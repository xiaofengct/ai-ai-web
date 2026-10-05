import type { CopyKey } from '@/copy/keys';
import { baseUrlFromRedirectHost } from './protocol';
import { ILINK_QR_STATUS, type IlinkQrcodeStatusResponse } from './types';

/**
 * ★ 微信 ClawBot 扫码登录 —— **纯状态机**。
 *
 * ────────────────────────────────────────────────────────────────
 * ★★ 这一层最硬的约束：**reducer 里不许发网络请求、不许碰 localStorage、
 *    不许读时间 / 随机数**。
 *
 *   所有副作用都由返回值里的 `effects` 表达，由驱动方（`ilinkStore`）执行。
 *   这样做的唯一目的：**状态机的每一条分支都能被单测覆盖**——
 *   扫码协议有 8 个状态（外加未知值），还有两套计数上限，
 *   靠真机点一遍是验不全的，而这里一次 `reducer(state, event)` 就能穷举。
 * ────────────────────────────────────────────────────────────────
 *
 * ★ 协议来源见 `protocol.ts` 文件头的许可证说明：只借鉴协议事实，代码全部重写。
 */

/** `expired` / `verify_code_blocked` 的换码次数上限（规格里是同一个计数器，上限 3） */
export const ILINK_QR_REFRESH_LIMIT = 3;

/**
 * 轮询间隔。规格里每次拿到状态后固定歇 1200ms 再问下一次。
 *
 * ⚠️ 注意：这是**两次轮询之间的间隔**，不是「长轮询挂起时长」——
 *    挂起在服务端，由客户端读超时（`ILINK_READ_TIMEOUT_MS`）兜住。
 *    两者别搞混。
 */
export const ILINK_QR_POLL_INTERVAL_MS = 1200;

/** 登录阶段 */
export type IlinkLoginPhase =
  | 'idle'
  | 'fetchingQr'
  | 'waiting'
  | 'scanned'
  | 'awaitingVerifyCode'
  | 'bound'
  | 'failed';

/** 状态机对外的副作用意图。由驱动方执行，reducer 自己不做 */
export type IlinkLoginEffect =
  | { readonly type: 'fetchQr' }
  /** 用**当前 state** 的 `qrcode` / `verifyCode` / `baseUrl` 再问一次状态 */
  | { readonly type: 'pollQrcodeStatus' }
  | { readonly type: 'notifyStart' }
  | { readonly type: 'startReceiver' }
  /** 绑定确认：凭据只在**这个瞬时载荷**里出现，不进 state（避免被日志 / 持久化带出去） */
  | {
      readonly type: 'bindConfirmed';
      readonly botId: string;
      readonly botToken: string;
      readonly userId?: string;
      readonly baseUrl?: string;
    }
  /** 流程结束（成功或失败），驱动方停止轮询 */
  | { readonly type: 'finish' };

/** 驱动方喂进来的事件 */
export type IlinkLoginEvent =
  | { readonly type: 'start'; readonly baseUrl?: string; readonly hasLocalToken: boolean }
  | { readonly type: 'qrFetched'; readonly qrcode: string; readonly qrContent?: string }
  | { readonly type: 'qrFetchFailed'; readonly failureKey: CopyKey }
  | { readonly type: 'status'; readonly response: IlinkQrcodeStatusResponse }
  | { readonly type: 'verifyCodeSubmitted'; readonly code: string }
  | { readonly type: 'abort' }
  | { readonly type: 'reset' };

/**
 * 状态机状态。
 *
 * ★ 这里**不含任何凭据字段**（`bot_token` 之类）——它们只走 `bindConfirmed` effect。
 *   这是刻意的：state 是会被渲染、被日志、被单测快照带走的东西。
 */
export interface IlinkLoginState {
  readonly phase: IlinkLoginPhase;
  /** UI 主状态文案 key（永不硬编码中文） */
  readonly messageKey: CopyKey;
  /** 主状态文案的占位符（如 `{n}`） */
  readonly messageVars?: Readonly<Record<string, string | number>>;
  /** 当前二维码 id（服务端下发的 `qrcode`） */
  readonly qrcode: string;
  /**
   * 二维码**内容**（要被编码进二维码的字符串），不是图片地址。
   *
   * ★★ 2026-10-04 改名（原名 `qrImageUrl`，语义错误、且已导致一个真 bug）：
   *   服务端 `get_bot_qrcode` 返回的 `qrcode_img_content` 实测是一个
   *   **H5 页面链接**（`https://liteapp.weixin.qq.com/q/...`，返回 `text/html`），
   *   不是图片。字段名的含义是「二维码图片的**内容**」= 应当被编码进二维码的载荷。
   *   按原名把它当 `<img src>` 用 ⇒ 浏览器解析 HTML 失败 ⇒ **破图**（实测确认）。
   *   正确用法：用二维码库把本字段的**值**编码成二维码再显示。
   *   服务端不给就是 undefined（此时只展示 id，不画假码 —— 不糊弄）。
   */
  readonly qrContent?: string;
  /** 已提交的配对码；`''` 表示没提交过 */
  readonly verifyCode: string;
  /** `expired` / `verify_code_blocked` 共用的换码计数器 */
  readonly refreshCount: number;
  /** 当前运行期基址（可能被 `scaned_but_redirect` 改写） */
  readonly baseUrl?: string;
  /** 本机是否已有可用凭据（决定 `binded_redirect` 走哪条分支） */
  readonly hasLocalToken: boolean;
  /** 失败原因文案 key（仅 `phase === 'failed'` 时有值） */
  readonly failureKey?: CopyKey;
}

/** reducer 的返回值 */
export interface IlinkLoginTransition {
  readonly state: IlinkLoginState;
  readonly effects: readonly IlinkLoginEffect[];
}

/** 初始状态（未开始） */
export function createInitialLoginState(): IlinkLoginState {
  return {
    phase: 'idle',
    messageKey: 'ilink.state.idle',
    qrcode: '',
    verifyCode: '',
    refreshCount: 0,
    hasLocalToken: false,
  };
}

/** 是否已进入终态（成功或失败）——驱动方据此停止轮询 */
export function isLoginTerminal(state: IlinkLoginState): boolean {
  return state.phase === 'bound' || state.phase === 'failed';
}

/** 当前是否在等用户填配对码 */
export function isAwaitingVerifyCode(state: IlinkLoginState): boolean {
  return state.phase === 'awaitingVerifyCode';
}

/** 无副作用的失败转移 */
function fail(state: IlinkLoginState, failureKey: CopyKey): IlinkLoginTransition {
  return {
    state: { ...state, phase: 'failed', failureKey, messageKey: failureKey },
    effects: [{ type: 'finish' }],
  };
}

/**
 * 处理 `status` 事件的核心分支。
 *
 * 单独抽出来是为了让「8 个已知取值 + 未知值」这张表在代码里一眼看全，
 * 不用在一大坨 reducer 里找。
 */
function reduceStatus(
  state: IlinkLoginState,
  response: IlinkQrcodeStatusResponse,
): IlinkLoginTransition {
  const status = response.status;

  switch (status) {
    // —— 等扫码 / 已扫码 ——
    case ILINK_QR_STATUS.WAIT:
      return {
        state: { ...state, phase: 'waiting', messageKey: 'ilink.state.scanQr' },
        effects: [{ type: 'pollQrcodeStatus' }],
      };

    case ILINK_QR_STATUS.SCANED:
      return {
        state: { ...state, phase: 'scanned', messageKey: 'ilink.state.scanned' },
        effects: [{ type: 'pollQrcodeStatus' }],
      };

    // —— 需要配对码：**停轮询，等用户输入**（由 verifyCodeSubmitted 再续上） ——
    case ILINK_QR_STATUS.NEED_VERIFYCODE:
      return {
        state: { ...state, phase: 'awaitingVerifyCode', messageKey: 'ilink.state.needVerifyCode' },
        effects: [],
      };

    // —— IDC 重定向：把新 host 写回 baseUrl，然后**用新基址继续轮询** ——
    case ILINK_QR_STATUS.SCANED_BUT_REDIRECT: {
      const host = (response.redirect_host ?? '').trim();
      const baseUrl = host ? baseUrlFromRedirectHost(host) : state.baseUrl;
      return {
        state: { ...state, phase: 'waiting', baseUrl, messageKey: 'ilink.state.redirected' },
        effects: [{ type: 'pollQrcodeStatus' }],
      };
    }

    // —— 配对码连错：换一张码重来（共用 refresh 计数） ——
    case ILINK_QR_STATUS.VERIFY_CODE_BLOCKED: {
      const refreshCount = state.refreshCount + 1;
      if (refreshCount > ILINK_QR_REFRESH_LIMIT) return fail(state, 'ilink.err.qrRefreshLimit');
      return {
        state: {
          ...state,
          phase: 'fetchingQr',
          refreshCount,
          // 旧码的配对码对新码无效，必须清掉
          verifyCode: '',
          messageKey: 'ilink.state.refreshingQr',
          messageVars: { n: refreshCount },
        },
        effects: [{ type: 'fetchQr' }],
      };
    }

    // —— 二维码过期：换一张码重来 ——
    case ILINK_QR_STATUS.EXPIRED: {
      const refreshCount = state.refreshCount + 1;
      if (refreshCount > ILINK_QR_REFRESH_LIMIT) return fail(state, 'ilink.err.qrRefreshLimit');
      return {
        state: {
          ...state,
          phase: 'fetchingQr',
          refreshCount,
          verifyCode: '',
          messageKey: 'ilink.state.refreshingQr',
          messageVars: { n: refreshCount },
        },
        effects: [{ type: 'fetchQr' }],
      };
    }

    // —— 这个 bot 已经绑过了：有本地凭据就直接用，否则提示重新扫码 ——
    case ILINK_QR_STATUS.BINDED_REDIRECT: {
      if (!state.hasLocalToken) return fail(state, 'ilink.err.boundElsewhere');
      return {
        state: { ...state, phase: 'bound', messageKey: 'ilink.state.reuseLocalCredentials' },
        effects: [{ type: 'notifyStart' }, { type: 'startReceiver' }, { type: 'finish' }],
      };
    }

    // —— 绑定确认（唯一成功出口） ——
    case ILINK_QR_STATUS.CONFIRMED: {
      const botId = (response.ilink_bot_id ?? '').trim();
      const botToken = (response.bot_token ?? '').trim();
      // 规格里这里是「抛错」：缺任一凭据即绑定失败，不许当成成功继续走
      if (!botId || !botToken) return fail(state, 'ilink.err.missingCredentials');
      const userId = (response.ilink_user_id ?? '').trim() || undefined;
      const baseUrl = (response.baseurl ?? '').trim() || undefined;
      return {
        state: { ...state, phase: 'bound', messageKey: 'ilink.state.bound', failureKey: undefined },
        effects: [
          { type: 'bindConfirmed', botId, botToken, userId, baseUrl },
          { type: 'notifyStart' },
          { type: 'startReceiver' },
          { type: 'finish' },
        ],
      };
    }

    // —— 未知取值：容错，继续轮询（协议演进时表现为「多等一会儿」，比直接失败好排查） ——
    default:
      return {
        state: { ...state, phase: 'waiting', messageKey: 'ilink.state.scanQr' },
        effects: [{ type: 'pollQrcodeStatus' }],
      };
  }
}

/**
 * ★ 主 reducer：`(state, event) => { nextState, effects }`。
 *
 * 纯函数：同样的 `(state, event)` 一定得到同样的结果，且不修改入参。
 */
export function ilinkLoginReducer(
  state: IlinkLoginState,
  event: IlinkLoginEvent,
): IlinkLoginTransition {
  switch (event.type) {
    case 'reset':
    case 'abort':
      return { state: createInitialLoginState(), effects: [{ type: 'finish' }] };

    case 'start':
      return {
        state: {
          ...createInitialLoginState(),
          phase: 'fetchingQr',
          messageKey: 'ilink.state.fetchingQr',
          baseUrl: event.baseUrl,
          hasLocalToken: event.hasLocalToken,
        },
        effects: [{ type: 'fetchQr' }],
      };

    case 'qrFetched':
      return {
        state: {
          ...state,
          phase: 'waiting',
          messageKey: 'ilink.state.scanQr',
          qrcode: event.qrcode,
          qrContent: event.qrContent,
          // 新码作废旧配对码
          verifyCode: '',
          failureKey: undefined,
        },
        effects: [{ type: 'pollQrcodeStatus' }],
      };

    case 'qrFetchFailed':
      return fail(state, event.failureKey);

    case 'verifyCodeSubmitted':
      return {
        state: {
          ...state,
          phase: 'waiting',
          messageKey: 'ilink.state.verifySubmitted',
          verifyCode: event.code.trim(),
        },
        effects: [{ type: 'pollQrcodeStatus' }],
      };

    case 'status':
      return reduceStatus(state, event.response);
  }
  // ★ 正常不可达：`event` 是判别联合且上面每个 `type` 都已处理。
  //   留这一行是为了在任何 tsconfig 下函数都有返回值，而不是靠 `noImplicitReturns` 的宽松度。
  return { state, effects: [] };
}
