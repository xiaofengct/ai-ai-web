import type { ChatSettings } from '@/types/settings';
import type { UUID } from '@/types/common';

/**
 * LLM 层类型（架构文档 §3.10 + §2 `src/llm/types.ts`）。
 *
 * 本文件是 T05 的类型出口：`client.ts` / `sse.ts` / `adapter/*` 全部依赖这里的定义。
 * T02 的 `src/types/prompt.ts`（`PromptBuildResult.messages`）也从这里取 `LLMMessage`，
 * 因此**不要改动 `LLMMessage` 的形状**，否则会连带影响提示词装配层。
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
  name?: string;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatChunk {
  delta: string;
  finishReason?: string | null;
  usage?: TokenUsage;
}

export interface CompletionOptions {
  messages: LLMMessage[];
  model?: string;
  params?: Partial<ChatSettings['params']>;
  stream?: boolean;
  signal?: AbortSignal;
  responseFormat?: 'text' | 'json';
  timeoutMs?: number;
  providerId?: UUID;
}

export interface ConnectTestResult {
  ok: boolean;
  /** 毫秒 */
  latencyMs?: number;
  /** HTTP 状态码（非网络错误时） */
  statusCode?: number;
  errorCode?: string;
  /** 原始响应片段（已脱敏） */
  raw?: string;
  models?: string[];
  at: string;
  /**
   * ★ 本次**实际请求的地址**（2026-10-04 加）。
   *
   * 为什么需要它：连接测试失败时，用户最需要知道的恰恰是
   * 「应用到底把请求发到哪个 URL 去了」—— 而这一条以前是**看不见的**。
   * 排查那起 404 时，用户只能看到「请求被拒绝」，无从判断地址是否被拼错。
   *
   * 现在它由 `resolveChatUrl()` / `resolveModelsUrl()` 的真实结果填入，
   * 与真实调用**同源**，不会出现"预览一个地址、实际请求另一个"的情况。
   */
  url?: string;
  /**
   * 服务端返回的错误正文片段（已脱敏）。
   *
   * 与 `raw` 的分工：`raw` 是**应用自己的**归一化描述（如「请求被拒绝（HTTP 404）」），
   * `serverBody` 是**服务端原话**（如 DeepSeek 的 `{"error":{"message":"…"}}`）。
   * 前者好读、后者好查 —— 缺了后者，用户拿着"请求被拒绝"四个字查不到任何东西。
   */
  serverBody?: string;
}

export interface LLMClient {
  /** 非流式（总结、蒸馏分析、主动消息） */
  complete(opts: CompletionOptions): Promise<string>;
  /** 流式（聊天主流程） */
  stream(opts: CompletionOptions): AsyncIterable<ChatChunk>;
  /** 拉取模型列表（连接测试） */
  listModels(providerId?: UUID): Promise<string[]>;
  /** 连接测试：返回延迟/错误码/原始响应 */
  testConnection(providerId?: UUID): Promise<ConnectTestResult>;
}

/* ============================================================
   Adapter 内部类型
   ============================================================ */

/** OpenAI 兼容请求体；`compatMode` 下由 `adapter/compat.ts` 裁剪不支持字段 */
export interface ChatRequestBody {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  stream?: boolean;
  response_format?: { type: 'text' | 'json_object' };
}

/** 归一化后的非流式结果（字段容错后的统一形状） */
export interface NonStreamResult {
  content: string;
  finishReason?: string | null;
  usage?: TokenUsage;
  /** 原始响应（已脱敏，仅供开发者页查看） */
  raw?: unknown;
}

/**
 * 一次请求所需的全部上下文（由 `openaiCompat.buildRequestContext()` 产出，
 * 在 adapter 之间传递，避免每个函数重复拼 URL / Header）。
 */
export interface RequestContext {
  providerId: UUID;
  baseUrl: string;
  apiKey?: string;
  url: string;
  headers: Record<string, string>;
  body: ChatRequestBody;
  timeoutMs: number;
  signal?: AbortSignal;
  /** FN-11 兼容模式：字段裁剪 + 路径探测 */
  compatMode: boolean;
}

/** `/models` 的常见响应形状（不同厂商差异很大，故做宽松联合） */
export type ModelListResponse =
  | { data?: Array<{ id?: string } | string> }
  | Array<{ id?: string } | string>
  | { models?: Array<{ id?: string } | string> };

/** 未归一化的聊天响应（normalizeResponse 的输入） */
export type RawChatResponse = Record<string, unknown>;

/** 文生图结果 */
export interface ImageGenResult {
  /** data:URL 或 object URL，可直接放进 `<img src>` */
  url: string;
  raw?: unknown;
}
