import { AppError, redact, toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { useSettingsStore } from '@/store/settingsStore';
import { buildHeaders, joinUrl, normalizeHttpError } from './adapter/compat';
import type { LLMProviderConfig } from '@/types/settings';
import type { UUID } from '@/types/common';

/**
 * 语音合成（FN-59 / PG-04）。
 *
 * 两条路：
 * 1. **云端 TTS**：Provider 配了 `pathOverrides.tts`（或默认 `/v1/audio/speech`）时走 OpenAI 兼容接口，
 *    拿到音频 Blob 后用 `<audio>` 播放，可配合角色音色（FN-55）；
 * 2. **Web Speech 兜底**（PL-02 / alt.ttsFallback）：`speechSynthesis`，零成本、离线可用，
 *    但音色不可控——失败或不可用时降级到这里，而不是直接报错。
 *
 * ★ 与「不可实现项」的边界：真正的**音色克隆**（克隆某个人的声音）在浏览器里做不到，
 *   只能选预置音色；这条降级理由写在能力表 FN-55 的 `reason` 里。
 */

export type TtsEngine = 'cloud' | 'webSpeech';

export interface SpeakOptions {
  text: string;
  /** 音色 ID（云端 TTS 用） */
  timbreId?: UUID;
  /** 语速 0.1~10，默认 1 */
  rate?: number;
  /** 音调 0~2，默认 1 */
  pitch?: number;
  lang?: string;
  providerId?: UUID;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SpeakResult {
  engine: TtsEngine;
  /** 云端 TTS 才有：音频元素（调用方负责管理生命周期） */
  audio?: HTMLAudioElement;
  /** 播放完成的 Promise（云端 = ended；Web Speech = utterance.onend） */
  done: Promise<void>;
}

/** 是否有可用的云端 TTS 端点 */
export function hasCloudTts(provider?: LLMProviderConfig): boolean {
  const p = provider ?? useSettingsStore.getState().activeProvider();
  return Boolean(p?.baseUrl?.trim());
}

/** 浏览器是否支持 Web Speech 兜底 */
export function isWebSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

/** 解析云端 TTS 地址 */
export function resolveTtsUrl(provider: LLMProviderConfig): string {
  return joinUrl(provider.baseUrl, provider.pathOverrides?.tts || '/v1/audio/speech');
}

/** 云端 TTS：返回可直接播放的音频元素 */
async function speakCloud(text: string, opts: SpeakOptions): Promise<SpeakResult> {
  const store = useSettingsStore.getState();
  const provider = opts.providerId
    ? store.settings.providers.find((p) => p.id === opts.providerId) ?? store.activeProvider()
    : store.activeProvider();
  if (!provider) throw new AppError('LLM_NO_PROVIDER', '还没有配置可用的模型服务', undefined);

  const url = resolveTtsUrl(provider);
  const timeoutMs = opts.timeoutMs ?? provider.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(provider.apiKey, provider.headers),
      body: JSON.stringify({
        model: provider.model,
        input: text,
        voice: opts.timbreId ?? 'alloy',
        response_format: 'mp3',
        speed: opts.rate ?? 1,
      }),
      signal: opts.signal ?? controller.signal,
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      const err = normalizeHttpError(res.status, bodyText);
      throw new AppError(err.code, err.message, redact({ status: res.status }));
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    audio.playbackRate = 1;

    const done = new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        URL.revokeObjectURL(objectUrl);
      };
      audio.addEventListener('ended', () => {
        cleanup();
        resolve();
      }, { once: true });
      audio.addEventListener('error', () => {
        cleanup();
        reject(new AppError('LLM_BAD_RESPONSE', '音频播放失败', undefined));
      }, { once: true });
    });

    void audio.play().catch(() => undefined);
    return { engine: 'cloud', audio, done };
  } catch (e) {
    throw toAppError(e, 'LLM_BAD_RESPONSE');
  } finally {
    clearTimeout(timer);
  }
}

/** Web Speech 兜底 */
function speakWebSpeech(text: string, opts: SpeakOptions): SpeakResult {
  if (!isWebSpeechAvailable()) {
    throw new AppError('CAPABILITY_UNAVAILABLE', '当前浏览器不支持语音合成', undefined);
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = opts.rate ?? 1;
  utterance.pitch = opts.pitch ?? 1;
  utterance.lang = opts.lang ?? 'zh-CN';

  const done = new Promise<void>((resolve, reject) => {
    utterance.onend = () => resolve();
    utterance.onerror = (event) => {
      const reason = (event as SpeechSynthesisErrorEvent).error ?? 'unknown';
      reject(new AppError('LLM_BAD_RESPONSE', `语音合成失败：${reason}`, undefined));
    };
  });

  window.speechSynthesis.speak(utterance);
  return { engine: 'webSpeech', done };
}

/**
 * 说话。云端失败**自动降级**到 Web Speech（除非用户主动取消）。
 * ★ 不静默吞错：两条路都失败才抛，且抛的是 AppError（UI 用文案 key 提示）。
 */
export async function speak(opts: SpeakOptions): Promise<SpeakResult> {
  const text = opts.text.trim();
  if (!text) throw new AppError('LLM_BAD_RESPONSE', '没有要念的内容', undefined);

  const store = useSettingsStore.getState();
  const wantCloud = store.settings.voice.tts && hasCloudTts();

  if (wantCloud) {
    try {
      return await speakCloud(text, opts);
    } catch (e) {
      const err = toAppError(e);
      if (err.code === 'ABORTED' || err.code === 'LLM_ABORT') throw err;
      log.warn('llm', '云端语音合成失败，降级为浏览器合成', redact({ code: err.code }), 'FN-59');
    }
  }

  if (isWebSpeechAvailable()) return speakWebSpeech(text, opts);
  throw new AppError('CAPABILITY_UNAVAILABLE', '当前浏览器不支持语音合成', undefined);
}

/** 停止当前朗读（切会话 / 页面隐藏时调用） */
export function stopSpeak(): void {
  if (isWebSpeechAvailable()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* 忽略 */
    }
  }
}
