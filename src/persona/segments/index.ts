import { identitySegment } from './identitySegment';
import { layersSegment } from './layersSegment';
import { scenarioSegment } from './scenarioSegment';
import { personalitySegment } from './personalitySegment';
import { worldBookSegment } from './worldBookSegment';
import { memorySegment } from './memorySegment';
import { timeSegment } from './timeSegment';
import { examplesSegment } from './examplesSegment';
import { cardSystemSegment } from './cardSystemSegment';
import { styleSegment } from './styleSegment';
import { constraintSegment } from './constraintSegment';
import { jailbreakSegment } from './jailbreakSegment';
import { SEGMENT_ORDER } from '../promptTypes';
import type { PromptSegmentId } from '@/types/prompt';
import type { SegmentBuilder } from '../promptTypes';

/**
 * 段注册表（架构文档 §7.1）：**顺序即优先级**，改动这里等于改动提示词语义，务必谨慎。
 *
 * 1 identity → 2 personaLayers → 3 scenario → 4 personality → 5 worldBook
 * → 6 memory → 7 time → 8 examples → 9 cardSystem → 10 styleOverride
 * → 11 constraints → 12 jailbreak
 */
export const SEGMENT_BUILDERS: readonly SegmentBuilder[] = [
  identitySegment,
  layersSegment,
  scenarioSegment,
  personalitySegment,
  worldBookSegment,
  memorySegment,
  timeSegment,
  examplesSegment,
  cardSystemSegment,
  styleSegment,
  constraintSegment,
  jailbreakSegment,
];

/** id → 构造器 */
export const SEGMENT_MAP: Record<PromptSegmentId, SegmentBuilder> = SEGMENT_BUILDERS.reduce(
  (acc, builder) => {
    acc[builder.id] = builder;
    return acc;
  },
  {} as Record<PromptSegmentId, SegmentBuilder>,
);

/** 按 id 取构造器 */
export function getSegment(id: PromptSegmentId): SegmentBuilder | undefined {
  return SEGMENT_MAP[id];
}

/** 注册表的顺序是否与 `SEGMENT_ORDER` 完全一致（自检用，防止手滑改乱顺序） */
export function isRegistryConsistent(): boolean {
  if (SEGMENT_BUILDERS.length !== SEGMENT_ORDER.length) return false;
  return SEGMENT_BUILDERS.every((b, i) => b.id === SEGMENT_ORDER[i] && b.order === i + 1);
}

export {
  identitySegment,
  layersSegment,
  scenarioSegment,
  personalitySegment,
  worldBookSegment,
  memorySegment,
  timeSegment,
  examplesSegment,
  cardSystemSegment,
  styleSegment,
  constraintSegment,
  jailbreakSegment,
};
