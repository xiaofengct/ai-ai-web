import { MAX_PERSONALITY_CHARS } from '@/constants/limits';
import { makeSegment, pushWarning, truncateChars, type PromptContext, type SegmentBuilder } from '../promptTypes';
import type { PromptSegment } from '@/types/prompt';

/**
 * 第 4 段 · 性格设定（`card.data.personality`）。
 *
 * ★ 原应用导出的卡里，这个字段**含分阶段演变规则**
 *   （「第1天 00:00 – …严格按时间执行，不可越级」，见 docs/00-逆向取证.md §5.2），
 *   所以截断要格外克制：只在超长时切尾部，并在提示词里保留「严格按时间执行」这类规则的原句。
 *   这里按字符截断是兜底，正常情况下 personality 不会超 1500 字。
 */
export const personalitySegment: SegmentBuilder = {
  id: 'personality',
  order: 4,
  build(ctx: PromptContext): PromptSegment | null {
    const raw = ctx.persona.data.personality?.trim();
    if (!raw) return null;
    const { text, truncated } = truncateChars(raw, MAX_PERSONALITY_CHARS);
    if (truncated) pushWarning(ctx, '性格设定超出长度上限，已截断');
    return makeSegment('personality', `【性格设定】\n${text}`, { truncated });
  },
};

export default personalitySegment;
