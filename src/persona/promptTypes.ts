import { estimateTokens } from '@/lib/token';
import type { ChatSession, Message } from '@/types/chat';
import type { PersonaCard } from '@/types/persona';
import type { MemoryHit } from '@/types/memory';
import type { ChatSettings, PromptInjectControl } from '@/types/settings';
import type { PromptSegment, PromptSegmentId } from '@/types/prompt';

/**
 * 编译器内部类型（架构文档 §2 `src/persona/promptTypes.ts`）。
 *
 * `PromptBuildInput`（对外）→ `PromptContext`（对内）的转换在这里定义：
 * 对外只收「原始数据」，对内补上预算、注入开关、警告收集器等派生信息，
 * 各段实现只读 `PromptContext`，不再回头查 settings，保证同一段在任何入口行为一致。
 */

/**
 * 组装用途：聊天 / 总结 / 主动消息 / 蒸馏 / **动态**。
 *
 * ★ `'moment'`（2026-10-04 加）：生成一条朋友圈动态。
 *   与 `'proactive'` 同属"她主动说话"，但**产物形态不同** ——
 *   主动消息是"对你说一句话"，动态是"对外发一条广播"（不带私聊指代、允许更长）。
 *   现在分开，将来按 kind 做差异化处理时才有依据；合并的代价是零收益。
 */
export type PromptKind = 'chat' | 'summary' | 'proactive' | 'distill' | 'moment';

/** token 预算（由 Provider 的 contextWindow 与 params.maxTokens 推导） */
export interface PromptBudget {
  /** 上下文窗口总长 */
  contextWindow: number;
  /** 单次回复最大 token */
  maxTokens: number;
  /** 预留（CONTEXT_RESERVE） */
  reserve: number;
  /** 可用总量 = contextWindow - maxTokens - reserve */
  total: number;
  /** 已用（system 段累计） */
  used: number;
}

/** ★ 12 段的装配顺序（架构文档 §7.1，顺序不可改） */
export const SEGMENT_ORDER: readonly PromptSegmentId[] = [
  'identity',
  'personaLayers',
  'scenario',
  'personality',
  'worldBook',
  'memory',
  'time',
  'examples',
  'cardSystem',
  'styleOverride',
  'constraints',
  'jailbreak',
];

/**
 * 各段的中文名（开发者页 `PromptPreview` 逐段展示用）。
 *
 * ★ 为什么放在这里而不是 `src/copy/xinran.ts`：
 *   这些标签与 `PromptSegmentId` 联合类型是**一对一绑定**的编译期元数据，
 *   放在同一个文件里可以保证「加一个段 id → 类型立刻要求补一个标签」，不会漂移；
 *   它们也不属于「欣然对风说话」的文案范畴（不是欣然的口吻）。
 *   UI 侧（`PromptPreview`）直接读 `segment.label`，自身不出现任何中文字面量，
 *   因此 `npm run lint:copy` 的约束依然成立。
 */
export const SEGMENT_LABELS: Record<PromptSegmentId, string> = {
  identity: '角色身份',
  personaLayers: '人格分层',
  scenario: '当前场景',
  personality: '性格设定',
  worldBook: '世界书',
  memory: '记忆注入',
  time: '时间感知',
  examples: '对话示例',
  cardSystem: '卡片系统提示词',
  styleOverride: '风格调味',
  constraints: '提示词约束',
  jailbreak: '后置指令',
};

/** 段与「注入控制」的对应关系（FN-30 逐段开关） */
export const SEGMENT_CONTROL_KEY: Record<PromptSegmentId, keyof PromptInjectControl | 'always'> = {
  identity: 'system',
  personaLayers: 'system',
  scenario: 'system',
  personality: 'system',
  worldBook: 'worldBook',
  memory: 'memory',
  time: 'always',
  examples: 'always',
  cardSystem: 'system',
  styleOverride: 'always',
  constraints: 'always',
  jailbreak: 'jailbreak',
};

/** 段构造器的上下文 */
export interface PromptContext {
  persona: PersonaCard;
  session?: ChatSession;
  settings: ChatSettings;
  /** 已完成清洗与截断的历史 */
  history: readonly Message[];
  userInput?: string;
  memoryHits?: readonly MemoryHit[];
  /**
   * 病娇模式（来自 `AppearanceSettings.yandereMode`）。
   * ★ 为什么挂在 ctx 上：`PromptBuildInput` 只收 `ChatSettings`（架构文档 §3.7 定死的结构），
   *   而病娇开关在外观设置里，因此由 `PersonaCompiler` 读 store 后派生到这里，
   *   段实现不直接依赖 store。
   */
  yandereMode: boolean;
  /** 合并 overrides 之后的注入控制 */
  inject: PromptInjectControl;
  /** 额外约束（临时注入，不落盘） */
  extraConstraints: string[];
  kind: PromptKind;
  budget: PromptBudget;
  /** 各段共享的警告收集器（预算超限、段被裁剪等） */
  warnings: string[];
  /** 当前时间（可注入，便于测试与「时间感知」确定性） */
  now: Date;
}

/** 段构造器（架构文档 §3.11 的 `PromptSegmentBuilder`） */
export interface SegmentBuilder {
  id: PromptSegmentId;
  /** 1-based，与 SEGMENT_ORDER 一致 */
  order: number;
  /** 返回 null 表示「这段没有内容，不注入」 */
  build(ctx: PromptContext): PromptSegment | null;
}

/** 构造一个 PromptSegment（统一算 token，避免各段各算一遍） */
export function makeSegment(
  id: PromptSegmentId,
  content: string,
  options: { truncated?: boolean; enabled?: boolean } = {},
): PromptSegment {
  return {
    id,
    label: SEGMENT_LABELS[id],
    enabled: options.enabled ?? true,
    content,
    tokenEstimate: estimateTokens(content),
    truncated: options.truncated,
    order: SEGMENT_ORDER.indexOf(id) + 1,
  };
}

/** 段是否被注入（先按注入控制大类，再看 extras 的逐段覆写） */
export function isSegmentEnabled(ctx: PromptContext, id: PromptSegmentId): boolean {
  // ★★ 唯一不可关闭的例外：欣然的硬约束段。
  //   用户把 `injectControl.extras.constraints` 设成 false 也只能关掉「用户自定义约束」那部分，
  //   `constraints.ts` 的 XINRAN_HARD_CONSTRAINTS 恒在（架构文档 §7.1 第 11 行）。
  if (id === 'constraints' && ctx.persona.origin === 'xinran') return true;

  const key = SEGMENT_CONTROL_KEY[id];
  if (key === 'always') {
    // ★ 例外：`constraints` 段里「欣然的硬约束」恒为 true（不可关），
    //   见 §7.1 第 11 行与 constraints.ts 的说明——这里只判段本身。
    return ctx.inject.extras[id] ?? true;
  }
  // `key` 可能是 'extras'（PromptInjectControl 的一个成员），它本身不是布尔开关，
  // 这里显式排除，避免出现「拿对象当布尔」的隐式转换
  if (key === 'extras') return ctx.inject.extras[id] ?? true;
  const base: boolean = ctx.inject[key];
  const override = ctx.inject.extras[id];
  return override ?? base;
}

/** 把警告去重后写入 ctx（同一条警告重复多次没有意义） */
export function pushWarning(ctx: PromptContext, message: string): void {
  if (!ctx.warnings.includes(message)) ctx.warnings.push(message);
}

/** 按字符数截断，返回 [文本, 是否被裁剪] */
export function truncateChars(text: string, max: number): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { text: '', truncated: false };
  if (trimmed.length <= max) return { text: trimmed, truncated: false };
  return { text: `${trimmed.slice(0, max)}…`, truncated: true };
}

/** 取最近 N 条消息拼成的「检索/命中用文本」 */
export function recentText(messages: readonly Message[], count: number): string {
  return messages
    .slice(-Math.max(1, count))
    .map((m) => m.content)
    .join('\n');
}
