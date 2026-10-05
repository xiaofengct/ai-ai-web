import type { ISODate, PersonaOrigin, UUID } from './common';

/** chara_card_v2 世界书条目 */
export interface CharacterBookEntry {
  keys: string[];
  secondary_keys?: string[];
  content: string;
  enabled: boolean;
  insertion_order: number;
  comment?: string;
  extensions?: Record<string, unknown>;
}

/** chara_card_v2 的 9 个核心字段（原应用导出格式，见 docs/00-逆向取证.md §5.2） */
export interface PersonaCardData {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  creator_notes?: string;
  first_mes?: string;
  mes_example?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  alternate_greetings?: string[];
  tags?: string[];
  character_book?: { entries: CharacterBookEntry[] };
  extensions?: Record<string, unknown>;
}

/** 角色文生图设置（★ 欣然的隐私红线为该入口置灰，见 XR-06） */
export interface ImageGenSettings {
  provider: string;
  model: string;
  size: string;
  promptTemplate: string;
  negativePrompt?: string;
}

/** 立绘引用：静态图 / Live2D / 桌宠 */
export interface PortraitRef {
  type: 'image' | 'live2d' | 'pet';
  assetId: UUID;
  /** 0~1 */
  opacity?: number;
  /** 归一化位置 0~1 */
  position?: { x: number; y: number };
  scale?: number;
}

/**
 * 人设卡（Web 版扩展字段在导出时写回 `data.extensions`，保证与原应用互通）。
 * ★ `privacy.noImage` 为隐私红线：欣然 = true。
 */
export interface PersonaCard {
  id: UUID;
  spec: 'chara_card_v2';
  specVersion: '2.0';
  data: PersonaCardData;

  origin: PersonaOrigin;
  /** 角色模型（Provider 绑定），未指定则用全局默认 */
  modelId?: UUID;
  /** 角色音色 */
  timbreId?: UUID;
  portrait?: PortraitRef[];
  imageGen?: ImageGenSettings;
  /** ★ 隐私红线：欣然 = { noImage: true } */
  privacy?: { noImage: boolean };
  /** 内置卡（欣然），禁止删除 */
  isBuiltin?: boolean;
  /** 若来自蒸馏产物 */
  distillJobId?: UUID;
  createdAt: ISODate;
  updatedAt: ISODate;
}
