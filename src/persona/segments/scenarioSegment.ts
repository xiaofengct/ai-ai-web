import { MAX_SCENARIO_CHARS } from '@/constants/limits';
import { makeSegment, pushWarning, truncateChars, type PromptContext, type SegmentBuilder } from '../promptTypes';
import type { PromptSegment } from '@/types/prompt';

/**
 * 第 3 段 · 当前场景（`card.data.scenario`）。
 * 超 MAX_SCENARIO_CHARS(800) 字截断并置 `truncated=true`（开发者页会标出来）。
 */
export const scenarioSegment: SegmentBuilder = {
  id: 'scenario',
  order: 3,
  build(ctx: PromptContext): PromptSegment | null {
    const raw = ctx.persona.data.scenario?.trim();
    if (!raw) return null;
    const { text, truncated } = truncateChars(raw, MAX_SCENARIO_CHARS);
    if (truncated) pushWarning(ctx, '当前场景超出长度上限，已截断');
    return makeSegment('scenario', `【当前场景】\n${text}`, { truncated });
  },
};

export default scenarioSegment;
