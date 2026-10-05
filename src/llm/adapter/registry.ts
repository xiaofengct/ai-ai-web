import type { ChatSettings } from '@/types/settings';
import type { UUID } from '@/types/common';
import type { LLMMessage } from '@/llm/types';
import { AppError } from '@/lib/errors';

/**
 * ★ LLM 适配器注册表（依赖注入槽）。
 *
 * ## 为什么单独成一个文件（**不要搬回 `@/distill/pipeline`**）
 *
 * 这个槽位必须在**应用启动时**（`src/main.tsx`，与 `bootstrap()` 同一处序列）
 * 就完成注入，否则蒸馏功能为零。而 `main.tsx` 属于**主入口 chunk**——
 * 如果 `setLlmAdapter` 放在 `src/distill/pipeline` 里，main.tsx 的一行 import
 * 就会把整个蒸馏引擎（pipeline / parsers / prompts，源码 ~65 kB）**拽进首屏主包**，
 * 懒加载直接失效。
 *
 * 实测：入口 chunk 193.42 kB → 205.95 kB（+12.5 kB），根因就是这一行 import。
 * 本文件**刻意保持零重依赖**（只依赖 `lib/errors` 与三个 `type` 导入，
 * type 导入编译后会被擦除），因此可以安全地被主入口 import。
 *
 * ★ 新增依赖前先问一句：「这条 import 会不会把某个重型模块带进主包？」
 *
 * ## 契约
 * - 未注入 = 蒸馏**完全不可用**（不是降级）：`hasLlmAdapter()` 恒 false
 *   → StepAnalyze 守卫命中 → 双线分析永不执行。所以启动时必须调一次。
 * - 注入实现走 `llmClient` 门面（重试 / 内容过滤 / 脱敏日志 / 错误归一化都在门面里），
 *   不要裸 fetch。蒸馏是最烧 token 的一路，绕过去等于全丢。
 */

export interface LlmCompleteRequest {
  messages: LLMMessage[];
  /** 结构化输出用 'json'；生成 Markdown 用 'text' */
  responseFormat?: 'text' | 'json';
  params?: Partial<ChatSettings['params']>;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  providerId?: UUID;
}

/** ★ 唯一需要的 LLM 能力：非流式补全（蒸馏分析与生成不启用流式，PRD §7.3） */
export type LlmComplete = (req: LlmCompleteRequest) => Promise<string>;

export interface LlmAdapter {
  complete: LlmComplete;
  /** 可选：展示用的是哪个模型（成本预估弹窗里显示） */
  modelLabel?: string;
}

let adapter: LlmAdapter | null = null;

/** 注入 LLM 适配器（应用启动时调用一次）。传 null 可撤销注入。 */
export function setLlmAdapter(next: LlmAdapter | null): void {
  adapter = next;
}

/** 取适配器；未注入时抛 LLM_NO_PROVIDER（UI 会提示「先去接一个模型」） */
export function getLlmAdapter(): LlmAdapter {
  if (!adapter) {
    throw new AppError('LLM_NO_PROVIDER', '还没有注入 LLM 适配器（distill: setLlmAdapter）');
  }
  return adapter;
}

/** 守卫用：判断是否已注入（不抛错，供 UI 提前拦截） */
export function hasLlmAdapter(): boolean {
  return adapter !== null;
}

/**
 * 只读偷看一眼适配器（**未注入时返回 null，不抛错**）。
 * 供「只是想读 `modelLabel` 之类可选信息」的场景用，避免为了取个展示值就 try/catch。
 */
export function peekLlmAdapter(): LlmAdapter | null {
  return adapter;
}
