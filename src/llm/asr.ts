import { AppError, redact, toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { useSettingsStore } from '@/store/settingsStore';
import { buildHeaders, joinUrl, normalizeHttpError } from './adapter/compat';
import type { LLMProviderConfig } from '@/types/settings';
import type { UUID } from '@/types/common';

/**
 * 语音识别（PL-02）。
 *
 * 两条路：
 * 1. **Web Speech（`SpeechRecognition`）**：浏览器原生、零成本，但只有 Chromium 系支持，
 *    且需要麦克风权限 —— 权限被拒时抛 `CAPABILITY_UNAVAILABLE`，UI 用 `err.microphoneDenied` 提示；
 * 2. **云端 ASR**：兼容 OpenAI `/v1/audio/transcriptions`（multipart），
 *    需要端点支持 CORS，失败抛 `LLM_CORS`。
 *
 * ★ 不可实现部分：浏览器拿不到「系统级输入法监听」，
 *   所以做不到「任何输入框都能语音输入」，只能在应用内的录音入口使用（能力表 PL-02 已标注）。
 */

/** 极简 SpeechRecognition 类型声明（避免依赖 TS lib 版本差异） */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike {
  error?: string;
  message?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** 浏览器是否支持原生语音识别 */
export function isAsrSupported(): boolean {
  return getRecognitionCtor() !== undefined;
}

export interface AsrHandlers {
  /** 实时结果（final=false 为中间结果） */
  onResult?: (text: string, final: boolean) => void;
  onError?: (code: string, message: string) => void;
  onEnd?: () => void;
}

export interface AsrSession {
  start(): void;
  stop(): void;
  abort(): void;
  readonly supported: boolean;
}

/**
 * 创建一次识别会话。
 * ★ 权限被拒（`not-allowed`）单独成码，方便 UI 给出「去设置里开麦克风」而不是笼统报错。
 */
export function createAsrSession(handlers: AsrHandlers = {}, lang = 'zh-CN'): AsrSession {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    return {
      supported: false,
      start: () => handlers.onError?.('CAPABILITY_UNAVAILABLE', 'unsupported'),
      stop: () => undefined,
      abort: () => undefined,
    };
  }

  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event: SpeechRecognitionEventLike) => {
    let transcript = '';
    let final = false;
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result) continue;
      transcript += result[0]?.transcript ?? '';
      if (result.isFinal) final = true;
    }
    if (transcript) handlers.onResult?.(transcript, final);
  };

  recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
    const raw = event.error ?? 'unknown';
    const code = raw === 'not-allowed' || raw === 'service-not-allowed' ? 'CAPABILITY_UNAVAILABLE' : 'LLM_BAD_RESPONSE';
    log.warn('llm', '语音识别出错', redact({ error: raw }), 'PL-02');
    handlers.onError?.(code, raw);
  };

  recognition.onend = () => handlers.onEnd?.();

  return {
    supported: true,
    start: () => recognition.start(),
    stop: () => recognition.stop(),
    abort: () => recognition.abort(),
  };
}

/** 云端 ASR 地址（OpenAI 兼容） */
export function resolveAsrUrl(provider: LLMProviderConfig): string {
  return joinUrl(provider.baseUrl, '/v1/audio/transcriptions');
}

/**
 * 云端转写（上传音频 Blob）。
 * 端点不支持 / CORS 失败 → 抛 `LLM_CORS`，由 UI 引导改用浏览器原生识别。
 */
export async function transcribeAudio(
  audio: Blob,
  opts: { providerId?: UUID; language?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  const store = useSettingsStore.getState();
  const provider = opts.providerId
    ? store.settings.providers.find((p) => p.id === opts.providerId) ?? store.activeProvider()
    : store.activeProvider();
  if (!provider) throw new AppError('LLM_NO_PROVIDER', '还没有配置可用的模型服务', undefined);

  const form = new FormData();
  const ext = audio.type.includes('webm') ? 'webm' : audio.type.includes('mp4') ? 'mp4' : 'wav';
  form.append('file', audio, `speech.${ext}`);
  form.append('model', provider.model || 'whisper-1');
  if (opts.language) form.append('language', opts.language);

  const timeoutMs = opts.timeoutMs ?? provider.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(resolveAsrUrl(provider), {
      method: 'POST',
      // ★ FormData 不能手动设 Content-Type（浏览器要带 boundary），这里只带鉴权
      headers: buildHeaders(provider.apiKey, provider.headers),
      body: form,
      signal: opts.signal ?? controller.signal,
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      const err = normalizeHttpError(res.status, bodyText);
      throw new AppError(err.code, err.message, redact({ status: res.status }));
    }
    const json = (await res.json()) as unknown;
    if (typeof json === 'object' && json !== null) {
      const text = (json as Record<string, unknown>).text;
      if (typeof text === 'string') return text.trim();
    }
    throw new AppError('LLM_BAD_RESPONSE', '转写服务没有返回文本', undefined);
  } catch (e) {
    throw toAppError(e, 'LLM_CORS');
  } finally {
    clearTimeout(timer);
  }
}
