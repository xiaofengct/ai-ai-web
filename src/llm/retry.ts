import { AppError, isAbortError, isRetryable, toAppError } from '@/lib/errors';

/**
 * 重试策略（架构文档 §2 `src/llm/retry.ts`）。
 *
 * ★ 验收要点⑥：5xx / 超时**可重试**，4xx **不重试**，指数退避。
 *   可重试判定统一走 `lib/errors.isRetryable()`，避免两处各写一份规则。
 *
 * 退避：base * factor^attempt，带 ±20% 抖动（避免同一秒打爆端点），上限 maxDelayMs。
 */

export interface RetryOptions {
  /** 额外重试次数（不含首次），默认 2 */
  retries?: number;
  /** 首次退避基数，默认 500ms */
  baseDelayMs?: number;
  /** 退避上限，默认 8s */
  maxDelayMs?: number;
  /** 退避倍数，默认 2 */
  factor?: number;
  /** 是否加抖动，默认 true */
  jitter?: boolean;
  /** 外部取消信号 */
  signal?: AbortSignal;
  /** 每次重试前回调（用于日志 / UI 提示） */
  onRetry?: (info: { attempt: number; error: AppError; delayMs: number }) => void;
}

export const DEFAULT_RETRY: Required<Omit<RetryOptions, 'signal' | 'onRetry'>> = {
  retries: 2,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  factor: 2,
  jitter: true,
};

/** 计算第 attempt 次（从 0 开始）的退避毫秒数 */
export function backoffDelay(attempt: number, opts: RetryOptions = {}): number {
  const base = opts.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs;
  const factor = opts.factor ?? DEFAULT_RETRY.factor;
  const max = opts.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs;
  const raw = Math.min(max, base * factor ** Math.max(0, attempt));
  if (opts.jitter === false) return Math.round(raw);
  // ±20% 抖动
  const delta = raw * 0.2;
  return Math.round(raw - delta + Math.random() * delta * 2);
}

/** 可被 AbortSignal 打断的 sleep */
export function sleepCancellable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class RetryPolicy {
  private readonly opts: RetryOptions;

  constructor(opts: RetryOptions = {}) {
    this.opts = opts;
  }

  /** 执行；非可重试错误立即抛出，可重试错误耗尽次数后抛出最后一次的错误 */
  async run<T>(fn: (attempt: number) => Promise<T>): Promise<T> {
    const maxAttempts = (this.opts.retries ?? DEFAULT_RETRY.retries) + 1;
    let lastError: AppError | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (this.opts.signal?.aborted) {
        throw new AppError('ABORTED', '请求已取消', undefined);
      }
      try {
        return await fn(attempt);
      } catch (e) {
        const err = toAppError(e);
        lastError = err;

        // ★ 主动取消 / 4xx —— 不重试
        if (isAbortError(e) || err.code === 'ABORTED' || err.code === 'LLM_ABORT') {
          throw new AppError('LLM_ABORT', '请求已取消', undefined);
        }
        if (!isRetryable(err)) throw err;

        const isLast = attempt >= maxAttempts - 1;
        if (isLast) break;

        const delayMs = backoffDelay(attempt, this.opts);
        this.opts.onRetry?.({ attempt: attempt + 1, error: err, delayMs });
        try {
          await sleepCancellable(delayMs, this.opts.signal);
        } catch {
          throw new AppError('LLM_ABORT', '请求已取消', undefined);
        }
      }
    }

    throw lastError ?? new AppError('UNKNOWN', '重试后仍然失败');
  }
}

/** 默认重试策略（单例，client 直接用） */
export const defaultRetryPolicy = new RetryPolicy();

/**
 * 生成一个「超时会自动 abort」的信号，并与外部信号合并。
 * 用完必须调返回的 `dispose()`，否则定时器会挂住。
 */
export function createTimeoutSignal(
  timeoutMs: number,
  outer?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  const onOuterAbort = (): void => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onOuterAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    },
  };
}
