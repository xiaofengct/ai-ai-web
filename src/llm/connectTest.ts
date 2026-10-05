import { AppError, redact, toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { nowISO } from '@/lib/time';
import { useSettingsStore } from '@/store/settingsStore';
import { chatComplete, buildRequestContext, listModels, resolveChatUrl } from './adapter/openaiCompat';
import { clearProbeCache } from './adapter/compat';
import type { LLMProviderConfig } from '@/types/settings';
import type { UUID } from '@/types/common';
import type { ConnectTestResult } from './types';

/**
 * 连接测试（PG-18）。
 *
 * 流程：`/models` 探测 → 最小 chat（max_tokens=8）→ 返回延迟 / 状态码 / 错误码 / 原始响应片段。
 * ★ 判定口径：**chat 通了就算通**。很多自建端点没有 `/models`，
 *   不能因为拉不到模型列表就把一个能聊的端点判成不可用。
 *
 * 所有原始响应都过 `redact()` 再写入结果，避免把 Key 回显到 UI。
 */

export interface ConnectTestOptions {
  providerId?: UUID;
  /** 直接传 Provider（不查 store）时用 */
  provider?: LLMProviderConfig;
  /** 超时（默认取 Provider 配置） */
  timeoutMs?: number;
  /** 只探测模型列表，不做最小 chat（省一次调用） */
  modelsOnly?: boolean;
  signal?: AbortSignal;
  /** 是否先清空路径探测缓存（改完 baseUrl 立刻重测时用） */
  forceReprobe?: boolean;
}

/** 从 settingsStore 解析 Provider；找不到抛 LLM_NO_PROVIDER */
export function resolveProviderOrThrow(providerId?: UUID): LLMProviderConfig {
  const store = useSettingsStore.getState();
  const provider = providerId
    ? store.settings.providers.find((p) => p.id === providerId)
    : store.activeProvider();
  if (!provider) {
    throw new AppError('LLM_NO_PROVIDER', '还没有配置可用的模型服务', undefined);
  }
  if (!provider.baseUrl.trim()) {
    throw new AppError('LLM_NO_PROVIDER', '模型服务的接口地址还是空的', redact({ id: provider.id }));
  }
  if (!provider.model.trim()) {
    throw new AppError('LLM_NO_MODEL', '还没有填模型名', redact({ id: provider.id }));
  }
  return provider;
}

/** 执行一次连接测试 */
export async function testConnection(options: ConnectTestOptions = {}): Promise<ConnectTestResult> {
  const at = nowISO();
  let provider: LLMProviderConfig;
  try {
    provider = options.provider ?? resolveProviderOrThrow(options.providerId);
  } catch (e) {
    const err = toAppError(e);
    return { ok: false, errorCode: err.code, raw: err.message, at };
  }

  if (options.forceReprobe) clearProbeCache(provider.baseUrl);

  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? provider.timeoutMs ?? 30_000;
  let models: string[] | undefined;
  let statusCode: number | undefined;
  let modelError: AppError | undefined;

  // —— 第 1 步：拉模型列表（失败不致命） ——
  try {
    models = await listModels(provider, { signal: options.signal, timeoutMs });
  } catch (e) {
    modelError = toAppError(e, 'LLM_BAD_RESPONSE');
  }

  // —— 第 2 步：最小 chat（决定性判定） ——
  if (options.modelsOnly) {
    const latencyMs = Date.now() - started;
    if (modelError) {
      return {
        ok: false,
        latencyMs,
        errorCode: modelError.code,
        raw: modelError.message,
        serverBody: detailTextOf(modelError),
        models,
        at,
      };
    }
    return { ok: true, latencyMs, models, raw: models?.slice(0, 5).join(', '), at };
  }

  try {
    const ctx = await buildRequestContext(provider, {
      messages: [{ role: 'user', content: 'ping' }],
      params: { maxTokens: 8, temperature: 0 },
      stream: false,
      timeoutMs,
      signal: options.signal,
      providerId: provider.id,
    });
    const result = await chatComplete(ctx);
    const latencyMs = Date.now() - started;
    const preview = result.content.trim().slice(0, 120);
    log.info('llm', '连接测试通过', redact({ provider: provider.name, latencyMs }), 'PG-18');
    return {
      ok: true,
      latencyMs,
      models,
      raw: preview || undefined,
      // ★ 通过的这一路也要带出实际地址：用户常需要"确认它到底打到哪了"
      url: ctx.url,
      at,
    };
  } catch (e) {
    const err = toAppError(e);
    const latencyMs = Date.now() - started;
    const detail = err.detail as { status?: number } | undefined;
    if (typeof detail?.status === 'number') statusCode = detail.status;
    // chat 失败时，若模型列表也没拿到，就把模型那步的错误码也带上，方便定位
    const errorCode = err.code === 'UNKNOWN' && modelError ? modelError.code : err.code;
    log.warn('llm', '连接测试失败', redact({ code: errorCode, message: err.message }), 'PG-18');
    return {
      ok: false,
      latencyMs,
      statusCode,
      errorCode,
      raw: err.message,
      /**
       * ★ 把"实际请求的 URL"带出去（2026-10-04 加）。
       *
       * 失败时**算一次**解析结果：正常路径下 `chatComplete` 内部会走
       * `resolveChatUrl`（有缓存，代价极小）；即便它没走到那一步（比如构造请求体时就抛了），
       * 这里也算出"本来会请求哪个地址" —— 排查需要的正是这个**确定性**。
       */
      url: await resolveAttemptedUrl(provider, options.signal),
      serverBody: detailTextOf(err),
      models,
      at,
    };
  }
}

/**
 * 取服务端的错误正文（如果有）。
 *
 * ★ 为什么单独取：`err.message` 是**应用自己**归一化出来的话（「请求被拒绝（HTTP 404）」），
 *   而服务端原话（如 DeepSeek 的 `{"error":{"message":"…"}}`）在 `err.detail` 里。
 *   排查时前者给方向、后者给答案 —— 缺了后者，用户拿四个字去搜什么都搜不到。
 */
function detailTextOf(err: AppError): string | undefined {
  const d = err.detail;
  if (typeof d === 'string' && d.trim()) return d.slice(0, 500);
  if (d && typeof d === 'object') {
    const maybe = d as { bodyText?: unknown; detail?: unknown };
    if (typeof maybe.bodyText === 'string' && maybe.bodyText.trim()) return maybe.bodyText.slice(0, 500);
  }
  return undefined;
}

/**
 * 算出"这次本来会请求哪个地址"，用于失败时展示。
 *
 * ★ 走真实的 `resolveChatUrl`，**不自己拼** —— 自己拼就会出现"预览与实际不一致"，
 *   而那正是 2026-10-04 那次排查被误导的原因（`ConnectionTestPage` 原来显示的是
 *   `${baseUrl}/chat/completions`，与实际调用的地址不是同一个）。
 */
async function resolveAttemptedUrl(provider: LLMProviderConfig, signal?: AbortSignal): Promise<string | undefined> {
  try {
    return await resolveChatUrl(provider, signal);
  } catch {
    // 解析都失败（例如 baseUrl 是空串）→ 不展示，别用一个假的地址误导人
    return undefined;
  }
}

/** 只测「能不能列出模型」（设置页切换 Provider 时的轻量校验） */
export async function probeModelsOnly(options: ConnectTestOptions = {}): Promise<ConnectTestResult> {
  return testConnection({ ...options, modelsOnly: true });
}
