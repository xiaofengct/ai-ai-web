import { AppError } from './errors';

/**
 * sleep（架构文档 §2 `lib/sleep.ts`）：延时 + 可取消延时（配合 AbortController）。
 * 用于 FN-17 发送延时、FN-24 多条消息延时、重试退避。
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

/**
 * 可取消的 sleep。
 * 已存在的 signal 若已 abort，立即 reject。
 */
export function sleepCancellable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AppError('ABORTED', 'sleep 已取消'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));

    function onAbort(): void {
      clearTimeout(timer);
      reject(new AppError('ABORTED', 'sleep 已取消'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 指数退避：base * 2^attempt，带上限与抖动 */
export function backoffDelay(attempt: number, base = 500, max = 15_000): number {
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt));
  const jitter = Math.random() * raw * 0.2;
  return Math.floor(raw + jitter);
}

/** 带超时的 Promise 包装（LLM 请求的兜底，真正取消靠 fetch 的 signal） */
export function withTimeout<T>(promise: Promise<T>, ms: number, message = '操作超时'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AppError('LLM_TIMEOUT', message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
