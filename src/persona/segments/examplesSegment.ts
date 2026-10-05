import { MAX_EXAMPLES_CHARS } from '@/constants/limits';
import { makeSegment, pushWarning, truncateChars, type PromptContext, type SegmentBuilder } from '../promptTypes';
import type { PromptSegment } from '@/types/prompt';

/**
 * 第 8 段 · 对话示例（`card.data.mes_example`）。
 * 超 MAX_EXAMPLES_CHARS(1200) 字截断。
 */
export const examplesSegment: SegmentBuilder = {
  id: 'examples',
  order: 8,
  build(ctx: PromptContext): PromptSegment | null {
    const raw = ctx.persona.data.mes_example?.trim();
    if (!raw) return null;
    const { text, truncated } = truncateChars(raw, MAX_EXAMPLES_CHARS);
    if (truncated) pushWarning(ctx, '对话示例超出长度上限，已截断');
    return makeSegment('examples', `【对话示例】\n${text}`, { truncated });
  },
};

export default examplesSegment;
