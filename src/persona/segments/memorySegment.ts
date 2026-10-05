import { MEMORY_TOKEN_BUDGET } from '@/constants/limits';
import { estimateTokens } from '@/lib/token';
import { makeSegment, pushWarning, type PromptContext, type SegmentBuilder } from '../promptTypes';
import type { MemoryHit } from '@/types/memory';
import type { PromptSegment } from '@/types/prompt';

/**
 * 第 6 段 · 记忆注入（★ FN-29 / FN-56）。
 *
 * 两种模式：
 * - `provideFullMemory = true` → **全库**按 score 排序（不做阈值过滤，适合短会话精聊）；
 * - 否则 → 按 `memoryScoreThreshold`（默认 0.35）过滤，scope 由调用方检索时决定。
 *
 * 预算：**严格按 token 截断**并置 `truncated=true`。
 * 截断规则：宁可少带几条记忆，也不把记忆塞爆上下文导致历史被挤掉——
 * 历史是「刚发生的事」，记忆是「以前的事」，前者的时效性更高。
 */
export const memorySegment: SegmentBuilder = {
  id: 'memory',
  order: 6,
  build(ctx: PromptContext): PromptSegment | null {
    const hits: readonly MemoryHit[] = ctx.memoryHits ?? [];
    if (hits.length === 0) return null;

    const full = ctx.settings.provideFullMemory;
    const threshold = ctx.settings.memoryScoreThreshold;
    const filtered = (full ? hits : hits.filter((h) => h.score >= threshold))
      .slice()
      .sort((a, b) => b.score - a.score);

    if (filtered.length === 0) return null;

    // 预算：全局上限与「剩余预算」取小
    const remaining = Math.max(0, ctx.budget.total - ctx.budget.used);
    const budget = Math.min(MEMORY_TOKEN_BUDGET, remaining);
    if (budget <= 0) {
      pushWarning(ctx, '上下文预算已用尽，本次未注入记忆');
      return null;
    }

    const parts: string[] = [];
    let used = 0;
    let truncated = false;

    for (const hit of filtered) {
      const line = `- ${hit.entry.content}`;
      const cost = estimateTokens(line);
      if (used + cost > budget) {
        truncated = true;
        break;
      }
      parts.push(line);
      used += cost;
    }

    if (parts.length === 0) {
      pushWarning(ctx, '记忆超出 token 预算，本次未注入');
      return null;
    }
    if (truncated) pushWarning(ctx, '记忆超出 token 预算，已按相关性截断');

    const head = full ? '【记忆库（全量）】' : '【记忆库（相关）】';
    return makeSegment('memory', `${head}\n${parts.join('\n')}`, { truncated });
  },
};

export default memorySegment;
