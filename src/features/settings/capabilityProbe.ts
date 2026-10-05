/**
 * ★ Web 能力探针（PG-20 诊断页 / FN-58）。
 *
 * 原生 App 的诊断项是「无障碍权限 / 悬浮窗权限 / 后台保活」，
 * 这些在浏览器里没有意义（能力表 PG-20 = partial，替代方案 `alt.webProbe`）。
 * 因此这里换成**浏览器能力探针**，每一项都标注它替代的是哪一条原生能力：
 *
 * - File System Access  ← PL-11（全盘文件读写）
 * - Notification        ← PL-13（系统通知）
 * - Speech（听与说）     ← PL-14（端侧 sherpa-onnx）
 * - WASM SIMD          ← PL-15（onnxruntime-web 本地 embedding）
 * - 麦克风 / 相机        ← PL-02 / PL-03
 * - 振动                ← PL-12
 * - Service Worker      ← PL-08（开机自启 → PWA 安装）
 * - 存储配额             ← 浏览器给 IndexedDB 的额度
 *
 * ★ 所有探针都是**只读**的，不申请权限、不发请求、不写库。
 */

export type ProbeStatus = 'ok' | 'fail' | 'unknown';

export interface ProbeResult {
  /** 对应功能项 ID（PL-xx） */
  featureId: string;
  /** 探针名（诊断页展示，key 走 settingsCopy） */
  key: 'fsAccess' | 'notification' | 'speech' | 'wasmSimd' | 'microphone' | 'camera' | 'vibrate' | 'serviceWorker';
  status: ProbeStatus;
  /** 补充说明（权限状态、估算值等） */
  detail: string;
}

/** 权限 API 的最小形状（各浏览器实现不一，按需容错） */
interface PermissionsLike {
  query(descriptor: unknown): Promise<PermissionStatus>;
}

/** 权限查询的兜底：部分浏览器没有 permissions API */
async function queryPermission(name: string): Promise<PermissionState | 'unsupported'> {
  const perms = (navigator as Navigator & { permissions?: PermissionsLike }).permissions;
  if (!perms || typeof perms.query !== 'function') return 'unsupported';
  try {
    const status = await perms.query({ name });
    return status.state;
  } catch {
    return 'unsupported';
  }
}

/** File System Access（PL-11）：只有 Chromium 系能选目录 */
async function probeFsAccess(): Promise<ProbeResult> {
  const w = window as unknown as Record<string, unknown>;
  const ok = typeof w['showDirectoryPicker'] === 'function' || typeof w['showOpenFilePicker'] === 'function';
  return {
    featureId: 'PL-11',
    key: 'fsAccess',
    status: ok ? 'ok' : 'fail',
    detail: ok ? 'directories' : 'single-file',
  };
}

/** 系统通知（PL-13） */
async function probeNotification(): Promise<ProbeResult> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { featureId: 'PL-13', key: 'notification', status: 'fail', detail: 'no-api' };
  }
  const permission = await queryPermission('notifications');
  const state = permission === 'unsupported' ? Notification.permission : permission;
  return {
    featureId: 'PL-13',
    key: 'notification',
    status: state === 'granted' ? 'ok' : state === 'denied' ? 'fail' : 'unknown',
    detail: state,
  };
}

/** 语音（PL-14）：识别 + 朗读，两项都算进去 */
async function probeSpeech(): Promise<ProbeResult> {
  const w = window as unknown as Record<string, unknown>;
  const asr = typeof w['SpeechRecognition'] === 'function' || typeof w['webkitSpeechRecognition'] === 'function';
  const tts = typeof w['speechSynthesis'] !== 'undefined';
  return {
    featureId: 'PL-14',
    key: 'speech',
    status: asr && tts ? 'ok' : asr || tts ? 'unknown' : 'fail',
    detail: `asr=${asr ? 'yes' : 'no'} tts=${tts ? 'yes' : 'no'}`,
  };
}

/** WASM SIMD（PL-15）：本地 embedding 的硬件前提 */
async function probeWasmSimd(): Promise<ProbeResult> {
  try {
    // 一个只用了 v128 常量与 splat 的最小模块；能 validate 就说明支持 SIMD
    const bytes = new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
    ]);
    const ok = WebAssembly.validate(bytes);
    return { featureId: 'PL-15', key: 'wasmSimd', status: ok ? 'ok' : 'fail', detail: ok ? 'v128' : 'no-simd' };
  } catch {
    return { featureId: 'PL-15', key: 'wasmSimd', status: 'unknown', detail: 'no-wasm' };
  }
}

/** 麦克风（PL-02） */
async function probeMicrophone(): Promise<ProbeResult> {
  const has = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  if (!has) return { featureId: 'PL-02', key: 'microphone', status: 'fail', detail: 'no-api' };
  const state = await queryPermission('microphone');
  return {
    featureId: 'PL-02',
    key: 'microphone',
    status: state === 'granted' ? 'ok' : state === 'denied' ? 'fail' : 'unknown',
    detail: state,
  };
}

/** 相机（PL-03） */
async function probeCamera(): Promise<ProbeResult> {
  const has = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  if (!has) return { featureId: 'PL-03', key: 'camera', status: 'fail', detail: 'no-api' };
  const state = await queryPermission('camera');
  return {
    featureId: 'PL-03',
    key: 'camera',
    status: state === 'granted' ? 'ok' : state === 'denied' ? 'fail' : 'unknown',
    detail: state,
  };
}

/** 振动（PL-12）：iOS Safari 永远不行 */
async function probeVibrate(): Promise<ProbeResult> {
  const ok = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  return { featureId: 'PL-12', key: 'vibrate', status: ok ? 'ok' : 'fail', detail: ok ? 'api' : 'no-api' };
}

/** Service Worker（PL-08 → PWA 安装） */
async function probeServiceWorker(): Promise<ProbeResult> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { featureId: 'PL-08', key: 'serviceWorker', status: 'fail', detail: 'no-api' };
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      featureId: 'PL-08',
      key: 'serviceWorker',
      status: reg ? 'ok' : 'unknown',
      detail: reg ? 'registered' : 'not-installed',
    };
  } catch {
    return { featureId: 'PL-08', key: 'serviceWorker', status: 'unknown', detail: 'query-failed' };
  }
}

/** 跑一遍全部探针（并发，单项失败不影响其它项） */
export async function runCapabilityProbes(): Promise<ProbeResult[]> {
  const tasks: Promise<ProbeResult>[] = [
    probeFsAccess(),
    probeNotification(),
    probeSpeech(),
    probeWasmSimd(),
    probeMicrophone(),
    probeCamera(),
    probeVibrate(),
    probeServiceWorker(),
  ];
  const settled = await Promise.allSettled(tasks);
  return settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { featureId: 'unknown', key: 'serviceWorker', status: 'unknown' as ProbeStatus, detail: `probe-${i}-failed` },
  );
}

/** 存储配额（浏览器给 IndexedDB 的额度） */
export async function probeStorageQuota(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}

/** 申请通知权限（诊断页的「去开通知」按钮） */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'unsupported';
  }
}
