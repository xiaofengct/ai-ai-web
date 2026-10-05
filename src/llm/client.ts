import { AppError, isRetryable, redact, toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { useSettingsStore } from '@/store/settingsStore';
import { buildRequestContext, chatComplete, chatStream, listModels as fetchModels } from './adapter/openaiCompat';
import { contentFilter } from './filter';
import { backoffDelay, sleepCancellable, DEFAULT_RETRY } from './retry';
import { testConnection as runConnectTest } from './connectTest';
import { resolveProviderOrThrow } from './connectTest';
import type { LLMProviderConfig } from '@/types/settings';
import type { UUID } from '@/types/common';
import type { ChatChunk, CompletionOptions, ConnectTestResult, LLMClient, LLMMessage } from './types';

/**
 * ★ LLMClient 门面（架构文档 §2 `src/llm/client.ts`）。
 *
 * 这是**唯一出口**（§6.9）：组件禁止直接 `fetch(baseUrl)`，
 * 所有请求都要经过这里 —— 于是「Provider 解析 / 重试 / 内容过滤 / 脱敏日志 / 错误归一化」
 * 只需要在这一处实现，不会出现「某个页面忘了脱敏」这种漏网之鱼。
 *
 * 职责边界：
 * - 解析 Provider（来自 `settingsStore`，支持 `providerId` 覆盖）；
 * - 入站过滤（用户输入）与出站过滤（模型输出）——双向都走 `ContentFilter`；
 * - 重试：非流式整体重试；流式**只在第一帧之前**重试（已吐出内容再重试会导致内容重复）；
 * - 错误一律 `AppError`，UI 层只拿 `code` 去查文案 key，不显示英文原始 message。
 */

export interface ClientCallOptions extends CompletionOptions {
  /** 本次调用是否走内容过滤（默认 true） */
  sanitize?: boolean;
}

/** 解析 Provider（不抛错版；返回 undefined 由调用方决定如何提示） */
export function tryResolveProvider(providerId?: UUID): LLMProviderConfig | undefined {
  const store = useSettingsStore.getState();
  if (providerId) return store.settings.providers.find((p) => p.id === providerId);
  return store.activeProvider();
}

/** 解析 Provider（找不到就抛 LLM_NO_PROVIDER） */
export function resolveProvider(providerId?: UUID): LLMProviderConfig {
  return resolveProviderOrThrow(providerId);
}

/** 对消息数组做入站过滤（只处理 user 消息，system/assistant 不动） */
export function filterInboundMessages(messages: readonly LLMMessage[]): LLMMessage[] {
  return messages.map((m) => {
    if (m.role !== 'user' || typeof m.content !== 'string') return m;
    return { ...m, content: contentFilter.inbound(m.content) };
  });
}

/** 出站过滤（模型输出） */
function filterOutboundText(text: string): string {
  return contentFilter.outbound(text);
}

/** 开发用 mock：没配 Key 也能把流程跑通（settings.dev.mock = true） */
function mockComplete(opts: CompletionOptions): string {
  const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user');
  const text = typeof lastUser?.content === 'string' ? lastUser.content : '';
  return `（开发模拟回复）你刚才说的是：${text.slice(0, 80)}`;
}

async function* mockStream(opts: CompletionOptions): AsyncGenerator<ChatChunk> {
  const full = mockComplete(opts);
  // 逐字吐出，模拟真实流式的渲染节奏
  const chars = Array.from(full);
  for (let i = 0; i < chars.length; i += 2) {
    yield { delta: chars.slice(i, i + 2).join('') };
    await sleepCancellable(16, opts.signal);
  }
  yield { delta: '', finishReason: 'stop' };
}

export class OpenAICompatClient implements LLMClient {
  /** 额外重试次数（不含首次） */
  private retries: number;

  constructor(retries: number = DEFAULT_RETRY.retries) {
    this.retries = retries;
  }

  /** 非流式（总结 / 蒸馏分析 / 主动消息） */
  async complete(opts: ClientCallOptions): Promise<string> {
    if (useSettingsStore.getState().settings.dev.mock) return mockComplete(opts);

    const provider = resolveProvider(opts.providerId);
    const sanitize = opts.sanitize !== false;
    const messages = sanitize ? filterInboundMessages(opts.messages) : (opts.messages as LLMMessage[]);

    const ctx = await buildRequestContext(provider, { ...opts, messages, stream: false });

    let lastError: AppError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const result = await chatComplete(ctx);
        const text = sanitize ? filterOutboundText(result.content) : result.content;
        log.debug('llm', '非流式补全完成', redact({ chars: text.length, model: ctx.body.model }));
        return text;
      } catch (e) {
        const err = toAppError(e);
        lastError = err;
        if (!isRetryable(err) || attempt === this.retries) break;
        log.warn('llm', '补全失败，准备重试', redact({ code: err.code, attempt: attempt + 1 }));
        await sleepCancellable(backoffDelay(attempt), opts.signal);
      }
    }
    throw lastError ?? new AppError('UNKNOWN', '补全失败');
  }

  /**
   * 流式（聊天主流程）。
   * ★ 重试策略：只有**在吐出第一帧之前**失败才重试，
   *   已经开始输出再重试会把同一段内容发两遍。
   */
  async *stream(opts: ClientCallOptions): AsyncIterable<ChatChunk> {
    if (useSettingsStore.getState().settings.dev.mock) {
      yield* mockStream(opts);
      return;
    }

    const provider = resolveProvider(opts.providerId);
    const sanitize = opts.sanitize !== false;
    const messages = sanitize ? filterInboundMessages(opts.messages) : (opts.messages as LLMMessage[]);
    const ctx = await buildRequestContext(provider, { ...opts, messages, stream: true });

    let started = false;
    let lastError: AppError | undefined;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        for await (const chunk of chatStream(ctx)) {
          started = started || chunk.delta.length > 0;
          yield sanitize && chunk.delta
            ? { ...chunk, delta: filterOutboundText(chunk.delta) }
            : chunk;
        }
        return;
      } catch (e) {
        const err = toAppError(e);
        lastError = err;
        // 已吐过内容 → 不重试（防重复）；4xx → 不重试
        if (started || !isRetryable(err) || attempt === this.retries) throw err;
        log.warn('llm', '流式失败，准备重试', redact({ code: err.code, attempt: attempt + 1 }));
        await sleepCancellable(backoffDelay(attempt), opts.signal);
      }
    }
    throw lastError ?? new AppError('UNKNOWN', '流式补全失败');
  }

  /** 拉取模型列表 */
  async listModels(providerId?: UUID): Promise<string[]> {
    const provider = resolveProvider(providerId);
    try {
      return await fetchModels(provider);
    } catch (e) {
      const err = toAppError(e);
      log.warn('llm', '拉取模型列表失败', redact({ code: err.code, message: err.message }), 'PG-18');
      // 拉不到列表不该让设置页白屏 → 退回「至少把当前配置的模型显示出来」
      return provider.model ? [provider.model] : [];
    }
  }

  /** 连接测试（委托给 connectTest.ts） */
  async testConnection(providerId?: UUID): Promise<ConnectTestResult> {
    return runConnectTest({ providerId });
  }
}

/** 全局单例（应用内统一使用这一个实例，保证重试与过滤计数一致） */
export const llmClient: LLMClient = new OpenAICompatClient();

export default llmClient;
