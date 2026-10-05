import { formatTimeAware } from '@/lib/time';
import { makeSegment, type PromptContext, type SegmentBuilder } from '../promptTypes';
import type { PromptSegment } from '@/types/prompt';

/**
 * 第 7 段 · 时间感知（FN-34）。
 *
 * 输出格式固定为 `当前时间：YYYY-MM-DD HH:mm dddd (UTC+8)`（§6.4 `formatTimeAware`）。
 * 时间从 `ctx.now` 取而不是 `new Date()` —— 便于单测，也避免同一条消息里
 * system 与 user 两侧出现两个不一致的时间。
 */
export const timeSegment: SegmentBuilder = {
  id: 'time',
  order: 7,
  build(ctx: PromptContext): PromptSegment | null {
    if (!ctx.settings.timeAware) return null;
    return makeSegment('time', `当前时间：${formatTimeAware(ctx.now)}`);
  },
};

export default timeSegment;
