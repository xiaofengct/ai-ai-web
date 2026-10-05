/**
 * @copy-tier B
 *
 * ★ 为什么是 B 档：**本文件所有 `throw`/`Error` 的 message 经流向确认后都不进 DOM。**
 *   逐条核对过 catch 分支：全部落 `log.warn` / `log.error`（`useTTS.ts` :171 / :195 / :398 / :411），
 *   并置 `failed` / `denied` 状态位；**页面侧用的是文案 key，不是 `.message`**——
 *   `VoiceCallPage` 用 `err.ttsFailed`，`VoiceTestPage` 用 `err.ttsFailed` / `alt.ttsFallback`。
 *   所以这些英文 message 只出现在日志与开发者页，属设计允许的通道（§6.8 三档口径）。
 *
 * ★ 这不是"我看它像日志就豁免"，是**追过流向**：`throw` → `catch` → `log.*`（终），没有一条到组件 props。
 *
 * ★★ 若将来有人把这里某个 `Error` 的 `.message` 直接渲染给用户（比如 `snack.error(err.message)`），
 *   本文件必须**降回 A 档**并把那条 message 改成走文案表——判据是流向变了，不是文件名。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isWebSpeechAvailable, speak as speakCloud } from '@/llm/tts';
import { useSettingsStore } from '@/store/settingsStore';
import { log } from '@/store/logStore';
import { redact } from '@/lib/errors';
import type { UUID } from '@/types/common';

/**
 * ★ 语音合成三档通道（FN-59 / PG-04 / PL-14）。
 *
 * | 通道 | 说明 | 成本 | 体积 |
 * |---|---|---|---|
 * | `sherpaWasm` | sherpa-onnx 官方 WebAssembly（Apache-2.0），**与原应用 APK 同一个引擎** | 0 | 引擎 ~10MB + 模型 20~150MB，**默认不下载** |
 * | `cloud` | 用户自备 Key 的云端 TTS（OpenAI 兼容 `/audio/speech`） | 按量 | 0 |
 * | `webSpeech` | 浏览器 `speechSynthesis` 兜底 | 0 | 0 |
 *
 * ★★ 三条铁律：
 * 1. **绝不首屏静默下载几十 MB**：sherpa 的 wasm 与模型只在用户显式选择该通道、
 *    且 `public/sherpa/manifest.json` 存在时才按需加载；拿不到就**静默回退**，不弹错误。
 * 2. **如实标注音色**：sherpa 用的是模型自带的固定 `speaker id`，
 *    **不等价于**原 App 的硅基流动语音克隆——UI 上必须写清楚（`alt.ttsFallback`）。
 * 3. 通道降级链：`sherpaWasm → cloud → webSpeech`，全挂才报错，且报错文案走 `err.ttsFailed`。
 */

export type TtsChannel = 'sherpaWasm' | 'cloud' | 'webSpeech';

/** `public/sherpa/manifest.json` 的模型条目 */
export interface SherpaModelEntry {
  id: string;
  label: string;
  /** 模型目录（相对站点根，如 `/sherpa/model-tts-vits-zh-aishell3`） */
  dir: string;
  /** 模型文件名（如 `model.onnx`） */
  model: string;
  tokens?: string;
  lexicon?: string;
  dataDir?: string;
  ruleFsts?: string;
  /** 说话人 id（固定 speaker id，不是语音克隆） */
  speakerId?: number;
  sampleRate?: number;
}

export interface SherpaManifest {
  version: number;
  engine: string;
  license: string;
  tts?: {
    /** 胶水层脚本，如 `/sherpa/sherpa-onnx-tts.js` */
    glue?: string;
    wasm?: string;
    data?: string;
    models?: SherpaModelEntry[];
  };
  asr?: {
    glue?: string;
    wasm?: string;
    data?: string;
    models?: SherpaModelEntry[];
  };
}

/** 动态脚本注入缓存（同 URL 只注入一次） */
const injectedScripts = new Map<string, Promise<void>>();

function injectScript(src: string): Promise<void> {
  const cached = injectedScripts.get(src);
  if (cached) return cached;
  const task = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`script load failed: ${src}`));
    document.head.appendChild(script);
  });
  injectedScripts.set(src, task);
  return task;
}

/** 供 `useASR.ts` 复用（同 URL 只注入一次；失败只 reject，不弹 UI 错误） */
export function injectSherpaScriptSafe(src: string): Promise<void> {
  return injectScript(src);
}

/** 拿 manifest；404 / 解析失败都返回 null（静默回退，不弹错） */
export async function fetchSherpaManifest(): Promise<SherpaManifest | null> {
  try {
    const res = await fetch('/sherpa/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    return typeof json === 'object' && json !== null ? (json as SherpaManifest) : null;
  } catch {
    return null;
  }
}

/* ============================================================
   WAV 编码（sherpa 返回 Float32Array，浏览器要能播放）
   ============================================================ */

/** 把 Float32 PCM 编码成 16bit WAV Blob */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string): void => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

/* ============================================================
   sherpa-onnx WASM：尽力而为的加载器
   ============================================================ */

/** 官方胶水层暴露的构造器形状（不同版本名字不一样，全部按可选处理） */
interface SherpaTtsLike {
  generate(input: { text: string; sid?: number; speed?: number }):
    | { samples: Float32Array; sampleRate: number }
    | undefined;
  free?(): void;
}
type SherpaFactory = (config: Record<string, unknown>) => Promise<SherpaTtsLike> | SherpaTtsLike;

function findTtsFactory(): SherpaFactory | undefined {
  const w = window as unknown as Record<string, unknown>;
  const candidates = [w.createOfflineTts, w.SherpaOnnxOfflineTts, w.sherpaOnnxOfflineTts];
  for (const candidate of candidates) {
    if (typeof candidate === 'function') return candidate as SherpaFactory;
  }
  return undefined;
}

let ttsHandle: SherpaTtsLike | undefined;
let ttsModelId: string | undefined;

/**
 * 加载 sherpa-onnx TTS（**只有用户显式选了这个通道才会调**）。
 * 任何一步失败都返回 null，由调用方静默回退。
 */
export async function loadSherpaTts(modelId?: string): Promise<{ modelId: string; entry: SherpaModelEntry } | null> {
  const manifest = await fetchSherpaManifest();
  const tts = manifest?.tts;
  const models = tts?.models ?? [];
  if (!tts?.glue || models.length === 0) return null;

  const entry = models.find((m) => m.id === modelId) ?? models[0];
  if (!entry) return null;

  try {
    await injectScript(tts.glue);
  } catch (e) {
    log.warn('voice', 'sherpa-onnx TTS glue script load failed, fallback', redact({ error: String(e) }), 'PL-14');
    return null;
  }

  const factory = findTtsFactory();
  if (!factory) {
    log.warn('voice', 'sherpa-onnx TTS factory not exposed, fallback', undefined, 'PL-14');
    return null;
  }

  try {
    const handle = await factory({
      model: `${entry.dir}/${entry.model}`,
      tokens: entry.tokens ? `${entry.dir}/${entry.tokens}` : undefined,
      lexicon: entry.lexicon ? `${entry.dir}/${entry.lexicon}` : undefined,
      dataDir: entry.dataDir ? `${entry.dir}/${entry.dataDir}` : undefined,
      ruleFsts: entry.ruleFsts ? `${entry.dir}/${entry.ruleFsts}` : undefined,
      numThreads: 1,
      provider: 'cpu',
    });
    ttsHandle = handle;
    ttsModelId = entry.id;
    return { modelId: entry.id, entry };
  } catch (e) {
    log.warn('voice', 'sherpa-onnx TTS init failed, fallback', redact({ error: String(e) }), 'PL-14');
    return null;
  }
}

export function isSherpaTtsReady(modelId?: string): boolean {
  if (!ttsHandle) return false;
  return modelId === undefined || ttsModelId === modelId;
}

/** 释放 sherpa 实例（切换模型 / 卸载页面时） */
export function freeSherpaTts(): void {
  try {
    ttsHandle?.free?.();
  } catch {
    /* 忽略 */
  }
  ttsHandle = undefined;
  ttsModelId = undefined;
}

/* ============================================================
   Web Speech 兜底
   ============================================================ */

function speakWebSpeech(text: string, rate: number, pitch: number, lang: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!isWebSpeechAvailable()) {
      reject(new Error('webSpeech unavailable'));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.lang = lang;
    utterance.onend = () => resolve();
    utterance.onerror = (event) => reject(new Error(String((event as SpeechSynthesisErrorEvent).error ?? 'error')));
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

/* ============================================================
   Hook
   ============================================================ */

export interface SpeakOptionsLite {
  rate?: number;
  pitch?: number;
  /** 云端 TTS 的音色 id（FN-55） */
  timbreId?: UUID;
  /** sherpa 的 speaker id（固定说话人，非克隆） */
  speakerId?: number;
  lang?: string;
}

export interface UseTTSResult {
  channel: TtsChannel;
  setChannel(channel: TtsChannel): void;
  /** 各通道当前是否可用 */
  availability: Record<TtsChannel, boolean>;
  /** 已部署的 sherpa 模型（未下载模型时为空数组） */
  sherpaModels: SherpaModelEntry[];
  sherpaModelId?: string;
  setSherpaModelId(id: string): void;
  /** sherpa 引擎是否已就绪（未部署 wasm 时恒为 false） */
  sherpaReady: boolean;
  /** 手动探测一次模型清单（用户主动切到离线通道时才需要） */
  probeSherpaModels(): Promise<boolean>;
  loading: boolean;
  speaking: boolean;
  /** 失败原因编码（UI 用 `err.ttsFailed` 提示，不展示原始错误） */
  failed: boolean;
  speak(text: string, options?: SpeakOptionsLite): Promise<TtsChannel>;
  stop(): void;
}

/**
 * 语音合成 Hook。
 * ★ 返回值里的 `channel` 是**实际使用**的通道（可能与请求的不同——降级后如实回报）。
 */
export function useTTS(): UseTTSResult {
  const patchSettings = useSettingsStore((s) => s.patch);
  const voiceTtsEnabled = useSettingsStore((s) => s.settings.voice.tts);
  const providers = useSettingsStore((s) => s.settings.providers);
  const activeProviderId = useSettingsStore((s) => s.settings.activeProviderId);
  /** 云端通道是否可用：至少要有 baseUrl（Key 由用户自备） */
  const hasCloud = useMemo(
    () => Boolean((providers.find((p) => p.id === activeProviderId) ?? providers[0])?.baseUrl?.trim()),
    [providers, activeProviderId],
  );

  const [channel, setChannelState] = useState<TtsChannel>('webSpeech');
  const [sherpaModels, setSherpaModels] = useState<SherpaModelEntry[]>([]);
  const [sherpaModelId, setSherpaModelId] = useState<string | undefined>(undefined);
  const [sherpaReady, setSherpaReady] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [speaking, setSpeaking] = useState<boolean>(false);
  const [failed, setFailed] = useState<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | undefined>(undefined);

  /**
   * 探测 sherpa 模型清单（**只拉 manifest.json，不下载任何二进制**）。
   *
   * ★★ 全局约定「默认路径不得发起任何请求」：
   *   这里**不在组件挂载时自动探测**，只在用户主动切到 `sherpaWasm` 通道时才发一次。
   *   没有部署产物 → 404 → 静默返回空列表，不弹错、不重试。
   */
  const probeSherpaModels = useCallback(async () => {
    const manifest = await fetchSherpaManifest();
    setSherpaModels(manifest?.tts?.models ?? []);
    return (manifest?.tts?.models ?? []).length > 0;
  }, []);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const availability = useMemo<Record<TtsChannel, boolean>>(
    () => ({
      sherpaWasm: sherpaModels.length > 0,
      cloud: hasCloud && voiceTtsEnabled,
      webSpeech: isWebSpeechAvailable(),
    }),
    [sherpaModels.length, hasCloud, voiceTtsEnabled],
  );

  const ensureSherpa = useCallback(
    async (modelId?: string): Promise<SherpaModelEntry | null> => {
      if (isSherpaTtsReady(modelId ?? sherpaModelId)) {
        return sherpaModels.find((m) => m.id === (modelId ?? sherpaModelId)) ?? null;
      }
      setLoading(true);
      try {
        const loaded = await loadSherpaTts(modelId ?? sherpaModelId);
        setSherpaReady(Boolean(loaded));
        if (loaded) setSherpaModelId(loaded.modelId);
        return loaded?.entry ?? null;
      } finally {
        setLoading(false);
      }
    },
    [sherpaModelId, sherpaModels],
  );

  const speak = useCallback(
    async (text: string, options: SpeakOptionsLite = {}): Promise<TtsChannel> => {
      const content = text.trim();
      if (!content) return channel;
      setFailed(false);
      setSpeaking(true);
      try {
        // ① sherpa-onnx WASM（未下载模型 → 静默跳过）
        if (channel === 'sherpaWasm') {
          const entry = await ensureSherpa();
          if (ttsHandle && entry) {
            const result = ttsHandle.generate({
              text: content,
              sid: options.speakerId ?? entry.speakerId ?? 0,
              speed: options.rate ?? 1,
            });
            const samples = result?.samples;
            const sampleRate = result?.sampleRate ?? entry.sampleRate ?? 22050;
            if (samples && samples.length > 0) {
              const blob = encodeWav(samples, sampleRate);
              const url = URL.createObjectURL(blob);
              const audio = new Audio(url);
              audioRef.current = audio;
              await new Promise<void>((resolve, reject) => {
                audio.onended = () => {
                  URL.revokeObjectURL(url);
                  resolve();
                };
                audio.onerror = () => {
                  URL.revokeObjectURL(url);
                  reject(new Error('audio playback failed'));
                };
                void audio.play().catch(reject);
              });
              return 'sherpaWasm';
            }
          }
          // 拿不到引擎 → 静默降级到云端 / 系统音色
          log.info('voice', 'sherpa-onnx unavailable, downgrade to cloud/system voice', undefined, 'PL-14');
        }

        // ② 云端（用户自备 Key）
        if (channel !== 'webSpeech') {
          if (!voiceTtsEnabled) patchSettings({ voice: { tts: true } });
          try {
            const res = await speakCloud({
              text: content,
              timbreId: options.timbreId,
              rate: options.rate ?? 1,
              pitch: options.pitch ?? 1,
              lang: options.lang ?? 'zh-CN',
            });
            return res.engine === 'cloud' ? 'cloud' : 'webSpeech';
          } catch (e) {
            log.warn('voice', 'cloud TTS failed, downgrade to system voice', redact({ error: String(e) }), 'FN-59');
          }
        }

        // ③ 系统音色兜底
        if (isWebSpeechAvailable()) {
          await speakWebSpeech(content, options.rate ?? 1, options.pitch ?? 1, options.lang ?? 'zh-CN');
          return 'webSpeech';
        }

        setFailed(true);
        return channel;
      } catch (e) {
        setFailed(true);
        log.error('voice', 'speech synthesis failed', redact({ error: String(e) }), 'FN-59');
        return channel;
      } finally {
        setSpeaking(false);
      }
    },
    [channel, ensureSherpa, patchSettings, voiceTtsEnabled],
  );

  const stop = useCallback(() => {
    audioRef.current?.pause();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* 忽略 */
    }
    setSpeaking(false);
  }, []);

  const setChannel = useCallback(
    (next: TtsChannel) => {
      setChannelState(next);
      setSherpaReady(isSherpaTtsReady());
      // 只有用户主动选了离线通道才去探测（挂载时绝不发请求）
      if (next === 'sherpaWasm') void probeSherpaModels();
    },
    [probeSherpaModels],
  );

  return {
    channel,
    setChannel,
    availability,
    sherpaModels,
    sherpaModelId,
    setSherpaModelId,
    sherpaReady,
    probeSherpaModels,
    loading,
    speaking,
    failed,
    speak,
    stop,
  };
}

export default useTTS;
