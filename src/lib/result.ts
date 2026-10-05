import { AppError, toAppError, type AppErrorCode } from './errors';
import type { Result } from '@/types/common';

/**
 * Result 辅助（架构文档 §6.2）。
 * 所有 repo 方法返回 `Result<T>` 或抛 `AppError`，避免到处 try/catch。
 */

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(error: AppError | string, detail?: unknown): Result<T> {
  const e = typeof error === 'string' ? new AppError('UNKNOWN', error, detail) : error;
  return { ok: false, error: e };
}

/** 同步 try/catch → Result */
export function tryCatch<T>(fn: () => T, code: AppErrorCode = 'UNKNOWN'): Result<T> {
  try {
    return ok(fn());
  } catch (e) {
    return err<T>(toAppError(e, code));
  }
}

/** 异步 try/catch → Result */
export async function tryCatchAsync<T>(
  fn: () => Promise<T>,
  code: AppErrorCode = 'UNKNOWN',
): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err<T>(toAppError(e, code));
  }
}

/** 取值，失败时返回默认值 */
export function unwrapOr<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** 取值，失败时抛错（在确定不会失败的场景用） */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw result.error;
}

/** 映射成功值 */
export function mapResult<T, U>(result: Result<T>, fn: (value: T) => U): Result<U> {
  return result.ok ? ok(fn(result.value)) : err<U>(result.error);
}

export type { Result };
