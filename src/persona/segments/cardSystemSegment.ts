import { makeSegment, pushWarning, type PromptContext, type SegmentBuilder } from '../promptTypes';
import { xinranLayer0 } from '../xinranLayers';
import type { PromptSegment } from '@/types/prompt';

/**
 * 第 9 段 · 卡片自带 `system_prompt`。
 *
 * ★★ 优先级：本段**低于** Layer0（第 2 段）与约束段（第 11 段）。
 *
 * 两种来源的处理：
 * - `origin = 'xinran'`：欣然卡的 `system_prompt` 正常为空；
 *   若被人手工填了内容（比如导入时把外部卡改名为欣然），
 *   这里会**附上一句「不得与 Layer0 冲突」的声明**，并记一条 warning；
 * - `origin = 'external'`：原样注入，随后第 11 段会重申 Layer0 至高
 *   （对外部卡而言即「不得改写称呼关系与自称规则」）。
 */
export const cardSystemSegment: SegmentBuilder = {
  id: 'cardSystem',
  order: 9,
  build(ctx: PromptContext): PromptSegment | null {
    const raw = ctx.persona.data.system_prompt?.trim();
    if (!raw) return null;

    if (ctx.persona.origin !== 'xinran') {
      return makeSegment('cardSystem', raw);
    }

    // 欣然卡带了 system_prompt → 明确声明 Layer0 优先，避免它被误当成最高指令
    pushWarning(ctx, '欣然卡自带了 system_prompt，已标注 Layer0 优先');
    const layer0 = xinranLayer0();
    const note = layer0
      ? '【优先级提示】上方内容若与下面的核心设定冲突，以核心设定为准：\n' + layer0.split('\n').slice(0, 6).join('\n')
      : '【优先级提示】上方内容若与欣然的 Layer0 核心设定冲突，以 Layer0 为准。';
    return makeSegment('cardSystem', `${raw}\n\n${note}`);
  },
};

export default cardSystemSegment;
