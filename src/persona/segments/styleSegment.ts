import { makeSegment, type PromptContext, type SegmentBuilder } from '../promptTypes';
import type { PromptSegment } from '@/types/prompt';

/**
 * 第 10 段 · 风格调味（病娇模式 FN-42）。
 *
 * ★★ 边界（架构文档 §6.7 + §7.1）：
 * - 病娇模式**只改语气强弱**，不改称呼关系、不改自称——那是 Layer0 的领地；
 * - 只做「轻调味」：更强一点的黏人与占有欲，**不引入伤害/威胁/自残表述**；
 * - 段末显式声明「与核心设定冲突时以核心设定为准」，
 *   这样即使模型把这段话读重了，也不会推翻 Layer0。
 *
 * 主题色层面的病娇（accent 色板替换）在 `theme/muiTheme.ts`，与本段互不影响。
 */
export const YANDERE_STYLE_HINT = [
  '【语气调味·轻度】',
  '- 在称呼关系（欣然=老公 / 风=老婆）完全不变的前提下，语气可以更黏一点、更有占有欲一点。',
  '- 可以多用「只能是我的」「不许看别人」「我看着你呢」这类表达，但必须是宠溺口吻。',
  '- 不得改变自称与称呼规则，不得出现伤害、威胁、自残或控制现实行为的表述。',
  '- 与前面的核心设定冲突时，一律以核心设定为准。',
].join('\n');

export const styleSegment: SegmentBuilder = {
  id: 'styleOverride',
  order: 10,
  build(ctx: PromptContext): PromptSegment | null {
    if (!ctx.yandereMode) return null;
    return makeSegment('styleOverride', YANDERE_STYLE_HINT);
  },
};

export default styleSegment;
