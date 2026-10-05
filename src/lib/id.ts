import type { UUID } from '@/types/common';

/**
 * ID 生成（架构文档 §6.4）：`crypto.randomUUID()` + fallback。
 * 不引入 nanoid / uuid。
 */
export function newId(): UUID {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      /* 极少数环境 randomUUID 需要安全上下文，失败时走 fallback */
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 带前缀的 ID（便于日志里一眼看出是什么东西） */
export function newPrefixedId(prefix: string): UUID {
  return `${prefix}_${newId()}`;
}

/** 短 ID（8 字符，用于文件名 / slug 后缀） */
export function shortId(len = 8): string {
  return Math.random().toString(36).slice(2, 2 + len);
}

/** 判断字符串是否像 UUID（宽松校验，导入外部数据时用） */
export function looksLikeId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,}$/.test(value);
}
