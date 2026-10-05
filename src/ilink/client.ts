import { httpFetch } from '@/llm/httpTransport';
import { AppError, isAppError, toAppError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/result';
import {
  ILINK_PATHS,
  ILINK_QR_BOT_TYPE,
  ILINK_READ_TIMEOUT_MS,
  ILINK_SHORT_TIMEOUT_MS,
  ILINK_TYPING_STATUS,
  buildBaseInfo,
  buildHeaders,
  joinUrl,
  resolveBaseUrl,
} from './protocol';
import {
  ILINK_ERROR_CODES,
  type IlinkConfigResponse,
  type IlinkErrorFields,
  type IlinkOutboundMessage,
  type IlinkQrcodeResponse,
  type IlinkQrcodeStatusResponse,
  type IlinkRequestContext,
  type IlinkSendMessageResponse,
  type IlinkSimpleResponse,
  type IlinkUpdatesResponse,
} from './types';

/**
 * ★ 微信 ClawBot（iLink Bot）HTTP 客户端。
 *
 * ────────────────────────────────────────────────────────────────
 * ★★ 为什么必须走 `@/llm/httpTransport` 的 `httpFetch`，不许自己写 `fetch`：
 *
 *   它封装了「浏览器 `fetch` 优先 → 失败且处于原生环境时退回 `CapacitorHttp`」。
 *   `CapacitorHttp` 在原生侧走 `HttpURLConnection`，**不受 CORS 约束**——
 *   这正是本通道能跑通的前提：本协议的请求带 4 个**非标准请求头**
 *   （`AuthorizationType` / `X-WECHAT-UIN` / `iLink-App-Id` / `iLink-App-ClientVersion`），
 *   在浏览器里必然触发 CORS 预检，纯 Web 直连**大概率不通**（未实测，见交付报告）。
 *
 *   ⇒ 换掉这个依赖 = 静默丢掉原生兜底，而且不会有任何编译错误。
 * ────────────────────────────────────────────────────────────────
 *
 * ★ 本层只做「发请求 + 解析 + 归一化错误」，**不解释业务语义**：
 *   `errcode` / `status` 一律原样交给调用方（store / login reducer）判断。
 *   理由：`errcode = -14` 对 `getupdates` 是「会话过期、清缓冲继续」，
 *   对 `sendmessage` 是「发送失败」——同一个字段两种处置，客户端不该替调用方决定。
 */

/** 统一的请求描述 */
interface RawRequest {
  method: 'GET' | 'POST';
  path: string;
  /** 查询参数（会被 `encodeURIComponent`） */
  query?: Record<string, string | number | undefined>;
  /** 请求体（对象，由 httpFetch 序列化） */
  body?: unknown;
  /** 是否附加 `Authorization` */
  withAuth: boolean;
  timeoutMs: number;
}

/** 把异常归一成本域可识别的 `AppError` */
function normalizeError(e: unknown): AppError {
  if (isAppError(e)) return e;
  // fetch 在浏览器里把 CORS / DNS / 断网都表现为 TypeError；此时原生兜底若也失败，
  // httpTransport 会把**最初的那个** TypeError 抛回来（见其文件头契约）。
  if (e instanceof TypeError) {
    return new AppError(ILINK_ERROR_CODES.NETWORK, 'iLink 请求失败（网络层）', e);
  }
  return toAppError(e);
}

/** 拼完整 URL */
function buildUrl(ctx: IlinkRequestContext, path: string, query?: RawRequest['query']): string {
  const base = joinUrl(resolveBaseUrl(ctx.baseUrl), path);
  if (!query) return base;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length > 0 ? `${base}?${parts.join('&')}` : base;
}

/** 读响应体：先取文本，再尽力解析成 JSON（原生通道可能回字符串） */
async function readJson(res: Response): Promise<Result<Record<string, unknown>>> {
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    return err(new AppError(ILINK_ERROR_CODES.PROTOCOL, 'iLink 响应体读取失败', e));
  }
  if (text.trim() === '') return ok({});
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return ok(parsed as Record<string, unknown>);
    }
    return err(new AppError(ILINK_ERROR_CODES.PROTOCOL, 'iLink 响应不是 JSON 对象'));
  } catch (e) {
    return err(new AppError(ILINK_ERROR_CODES.PROTOCOL, 'iLink 响应不是合法 JSON', e));
  }
}

/** HTTP 状态 → AppError */
function statusError(status: number): AppError {
  if (status === 401 || status === 403) {
    return new AppError(ILINK_ERROR_CODES.AUTH, `iLink 鉴权失败（HTTP ${status}）`, { status });
  }
  return new AppError(ILINK_ERROR_CODES.HTTP, `iLink 请求失败（HTTP ${status}）`, { status });
}

/**
 * 唯一请求出口。
 *
 * 契约：
 *   1. 网络 / 解析 / HTTP 层失败 → `Result.error`（带本域错误码）；
 *   2. **业务错误码（`errcode` / `ret`）不算失败**——原样返回，交给调用方解释；
 *   3. 绝不抛错到调用方（`Result<T>` 一路到底，与 `src/db/repo/` 同口径）。
 */
async function request(ctx: IlinkRequestContext, req: RawRequest): Promise<Result<Record<string, unknown>>> {
  const url = buildUrl(ctx, req.path, req.query);
  let res: Response;
  try {
    res = await httpFetch(url, {
      method: req.method,
      headers: {
        ...(req.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...buildHeaders(ctx.token, req.withAuth),
      },
      body: req.body,
      timeoutMs: req.timeoutMs,
    });
  } catch (e) {
    return err(normalizeError(e));
  }
  if (!res.ok) return err(statusError(res.status));
  return readJson(res);
}

/* ============================================================
   端点方法
   ============================================================ */

/**
 * 取绑定二维码。
 *
 * ★ `withAuth: false` —— 扫码发生在「还没有 token」之前，服务端不认未绑定的凭据。
 *   `local_token_list` 传本机已有的令牌（有就带上；服务端如何用它**未验证**，
 *   对方注释也没说，只写了 body 形状）。
 */
export async function getBotQrcode(
  ctx: IlinkRequestContext,
  localTokens: readonly string[],
): Promise<Result<IlinkQrcodeResponse>> {
  const tokens = localTokens.map((t) => t.trim()).filter((t) => t !== '');
  const res = await request(ctx, {
    method: 'POST',
    path: ILINK_PATHS.getBotQrcode,
    query: { bot_type: ILINK_QR_BOT_TYPE },
    body: { local_token_list: tokens },
    withAuth: false,
    timeoutMs: ILINK_SHORT_TIMEOUT_MS,
  });
  if (!res.ok) return res;
  const data = res.value as IlinkQrcodeResponse;
  if (!data.qrcode) {
    return err(
      new AppError(ILINK_ERROR_CODES.PROTOCOL, 'iLink 未返回二维码 id', { errcode: data.errcode }),
    );
  }
  return ok(data);
}

/**
 * 长轮询扫码状态。
 *
 * ★ `withAuth: false`，同 `getBotQrcode`（扫码阶段全程无鉴权）。
 * ★ 用长读超时：服务端会挂起一段时间等状态变化，超时过早会把正常长轮询当失败。
 */
export async function getQrcodeStatus(
  ctx: IlinkRequestContext,
  qrcode: string,
  verifyCode?: string,
): Promise<Result<IlinkQrcodeStatusResponse>> {
  const res = await request(ctx, {
    method: 'GET',
    path: ILINK_PATHS.getQrcodeStatus,
    query: { qrcode, verify_code: verifyCode },
    withAuth: false,
    timeoutMs: ILINK_READ_TIMEOUT_MS,
  });
  if (!res.ok) return res;
  return ok(res.value as IlinkQrcodeStatusResponse);
}

/**
 * 长轮询收消息。
 *
 * ★ 调用方**必须**在拿到结果后、解析 `msgs` 之前把 `get_updates_buf` 回存
 *   （见 `receiver.ts` 的注释）。
 */
export async function getUpdates(
  ctx: IlinkRequestContext,
  getUpdatesBuf: string,
): Promise<Result<IlinkUpdatesResponse>> {
  const res = await request(ctx, {
    method: 'POST',
    path: ILINK_PATHS.getUpdates,
    body: { get_updates_buf: getUpdatesBuf, base_info: buildBaseInfo() },
    withAuth: true,
    timeoutMs: ILINK_READ_TIMEOUT_MS,
  });
  if (!res.ok) return res;
  return ok(res.value as IlinkUpdatesResponse);
}

/**
 * 发消息。
 *
 * ★ 业务成败由调用方按「响应里有没有 `errcode`」判定（见 `hasIlinkError`），
 *   客户端不替它下结论。
 */
export async function sendMessage(
  ctx: IlinkRequestContext,
  msg: IlinkOutboundMessage,
): Promise<Result<IlinkSendMessageResponse>> {
  const res = await request(ctx, {
    method: 'POST',
    path: ILINK_PATHS.sendMessage,
    body: { msg, base_info: buildBaseInfo() },
    withAuth: true,
    timeoutMs: ILINK_SHORT_TIMEOUT_MS,
  });
  if (!res.ok) return res;
  return ok(res.value as IlinkSendMessageResponse);
}

/** 取「输入中」票据（`typing_ticket`） */
export async function getConfig(
  ctx: IlinkRequestContext,
  ilinkUserId: string,
  contextToken?: string,
): Promise<Result<IlinkConfigResponse>> {
  const res = await request(ctx, {
    method: 'POST',
    path: ILINK_PATHS.getConfig,
    body: {
      ilink_user_id: ilinkUserId,
      context_token: contextToken,
      base_info: buildBaseInfo(),
    },
    withAuth: true,
    timeoutMs: ILINK_SHORT_TIMEOUT_MS,
  });
  if (!res.ok) return res;
  return ok(res.value as IlinkConfigResponse);
}

/** 输入中开 / 关 */
export async function sendTyping(
  ctx: IlinkRequestContext,
  params: { ilinkUserId: string; typingTicket: string; start: boolean },
): Promise<Result<IlinkSimpleResponse>> {
  const res = await request(ctx, {
    method: 'POST',
    path: ILINK_PATHS.sendTyping,
    body: {
      ilink_user_id: params.ilinkUserId,
      typing_ticket: params.typingTicket,
      status: params.start ? ILINK_TYPING_STATUS.START : ILINK_TYPING_STATUS.STOP,
      base_info: buildBaseInfo(),
    },
    withAuth: true,
    timeoutMs: ILINK_SHORT_TIMEOUT_MS,
  });
  if (!res.ok) return res;
  return ok(res.value as IlinkSimpleResponse);
}

/**
 * 上线通知（「起停通知」的 start）。
 *
 * ★ 对应的 `notifystop` **本仓库不实现**：对方源码里它只出现在注释中、
 *   没有任何实现，路径与请求体均**未验证**（见 `protocol.ILINK_PATHS.notifyStop` 注释）。
 *   ⇒ 解绑时**不通知服务端**，这是已知行为，不是遗漏；已写进 `ilink.note.unbindLocalOnly` 文案。
 */
export async function notifyStart(ctx: IlinkRequestContext): Promise<Result<IlinkSimpleResponse>> {
  const res = await request(ctx, {
    method: 'POST',
    path: ILINK_PATHS.notifyStart,
    body: { base_info: buildBaseInfo() },
    withAuth: true,
    timeoutMs: ILINK_SHORT_TIMEOUT_MS,
  });
  if (!res.ok) return res;
  return ok(res.value as IlinkSimpleResponse);
}

/* ============================================================
   业务判据
   ============================================================ */

/**
 * 响应是否携带服务端错误码。
 *
 * ★ 判据照规格：**只要 `errcode` 存在即为失败**（对方实现是 `!(r && r.errcode)`）。
 *   `ret` 只在 `getupdates` 的会话过期判定里用（`-14`），**不**作为通用失败判据——
 *   把它也当失败会在成功响应里误报（成功响应可能带 `ret: 0`）。
 */
export function hasIlinkError(res: IlinkErrorFields | undefined): boolean {
  if (!res) return false;
  return res.errcode !== undefined && res.errcode !== null;
}
