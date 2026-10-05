import { AppError, redact, toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { httpFetch } from '../httpTransport';
import type { LLMProviderConfig } from '@/types/settings';
import type { UUID } from '@/types/common';
import { streamFromResponse, SSE_DONE } from '../sse';
import {
  buildHeaders,
  chatPathCandidates,
  clearProbeCache,
  extractErrorMessage,
  fallbackNonStream,
  joinUrl,
  modelsPathCandidates,
  normalizeBaseUrl,
  normalizeHttpError,
  normalizeResponse,
  probeChatPath,
  probeModelsPath,
  stripUnsupportedFields,
  toNonStreamContext,
} from './compat';
import type {
  ChatChunk,
  ChatRequestBody,
  CompletionOptions,
  ModelListResponse,
  NonStreamResult,
  RequestContext,
} from '../types';

/**
 * OpenAI 兼容适配器（架构文档 §2 `src/llm/adapter/openaiCompat.ts`）。
 *
 * 职责：把 `CompletionOptions` + `LLMProviderConfig` 变成一次真实的 HTTP 调用。
 * ★ 唯一出口约束（§6.9）：组件禁止直接 `fetch(baseUrl)`，一律经本文件 → `client.ts`。
 */

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * 解析聊天地址：`pathOverrides.chat` 优先，其次按兼容模式探测。
 *
 * ★★ 2026-10-04 修一个真机 404：**baseUrl 先归一化，路径按 base 决定**。
 *
 * 原来固定用 `/v1/chat/completions`，与"基础地址可能已含 `/v1`"这一事实冲突：
 *   - 预设 `https://api.deepseek.com/v1` + `/v1/chat/completions` ⇒ `/v1/v1/…` ✗
 *   - 用户粘完整端点 `…/chat/completions` + `/v1/chat/completions` ⇒ 更长的重复 ✗
 * 现在：`normalizeBaseUrl()` 剥掉误粘的端点后缀，`chatPathCandidates()` 按
 * base 是否已带版本段给出路径 —— 上述两种输入都会得到正确的
 * `https://api.deepseek.com/v1/chat/completions`。
 *
 * `pathOverrides.chat` 仍然**优先且不归一化**：那是用户显式指定的路径，
 * 我们不改写显式意图（只把它拼到归一化后的 base 上）。
 */
export async function resolveChatUrl(provider: LLMProviderConfig, signal?: AbortSignal): Promise<string> {
  const base = normalizeBaseUrl(provider.baseUrl);
  const override = provider.pathOverrides?.chat;
  if (override) return joinUrl(base, override);
  const candidates = chatPathCandidates(base);
  if (provider.compatMode) {
    const path = await probeChatPath({
      baseUrl: base,
      apiKey: provider.apiKey,
      headers: provider.headers,
      model: provider.model,
      timeoutMs: provider.timeoutMs || DEFAULT_TIMEOUT_MS,
      signal,
      candidates,
    });
    return joinUrl(base, path);
  }
  return joinUrl(base, candidates[0]);
}

/** 解析模型列表地址（同上：base 归一化 + 按 base 取路径） */
export async function resolveModelsUrl(provider: LLMProviderConfig, signal?: AbortSignal): Promise<string> {
  const base = normalizeBaseUrl(provider.baseUrl);
  const override = provider.pathOverrides?.models;
  if (override) return joinUrl(base, override);
  const candidates = modelsPathCandidates(base);
  if (provider.compatMode) {
    const path = await probeModelsPath({
      baseUrl: base,
      apiKey: provider.apiKey,
      headers: provider.headers,
      model: provider.model,
      timeoutMs: provider.timeoutMs || DEFAULT_TIMEOUT_MS,
      signal,
      candidates,
    });
    return joinUrl(base, path);
  }
  return joinUrl(base, candidates[0]);
}

/** 由 `CompletionOptions.params` 生成请求体（缺省取 Provider 上配置的模型） */
export function buildRequestBody(
  provider: LLMProviderConfig,
  opts: CompletionOptions,
): ChatRequestBody {
  const params = opts.params ?? {};
  const body: ChatRequestBody = {
    model: opts.model?.trim() || provider.model,
    messages: opts.messages,
    temperature: params.temperature,
    top_p: params.topP,
    max_tokens: params.maxTokens,
    presence_penalty: params.presencePenalty,
    frequency_penalty: params.frequencyPenalty,
    stream: opts.stream === true,
  };
  if (opts.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }
  // ★ 兼容模式：裁掉部分端点不支持的字段（FN-11）
  return stripUnsupportedFields(body, provider.compatMode);
}

/** 构造请求上下文（URL / Header / Body / 超时 / 信号） */
export async function buildRequestContext(
  provider: LLMProviderConfig,
  opts: CompletionOptions,
): Promise<RequestContext> {
  if (!provider.baseUrl || !provider.baseUrl.trim()) {
    throw new AppError('LLM_NO_PROVIDER', 'Provider 未配置 baseUrl', redact({ id: provider.id }));
  }
  const url = await resolveChatUrl(provider, opts.signal);
  return {
    providerId: provider.id,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    url,
    headers: buildHeaders(provider.apiKey, provider.headers),
    body: buildRequestBody(provider, opts),
    timeoutMs: opts.timeoutMs ?? provider.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: opts.signal,
    compatMode: provider.compatMode,
  };
}

/** 真正发一次请求（带超时）；流式与非流式共用 */
async function fetchChat(ctx: RequestContext): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  const onOuterAbort = (): void => controller.abort();
  if (ctx.signal) {
    if (ctx.signal.aborted) controller.abort();
    else ctx.signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  log.debug('llm', '发起聊天请求', redact({ url: ctx.url, model: ctx.body.model, stream: ctx.body.stream }));

  try {
    // ★ 走传输层而非裸 fetch：原生环境下浏览器直连被 CORS 拦掉时会自动退回原生通道，
    //   纯 Web 下行为与原来完全一致（见 `llm/httpTransport.ts` 的契约说明）。
    const res = await httpFetch(ctx.url, {
      method: 'POST',
      headers: ctx.headers,
      body: ctx.body,
      timeoutMs: ctx.timeoutMs,
      signal: controller.signal,
    });
    if (!res.ok) {
      const bodyText = await res.clone().text().catch(() => '');
      const message = extractErrorMessage(bodyText);
      const err = normalizeHttpError(res.status, bodyText);
      throw new AppError(err.code, message ? `${err.message}：${message}` : err.message, redact({ status: res.status }));
    }
    return res;
  } catch (e) {
    // 超时 → 明确标成 LLM_TIMEOUT（可重试），而不是笼统的 AbortError
    if (!ctx.signal?.aborted && controller.signal.aborted) {
      throw new AppError('LLM_TIMEOUT', `请求超时（${ctx.timeoutMs}ms）`, redact({ url: ctx.url }));
    }
    throw toAppError(e, 'LLM_BAD_RESPONSE');
  } finally {
    clearTimeout(timer);
    ctx.signal?.removeEventListener('abort', onOuterAbort);
  }
}

/** 非流式补全（总结 / 蒸馏分析 / 主动消息走这条） */
export async function chatComplete(ctx: RequestContext): Promise<NonStreamResult> {
  const res = await fetchChat(ctx);
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // 极少数端点返回「裸文本」；直接当作结果内容，避免整条链路失败
    log.warn('llm', '响应不是 JSON，按纯文本处理', redact({ preview: text.slice(0, 120) }));
    return { content: text, finishReason: 'stop' };
  }
  const result = normalizeResponse(json);
  if (!result.content) {
    log.warn('llm', '响应里没有取到内容', redact({ keys: Object.keys(json as object) }));
  }
  return result;
}

/**
 * 流式补全。
 * ★ 降级链：SSE 解析不到任何增量 → 自动改用一次非流式，把整段作为单 chunk 吐出（FN-11）。
 */
export async function* chatStream(ctx: RequestContext): AsyncGenerator<ChatChunk> {
  const res = await fetchChat(ctx);

  // 有些端点即使 stream=true 也返回整段 JSON（Content-Type: application/json）
  const contentType = res.headers.get('content-type') ?? '';
  if (!isEventStream(contentType)) {
    const text = await res.clone().text().catch(() => '');
    const looksLikeSse = text.includes('data:') || text.includes(SSE_DONE);
    if (!looksLikeSse) {
      let parsed: unknown = undefined;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      if (parsed !== undefined && typeof parsed === 'object') {
        const normalized = normalizeResponse(parsed);
        if (normalized.content) {
          log.info('llm', '端点不支持 SSE，已降级为非流式', undefined, 'FN-11');
          yield* fallbackNonStream(async () => normalized, 'endpoint returned JSON instead of SSE');
          return;
        }
      }
    }
  }

  let produced = false;

  // ★ 逐帧转发：这样才能统计「有没有真的产出内容」，空流时才能触发降级
  for await (const chunk of streamFromResponse(res, {
    signal: ctx.signal,
    onIncomplete: (reason) => {
      log.warn('llm', `流式中断：${reason}`, redact({ url: ctx.url }), 'FN-11');
    },
  })) {
    if (chunk.delta) produced = true;
    yield chunk;
  }

  if (!produced) {
    // 一次都没产出（端点返回了空 SSE）→ 降级为非流式拿一次结果
    log.warn('llm', 'SSE 无内容，降级为非流式', redact({ url: ctx.url }), 'FN-11');
    yield* fallbackNonStream(() => chatComplete(toNonStreamContext(ctx)), 'empty SSE stream');
  }
}

function isEventStream(contentType: string): boolean {
  return /text\/event-stream/i.test(contentType);
}

/** 拉取模型列表（连接测试 / 设置页下拉用） */
export async function listModels(
  provider: LLMProviderConfig,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string[]> {
  const url = await resolveModelsUrl(provider, opts.signal);
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? provider.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await httpFetch(url, {
      method: 'GET',
      headers: buildHeaders(provider.apiKey, provider.headers),
      timeoutMs,
      signal: opts.signal ?? controller.signal,
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      const err = normalizeHttpError(res.status, bodyText);
      throw new AppError(err.code, err.message, redact({ status: res.status }));
    }
    const json = (await res.json()) as ModelListResponse;
    return extractModelIds(json);
  } catch (e) {
    throw toAppError(e, 'LLM_BAD_RESPONSE');
  } finally {
    clearTimeout(timer);
  }
}

/** 从各种形状的 /models 响应里抠出 id 列表 */
export function extractModelIds(json: ModelListResponse): string[] {
  const rawList: unknown[] = Array.isArray(json)
    ? (json as unknown[])
    : Array.isArray((json as { data?: unknown }).data)
      ? ((json as { data: unknown[] }).data as unknown[])
      : Array.isArray((json as { models?: unknown }).models)
        ? ((json as { models: unknown[] }).models as unknown[])
        : [];

  const out: string[] = [];
  for (const item of rawList) {
    if (typeof item === 'string') {
      if (item.trim()) out.push(item.trim());
    } else if (typeof item === 'object' && item !== null) {
      const rec = item as Record<string, unknown>;
      for (const key of ['id', 'name', 'model']) {
        const v = rec[key];
        if (typeof v === 'string' && v.trim()) {
          out.push(v.trim());
          break;
        }
      }
    }
  }
  return [...new Set(out)].sort();
}

/** Provider 配置变更（改了 baseUrl）后清掉路径探测缓存 */
export function invalidateProviderCache(providerId: UUID, baseUrl?: string): void {
  if (baseUrl) clearProbeCache(baseUrl);
  else clearProbeCache();
  log.debug('llm', '已清空路径探测缓存', { providerId });
}
