import { XINRAN_LAYERS } from '@/copy/xinran';
import type { PersonaCard } from '@/types/persona';

/**
 * 欣然 5 层人格（架构文档 §2 `src/persona/xinranLayers.ts`）。
 *
 * ★ 单一真源：人格原文**只写在 `src/copy/xinran.ts` 的 `XINRAN_LAYERS`**，
 *   本文件只做「结构化取用」，绝不复制一份——否则改了文案层忘了改编译器，
 *   就会出现「设置里看到的人格」和「真正注入的人格」不一致。
 *
 * 索引约定：0 = Layer0（不可违背的核心）… 4 = Layer4（偏好/雷点/细节）。
 */

export const XINRAN_LAYER_TITLES: readonly string[] = [
  'Layer 0 · 不可违背的核心（最高优先级）',
  'Layer 1 · 核心性格',
  'Layer 2 · 表达风格',
  'Layer 3 · 情感逻辑与关系行为',
  'Layer 4 · 偏好 / 雷点 / 细节',
];

/** 层数（与 XINRAN_LAYERS.length 一致，写死是为了让类型能参与校验） */
export const XINRAN_LAYER_COUNT = 5;

/** 取第 index 层（越界返回空串，绝不抛错导致提示词装配失败） */
export function xinranLayer(index: number): string {
  return XINRAN_LAYERS[index] ?? '';
}

/** ★ Layer0 单独暴露：`cardSystem` 段要拿它做「不可覆盖」的比对基准 */
export function xinranLayer0(): string {
  return xinranLayer(0);
}

/** 把 5 层拼成带标题的完整文本（注入提示词用） */
export function xinranLayersText(): string {
  const parts: string[] = [];
  for (let i = 0; i < XINRAN_LAYER_COUNT; i += 1) {
    const body = xinranLayer(i);
    if (!body) continue;
    parts.push(`## ${XINRAN_LAYER_TITLES[i]}\n${body}`);
  }
  return parts.join('\n\n');
}

/** 5 层原文数组（只读） */
export function allLayers(): readonly string[] {
  return XINRAN_LAYERS;
}

/** 从角色卡里读「已存的 5 层」（bootstrap 写在 `data.extensions.aiyuLayers`） */
export function layersOfCard(card: PersonaCard): readonly string[] {
  const ext = card.data.extensions as { aiyuLayers?: unknown } | undefined;
  const raw = ext?.aiyuLayers;
  if (Array.isArray(raw)) {
    const list = raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    if (list.length > 0) return list;
  }
  // 卡里没存（老数据 / 手工导入的欣然卡）→ 回落文案层的常量
  return XINRAN_LAYERS;
}

/**
 * 外部角色的人格原文（蒸馏产物的 persona.md，5 层结构）。
 *
 * ★ 为什么从 `extensions` 读而不是查库：
 *   `PersonaCompiler` 被约定为**不依赖 DB**（记忆检索结果都由调用方注入），
 *   所以外部人格必须由调用方提前写进卡片的 `extensions.aiyu.personaMd`。
 *   读不到就返回空串，`layersSegment` 会自然跳过这一段。
 */
export function externalPersonaMd(card: PersonaCard): string {
  const ext = card.data.extensions as { aiyu?: { personaMd?: unknown } } | undefined;
  const md = ext?.aiyu?.personaMd;
  return typeof md === 'string' ? md.trim() : '';
}

export { XINRAN_LAYERS };
