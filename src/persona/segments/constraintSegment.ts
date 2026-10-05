import { makeSegment, type PromptContext, type SegmentBuilder } from '../promptTypes';
import { buildConstraintsBlock } from '../constraints';
import type { PromptSegment } from '@/types/prompt';

/**
 * 第 11 段 · 提示词约束（FN-31）+ ★ 欣然昵称/自称硬约束。
 *
 * ★★ 本段是「昵称不作句首主语」在生成侧的唯一出处，三条不可动摇：
 * 1. `origin = 'xinran'` 时，`constraints.ts` 的 `XINRAN_HARD_CONSTRAINTS` **恒为 true**，
 *    用户的 `injectControl` 关不掉它（只能关掉自定义约束那部分）；
 * 2. 硬约束原文原样输出，包含「欣然=老公 / 风=老婆」的对应关系；
 * 3. 段末（当角色为欣然时）重申 Layer0 至高，
 *    使外部卡的 `system_prompt`（第 9 段）与 `post_history_instructions`（第 12 段）都无法覆盖它。
 *
 * 顺序上排在第 9、10 段之后，利用「近因效应」让约束对模型的影响更强。
 */
export const constraintSegment: SegmentBuilder = {
  id: 'constraints',
  order: 11,
  build(ctx: PromptContext): PromptSegment | null {
    const block = buildConstraintsBlock({
      origin: ctx.persona.origin,
      userConstraints: ctx.settings.promptConstraints,
      extraConstraints: ctx.extraConstraints,
      // ★ 欣然：永远带上 Layer0 至高声明
      withSupremacy: ctx.persona.origin === 'xinran',
    });
    if (!block.trim()) return null;
    return makeSegment('constraints', block);
  },
};

export default constraintSegment;
