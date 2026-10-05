import { create } from 'zustand';
import { t } from '@/copy';
import type { CopyKey } from '@/copy/keys';
import { DEFAULT_ILINK_SETTINGS, XINRAN_PERSONA_ID } from '@/constants/defaults';
import { messageRepo } from '@/db/repo/messageRepo';
import { sessionRepo } from '@/db/repo/sessionRepo';
import {
  getBotQrcode,
  getQrcodeStatus,
  getUpdates,
  hasIlinkError,
  notifyStart as notifyStartApi,
  sendMessage,
} from '@/ilink/client';
import {
  ILINK_QR_POLL_INTERVAL_MS,
  createInitialLoginState,
  ilinkLoginReducer,
  isLoginTerminal,
  type IlinkLoginEffect,
  type IlinkLoginEvent,
  type IlinkLoginState,
} from '@/ilink/login';
import { ILINK_ITEM_TYPE, ILINK_MESSAGE_STATE, ILINK_MESSAGE_TYPE } from '@/ilink/protocol';
import {
  createIlinkReceiver,
  ilinkBufStore,
  type IlinkInbound,
  type IlinkRuntimeConfig,
} from '@/ilink/receiver';
import { ILINK_ERROR_CODES, type IlinkOutboundMessage } from '@/ilink/types';
import { AppError, isAppError } from '@/lib/errors';
import { sleep } from '@/lib/sleep';
import { log } from './logStore';
import { usePersonaStore } from './personaStore';
import { useSettingsStore } from './settingsStore';
import type { IlinkSettings } from '@/types/settings';
import type { Result } from '@/types/common';
import type { UUID } from '@/types/common';

/**
 * ★ 微信 ClawBot（iLink Bot 通道）运行时 Store。
 *
 * ────────────────────────────────────────────────────────────────
 * 职责边界（想清楚再往这里加东西）：
 *   - **配置与凭据**不在本 store：它们在 `AppSettings.ilink`（`settingsStore` 持久化）。
 *     本 store 只**读**它，写的时候经 `settingsStore.patch`。
 *   - **协议与状态机**不在本 store：`src/ilink/protocol.ts` / `login.ts`。
 *     本 store 是**驱动方**——执行 reducer 产出的 `effects`。
 *   - **运行时态**（登录进度、收消息循环、context_token 缓存、日志环）在这里，
 *     且**不持久化**（context_token 与 typing_ticket 都是会话级的，重启即失效）。
 *
 * ★ 安全边界：本 store **不打印、不持久化** `botToken`。
 *   登录成功时凭据只从 `bindConfirmed` effect 的瞬时载荷里过一手，
 *   立刻写进 settings，之后只用不打印。日志走 `redact()` 兜底。
 * ────────────────────────────────────────────────────────────────
 */

/** 连接态（UI 用于配色 / 图标，与 `login.messageKey` 互补） */
export type IlinkConnectionState = 'idle' | 'binding' | 'connected' | 'error';

/** 注入缝：收到入站消息（已落库）后的回调，由上层接 LLM 生成链路 */
export type IlinkInboundHandler = (
  inbound: IlinkInbound,
  ctx: { sessionId?: UUID },
) => void | Promise<void>;

/** 内存日志环上限（UI 的「原始响应日志」框） */
const MAX_LOGS = 60;

/**
 * 微信会话的**固定 id**。
 *
 * 理由：微信来的消息需要一个落点。用固定 id 让「同一个微信联系人永远进同一条会话」，
 * 不必去猜「哪条会话是微信的」。上层若想换落点，用 `setInboundSessionId()` 覆盖。
 */
export const ILINK_SESSION_ID: UUID = 'session-ilink-wechat';

/** `context_token` 内存缓存。★ 不持久化：它是随消息滚动的会话级令牌 */
const contextTokens = new Map<string, string>();

/** 外部注入的运行时态（刻意不放 store state：它们不需要触发重渲染） */
let inboundSessionId: UUID | undefined;
let inboundHandler: IlinkInboundHandler | null = null;
/** 驱动登录流程的代号；`abortLogin()` 递增它让正在跑的驱动循环退出 */
let loginToken = 0;

/** 读设置里的 ilink 分组 */
function ilinkSettings(): IlinkSettings {
  /**
   * ★ 兜底不能省（2026-10-04，真机 P0）。
   *
   * 老用户的 localStorage 里没有 `ilink` 键（它是后来新增的分组），
   * 曾经导致 `settings.ilink` 为 `undefined` ⇒ `s.enabled` 抛
   * `TypeError: Cannot read properties of undefined` ⇒ **整个应用打不开**。
   *
   * 根因已在 `store/settingsStore.ts` 的 `merge` 里修掉（每次 hydration 都补全）。
   * 这里再兜一层，理由是**失败代价太不对称**：
   *   - 兜底的成本：一行 `??`；
   *   - 不兜底的代价：用户打开应用直接崩，且我们只能等用户截图才知道。
   * 这类"读设置分组"的地方，宁可多一层防御。
   */
  return useSettingsStore.getState().settings.ilink ?? DEFAULT_ILINK_SETTINGS;
}

/** 写设置里的 ilink 分组（深合并，只动本组字段） */
function patchIlink(partial: Partial<IlinkSettings>): void {
  useSettingsStore.getState().patch({ ilink: partial });
}

/** 由设置拼出一次请求的上下文 */
function contextOf(s: IlinkSettings): { baseUrl?: string; token?: string } {
  return { baseUrl: s.baseUrl || undefined, token: s.botToken || undefined };
}

/** AppError → 用户可见的错误文案 key（永不把英文 message 显示给用户） */
function errorKeyOf(error: AppError | undefined): CopyKey {
  switch (error?.code) {
    case ILINK_ERROR_CODES.NETWORK:
      return 'ilink.err.network';
    case ILINK_ERROR_CODES.AUTH:
    case ILINK_ERROR_CODES.HTTP:
      return 'ilink.err.http';
    case ILINK_ERROR_CODES.NOT_NATIVE:
      return 'ilink.err.notNative';
    case ILINK_ERROR_CODES.PROTOCOL:
    case ILINK_ERROR_CODES.ARGS:
    default:
      return 'ilink.err.protocol';
  }
}

/**
 * 状态文案选择器。
 *
 * ★ 为什么不把结果存进 store state：那会成为「同一件事的第二份真相」
 *   （设置里已能算出「绑定没绑定」，再存一份就会漂）。
 *   这里**每次从 `login.state` + 设置实时算**，只有一个来源。
 */
export function selectIlinkStatusKey(state: Pick<IlinkStoreState, 'login' | 'receiving'>): CopyKey {
  if (state.login.phase !== 'idle') return state.login.messageKey;
  const s = ilinkSettings();
  if (s.enabled && s.botToken) return state.receiving ? 'ilink.state.bound' : 'ilink.state.stopped';
  return 'ilink.state.idle';
}

/** 状态文案的占位符（只有刷新二维码那条带 `{n}`） */
export function selectIlinkStatusVars(
  state: Pick<IlinkStoreState, 'login'>,
): Readonly<Record<string, string | number>> | undefined {
  return state.login.phase === 'idle' ? undefined : state.login.messageVars;
}

/** `Result` 失败 → 统一记一行日志 + 返回错误文案 key */
function reportFailure(scope: string, result: Result<unknown>): CopyKey {
  if (result.ok) return 'ilink.err.protocol';
  const key = errorKeyOf(result.error);
  log.warn('ilink', `${scope} 失败`, { code: result.error.code, message: result.error.message });
  return key;
}

export interface IlinkStoreState {
  /** 登录状态机状态（纯数据，可单测 / 可快照） */
  login: IlinkLoginState;
  /** 连接态 */
  connection: IlinkConnectionState;
  /** 收消息循环是否在跑 */
  receiving: boolean;
  /** 连续失败次数（0 = 正常）；UI 可据此提示「连接不稳」 */
  receivingErrors: number;
  /** 原始响应日志（最近的在前） */
  logs: readonly string[];

  /** 覆盖入站消息的落库会话；不设则用 `ILINK_SESSION_ID` */
  setInboundSessionId(id?: UUID): void;
  /** 注册「收到消息 → 生成回发」的处理函数（本仓库未接完整链路，见交付说明） */
  setInboundHandler(handler: IlinkInboundHandler | null): void;

  /** 开始扫码绑定；返回时流程已进入终态（成功或失败） */
  startLogin(): Promise<void>;
  /** 提交用户在微信里看到的配对码 */
  submitVerifyCode(code: string): void;
  /** 放弃本次扫码 */
  abortLogin(): void;

  /** 用已保存的凭据启动收消息循环（幂等）。App 启动时调用一次 */
  ensureRunning(): void;
  /** 停止收消息循环 */
  stop(): void;

  /** 发文本。`contextToken` 不给则用缓存的；返回是否发成功 */
  sendText(text: string, toUserId?: string, contextToken?: string): Promise<boolean>;
  /** 发一条测试消息（设置页按钮） */
  sendTestMessage(): Promise<boolean>;

  /** 解绑：只清本机（服务端关系不动，见 `ilink.note.unbindLocalOnly`） */
  unbind(): void;
  /** 清空日志环 */
  clearLogs(): void;
  /** 读缓存的 context_token（回复链路用） */
  getContextToken(from: string): string | undefined;
}

export const useIlinkStore = create<IlinkStoreState>()((set, get) => {
  /* ---------- 日志 ---------- */

  function pushLog(line: string): void {
    set((state) => ({ logs: [line, ...state.logs].slice(0, MAX_LOGS) }));
  }

  /** 记录一条带时间戳的日志行（同时进内存环）；`mirror` 为真时另写系统日志 */
  function record(message: string, mirror = false): void {
    const time = new Date().toTimeString().slice(0, 8);
    pushLog(`[${time}] ${message}`);
    if (mirror) log.info('ilink', message);
  }

  /* ---------- 收消息循环 ---------- */

  const receiver = createIlinkReceiver({
    getRuntime: (): IlinkRuntimeConfig => {
      const s = ilinkSettings();
      return {
        enabled: s.enabled,
        receive: s.receive,
        token: s.botToken,
        baseUrl: s.baseUrl || undefined,
        userId: s.userId || undefined,
      };
    },
    client: { getUpdates },
    buf: ilinkBufStore,
    onInbound: (inbound) => handleInbound(inbound),
    onAdoptUserId: (userId) => {
      // 绑定响应没给 userId 时，用第一条消息的来源补全
      patchIlink({ userId });
    },
    onContextToken: (from, token) => {
      // ★ 每条带 token 的消息都覆盖（它是滚动值，不是一次性赋值）
      contextTokens.set(from, token);
    },
    onTick: ({ errors }) => set({ receivingErrors: errors }),
    log: (level, message, detail) => {
      record(message, level === 'warn');
      if (level === 'warn') log.warn('ilink', message, detail);
    },
  });

  /** 入站消息：落库 → 交给注入的处理函数 */
  async function handleInbound(inbound: IlinkInbound): Promise<void> {
    const sessionId = await resolveInboundSession();
    const content =
      inbound.kind === 'text'
        ? inbound.text
        : inbound.kind === 'voice'
          ? inbound.transcript || t('ilink.inbound.voice')
          : inbound.kind === 'image'
            ? t('ilink.inbound.image')
            : t('ilink.inbound.unsupported');

    if (sessionId) {
      const appended = await messageRepo.append({
        sessionId,
        role: 'user',
        content,
        props: {
          via: 'wechat',
          wechatKind: inbound.kind,
          from: inbound.from,
        },
      });
      if (!appended.ok) {
        log.warn('ilink', '微信入站消息落库失败', { code: appended.error.code });
      }
    } else {
      // 落不了库也要看得见，不许静默丢
      record(`收到微信消息但找不到落库会话：${content.slice(0, 40)}`, true);
    }

    if (inboundHandler) {
      await inboundHandler(inbound, { sessionId });
    }
  }

  /** 解析（必要时创建）微信会话 */
  async function resolveInboundSession(): Promise<UUID | undefined> {
    if (inboundSessionId) return inboundSessionId;
    const existing = await sessionRepo.get(ILINK_SESSION_ID);
    if (existing.ok && existing.value) return ILINK_SESSION_ID;

    const persona = usePersonaStore.getState().current();
    const created = await sessionRepo.create({
      id: ILINK_SESSION_ID,
      title: t('ilink.session.title'),
      personaId: persona?.id ?? XINRAN_PERSONA_ID,
    });
    if (!created.ok) {
      log.warn('ilink', '创建微信会话失败', { code: created.error.code });
      return undefined;
    }
    return ILINK_SESSION_ID;
  }

  /* ---------- 登录驱动 ---------- */

  /** 执行一个 effect，返回「下一个要喂给 reducer 的事件」（无则 null） */
  async function runEffect(
    effect: IlinkLoginEffect,
    token: number,
  ): Promise<IlinkLoginEvent | null> {
    switch (effect.type) {
      case 'fetchQr':
        return fetchQrEvent(token);
      case 'pollQrcodeStatus':
        return pollStatusEvent(token);
      case 'notifyStart':
        await doNotifyStart();
        return null;
      case 'startReceiver':
        startReceiverInternal();
        return null;
      case 'bindConfirmed': {
        // ★ 凭据只在这里过一手，立刻落到 settings；不打印、不进日志
        patchIlink({
          botId: effect.botId,
          botToken: effect.botToken,
          userId: effect.userId ?? ilinkSettings().userId,
          baseUrl: effect.baseUrl ?? '',
          enabled: true,
        });
        // 新绑定必须重置同步游标，否则会拿旧游标去新会话里捞历史
        ilinkBufStore.clear();
        record('绑定成功，凭据已保存（明文，仅本机）', true);
        return null;
      }
      case 'finish':
        return null;
    }
    return null;
  }

  /** 取二维码 → 事件 */
  async function fetchQrEvent(token: number): Promise<IlinkLoginEvent> {
    const s = ilinkSettings();
    record('POST get_bot_qrcode');
    const res = await getBotQrcode(contextOf(s), s.botToken ? [s.botToken] : []);
    if (token !== loginToken) return { type: 'abort' };
    if (!res.ok) return { type: 'qrFetchFailed', failureKey: reportFailure('get_bot_qrcode', res) };
    /*
     * ★★ 实测更正（2026-10-04）：这个字段**不是图片地址**，是「要被编码进二维码的内容」。
     *
     * 实测 `get_bot_qrcode` 的真响应：
     *   { "qrcode":"81f7…", "qrcode_img_content":"https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=81f7…&bot_type=3", "ret":0 }
     * 而抓取那个 URL 得到的是 **`Content-Type: text/html`** 的 H5 落地页（页面显示"正在加载"，
     * 且带 `X-Frame-Options: SAMEORIGIN` ⇒ 既不能当图片、也不能用 iframe 嵌）。
     * 字段名的真实含义是「二维码图片的**内容**」——即自己用二维码库编码它。
     * 原先按 `imageUrl` 传给 UI 当 `<img src>` ⇒ **破图**。已改名 `qrContent`。
     *
     * 三个候选字段名的取舍保持不变（取到第一个非空的），但语义按"编码内容"处理。
     */
    const raw = res.value.qrcode_img_content ?? res.value.qrcode_img_url ?? res.value.qrcode_img ?? '';
    // 只认完整 http(s) 内容：拿不到就不画二维码 —— 不生成一张「内容是怪话」的假码骗用户。
    const qrContent = /^https?:\/\//i.test(raw) ? raw : undefined;
    record(`POST get_bot_qrcode → qrcode=${res.value.qrcode ?? ''}${qrContent ? ' （含二维码内容）' : ' （无二维码内容）'}`);
    return { type: 'qrFetched', qrcode: res.value.qrcode ?? '', qrContent };
  }

  /** 轮询扫码状态 → 事件 */
  async function pollStatusEvent(token: number): Promise<IlinkLoginEvent> {
    await sleep(ILINK_QR_POLL_INTERVAL_MS);
    if (token !== loginToken) return { type: 'abort' };
    const state = get().login;
    const s = ilinkSettings();
    const res = await getQrcodeStatus(
      { baseUrl: s.baseUrl || undefined },
      state.qrcode,
      state.verifyCode || undefined,
    );
    if (token !== loginToken) return { type: 'abort' };
    if (!res.ok) return { type: 'qrFetchFailed', failureKey: reportFailure('get_qrcode_status', res) };
    record(`GET get_qrcode_status → status=${res.value.status ?? '(空)'}`);
    return { type: 'status', response: res.value };
  }

  async function doNotifyStart(): Promise<void> {
    const s = ilinkSettings();
    if (!s.enabled || !s.botToken) return;
    const res = await notifyStartApi(contextOf(s));
    if (!res.ok) {
      record(`POST notifystart 失败：${res.error.code}`);
      log.warn('ilink', 'notifystart 失败', { code: res.error.code });
      return;
    }
    record('POST notifystart');
  }

  function startReceiverInternal(): void {
    receiver.start();
    set({
      receiving: receiver.isRunning(),
      receivingErrors: 0,
      connection: ilinkSettings().botToken ? 'connected' : 'idle',
    });
    record('收消息循环已启动（仅前台；页面隐藏时不打服务端）', true);
  }

  /**
   * 驱动循环：reducer 出状态与 effects，这里执行 effects。
   *
   * ★ 用显式的 `token` 参数（而不是读模块变量）是刻意的：
   *   `submitVerifyCode()` 会在**同一轮登录**里二次进入这个循环
   *   （`need_verifycode` 时循环已返回、等用户输入），两次必须共享同一个代号，
   *   否则一个 `abortLogin()` 只能停掉其中一个。
   *   `loginToken` 只在「开始新流程」与「放弃」时递增。
   */
  async function driveFrom(initial: IlinkLoginEvent, token: number): Promise<void> {
    let event: IlinkLoginEvent = initial;

    for (;;) {
      const transition = ilinkLoginReducer(get().login, event);
      const phase = transition.state.phase;
      set({
        login: transition.state,
        connection:
          phase === 'bound'
            ? 'connected'
            : phase === 'failed'
              ? 'error'
              : phase === 'idle'
                ? 'idle'
                : 'binding',
      });

      if (isLoginTerminal(transition.state)) return;
      if (token !== loginToken) return;

      let next: IlinkLoginEvent | null = null;
      for (const effect of transition.effects) {
        next = await runEffect(effect, token);
        if (token !== loginToken) return;
        if (next) break;
      }
      // 没有任何 effect 需要继续 → 本轮停在原地（例如等用户填配对码）
      if (!next) return;
      event = next;
    }
  }

  /** 开一次新的登录流程 */
  async function driveLogin(): Promise<void> {
    loginToken += 1;
    const token = loginToken;
    const s = ilinkSettings();
    await driveFrom(
      { type: 'start', baseUrl: s.baseUrl || undefined, hasLocalToken: s.botToken !== '' },
      token,
    );
  }

  /* ---------- 对外 API ---------- */

  return {
    login: createInitialLoginState(),
    connection: 'idle',
    receiving: false,
    receivingErrors: 0,
    logs: [],

    setInboundSessionId: (id) => {
      inboundSessionId = id;
    },
    setInboundHandler: (handler) => {
      inboundHandler = handler;
    },

    startLogin: async () => {
      await driveLogin();
    },

    submitVerifyCode: (code) => {
      // ★ 不在这里手动 dispatch 一次再让循环再 dispatch 一次（那会把事件应用两遍）。
      //   配对码是在 `need_verifycode` 停轮询之后由用户补上的，所以这里要**重新进入**
      //   驱动循环，并沿用本轮登录的代号。
      const token = loginToken;
      void driveFrom({ type: 'verifyCodeSubmitted', code }, token);
    },

    abortLogin: () => {
      loginToken += 1;
      set({ login: createInitialLoginState(), connection: ilinkSettings().botToken ? 'connected' : 'idle' });
      ilinkBufStore.clear();
    },

    ensureRunning: () => {
      const s = ilinkSettings();
      if (!s.enabled || !s.botToken) {
        set({ receiving: false, connection: 'idle' });
        return;
      }
      void doNotifyStart();
      startReceiverInternal();
    },

    stop: () => {
      receiver.stop();
      set({
        receiving: false,
        connection: ilinkSettings().botToken && ilinkSettings().enabled ? 'connected' : 'idle',
      });
      record('收消息循环已停止');
    },

    sendText: async (text, toUserId, contextToken) => {
      const s = ilinkSettings();
      const body = text.trim();
      if (!s.enabled || !s.botToken || body === '') return false;
      const to = (toUserId ?? s.userId).trim();
      if (to === '') {
        record('没有收件人 id，发不出去', true);
        return false;
      }
      const cached = contextToken || contextTokens.get(to);
      const msg: IlinkOutboundMessage = {
        from_user_id: '',
        to_user_id: to,
        client_id: `ai-ai-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
        message_type: ILINK_MESSAGE_TYPE.BOT,
        message_state: ILINK_MESSAGE_STATE.FINISH,
        item_list: [{ type: ILINK_ITEM_TYPE.TEXT, text_item: { text: body } }],
        ...(cached ? { context_token: cached } : {}),
      };
      const res = await sendMessage(contextOf(s), msg);
      if (!res.ok) {
        record(`POST sendmessage 失败：${res.error.code}`);
        return false;
      }
      if (hasIlinkError(res.value)) {
        record(`POST sendmessage 业务失败：errcode=${res.value.errcode ?? ''}`);
        return false;
      }
      record('POST sendmessage 成功');
      return true;
    },

    sendTestMessage: async () => {
      // ★ 测试消息的正文是**发到微信里的消息内容**，不是 UI 文案标签。
      //   所以它有自己的 key（`ilink.test.message`），不能复用按钮上的
      //   `ilink.action.test`（那个是「发一条测试消息」这个动作名，发出去很奇怪）。
      return get().sendText(t('ilink.test.message'));
    },

    unbind: () => {
      // 先停循环与登录，再清配置，最后清本机游标与内存令牌
      loginToken += 1;
      receiver.stop();
      patchIlink({ enabled: false, botId: '', botToken: '', userId: '', baseUrl: '' });
      ilinkBufStore.clear();
      contextTokens.clear();
      set({
        login: createInitialLoginState(),
        connection: 'idle',
        receiving: false,
        receivingErrors: 0,
      });
      record('已解绑：本机配置与同步游标已清空（服务端绑定关系未动）', true);
    },

    clearLogs: () => set({ logs: [] }),

    getContextToken: (from) => contextTokens.get(from),
  };
});

/* ============================================================
   供 UI 使用的稳定入口（避免设置页直接依赖 isAppError 等内部细节）
   ============================================================ */

/** 把任意异常转成用户可见的错误文案 key（设置页 catch 里用） */
export function ilinkErrorTextKey(error: unknown): CopyKey {
  return errorKeyOf(isAppError(error) ? error : new AppError('UNKNOWN', 'iLink 未知错误', error));
}

export default useIlinkStore;
