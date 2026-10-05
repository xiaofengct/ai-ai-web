import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { HttpOptions, HttpResponse } from '@capacitor/core';
import { redact } from '@/lib/errors';
import { log } from '@/store/logStore';

/**
 * LLM 传输层：浏览器 `fetch` 优先，被 CORS 拦掉时退回原生通道。
 *
 * ★ 来源声明：本文件**思路**参考自外部项目 `xinran-app`（`UNLICENSED`，无 LICENSE 文件）
 *   中 `fetchOrNative()` 的「fetch 失败 → CapacitorHttp 兜底」做法。
 *   **代码为按本项目架构与类型重写，未复制其任何代码块。** 对方 LICENSE 为「保留所有权利」，
 *   凡后续改动请继续遵守此约束（思路可借鉴，代码不照搬）。
 *
 * ★ 为什么这是**唯一**该碰传输的地方（§6.9「唯一出口」）：
 *   组件层禁止直接 `fetch(baseUrl)` 的约束**依然成立**——本文件只被 `src/llm/**` 内部引用，
 *   `src/features/**` 不允许 import 它。于是「是不是原生环境 / 怎么降级」只有一处实现，
 *   不会散落到各个调用点各判一次。
 *
 * ★ 为什么用显式调用，而**不**开 `plugins.CapacitorHttp.enabled = true`：
 *   后者会把 `window.fetch` / `XMLHttpRequest` **全局替换**成非流式实现，
 *   直接摧毁 `src/llm/sse.ts` 依赖的 `response.body` 增量读（逐字上屏会全线失效），
 *   也会绕过我们在 `fetchChat()` 里已有的超时、AbortSignal 与 AppError 归一化链路。
 *   本文件走的是「显式调用原生插件」，`window.fetch` 保持原样。
 *
 * ★ 为什么纯 Web 下必须降级（实测读源码得出，非推测）：
 *   `CapacitorHttp` 在 web 平台**并非不可用**——`@capacitor/core` 为它注册了完整的
 *   web 实现，而该实现内部就是 `await fetch(...)`。也就是说在浏览器里走它
 *   既**拿不到任何跨域豁免**，还要多付一次
 *   「响应 → JSON/文本 → 再包一层」的序列化开销。故以 `isNativePlatform()` 为闸门，
 *   纯 Web 一律走原生 `fetch`，行为与改造前**完全一致**。
 *
 * ★ 已知边界（读源码得出）：`CapacitorHttp` **会自动跟随重定向**——
 *   Android 侧 `HttpURLConnection` 未显式关闭 `instanceFollowRedirects`（默认跟随），
 *   web 侧 `buildRequestInit()` 也不设 `redirect`（fetch 默认 `follow`）。
 *   若要禁止，只能通过 `disableRedirects: true` 整体关闭，本文件暂不处理。
 */

/** 传输层支持的请求方法。只开放我们实际用到的两种，避免把写操作误暴露给调用方 */
export type HttpTransportMethod = 'GET' | 'POST';

export interface HttpTransportRequest {
  method: HttpTransportMethod;
  headers: Record<string, string>;
  /**
   * 请求体。传**对象**（而不是预先 stringify 好的字符串）：
   * 传输层需要读 `stream` 字段来决定原生降级时的请求形态（见 `toNativeOptions`）。
   */
  body?: unknown;
  /** 超时（毫秒）。浏览器侧作 AbortController 用，原生侧同时作为连接与读取超时 */
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * 发起一次 LLM 相关请求。
 *
 * 行为契约：
 * 1. 先走浏览器 `fetch`（保持流式能力）；成功即返回，**不产生任何额外开销**；
 * 2. 仅当失败属于**网络层 `TypeError`**（浏览器里 CORS / DNS / 断网都表现为它）
 *    且当前是原生环境时，才退回 `CapacitorHttp` 发一次；
 * 3. 其余异常（用户取消的 `AbortError`、已归一化的 `AppError` 等）**原样抛出**，
 *    绝不触发第二次请求——否则用户点了「停止」还会被偷偷补发一次完整请求；
 * 4. 原生也失败时，抛**最初的**那个错误，而不是原生错误。
 *    这一点很关键：上层 `toAppError()` 靠 `TypeError` 才能归一成 `LLM_CORS`，
 *    进而让 UI 给出「自建代理」的替代方案。换成别的错误对象，这条引导就断了。
 */
export async function httpFetch(url: string, req: HttpTransportRequest): Promise<Response> {
  try {
    return await fetch(url, {
      method: req.method,
      headers: req.headers,
      body: serializeBody(req.body),
      signal: req.signal,
    });
  } catch (error) {
    const viaNative = await tryNativeFallback(url, req, error);
    if (viaNative) return viaNative;
    throw error;
  }
}

/* ============================================================
   原生兜底
   ============================================================ */

/** 判断是否值得尝试原生兜底；不值得时返回 undefined，调用方抛原始错误 */
async function tryNativeFallback(
  url: string,
  req: HttpTransportRequest,
  originalError: unknown,
): Promise<Response | undefined> {
  if (!Capacitor.isNativePlatform()) return undefined;
  // 用户主动取消：绝不能补发
  if (isAbortError(originalError)) return undefined;
  // 只认网络层 TypeError。AppError / 解析错误等已在别处归一化，不该在这里重试
  if (!(originalError instanceof TypeError)) return undefined;
  // 最小协议守卫：不把 file:// 、content:// 之类的方案喂给原生 HTTP 客户端
  if (!hasSupportedScheme(url)) {
    log.warn('llm', '原生兜底跳过：URL 协议不受支持', redact({ scheme: schemeOf(url) }), 'FN-11');
    return undefined;
  }

  const options = toNativeOptions(url, req);
  try {
    log.info('llm', '浏览器直连失败，改用原生通道重试', redact({ method: req.method }), 'FN-11');
    const response = await raceWithAbort(CapacitorHttp.request(options), req.signal);
    return toWebResponse(response);
  } catch (nativeError) {
    log.warn(
      'llm',
      '原生兜底同样失败，交回原始错误',
      redact({ native: nativeError instanceof Error ? nativeError.message : String(nativeError) }),
      'FN-11',
    );
    return undefined;
  }
}

/**
 * 构造原生请求参数。
 *
 * ★ 流式自动降级：原生通道**不支持流式**（一次性拿回整个 body，没有增量读）。
 *   若请求体里带 `stream: true`，这里会克隆一份并置为 `false`，
 *   让服务端直接返回整段 JSON——这正是对方补丁里「能用优先于有打字动画」的取舍。
 *   调用方**不需要**知道这件事，传输层自己判。
 *
 * ★ 响应 Content-Type 必须显式声明成 JSON：下游 `chatStream()` 靠
 *   `content-type 不是 text/event-stream` 才会进入「非 SSE → 整段作为单个 chunk」
 *   的降级分支。不声明的话，某些服务端会把 `text/event-stream` 回给我们，
 *   于是下游以为要解析 SSE，结果解析不出任何事件。
 */
function toNativeOptions(url: string, req: HttpTransportRequest): HttpOptions {
  const headers: Record<string, string> = { ...req.headers };
  let body = req.body;

  if (isStreamingBody(body)) {
    body = { ...(body as Record<string, unknown>), stream: false };
    headers['Content-Type'] = 'application/json';
  }

  const options: HttpOptions = {
    url,
    method: req.method,
    headers,
    // 不传的话原生侧会用插件自己的默认值，与我们的 timeoutMs 不一致
    // （会出现「fetch 已超时、原生却还在等」）。两个都显式给。
    connectTimeout: req.timeoutMs,
    readTimeout: req.timeoutMs,
    // 明确要文本：原生侧遇到 application/json 会直接解析成对象回传，
    // 其余情况给字符串；两者都在 toWebResponse() 里统一处理。
    responseType: 'text',
  };
  // GET 在原生侧本就不会带 body，塞了也会被忽略，这里显式不传以免歧义
  if (body !== undefined && req.method !== 'GET') options.data = body;
  return options;
}

/**
 * 把原生响应还原成标准 `Response`。
 *
 * ★ 关键坑（读 Java 源码得出）：原生侧若发现响应 Content-Type 是 `application/json`，
 *   `data` 字段回传的**已经是解析好的对象**，不是字符串。
 *   直接 `new Response(data)` 会得到 `[object Object]`——所以必须判断类型。
 */
function toWebResponse(response: HttpResponse): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(response.headers ?? {})) {
    try {
      headers.set(key, String(value));
    } catch {
      /* 非法头名 / 非法头值：跳过，不该因为一个头让整次响应失败 */
    }
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');

  const raw: unknown = response.data;
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');

  // status 必须在 200..599 之间，否则 `new Response` 直接抛 RangeError
  const status = Number.isInteger(response.status) && response.status >= 200 && response.status <= 599
    ? response.status
    : 200;

  // 204 / 205 / 304 语义上不允许携带 body，传了会抛
  const bodyless = status === 204 || status === 205 || status === 304;
  return new Response(bodyless ? null : text, { status, headers });
}

/* ============================================================
   小工具
   ============================================================ */

/** 对象请求体 → fetch 需要的字符串。字符串原样透传 */
function serializeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

/** 请求体是否声明了流式（用于原生降级时改写成非流式） */
function isStreamingBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { stream?: unknown }).stream === true;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === 'AbortError';
  return error instanceof Error && error.name === 'AbortError';
}

function schemeOf(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return 'invalid';
  }
}

/**
 * 最小协议守卫（**不是**完整的 URL 白名单）。
 *
 * 只拦掉 `file:` / `content:` / `javascript:` 这类不该喂给原生 HTTP 客户端的方案。
 * ★ 遗留风险：仍未实现「主机 / 方法 / 请求体体积」维度的完整白名单，
 *   即原生通道目前可以代为访问任意 http(s) 地址。约束它的前提是
 *   **`baseUrl` 只能来自用户在设置页的显式输入**，不得由角色卡、导入的聊天记录
 *   或模型输出推导而来。若将来开放外部数据影响 `baseUrl`，此处必须先补白名单。
 */
function hasSupportedScheme(url: string): boolean {
  const scheme = schemeOf(url);
  return scheme === 'http:' || scheme === 'https:';
}

/**
 * 给原生请求套一层取消。
 *
 * ★ 局限：`CapacitorHttp` 不接受 `AbortSignal`，**无法真正中断**已经在飞的请求。
 *   这里只能保证调用方拿到正确的 `AbortError`（语义正确、界面不会卡住），
 *   底层请求仍会在后台跑完，其结果被丢弃。
 *   若不套这一层，`stop()` 会一直等到整段生成结束才返回。
 */
function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('请求已取消', 'AbortError'));

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new DOMException('请求已取消', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
