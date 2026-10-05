import type { LLMMessage } from '@/llm/types';
import type { ChatSession, Message } from './chat';
import type { ChatSettings } from './settings';
import type { PersonaCard } from './persona';
import type { MemoryHit } from './memory';

/**
 * ★ 提示词装配核心类型（架构文档 §3.7）。
 * `PersonaCompiler` 是唯一提示词出口，12 段按此顺序装配。
 */
export type PromptSegmentId =
  /** 角色名 + 外貌/背景 */
  | 'identity'
  /** ★ 欣然 5 层 / 外部 persona.md */
  | 'personaLayers'
  | 'scenario'
  /** 含分阶段演变规则 */
  | 'personality'
  /** character_book */
  | 'worldBook'
  /** ★ 记忆注入 */
  | 'memory'
  /** 时间感知 */
  | 'time'
  /** mes_example */
  | 'examples'
  /** 卡片自带 system_prompt */
  | 'cardSystem'
  /** 病娇调味 */
  | 'styleOverride'
  /** ★ 提示词约束 + 昵称/自称硬约束 */
  | 'constraints'
  /** post_history_instructions */
  | 'jailbreak';

export interface PromptSegment {
  id: PromptSegmentId;
  /** 中文名，开发者页/设置页展示 */
  label: string;
  enabled: boolean;
  content: string;
  tokenEstimate: number;
  /** 是否因预算被裁剪 */
  truncated?: boolean;
  order: number;
}

export interface PromptBuildInput {
  persona: PersonaCard;
  session?: ChatSession;
  settings: ChatSettings;
  /** 历史消息（已完成上下文清洗与截断） */
  history: Message[];
  /** 用户当前输入 */
  userInput?: string;
  /** 记忆检索结果（由调用方注入，避免编译器依赖 DB） */
  memoryHits?: MemoryHit[];
  /** 额外覆盖：注入控制、临时约束 */
  overrides?: Partial<ChatSettings['injectControl']> & { extraConstraints?: string[] };
  /**
   * 提示词用途。
   * ★ `'moment'`（2026-10-04 加）：生成一条**动态**（朋友圈）。
   *   与 `'proactive'` 同属"她主动说话"，但**产物形态不同** ——
   *   主动消息是"对你说一句话"，动态是"对外发一条广播"。
   *   两者若共用一个 kind，将来按 kind 做差异化处理时（比如动态允许更长、
   *   不需要称呼对方）就没有区分依据。现在分开，代价为零。
   */
  kind: 'chat' | 'summary' | 'proactive' | 'distill' | 'moment';
}

export interface PromptBuildResult {
  /** 拼装后的 system 内容 */
  system: string;
  /** 完整请求体（含多模态 parts） */
  messages: LLMMessage[];
  /** 逐段明细（供预览/审计） */
  segments: PromptSegment[];
  tokenEstimate: number;
  /** 预算超限、段被裁剪等 */
  warnings: string[];
}
