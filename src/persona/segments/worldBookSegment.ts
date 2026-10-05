import { WORLD_BOOK_LOOKBACK, WORLD_BOOK_TOKEN_BUDGET } from '@/constants/limits';
import { estimateTokens } from '@/lib/token';
import {
  makeSegment,
  pushWarning,
  recentText,
  type PromptContext,
  type SegmentBuilder,
} from '../promptTypes';
import type { CharacterBookEntry } from '@/types/persona';
import type { PromptSegment } from '@/types/prompt';

/**
 * 第 5 段 · 世界书（`character_book`）。
 *
 * 命中规则（SillyTavern 惯例）：
 * - 条目的 `keys` 或 `secondary_keys` 任一关键词出现在**最近 N 条消息 + 当前输入**里 → 命中；
 * - `enabled` 且 `keys` 为空 → 视为**常驻条目**，无条件注入；
 * - 命中的条目按 `insertion_order` 升序注入（数值小的更靠前）。
 *
 * 预算：总 token 上限 WORLD_BOOK_TOKEN_BUDGET(2000)，超了就按序截断并置 `truncated=true`。
 */

/** 关键词是否命中（大小写不敏感；空关键词视为常驻） */
export function entryMatches(entry: CharacterBookEntry, text: string): boolean {
  const keys = [...(entry.keys ?? []), ...(entry.secondary_keys ?? [])]
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length === 0) return true; // 常驻
  const haystack = text.toLowerCase();
  return keys.some((k) => haystack.includes(k.toLowerCase()));
}

export const worldBookSegment: SegmentBuilder = {
  id: 'worldBook',
  order: 5,
  build(ctx: PromptContext): PromptSegment | null {
    const entries = ctx.persona.data.character_book?.entries ?? [];
    if (entries.length === 0) return null;

    const needle = `${recentText(ctx.history, WORLD_BOOK_LOOKBACK)}\n${ctx.userInput ?? ''}`;
    const hits = entries
      .filter((e) => e.enabled && entryMatches(e, needle))
      .slice()
      .sort((a, b) => (a.insertion_order ?? 0) - (b.insertion_order ?? 0));

    if (hits.length === 0) return null;

    const parts: string[] = [];
    let used = 0;
    let truncated = false;

    for (const entry of hits) {
      const cost = estimateTokens(entry.content);
      if (used + cost > WORLD_BOOK_TOKEN_BUDGET) {
        // 预算用尽：后续条目整条丢弃（不切一半，避免语义断裂）
        truncated = true;
        break;
      }
      const comment = entry.comment?.trim();
      parts.push(comment ? `· ${comment}\n${entry.content}` : `· ${entry.content}`);
      used += cost;
    }

    if (parts.length === 0) {
      pushWarning(ctx, '世界书条目超出 token 预算，本次未注入');
      return null;
    }
    if (truncated) pushWarning(ctx, '世界书超出 token 预算，已按优先级截断');

    return makeSegment('worldBook', `【世界书】\n${parts.join('\n\n')}`, { truncated });
  },
};

export default worldBookSegment;
