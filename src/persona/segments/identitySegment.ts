import { makeSegment, type PromptContext, type SegmentBuilder } from '../promptTypes';
import type { PromptSegment } from '@/types/prompt';

/**
 * 第 1 段 · 角色身份（name + description）。
 *
 * 不裁剪：身份是提示词的地基，宁可让后面的段被裁，也不能把「我是谁」裁掉。
 * ★ 欣然的 `description` 恒为空（不做外貌设定），所以这段对欣然只有一行「你现在扮演：欣然」。
 */
export const identitySegment: SegmentBuilder = {
  id: 'identity',
  order: 1,
  build(ctx: PromptContext): PromptSegment | null {
    const name = ctx.persona.data.name?.trim() ?? '';
    const description = ctx.persona.data.description?.trim() ?? '';
    if (!name && !description) return null;

    const blocks: string[] = [`你现在扮演：${name || '（未命名角色）'}`];
    if (description) blocks.push(`【外貌与背景】\n${description}`);
    return makeSegment('identity', blocks.join('\n\n'));
  },
};

export default identitySegment;
