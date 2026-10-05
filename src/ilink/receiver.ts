import { SK } from '@/constants/storageKeys';
import { sleep } from '@/lib/sleep';
import { ILINK_ITEM_TYPE, ILINK_MESSAGE_TYPE, ILINK_SESSION_TIMEOUT_CODE } from './protocol';
import type { IlinkInboundMessage, IlinkUpdatesResponse } from './types';
import type { Result } from '@/types/common';

/**
 * ★ 微信 ClawBot —— 长轮询收消息循环。
 *
 * ────────────────────────────────────────────────────────────────
 * ★★ 本文件里最要紧的三件事，改之前先读：
 *
 *   1. **`get_updates_buf` 的回存时机**：拿到响应后、**解析 `msgs` 之前**立刻回存。
 *      它是服务端的增量游标，晚存一步就可能把「已投递但未处理」的消息当成已消费，
 *      表现是**静默丢消息**（不报错、日志正常）。见 `tick()` 内注释。
 *   2. **页面隐藏时不打服务端**：`document.hidden` 为真时只 `sleep` 空转，不发请求。
 *      这既是省电，也是因为移动端 WebView 进后台后这个长轮询本来就会被系统挂起。
 *   3. **退避**：连续失败 500ms → 1s → 2s … 封顶 30s；**一次成功即回落 500ms**
 *      （规格里对方只增不减，会把节奏永久拖慢；这里修掉了，属于有意偏离，已记录）。
 * ────────────────────────────────────────────────────────────────
 *
 * ★ 协议来源与许可证边界见 `protocol.ts` 文件头：只借鉴协议事实，代码全部重写。
 */

/** 退避起点 */
export const ILINK_BACKOFF_BASE_MS = 500;
/** 退避封顶 */
export const ILINK_BACKOFF_MAX_MS = 30_000;
/** 页面隐藏时的空转间隔 */
export const ILINK_HIDDEN_SLEEP_MS = 500;

/* ============================================================
   同步游标存储
   ============================================================ */

/**
 * `get_updates_buf` 的存储。
 *
 * ★ 必须与 `AppSettings` 分开：它每次成功轮询都会写一次，
 *   塞进 settings 会让每次回存都触发整个设置对象的序列化 + persist。
 *   这里用**单独一个 localStorage key**（`SK.ilinkBuf`）。
 */
export interface IlinkBufStore {
  read(): string;
  write(buf: string): void;
  clear(): void;
}

/** localStorage 不可用（隐私模式 / Node / SSR）时的内存兜底 */
let memoryBuf = '';

function safeGetItem(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* 配额 / 隐私模式：内存里已经有了，不抛 */
  }
}

function safeRemoveItem(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    /* 同上 */
  }
}

/** 默认实现：localStorage + 内存双写（读不到时回落内存） */
export const ilinkBufStore: IlinkBufStore = {
  read: () => safeGetItem(SK.ilinkBuf) ?? memoryBuf,
  write: (buf) => {
    memoryBuf = buf;
    safeSetItem(SK.ilinkBuf, buf);
  },
  clear: () => {
    memoryBuf = '';
    safeRemoveItem(SK.ilinkBuf);
  },
};

/* ============================================================
   运行配置 / 入站消息
   ============================================================ */

/** 循环每一轮读一次运行配置（由 store 提供），任一项不满足即退出循环 */
export interface IlinkRuntimeConfig {
  readonly enabled: boolean;
  readonly receive: boolean;
  readonly token: string;
  readonly baseUrl?: string;
  readonly userId?: string;
}

/**
 * 入站消息（**已过滤、已归类**）。
 *
 * 这就是留给上层的**注入缝**：`onInbound(inbound)` 由 `ilinkStore` 实现，
 * 负责「落库 → 调 LLM 生成 → 回发」。本文件不碰 LLM，也不碰 Dexie。
 *
 * ★ 为什么不直接把原始 `IlinkInboundMessage` 交给上层：
 *   原始结构的 `item_list` 是个需要按 `type` 分派、还要做优先级判定的联合，
 *   每个消费者都重写一遍这段分派 = 又一份第二真相。
 */
export type IlinkInbound =
  | {
      readonly kind: 'text';
      readonly from: string;
      readonly text: string;
      readonly contextToken?: string;
    }
  | { readonly kind: 'image'; readonly from: string; readonly contextToken?: string }
  | {
      readonly kind: 'voice';
      readonly from: string;
      /** 服务端给的转写文本；为空串表示没有转写 */
      readonly transcript: string;
      readonly contextToken?: string;
    }
  | { readonly kind: 'unsupported'; readonly from: string; readonly contextToken?: string };

/** 从原始消息里抽出可用的入站内容（纯函数，便于单测） */
export function extractInbound(msg: IlinkInboundMessage): IlinkInbound | null {
  const from = (msg.from_user_id ?? '').trim();
  if (from === '') return null;
  const contextToken = msg.context_token;
  const items = Array.isArray(msg.item_list) ? msg.item_list : [];

  // ★ 优先级：图 > 语音 > 文本（照规格）。一条消息里带多项时取第一个命中的高优先项。
  const image = items.find(
    (i) => i && i.type === ILINK_ITEM_TYPE.IMAGE && 'image_item' in i && i.image_item,
  );
  if (image) return { kind: 'image', from, contextToken };

  const voice = items.find(
    (i) => i && i.type === ILINK_ITEM_TYPE.VOICE && 'voice_item' in i && i.voice_item,
  );
  if (voice && 'voice_item' in voice && voice.voice_item) {
    return { kind: 'voice', from, transcript: voice.voice_item.text ?? '', contextToken };
  }

  const text = items.find(
    (i) => i && i.type === ILINK_ITEM_TYPE.TEXT && 'text_item' in i && i.text_item,
  );
  if (text && 'text_item' in text && text.text_item) {
    const value = text.text_item.text;
    if (typeof value === 'string' && value !== '') {
      return { kind: 'text', from, text: value, contextToken };
    }
  }
  return { kind: 'unsupported', from, contextToken };
}

/* ============================================================
   循环
   ============================================================ */

/** 客户端最小依赖面（只用到 `getUpdates`，便于单测注入假实现） */
export interface IlinkUpdatesClient {
  getUpdates(
    ctx: { baseUrl?: string; token?: string },
    getUpdatesBuf: string,
  ): Promise<Result<IlinkUpdatesResponse>>;
}

export interface IlinkReceiverOptions {
  /** 每轮读一次运行配置；返回 null 或任一门控为 false 即结束循环 */
  getRuntime(): IlinkRuntimeConfig | null;
  client: IlinkUpdatesClient;
  /** 同步游标存储 */
  buf?: IlinkBufStore;
  /** 入站消息回调（过滤后的）。异常会被本层吞掉并记日志，不打断循环 */
  onInbound(inbound: IlinkInbound): void | Promise<void>;
  /**
   * 服务端有消息、但设置里还没有 `userId` 时回调，用于补全绑定用户。
   * 只在「当前没有 userId」时调用。
   */
  onAdoptUserId?(userId: string): void;
  /** `context_token` 更新（**每条带 token 的消息都会覆盖**，不是一次性赋值） */
  onContextToken?(from: string, token: string): void;
  /** 页面是否隐藏；默认读 `document.hidden` */
  isHidden?(): boolean;
  /** 一轮结束（用于 UI 展示心跳）；`errors` 是**连续**失败次数，0 表示这一轮正常 */
  onTick?(info: { errors: number }): void;
  log?(level: 'info' | 'warn', message: string, detail?: unknown): void;
}

export interface IlinkReceiver {
  /** 幂等启动 */
  start(): void;
  /** 请求停止（下一轮边界生效） */
  stop(): void;
  isRunning(): boolean;
}

function defaultIsHidden(): boolean {
  try {
    return typeof document !== 'undefined' && document.hidden === true;
  } catch {
    return false;
  }
}

/**
 * 创建收消息循环。
 *
 * ★ 不返回 Promise：`start()` 是**同步**的，循环在后台跑；
 *   停止靠 `stop()`。这样调用方（store / 设置页）不需要 await 一个永不结束的循环。
 *   ★ 用 `generation` 计数防止「stop 后立刻 start」时旧的循环体还活着继续跑
 *     （只用一个 boolean 的话，旧循环醒来会看到 running 又变 true，于是两个循环并存）。
 */
export function createIlinkReceiver(opts: IlinkReceiverOptions): IlinkReceiver {
  const buf = opts.buf ?? ilinkBufStore;
  const hidden = opts.isHidden ?? defaultIsHidden;

  let running = false;
  let generation = 0;

  function logWarn(message: string, detail?: unknown): void {
    opts.log?.('warn', message, detail);
  }

  /** 处理一条原始消息；返回是否消费掉 */
  async function handleMessage(msg: IlinkInboundMessage, rt: IlinkRuntimeConfig): Promise<void> {
    // 1) 跳过自己（BOT）发的回显
    if (msg.message_type === ILINK_MESSAGE_TYPE.BOT) return;

    // 2) 无来源，无法归属，丢弃
    const from = (msg.from_user_id ?? '').trim();
    if (from === '') return;

    // 3) context_token：每条都覆盖缓存（它是随消息滚动的，不是一次性值）
    if (msg.context_token) opts.onContextToken?.(from, msg.context_token);

    // 4) 首次收到消息时补全绑定用户（绑定响应没给 userId 的情况）
    if (!rt.userId) opts.onAdoptUserId?.(from);

    // 5) ★ 只处理绑定的那个人的消息。没设 userId 时视为「都收」（并在上一步被采纳）
    if (rt.userId && String(rt.userId) !== String(from)) return;

    // 6) 归类后交给上层（落库 + 生成回发的注入缝）
    const inbound = extractInbound(msg);
    if (!inbound) return;
    await opts.onInbound(inbound);
  }

  /** 跑一轮；返回**连续**失败次数 */
  async function tick(rt: IlinkRuntimeConfig, prevErrors: number): Promise<number> {
    const res = await opts.client.getUpdates(
      { baseUrl: rt.baseUrl, token: rt.token },
      buf.read(),
    );

    if (!res.ok) {
      logWarn('getupdates 失败', { code: res.error.code, message: res.error.message });
      return prevErrors + 1;
    }

    const data = res.value;

    // ★★ 回存游标：**必须在解析 msgs 之前**。
    //    理由：`get_updates_buf` 是服务端的「你已经消费到哪」游标。若先处理消息、
    //    处理过程中抛错/页面被杀，游标没回存 ⇒ 下轮会**重复投递**同一批（可接受）；
    //    反过来先存后处理虽然可能丢，但服务端语义上就是「存了即已消费」——
    //    所以顺序必须与服务端约定一致：拿到就存，然后立刻处理。
    //    改动这一段前请先想清楚「重复投递」与「静默丢消息」哪个代价更大。
    if (typeof data.get_updates_buf === 'string' && data.get_updates_buf !== '') {
      buf.write(data.get_updates_buf);
    }

    // 会话过期：清游标重新同步；★ **不重绑、不清 token**（照规格）
    if (data.errcode === ILINK_SESSION_TIMEOUT_CODE || data.ret === ILINK_SESSION_TIMEOUT_CODE) {
      buf.clear();
      opts.log?.('info', 'iLink 会话过期(-14)，已重置同步游标（不重新绑定）');
      return 0;
    }

    const list = Array.isArray(data.msgs) ? data.msgs : [];
    for (const msg of list) {
      try {
        await handleMessage(msg, rt);
      } catch (e) {
        // 单条消息处理失败不能拖垮整条循环（上层 onInbound 里可能有 LLM / DB 调用）
        logWarn('入站消息处理失败', e);
      }
    }
    return 0;
  }

  async function loop(): Promise<void> {
    const myGeneration = ++generation;
    let backoff = ILINK_BACKOFF_BASE_MS;
    let errors = 0;

    while (running && generation === myGeneration) {
      const rt = opts.getRuntime();
      if (!rt || !rt.enabled || !rt.receive || !rt.token) break;

      // 页面隐藏：空转，不打服务端
      if (hidden()) {
        await sleep(ILINK_HIDDEN_SLEEP_MS);
        continue;
      }

      try {
        errors = await tick(rt, errors);
      } catch (e) {
        errors += 1;
        logWarn('收消息循环异常', e);
      }
      opts.onTick?.({ errors });

      if (backoff > 0) await sleep(backoff);
      // 连续失败时翻倍封顶；**一次成功即回落**（见文件头第 3 条）
      backoff = errors > 0 ? Math.min(ILINK_BACKOFF_MAX_MS, backoff * 2) : ILINK_BACKOFF_BASE_MS;
      if (backoff < ILINK_BACKOFF_BASE_MS) backoff = ILINK_BACKOFF_BASE_MS;
    }

    if (generation === myGeneration) running = false;
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      void loop();
    },
    stop(): void {
      running = false;
      // 递增代号：让正在 await 的那一轮醒来后立刻退出
      generation += 1;
    },
    isRunning: () => running,
  };
}
