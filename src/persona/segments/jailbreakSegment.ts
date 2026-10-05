import { makeSegment, type PromptContext, type SegmentBuilder } from '../promptTypes';
import type { PromptSegment } from '@/types/prompt';

/**
 * 第 12 段 · 后置指令（`card.data.post_history_instructions`，即 Jailbreak）。
 *
 * 可关（`injectControl.jailbreak`）——这是用户明确要求的开关：
 * 有些卡的 jailbreak 会干扰欣然的硬性设定，关掉它是排障的第一步。
 *
 * ★ 即便本段被关闭，第 11 段的 Layer0 至高声明仍然生效，
 *   所以「关掉 jailbreak」不会削弱欣然的称呼约束。
 */
export const jailbreakSegment: SegmentBuilder = {
  id: 'jailbreak',
  order: 12,
  build(ctx: PromptContext): PromptSegment | null {
    const raw = ctx.persona.data.post_history_instructions?.trim();
    if (!raw) return null;
    return makeSegment('jailbreak', `【后置指令】\n${raw}`);
  },
};

export default jailbreakSegment;
