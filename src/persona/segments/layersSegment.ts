import { makeSegment, type PromptContext, type SegmentBuilder } from '../promptTypes';
import { externalPersonaMd, layersOfCard } from '../xinranLayers';
import type { PromptSegment } from '@/types/prompt';

/**
 * 第 2 段 · 人格分层（★ 欣然 5 层 L0~L4 / 外部 persona.md 6 层 L0~L5）。
 *   ⚠️ 两套层数别混：欣然 = 5 层；蒸馏产物 persona.md = 6 层。
 *   真源见 `docs/01-PRD` §7.2，实现约束见 `docs/02` §1.6 C4（混合语境行按分句标注）。
 *
 * ★★ 最关键的一段，两条判定：
 * - `origin = 'xinran'` → 注入**欣然的 L0-L4 原文**（来自 `copy/xinran.ts`，
 *   经 `xinranLayers.layersOfCard()` 读取，优先用卡里 `extensions.aiyuLayers` 存的那份）；
 *   **Layer0 永不裁剪**；
 * - `origin = 'external'` → **不注入任何欣然层**，改注蒸馏产物 `persona.md`（**6 层** markdown，Layer 0~5）；
 *   读不到就整段跳过（不拿欣然的层去填外部角色的空，那会造成人格串味）。
 *
 * 注意：外部角色卡自带的 `system_prompt` 在第 9 段，优先级**低于**本段，
 * 且第 11 段会重申「不得覆盖 Layer0」。
 */
export const layersSegment: SegmentBuilder = {
  id: 'personaLayers',
  order: 2,
  build(ctx: PromptContext): PromptSegment | null {
    if (ctx.persona.origin === 'xinran') {
      const layers = layersOfCard(ctx.persona);
      if (layers.length === 0) return null;
      const body = layers
        .map((layer, index) => `## Layer ${index}\n${layer}`)
        .join('\n\n');
      return makeSegment('personaLayers', `【人格分层·欣然（不可覆盖）】\n${body}`);
    }

    const personaMd = externalPersonaMd(ctx.persona);
    if (!personaMd) return null;
    return makeSegment('personaLayers', `【人格分层·外部角色】\n${personaMd}`);
  },
};

export default layersSegment;
