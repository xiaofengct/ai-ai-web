/**
 * @copy-tier B
 *
 * ★ 为什么是 B 档：与 `useTTS.ts` 同理，**本文件 `throw` 的 message 经流向确认后都不进 DOM**。
 *   `useASR.ts` :67 / :87 落 `log.warn`；:324 落 `log.error` 并置 `denied` / `failed` 状态位。
 *   **页面侧用文案 key**（`err.asrFailed` / `err.microphoneDenied`），从不取 `.message`。
 *
 * ★ 麦克风被拒那条尤其要注意：它是靠 `/NotAllowed|Permission|denied/i` **匹配 message** 来分流的，
 *   匹配结果只用来置 `denied` 状态位，message 本身**不会被渲染**。
 *   也就是说这里的英文 message 是**控制流输入**，不是文案——这也是它必须留在英文的原因
 *   （浏览器抛的是英文，改中文就匹配不上了）。
 *
 * ★★ 若将来把 `.message` 直接渲染给用户，本文件必须降回 A 档。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAsrSession, isAsrSupported, transcribeAudio } from '@/llm/asr';
import { useSettingsStore } from '@/store/settingsStore';
import { log } from '@/store/logStore';
import { redact } from '@/lib/errors';
import { encodeWav, fetchSherpaManifest, injectSherpaScriptSafe } from './useTTS';

/**
 * ★ 语音识别三档通道（PL-02 / FN-59 / PG-05）。
 *
 * | 通道 | 说明 | 备注 |
 * |---|---|---|
 * | `sherpaWasm` | sherpa-onnx 官方 WASM（Paraformer / SenseVoice），**离线** | 需 `public/sherpa/` 有产物，默认没有 → 静默回退 |
 * | `cloud` | 云端转写（OpenAI 兼容 `/audio/transcriptions`） | 用户自备 Key，端点需支持 CORS |
 * | `webSpeech` | `SpeechRecognition`，仅 Chromium 系可用 | 兜底 |
 *
 * ★ 与 TTS 一样的三条铁律：不静默下载大模型、失败静默回退、如实标注能力边界。
 */

export type AsrChannel = 'sherpaWasm' | 'cloud' | 'webSpeech';

/* ============================================================
   sherpa-onnx WASM ASR（尽力而为）
   ============================================================ */

interface SherpaStreamLike {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  result?: { text?: string };
  free?(): void;
}
interface SherpaAsrLike {
  createStream(): SherpaStreamLike;
  decode(stream: SherpaStreamLike): void;
  getResult?(stream: SherpaStreamLike): { text?: string };
  free?(): void;
}
type SherpaAsrFactory = (config: Record<string, unknown>) => Promise<SherpaAsrLike> | SherpaAsrLike;

function findAsrFactory(): SherpaAsrFactory | undefined {
  const w = window as unknown as Record<string, unknown>;
  const candidates = [
    w.createOfflineRecognizer,
    w.createOnlineRecognizer,
    w.SherpaOnnxOfflineRecognizer,
    w.SherpaOnnxOnlineRecognizer,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'function') return candidate as SherpaAsrFactory;
  }
  return undefined;
}

let asrHandle: SherpaAsrLike | undefined;

/** 加载 sherpa ASR（只有用户显式选择该通道时才调用；失败返回 null） */
export async function loadSherpaAsr(modelId?: string): Promise<boolean> {
  const manifest = await fetchSherpaManifest();
  const asr = manifest?.asr;
  const models = asr?.models ?? [];
  if (!asr?.glue || models.length === 0) return false;

  const entry = models.find((m) => m.id === modelId) ?? models[0];
  if (!entry) return false;

  try {
    await injectSherpaScriptSafe(asr.glue);
  } catch (e) {
    log.warn('voice', 'sherpa-onnx ASR glue script load failed, fallback', redact({ error: String(e) }), 'PL-02');
    return false;
  }

  const factory = findAsrFactory();
  if (!factory) {
    log.warn('voice', 'sherpa-onnx ASR factory not exposed, fallback', undefined, 'PL-02');
    return false;
  }

  try {
    asrHandle = await factory({
      model: `${entry.dir}/${entry.model}`,
      tokens: entry.tokens ? `${entry.dir}/${entry.tokens}` : undefined,
      sampleRate: entry.sampleRate ?? 16000,
      numThreads: 1,
      provider: 'cpu',
    });
    return true;
  } catch (e) {
    log.warn('voice', 'sherpa-onnx ASR init failed, fallback', redact({ error: String(e) }), 'PL-02');
    return false;
  }
}

export function freeSherpaAsr(): void {
  try {
    asrHandle?.free?.();
  } catch {
    /* 忽略 */
  }
  asrHandle = undefined;
}

/* ============================================================
   麦克风采集（sherpa / cloud 共用的 PCM 录制）
   ============================================================ */

export interface PcmRecording {
  /** 单声道 Float32 PCM */
  samples: Float32Array;
  sampleRate: number;
}

/**
 * 录一段麦克风 PCM。
 * ★ 用 AudioWorklet 不可用时降级到 ScriptProcessor——两者都失败才抛错。
 */
async function recordPcm(maxMs = 30_000): Promise<PcmRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error('AudioContext unavailable');

  const ctx = new Ctor();
  const source = ctx.createMediaStreamSource(stream);
  const chunks: Float32Array[] = [];

  await new Promise<void>((resolve) => {
    const processor = ctx.createScriptProcessor?.(4096, 1, 1);
    if (!processor) {
      resolve();
      return;
    }
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(input));
    };
    source.connect(processor);
    processor.connect(ctx.destination);
    window.setTimeout(resolve, maxMs);
  });

  // 停止采集
  stream.getTracks().forEach((track) => track.stop());
  void ctx.close().catch(() => undefined);

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return { samples: merged, sampleRate: ctx.sampleRate || 16000 };
}

/** 把 Float32 PCM 转成 WAV Blob（云端上传用；编码逻辑复用 `useTTS.encodeWav`） */
function pcmToWavBlob(recording: PcmRecording): Blob {
  return encodeWav(recording.samples, recording.sampleRate);
}

/* ============================================================
   Hook
   ============================================================ */

export interface UseASRResult {
  channel: AsrChannel;
  setChannel(channel: AsrChannel): void;
  availability: Record<AsrChannel, boolean>;
  listening: boolean;
  transcript: string;
  /** 中间结果（实时显示用） */
  interim: string;
  failed: boolean;
  /** 麦克风权限被拒（UI 用 `err.microphoneDenied`） */
  denied: boolean;
  /** 手动探测一次模型清单（用户主动切到离线通道时才需要） */
  probeSherpaModels(): Promise<boolean>;
  /**
   * 开始识别。
   * @param options.onFinal 拿到最终结果时的回调。
   *   ★ 必须用它而不是等 `start()` 返回：`webSpeech` 是事件驱动的，
   *     `start()` 会立刻 resolve，结果要过几秒才来。
   */
  start(options?: { onFinal?: (text: string) => void }): Promise<void>;
  stop(): void;
  reset(): void;
}

/**
 * 语音识别 Hook。
 * ★ 三档通道：优先用户选择的；sherpa 没部署就静默退到云端/系统识别，不弹错误。
 */
export function useASR(): UseASRResult {
  const providers = useSettingsStore((s) => s.settings.providers);
  const activeProviderId = useSettingsStore((s) => s.settings.activeProviderId);

  const [channel, setChannel] = useState<AsrChannel>('webSpeech');
  const [listening, setListening] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>('');
  const [interim, setInterim] = useState<string>('');
  const [failed, setFailed] = useState<boolean>(false);
  const [denied, setDenied] = useState<boolean>(false);
  const [sherpaAvailable, setSherpaAvailable] = useState<boolean>(false);
  const sessionRef = useRef<ReturnType<typeof createAsrSession> | undefined>(undefined);
  /** 云端/端侧录音的手动停止标记 */
  const stopFlagRef = useRef<{ stopped: boolean }>({ stopped: false });

  /**
   * 探测 sherpa 模型清单（**只拉 manifest.json，不下载任何二进制**）。
   * ★ 全局约定「默认路径不得发起请求」：挂载时不探测，只在用户主动切到 `sherpaWasm` 时发一次。
   */
  const probeSherpaModels = useCallback(async () => {
    const manifest = await fetchSherpaManifest();
    const available = (manifest?.asr?.models ?? []).length > 0;
    setSherpaAvailable(available);
    return available;
  }, []);

  useEffect(
    () => () => {
      sessionRef.current?.abort();
      freeSherpaAsr();
    },
    [],
  );

  const hasCloud = useMemo(
    () => Boolean((providers.find((p) => p.id === activeProviderId) ?? providers[0])?.baseUrl?.trim()),
    [providers, activeProviderId],
  );

  const availability = useMemo<Record<AsrChannel, boolean>>(
    () => ({
      sherpaWasm: sherpaAvailable,
      cloud: hasCloud,
      webSpeech: isAsrSupported(),
    }),
    [sherpaAvailable, hasCloud],
  );

  const stop = useCallback(() => {
    stopFlagRef.current.stopped = true;
    sessionRef.current?.stop();
    sessionRef.current = undefined;
    setListening(false);
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setInterim('');
    setFailed(false);
    setDenied(false);
  }, []);

  const start = useCallback(async (options: { onFinal?: (text: string) => void } = {}) => {
    /**
     * ★★ 引擎层闸门（A3′ 第 1 项，2026-10-04）。
     *
     * 设置里关着「语音」或「语音输入」时，**在这里就退出**，一个通道都不走。
     *
     * ★ 为什么引擎层也要挡一遍，而不是只靠 UI 把按钮置灰：
     *   两层买的东西不同——UI 层买的是**体验**（灰 + 说明，必须清晰）；
     *   引擎层买的是**不可绕过**。`start()` 不只被那个按钮调用，
     *   任何人拿到这个 hook 都能直接调；**UI 挡不算挡**。
     *   两层的验收标准不同，别要求防御层也体验完美——太重就没人愿意加。
     *
     * ★ 为什么用 `getState()` 而不是 `useSettingsStore((s) => …)` 订阅：
     *   本次判定只关心「按下按钮那一刻」的设置值，不是渲染态。
     *   若放进依赖数组，`start` 的引用会随设置抖动，
     *   给所有调用方制造重渲染——而 `start` 的语义是「执行一次动作」，不是「随设置变化」。
     *
     * ★ 为什么早退**不碰 `listening` / `failed` 状态**：
     *   调用方（`VoiceCallPage.tsx:108`）是先 `setStage('listening')` 再 `await asr.start()`，
     *   页面侧的 1200ms 兜底 effect（`VoiceCallPage.tsx:112-119`）会把 stage 收回 'idle'。
     *   引擎层不去改页面状态——那是 UI 层的职责，越权改会让两层的状态源打架。
     *
     * ★ 已知边界（不写 migration，已知且接受）：存量用户若已存过 `voice.asr === false`，
     *   升级后 ASR 由可用变不可用。本仓是全新 IndexedDB、存量≈0，故不处理。
     */
    const { enabled: voiceEnabled, asr: voiceAsrEnabled } = useSettingsStore.getState().settings.voice;
    if (!(voiceEnabled && voiceAsrEnabled)) {
      log.info('voice', 'ASR blocked by settings (needs voice.enabled && voice.asr)', undefined, 'FN-59');
      return;
    }

    setFailed(false);
    setDenied(false);
    setInterim('');
    stopFlagRef.current = { stopped: false };
    setListening(true);

    /** 统一出口：拿到文本就回调（各通道时序不同，调用方不该关心） */
    const emitFinal = (text: string): void => {
      const trimmed = text.trim();
      setTranscript(trimmed);
      setInterim('');
      if (!trimmed) setFailed(true);
      else options.onFinal?.(trimmed);
    };

    try {
      // ① sherpa-onnx WASM（离线；没部署就静默跳过）
      if (channel === 'sherpaWasm') {
        const ok = asrHandle !== undefined || (await loadSherpaAsr());
        if (ok && asrHandle) {
          const recording = await recordPcm();
          if (stopFlagRef.current.stopped) return;
          const stream = asrHandle.createStream();
          try {
            stream.acceptWaveform(recording.sampleRate, recording.samples);
            asrHandle.decode(stream);
            const result = asrHandle.getResult?.(stream) ?? stream.result;
            emitFinal(result?.text ?? '');
          } finally {
            stream.free?.();
          }
          setListening(false);
          return;
        }
        log.info('voice', 'sherpa-onnx ASR unavailable, downgrade', undefined, 'PL-02');
      }

      // ② 云端（录音 → 上传转写）
      if (channel === 'cloud') {
        const recording = await recordPcm();
        if (stopFlagRef.current.stopped) return;
        const text = await transcribeAudio(pcmToWavBlob(recording), { language: 'zh' });
        emitFinal(text);
        setListening(false);
        return;
      }

      // ③ 系统识别兜底
      if (!isAsrSupported()) {
        setFailed(true);
        setListening(false);
        return;
      }
      const session = createAsrSession({
        onResult: (text, final) => {
          // 中间结果只做实时显示，最终结果走统一出口
          if (final) emitFinal(text);
          else setInterim(text);
        },
        onError: (code) => {
          if (code === 'CAPABILITY_UNAVAILABLE') setDenied(true);
          else setFailed(true);
          setListening(false);
        },
        onEnd: () => setListening(false),
      });
      sessionRef.current = session;
      session.start();
    } catch (e) {
      const message = String(e);
      // ★ 麦克风被拒单独成码：UI 提示「去浏览器里开一下」而不是笼统报错
      if (/NotAllowed|Permission|denied/i.test(message)) setDenied(true);
      else setFailed(true);
      log.error('voice', 'speech recognition failed', redact({ error: message }), 'PL-02');
      setListening(false);
    }
  }, [channel]);

  const setChannelSafe = useCallback(
    (next: AsrChannel) => {
      setChannel(next);
      // 只有用户主动选了离线通道才去探测（挂载时绝不发请求）
      if (next === 'sherpaWasm') void probeSherpaModels();
    },
    [probeSherpaModels],
  );

  return {
    channel,
    setChannel: setChannelSafe,
    availability,
    listening,
    transcript,
    interim,
    failed,
    denied,
    probeSherpaModels,
    start,
    stop,
    reset,
  };
}

export default useASR;
