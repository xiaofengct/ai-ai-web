/**
 * Service Worker 注册（T01）。
 *
 * 只做静态资源缓存（见 `public/sw.js`）：
 * - 不实现 Web Push（需要服务端，本版本是纯前端）；
 * - 不做后台常驻调度（主动消息由页面内 scheduler + Worker 心跳负责）；
 * - 生产环境才注册，开发环境注册会干扰 HMR。
 */

const SW_URL = '/sw.js';

export interface RegisterSWOptions {
  /** 是否强制注册（默认仅生产环境） */
  force?: boolean;
  /** 发现新版本时的回调（用于提示用户刷新） */
  onUpdate?: () => void;
  /** 首次安装完成 */
  onReady?: () => void;
  /** 注册失败 */
  onError?: (err: unknown) => void;
}

/** 环境判断：默认只在生产注册 */
export function shouldRegisterSW(force = false): boolean {
  if (force) return true;
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env.PROD && import.meta.env.VITE_ENABLE_SW !== 'false';
  }
  return false;
}

/**
 * 注册 Service Worker。
 * 浏览器不支持 / 非安全上下文 / 注册失败时静默降级，绝不抛错中断启动。
 */
export async function registerSW(options: RegisterSWOptions = {}): Promise<boolean> {
  const { force = false, onUpdate, onReady, onError } = options;

  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  if (!shouldRegisterSW(force)) return false;

  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' });

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          // 已有旧 SW 在控制页面 → 说明是更新
          onUpdate?.();
        } else if (installing.state === 'activated') {
          onReady?.();
        }
      });
    });

    if (registration.active) onReady?.();
    return true;
  } catch (err) {
    onError?.(err);
    return false;
  }
}

/** 注销所有 Service Worker（开发者页「清空缓存」用） */
export async function unregisterSW(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    return true;
  } catch {
    return false;
  }
}

/** 通知 SW 跳过等待，立即接管 */
export async function skipWaiting(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
}

export default registerSW;
