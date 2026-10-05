import { CHARS_PER_ASCII_TOKEN } from '@/constants/limits';

/**
 * Token 估算（架构文档 §6.4）：
 * CJK 1 字 ≈ 1 token，ASCII 4 字符 ≈ 1 token。
 * 只是**估算**，用于预算控制与 UI 展示，不追求与各家 tokenizer 完全一致。
 */

/** CJK 统一表意文字 + 扩展 A + 兼容表意文字 */
const CJK_PATTERN = /[㐀-䶿一-鿿豈-﫿]/g;

export function estimateTokens(s: string): number {
  if (!s) return 0;
  const cjk = (s.match(CJK_PATTERN) ?? []).length;
  return Math.ceil(cjk + (s.length - cjk) / CHARS_PER_ASCII_TOKEN);
}

/** 批量估算（消息数组 → 总 token） */
export function estimateTokensMany(parts: readonly string[]): number {
  return parts.reduce((sum, p) => sum + estimateTokens(p), 0);
}

/** 上下文预算：contextWindow - maxTokens - 512（预留） */
export function contextBudget(contextWindow: number, maxTokens: number, reserve = 512): number {
  return Math.max(0, contextWindow - maxTokens - reserve);
}

/** 把长文本按 token 预算截断（从**尾部**保留，优先保住最近的上下文） */
export function truncateToTokenBudget(text: string, budget: number): string {
  if (budget <= 0) return '';
  if (estimateTokens(text) <= budget) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(text.slice(text.length - mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(text.length - lo);
}

/** 人类可读的 token 数（>=1000 显示为 1.2k） */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
