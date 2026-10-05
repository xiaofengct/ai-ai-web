import { httpErrorToAppError } from '@/lib/errors';
import { httpFetch } from '../httpTransport';
import { pickUsage } from '../sse';
import type { ChatChunk, ChatRequestBody, NonStreamResult, RequestContext, TokenUsage } from '../types';

/**
 * ★ 兼容模式（FN-11）：路径探测、字段容错、非流式降级、错误归一化。
 *
 * 为什么需要它：用户自备的「自定义 OpenAI 兼容端点」实现质量参差不齐——
 *   - 有的挂 `/v1/chat/completions`，有的直接挂 `/chat/completions`；
 *   - 有的不认 `presence_penalty` / `response_format`（400）；
 *   - 有的声称支持 SSE，实际返回整段 JSON；
 *   - 有的错误体不是 `{error:{message}}` 而是纯文本。
 * `compatMode=true` 时本文件负责把这些差异抹平。
 */

/** 候选聊天路径（按顺序探测） */
export const CHAT_PATH_CANDIDATES: readonly string[] = ['/v1/chat/completions', '/chat/completions'];

/** 候选模型列表路径 */
export const MODELS_PATH_CANDIDATES: readonly string[] = ['/v1/models', '/models'];

/* ============================================================
   ★★ baseUrl 归一化（2026-10-04 加）—— 修一个真机上真实发生的 404
   ------------------------------------------------------------
   事故：用户填的「接口地址」是完整端点
        https://api.deepseek.com/chat/completions
   而那个字段期望的是**基础地址**。兼容模式又关着 ⇒ 应用不探测、直接追加
   默认路径 `/v1/chat/completions` ⇒ 最终请求
        https://api.deepseek.com/chat/completions/v1/chat/completions
   ⇒ **404**（页面上表现为 `LLM_BAD_RESPONSE` /「请求被拒绝（HTTP 404）」）。

   ★ 顺带发现一个**预设自身的隐患**：预设 baseUrl 是 `https://api.deepseek.com/v1`，
   而默认路径是 `/v1/chat/completions` ⇒ 拼出来是 `/v1/v1/chat/completions`。
   硅基流动预设同理（`https://api.siliconflow.cn/v1`）。
   ⇒ 也就是说"基础地址已含版本段"的情况下，原来那条固定路径是错的。
   （我**无法**用真实请求验证 `/v1/v1/…` 是否被服务端接受 ——
     DeepSeek 的网关**先鉴权再路由**：连完全不存在的路径也返回 401，
     所以没有有效 Key 就用状态码区分不出路径是否存在。这条如实记录，不假装验证过。）

   修法两条，都是"让拼接结果符合直觉"，不引入任何新依赖：
     ① `normalizeBaseUrl`：把用户误粘进来的**端点后缀**剥掉，还原成基础地址；
     ② 按 base 是否已自带版本段（`/v1`）决定路径，避免 `/v1/v1`。
   ⇒ 下面这些输入现在都能得到**同一个正确 URL**：
        https://api.deepseek.com
        https://api.deepseek.com/
        https://api.deepseek.com/v1
        https://api.deepseek.com/chat/completions
        https://api.deepseek.com/v1/chat/completions   （→ 正确保留 /v1 语义）
   ============================================================ */

/**
 * 用户常把"完整端点"当"接口地址"粘进来；这些后缀要剥掉。
 * ★ 顺序有讲究：**长的必须排在前面**，否则 `/completions` 会先把
 *   `/v1/chat/completions` 截成 `…/v1/chat`（半个路径，比不剥更糟）。
 */
const ENDPOINT_SUFFIXES: readonly string[] = [
  '/v1/chat/completions',
  '/chat/completions',
  '/v1/completions',
  '/completions',
  '/v1/models',
  '/models',
];

/**
 * 把用户输入归一化成「基础地址」：去空白、去尾部斜杠、剥掉误粘的端点后缀。
 *
 * ★ 只剥**已知的端点后缀**，不做任何"猜测式"改写 ——
 *   不确定的路径原样保留（宁可让它自然报 404，也不要悄悄改掉用户的输入）。
 */
export function normalizeBaseUrl(raw: string): string {
  let s = (raw ?? '').trim().replace(/\/+$/, '');
  // 最多剥两层：`/v1/chat/completions` 先剥成长路径，再看是否有残留
  for (let depth = 0; depth < 2; depth += 1) {
    const lower = s.toLowerCase();
    const hit = ENDPOINT_SUFFIXES.find((suf) => lower.endsWith(suf));
    if (!hit) break;
    s = s.slice(0, -hit.length).replace(/\/+$/, '');
  }
  return s;
}

/** base 是否已自带版本段（`/v1`、`/v2`…）——已自带则路径里不再重复 */
export function hasVersionSegment(base: string): boolean {
  return /\/v\d+$/i.test((base ?? '').trim().replace(/\/+$/, ''));
}

/**
 * 按 base 给出应尝试的聊天路径（顺序即优先级）。
 *
 * ★ 为什么不是"永远先试 `/v1/chat/completions`"：
 *   base 已经是 `https://api.deepseek.com/v1` 时，再拼 `/v1/…` 就成了 `/v1/v1/…`。
 *   这条规则让"基础地址写法不同"不再影响结果。
 */
export function chatPathCandidates(base: string): readonly string[] {
  return hasVersionSegment(base) ? ['/chat/completions'] : CHAT_PATH_CANDIDATES;
}

/** 按 base 给出应尝试的模型列表路径 */
export function modelsPathCandidates(base: string): readonly string[] {
  return hasVersionSegment(base) ? ['/models'] : MODELS_PATH_CANDIDATES;
}

/**
 * 给用户看的"最终会请求哪个地址"（用于设置页预览与排错）。
 * ★ 存在的意义：把"应用到底会发到哪"变成**可见**的 ——
 *   这次 404 的排查难点正是"用户不知道自己填的地址会被怎么拼"。
 */
export function previewChatUrl(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  return joinUrl(base, chatPathCandidates(base)[0]);
}

/** 同 `previewChatUrl`，模型列表用 */
export function previewModelsUrl(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  return joinUrl(base, modelsPathCandidates(base)[0]);
}

/**
 * 判断两个 baseUrl 是不是**同一家服务**（用于"当前配置对应哪个内置预设"）。
 *
 * ★★ 为什么不能直接用 `normalizeBaseUrl(a) === normalizeBaseUrl(b)`（2026-10-04 踩的坑）：
 *   归一化只剥**端点后缀**，不剥**版本段**。于是
 *     normalizeBaseUrl('https://api.deepseek.com/chat/completions') → 'https://api.deepseek.com'
 *     normalizeBaseUrl('https://api.deepseek.com/v1')               → 'https://api.deepseek.com/v1'
 *   两者**不相等** —— 尽管它们指向完全相同的服务、实际请求也会是同一个 URL。
 *
 *   后果很讽刺：用户把地址填成"完整端点"（恰恰最需要被引导的写法）时，
 *   预设匹配失败 ⇒ 推荐地址、一键换回、偏离提醒**全都消失**。
 *   即"越需要提示越不提示"。这个坑是自动化测试抓出来的，不是读代码看出来的。
 *
 * ⇒ 正确判据是**忽略可选的版本段**：`/v1` 这种段由应用自动补，
 *   它在不在都不改变"这是哪家"。
 */
export function baseIdentity(raw: string): string {
  return normalizeBaseUrl(raw)
    .toLowerCase()
    .replace(/\/v\d+$/, '');
}

/**
 * 两个 baseUrl 的**实际请求是否等价**（不看写法，只看结果）。
 *
 * ★ 用途：决定"要不要提醒用户偏离推荐值"。
 *   判据不取"字符串是否相同"，而取**拼出来的请求地址是否相同** ——
 *   因为用户关心的是"能不能用"，不是"写法像不像。
 *   `https://api.deepseek.com` 与 `https://api.deepseek.com/v1` 写法不同，
 *   但请求地址一致 ⇒ 不该被当成"配错了"来警告。
 */
export function isSameChatTarget(a: string, b: string): boolean {
  return previewChatUrl(a) === previewChatUrl(b);
}

/** 拼接 baseUrl 与 path，容忍多余的斜杠 */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

/** 构造默认请求头（Authorization 只在有 key 时带上） */
export function buildHeaders(apiKey?: string, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  if (extra) {
    for (const [k, v] of Object.entries(extra)) headers[k] = v;
  }
  return headers;
}

/* ============================================================
   1. 路径探测
   ------------------------------------------------------------
   探测结果按 `baseUrl` 缓存（同一次会话里只付一次代价）。
   探测用 `max_tokens: 1` 的最小请求，成本可忽略。
   ============================================================ */

const chatPathCache = new Map<string, string>();
const modelsPathCache = new Map<string, string>();

interface ProbeOptions {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  model: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /**
   * 本次要尝试的候选路径（按优先级）。
   * 不传时用模块级的全量候选 `CHAT_PATH_CANDIDATES` / `MODELS_PATH_CANDIDATES`。
   * ★ 由调用方按"base 是否已含 /v1"决定，见 `chatPathCandidates()`。
   */
  candidates?: readonly string[];
}

/**
 * 探测可用的聊天路径；全部失败时返回**候选里的第一个**（让后续请求自然报错）。
 *
 * ★ `candidates` 可传入（2026-10-04）：调用方会按 base 是否已含 `/v1` 给出候选，
 *   避免"base 已带 /v1 还要再拼一个 /v1"。
 *   不传则用全量候选（保持旧行为，供其它调用点使用）。
 */
export async function probeChatPath(opts: ProbeOptions): Promise<string> {
  const candidates = opts.candidates ?? CHAT_PATH_CANDIDATES;
  const cached = chatPathCache.get(opts.baseUrl);
  if (cached) return cached;

  const preferred = await probePaths(opts, candidates, (url) => buildProbeBody(url, opts.model));
  const resolved = preferred ?? candidates[0];
  chatPathCache.set(opts.baseUrl, resolved);
  return resolved;
}

/** 探测可用的模型列表路径（`candidates` 语义同 `probeChatPath`） */
export async function probeModelsPath(opts: ProbeOptions): Promise<string> {
  const candidates = opts.candidates ?? MODELS_PATH_CANDIDATES;
  const cached = modelsPathCache.get(opts.baseUrl);
  if (cached) return cached;
  const found = await probeGetPaths(opts, candidates);
  const resolved = found ?? candidates[0];
  modelsPathCache.set(opts.baseUrl, resolved);
  return resolved;
}

function buildProbeBody(_url: string, model: string): ChatRequestBody {
  return { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false };
}

/** 逐个 POST 候选路径，返回第一个「不是 404/405」的 */
async function probePaths(
  opts: ProbeOptions,
  paths: readonly string[],
  bodyOf: (url: string) => ChatRequestBody,
): Promise<string | undefined> {
  for (const path of paths) {
    const url = joinUrl(opts.baseUrl, path);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(opts.timeoutMs, 10_000));
      // 走传输层：端点没有 CORS 头时也能探到真实路径（否则探测会全失败、回落到第一个候选）
      const res = await httpFetch(url, {
        method: 'POST',
        headers: buildHeaders(opts.apiKey, opts.headers),
        body: bodyOf(url),
        timeoutMs: Math.min(opts.timeoutMs, 10_000),
        signal: mergeSignal(opts.signal, controller.signal),
      });
      clearTimeout(timer);
      // 404 / 405 = 路径不对；401/403 = 路径对但没权限（也算探到了）
      if (res.status !== 404 && res.status !== 405) return path;
    } catch {
      // 网络错误 / 超时 → 试下一个候选
      continue;
    }
  }
  return undefined;
}

/** 逐个 GET 候选路径 */
async function probeGetPaths(opts: ProbeOptions, paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) {
    const url = joinUrl(opts.baseUrl, path);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(opts.timeoutMs, 10_000));
      const res = await httpFetch(url, {
        method: 'GET',
        headers: buildHeaders(opts.apiKey, opts.headers),
        timeoutMs: Math.min(opts.timeoutMs, 10_000),
        signal: mergeSignal(opts.signal, controller.signal),
      });
      clearTimeout(timer);
      if (res.status !== 404 && res.status !== 405) return path;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** 清空路径探测缓存（切换 baseUrl / 手动重测时调用） */
export function clearProbeCache(baseUrl?: string): void {
  if (baseUrl) {
    chatPathCache.delete(baseUrl);
    modelsPathCache.delete(baseUrl);
    return;
  }
  chatPathCache.clear();
  modelsPathCache.clear();
}

/* ============================================================
   2. 字段容错
   ============================================================ */

/** 兼容模式下会被裁掉的「高风险字段」（部分国产模型遇到会直接 400） */
export const RISKY_BODY_FIELDS: readonly (keyof ChatRequestBody)[] = [
  'presence_penalty',
  'frequency_penalty',
  'response_format',
];

/**
 * 按兼容模式裁剪请求体。
 * `compatMode=true` 时裁掉高风险字段；值为 0 的惩罚项本来也可以不传，这里一并清掉以减小体积。
 */
export function stripUnsupportedFields(body: ChatRequestBody, compatMode: boolean): ChatRequestBody {
  if (!compatMode) return body;
  const out: ChatRequestBody = { ...body };
  for (const field of RISKY_BODY_FIELDS) delete out[field];
  if (out.temperature === undefined) delete out.temperature;
  if (out.top_p === undefined) delete out.top_p;
  return out;
}

/**
 * 归一化非流式响应（★ 验收要点②「字段缺失容错」）。
 * 依次尝试：choices[0].message.content → choices[0].text → choices[0].delta.content
 * → 顶层 content / text / response / data.content。
 */
export function normalizeResponse(raw: unknown): NonStreamResult {
  const fallback: NonStreamResult = { content: '' };
  if (typeof raw !== 'object' || raw === null) return fallback;
  const obj = raw as Record<string, unknown>;

  const content = pickContent(obj);
  const usage = pickUsage(obj.usage);
  const finishReason = pickFinishReason(obj);

  return { content, finishReason, usage, raw: undefined };
}

function pickContent(obj: Record<string, unknown>): string {
  const candidates: unknown[] = [];

  const choices = obj.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (typeof first === 'string') candidates.push(first);
    else if (typeof first === 'object' && first !== null) {
      const c = first as Record<string, unknown>;
      const message = c.message;
      if (typeof message === 'string') candidates.push(message);
      else if (typeof message === 'object' && message !== null) {
        candidates.push((message as Record<string, unknown>).content);
      }
      candidates.push(c.text, c.content);
      const delta = c.delta;
      if (typeof delta === 'string') candidates.push(delta);
      else if (typeof delta === 'object' && delta !== null) {
        candidates.push((delta as Record<string, unknown>).content);
      }
    }
  }

  const data = obj.data;
  if (typeof data === 'object' && data !== null) {
    const d = data as Record<string, unknown>;
    candidates.push(d.content, d.text, d.response);
  }

  candidates.push(obj.content, obj.text, obj.response, obj.result, obj.output);

  for (const candidate of candidates) {
    if (typeof candidate === 'string') return candidate;
    if (Array.isArray(candidate)) {
      // 少数厂商把 content 拆成 [{type:'text',text:'...'}]
      const joined = candidate
        .map((part) => {
          if (typeof part === 'string') return part;
          if (typeof part === 'object' && part !== null) {
            const p = part as Record<string, unknown>;
            if (typeof p.text === 'string') return p.text;
          }
          return '';
        })
        .filter(Boolean)
        .join('');
      if (joined) return joined;
    }
  }
  return '';
}

function pickFinishReason(obj: Record<string, unknown>): string | null | undefined {
  const choices = obj.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (typeof first === 'object' && first !== null) {
      const reason = (first as Record<string, unknown>).finish_reason;
      if (typeof reason === 'string') return reason;
    }
  }
  const reason = obj.finish_reason;
  return typeof reason === 'string' ? reason : undefined;
}

/* ============================================================
   3. 非流式降级
   ============================================================ */

/**
 * 流式不可用时的降级：调用一次非流式，把整段文本作为**单个 chunk** 吐出。
 * ★ 关键点：对外形态仍是 `AsyncIterable<ChatChunk>`，上层渲染逻辑不用分叉。
 */
export async function* fallbackNonStream(
  nonStream: () => Promise<NonStreamResult>,
  reason: string,
  onFallback?: (reason: string) => void,
): AsyncGenerator<ChatChunk> {
  onFallback?.(reason);
  const result = await nonStream();
  if (result.content) {
    yield { delta: result.content, finishReason: result.finishReason ?? 'stop', usage: result.usage };
  } else {
    yield { delta: '', finishReason: result.finishReason ?? 'stop', usage: result.usage };
  }
}

/* ============================================================
   4. 错误归一化
   ============================================================ */

/** 从错误响应体里尽量抠出人类可读的 message（不同厂商形状不同） */
export function extractErrorMessage(bodyText: string): string | undefined {
  const trimmed = bodyText.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      const err = obj.error;
      if (typeof err === 'string') return err;
      if (typeof err === 'object' && err !== null) {
        const e = err as Record<string, unknown>;
        for (const key of ['message', 'msg', 'detail', 'error']) {
          const v = e[key];
          if (typeof v === 'string' && v.trim()) return v;
        }
      }
      for (const key of ['message', 'msg', 'detail', 'error_msg']) {
        const v = obj[key];
        if (typeof v === 'string' && v.trim()) return v;
      }
    }
  } catch {
    // 纯文本错误体
    return trimmed.slice(0, 300);
  }
  return trimmed.slice(0, 300);
}

/** HTTP 状态码 + 响应体 → AppError（4xx 不重试、5xx/429 可重试） */
export function normalizeHttpError(status: number, bodyText?: string): ReturnType<typeof httpErrorToAppError> {
  return httpErrorToAppError(status, bodyText ? bodyText.slice(0, 500) : undefined);
}

/* ============================================================
   5. 小工具
   ============================================================ */

/** 把外部 signal 与本函数内部 signal 合并（任一触发即 abort） */
export function mergeSignal(outer?: AbortSignal, inner?: AbortSignal): AbortSignal | undefined {
  if (!outer && !inner) return undefined;
  if (!outer) return inner;
  if (!inner) return outer;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([outer, inner]);
  // 旧浏览器兜底
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (outer.aborted || inner.aborted) controller.abort();
  else {
    outer.addEventListener('abort', onAbort, { once: true });
    inner.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

/** 估算 usage（部分端点不返回 usage，用本地估算补齐，便于统计页有数） */
export function fillUsage(usage: TokenUsage | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const { promptTokens, completionTokens, totalTokens } = usage;
  const total =
    totalTokens ??
    (promptTokens === undefined && completionTokens === undefined
      ? undefined
      : (promptTokens ?? 0) + (completionTokens ?? 0));
  return { promptTokens, completionTokens, totalTokens: total };
}

/** 从 RequestContext 派生一个「关闭流式」的副本（降级用） */
export function toNonStreamContext(ctx: RequestContext): RequestContext {
  return {
    ...ctx,
    body: { ...ctx.body, stream: false },
  };
}
