import type { ISODate } from '@/types/common';

/**
 * 统一错误类型（架构文档 §6.2）。
 *
 * 约定：
 * - 所有 repo / service 抛 `AppError` 或返回 `Result<T>`；
 * - **面向用户的提示只传文案 key**，不把 `err.message` 直接显示给用户
 *   （英文原始 message 只进日志与开发者页）。
 */

export type AppErrorCode =
  // LLM
  | 'LLM_TIMEOUT'
  | 'LLM_AUTH'
  | 'LLM_ABORT'
  | 'LLM_RATE_LIMIT'
  | 'LLM_BAD_RESPONSE'
  | 'LLM_NO_PROVIDER'
  | 'LLM_NO_MODEL'
  | 'LLM_CORS'
  // 解析 / 导入导出
  | 'PARSE_FAIL'
  | 'PARSE_UNSUPPORTED'
  | 'IMPORT_INVALID'
  // 存储
  | 'DB_FAILED'
  | 'STORAGE_FULL'
  // 隐私与能力
  | 'PRIVACY_BLOCK'
  | 'CAPABILITY_UNAVAILABLE'
  // 其它
  | 'NETWORK_OFFLINE'
  | 'ABORTED'
  | 'UNKNOWN';

export class AppError extends Error {
  readonly code: AppErrorCode | string;
  readonly detail?: unknown;
  readonly at: ISODate;

  constructor(code: AppErrorCode | string, message: string, detail?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
    this.at = new Date().toISOString();
    // 兼容 ES5 目标下的 instanceof
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /** 供日志使用（不含敏感信息，detail 需先过 redact） */
  toJSON(): { code: string; message: string; at: string } {
    return { code: this.code, message: this.message, at: this.at };
  }
}

/** 判定是否为 AppError */
export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** 是否为「用户主动取消」 */
export function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return true;
  if (isAppError(e)) return e.code === 'ABORTED' || e.code === 'LLM_ABORT';
  return e instanceof Error && e.name === 'AbortError';
}

/** 归一化为 AppError（fetch / Abort / HTTP / JSON 解析统一处理） */
export function toAppError(e: unknown, fallbackCode: AppErrorCode = 'UNKNOWN'): AppError {
  if (isAppError(e)) return e;

  if (isAbortError(e)) {
    return new AppError('ABORTED', '请求已取消', e);
  }

  if (e instanceof TypeError) {
    // fetch 失败（CORS / DNS / 断网）在浏览器里都是 TypeError: Failed to fetch
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return new AppError(offline ? 'NETWORK_OFFLINE' : 'LLM_CORS', e.message, e);
  }

  if (e instanceof DOMException) {
    if (e.name === 'QuotaExceededError') {
      return new AppError('STORAGE_FULL', '浏览器存储空间不足', e);
    }
    return new AppError('DB_FAILED', e.message, e);
  }

  if (typeof e === 'object' && e !== null && 'status' in e) {
    const status = Number((e as { status: unknown }).status);
    return httpErrorToAppError(status, e);
  }

  if (e instanceof Error) {
    return new AppError(fallbackCode, e.message, e);
  }

  return new AppError(fallbackCode, String(e), e);
}

/** HTTP 状态码 → AppError（4xx 不重试，5xx/429 可重试，见 llm/retry.ts） */
export function httpErrorToAppError(status: number, detail?: unknown): AppError {
  if (status === 401 || status === 403) {
    return new AppError('LLM_AUTH', `认证失败（HTTP ${status}）`, detail);
  }
  if (status === 408 || status === 504) {
    return new AppError('LLM_TIMEOUT', `请求超时（HTTP ${status}）`, detail);
  }
  if (status === 429) {
    return new AppError('LLM_RATE_LIMIT', `触发限流（HTTP ${status}）`, detail);
  }
  if (status >= 500) {
    return new AppError('LLM_BAD_RESPONSE', `服务端错误（HTTP ${status}）`, detail);
  }
  if (status >= 400) {
    return new AppError('LLM_BAD_RESPONSE', `请求被拒绝（HTTP ${status}）`, detail);
  }
  return new AppError('LLM_BAD_RESPONSE', `异常响应（HTTP ${status}）`, detail);
}

/** 可重试判定（供 llm/retry.ts 使用） */
export function isRetryable(err: AppError): boolean {
  return (
    err.code === 'LLM_TIMEOUT' ||
    err.code === 'LLM_RATE_LIMIT' ||
    err.code === 'LLM_BAD_RESPONSE' ||
    err.code === 'NETWORK_OFFLINE'
  );
}

const SENSITIVE_KEY_PATTERN = /(apiKey|api_key|authorization|token|secret|password|key)/i;

/**
 * ★ 脱敏（架构文档 §6.3）：任何写入日志 detail 的对象，
 *   含 `apiKey / Authorization / token` 等键的一律替换为 `***`。
 */
export function redact<T>(value: T): T {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((item) => redact(item)) as unknown as T;
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message } as unknown as T;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k) ? '***' : redact(v);
    }
    return out as unknown as T;
  }

  if (typeof value === 'string') {
    // 兜底：把 Bearer xxx / sk-xxx 这类明文也打码
    return value
      .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***')
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***') as unknown as T;
  }

  return value;
}
