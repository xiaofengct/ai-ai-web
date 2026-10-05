import {
  createJiwen,
  type JiwenDelta,
  type JiwenEngine,
  type JiwenLastMessage,
  type JiwenState,
  type JiwenTrigger,
  type JiwenUserStatus,
} from '@clarashafiq/jiwen';
import { blobRepo } from '@/db/repo/blobRepo';
import { messageRepo } from '@/db/repo/messageRepo';
import { sessionRepo } from '@/db/repo/sessionRepo';
import { useUiStore } from '@/store/uiStore';
import { log } from '@/store/logStore';
import type { Message } from '@/types/chat';
import type { UUID } from '@/types/common';
import { diffMinutes } from '@/lib/time';
import {
  XINRAN_EVENT_DELTA,
  XINRAN_IMMERSION_MAP,
  XINRAN_INITIAL_STATE,
  XINRAN_PERSONA,
  XINRAN_RATES,
  XINRAN_THRESHOLDS,
  xinranConnectionRateFn,
} from './xinranRates';
import { getXinranToneGrid } from './xinranTone';

/**
 * ★ jiwen（积温）接入桥（`docs/04-开源复用评估.md` §2.4）。
 *
 * 职责划分（**动机与内容分离**）：
 * - **jiwen** 决定「她想不想开口、用什么语气」——这里是唯一入口；
 * - **记忆库 / LLM** 决定「说什么」——由调度器把 `getPromptContext()` 交给上游；
 * - **scheduler.ts** 决定「浏览器什么时候允许 tick」——不管动机。
 *
 * 本文件只做三件事：
 *   1. 把 jiwen 的 `onSave` / `onLoad` 接到 Dexie（blobs 表，逻辑路径唯一）；
 *   2. 把 `getLastMessage` 接到消息 repo（引擎要求同步回调 → 用缓存，异步刷新）；
 *   3. 补一个 `getTriggerTrace()`（jiwen 0.4.0 未内置，见下）。
 */

/** 状态落库的逻辑路径（与 blobRepo 的路径约定一致） */
export const JIWEN_STATE_PATH = 'proactive/jiwen-state.json';

/** jiwen 的 `tick()` 内部把 minutes 截断到 60，补偿时必须自己分片 */
const MAX_TICK_CHUNK_MIN = 60;
/** 一次补偿最多推进多少分钟（防止关闭三天的标签页回来后卡死主线程） */
const MAX_CATCHUP_MIN = 24 * 60;

/* ============================================================
   1. 持久化：Dexie（blobs 表）
   ============================================================ */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function isPlainState(value: unknown): value is JiwenState {
  return typeof value === 'object' && value !== null && typeof (value as JiwenState).connection === 'number';
}

/**
 * 读 JSON 状态。
 * ★ 读不到时**返回播种状态**而不是 null：
 *   jiwen 的 DEFAULT_STATE 会把 pride/valence/arousal 初始化成轴下限 -1（见 `XINRAN_INITIAL_STATE` 注释），
 *   返回 null 会让她开局先「自我调节」一百多分钟。这里必须给一份正常的初始状态。
 */
async function loadJiwenState(): Promise<JiwenState> {
  const res = await blobRepo.getByPath(JIWEN_STATE_PATH);
  if (!res.ok || !res.value) return { ...XINRAN_INITIAL_STATE };
  const data = res.value.data;
  try {
    const text = data instanceof Uint8Array ? decoder.decode(data) : await (data as Blob).text();
    const parsed: unknown = JSON.parse(text);
    return isPlainState(parsed) ? { ...XINRAN_INITIAL_STATE, ...parsed } : { ...XINRAN_INITIAL_STATE };
  } catch (e) {
    log.warn('proactive', '积温状态解析失败，回退到初始状态', { error: String(e) }, 'FN-06');
    return { ...XINRAN_INITIAL_STATE };
  }
}

/** 写 JSON 状态（写失败只告警，不影响本次 tick） */
async function saveJiwenState(state: JiwenState): Promise<void> {
  const bytes = encoder.encode(JSON.stringify(state));
  const res = await blobRepo.put(JIWEN_STATE_PATH, bytes, 'application/json');
  if (!res.ok) {
    log.warn('proactive', '积温状态写入失败', { error: res.error.message }, 'FN-06');
  }
}

/* ============================================================
   2. 消息源：getLastMessage 必须是同步的，用缓存 + 异步刷新
   ============================================================ */

function toLastMessage(msg: Message | undefined): JiwenLastMessage | null {
  if (!msg) return null;
  return { id: msg.id, content: msg.content, timestamp: msg.createdAt };
}

/* ============================================================
   3. getTriggerTrace：jiwen 0.4.0 没有内置，这里补齐
   ============================================================ */

export type TriggerBlockedBy = 'connection' | 'pride' | 'immersion' | 'valence' | 'arousal' | 'none';

export interface TriggerTrace {
  /** 本次最终的行为（none = 什么都没发生） */
  action: JiwenTrigger['action'] | 'none';
  reason?: string;
  /** 被哪根轴挡住了（'none' = 没被挡） */
  blockedBy: TriggerBlockedBy;
  /** 距离「考虑开口」还差多少 connection（已越过时为 0） */
  gapToConsider: number;
  /** 距离「强制开口」还差多少（已越过时为 0） */
  gapToForce: number;
  /** 人话解释：为什么她没开口 / 她现在到哪一步了 */
  explanation: string;
}

/**
 * 由状态 + 阈值反推「为什么没开口」。
 * 与 `jiwen.checkThresholds()` 的判断顺序保持一致（见 jiwen.js），
 * 这样 trace 与真实触发结果永远一致。
 */
export function buildTriggerTrace(state: JiwenState, thresholds = XINRAN_THRESHOLDS): TriggerTrace {
  const { connection: c, pride: p, valence: v, arousal: a, immersion: i } = state;
  const gapToConsider = Math.max(0, thresholds.considerContact - c);
  const gapToForce = Math.max(0, thresholds.forceContact - c);

  if (v <= thresholds.valenceActivity) {
    return {
      action: 'find_activity',
      reason: 'low_valence',
      blockedBy: 'valence',
      gapToConsider,
      gapToForce,
      explanation: `心情掉到 ${v.toFixed(2)}（阈值 ${thresholds.valenceActivity}），她先自己消化，不会在这时候硬开口。`,
    };
  }
  if (a >= thresholds.arousalAgitation) {
    return {
      action: 'find_activity',
      reason: 'high_arousal',
      blockedBy: 'arousal',
      gapToConsider,
      gapToForce,
      explanation: `焦躁到了 ${a.toFixed(2)}（阈值 ${thresholds.arousalAgitation}），先找点事做把躁劲儿泄掉，不在这时候开口。`,
    };
  }
  if (c >= thresholds.forceContact) {
    return {
      action: 'contact',
      reason: 'force_contact',
      blockedBy: 'none',
      gapToConsider,
      gapToForce,
      explanation: `想念到 ${c.toFixed(2)}，越过了强制开口线 ${thresholds.forceContact}，不管多端着都会开口。`,
    };
  }
  if (c >= thresholds.considerContact) {
    if (p >= thresholds.prideBlock) {
      if (i >= 0.2) {
        return {
          action: 'none',
          blockedBy: 'immersion',
          gapToConsider,
          gapToForce,
          explanation: `想念 ${c.toFixed(2)} 已过考虑线，骄傲 ${p.toFixed(2)} 也过了阻断线，但沉浸度 ${i.toFixed(2)} ≥ 0.2 —— 她正忙着（沉浸也是面子的缓冲垫），所以既没开口也没去找事做。`,
        };
      }
      return {
        action: 'find_activity',
        reason: 'pride_block',
        blockedBy: 'pride',
        gapToConsider,
        gapToForce,
        explanation: `想念 ${c.toFixed(2)} 已过考虑线，但骄傲 ${p.toFixed(2)} ≥ ${thresholds.prideBlock} —— 想说又端着，转成「找事做」。`,
      };
    }
    return {
      action: 'contact',
      blockedBy: 'none',
      gapToConsider,
      gapToForce,
      explanation: `想念 ${c.toFixed(2)} 过了考虑线 ${thresholds.considerContact}，骄傲 ${p.toFixed(2)} 没到阻断线 —— 她会开口。`,
    };
  }
  if (c >= thresholds.observation) {
    return {
      action: 'observation',
      blockedBy: 'connection',
      gapToConsider,
      gapToForce,
      explanation: `想念 ${c.toFixed(2)}：她已经注意到你不在了，但还没到想开口的程度（还差 ${gapToConsider.toFixed(2)}）。`,
    };
  }
  return {
    action: 'none',
    blockedBy: 'connection',
    gapToConsider,
    gapToForce,
    explanation: `想念只有 ${c.toFixed(2)}，还没到留意线 ${thresholds.observation}（差 ${gapToConsider.toFixed(2)}），她现在没什么挂念。`,
  };
}

/* ============================================================
   4. Bridge：包一层，补齐浏览器侧需要的同步/异步语义
   ============================================================ */

export interface XinranEngine {
  /** 原始 jiwen 实例（一般不需要直接用） */
  readonly raw: JiwenEngine;
  /** 绑定会话（用于取最后一条消息）；不传则用「最近活跃的会话」 */
  setSessionId(sessionId?: UUID): void;
  /** 异步刷新「最后一条消息」缓存 */
  refreshLastMessage(): Promise<void>;
  /**
   * 推进 `minutes` 分钟。
   * ★ 引擎内部把 minutes 截断到 60，这里自动分片，
   *   并返回**最后一次**的触发结果（中间分片的触发会被合并进最终状态）。
   */
  tickMinutes(minutes: number): Promise<JiwenTrigger[]>;
  applyDelta(delta: JiwenDelta): Promise<void>;
  getState(): Promise<JiwenState>;
  /** 主动开口时用：她此刻的状态 + 该怎么说（proactive 模式） */
  getPromptContext(): Promise<string>;
  /** 回复对方时用（reactive 模式） */
  getStyleGuidance(): Promise<string>;
  /** 组装后的完整语气段（含称呼关系约束） */
  getStyleBlock(mode: 'proactive' | 'reactive'): Promise<string>;
  resetConnection(): Promise<void>;
  setActivity(type: string, label?: string): Promise<void>;
  setUserStatus(status: JiwenUserStatus): Promise<void>;
  getTriggerTrace(): Promise<TriggerTrace>;
  getStateSummary(): Promise<string>;
  /* —— 语义化事件：业务层只调这些，不要直接 applyDelta —— */
  /** 对方发来消息（还没回复） */
  noteUserMessage(message: Message): Promise<void>;
  /** 她主动开口成功发出：只部分缓解想念（开口 ≠ 被回复） */
  noteProactiveSent(): Promise<void>;
  /** 对方回复了她：想念归零 */
  noteUserReplied(): Promise<void>;
  /** 对方说了亲近的话 */
  noteUserAffection(): Promise<void>;
  /** 对方明显冷淡 */
  noteUserCold(): Promise<void>;
}

export interface XinranEngineOptions {
  /** 绑定会话；不传时自动取最近活跃会话 */
  sessionId?: UUID;
  /** 打开引擎内部日志（默认只在阈值触发时打） */
  verbose?: boolean;
  /** 自定义日志出口（默认走 logStore） */
  onLog?: (msg: string) => void;
}

/** 创建欣然引擎实例 */
export function createXinranJiwen(options: XinranEngineOptions = {}): XinranEngine {
  let sessionId: UUID | undefined = options.sessionId;
  let cachedLast: JiwenLastMessage | null = null;

  const grid = getXinranToneGrid();

  const engine = createJiwen({
    rates: XINRAN_RATES,
    thresholds: XINRAN_THRESHOLDS,
    immersionMap: { ...XINRAN_IMMERSION_MAP },
    persona: { ...XINRAN_PERSONA },
    connectionRateFn: xinranConnectionRateFn,
    getLastMessage: () => cachedLast,
    // ★ 注入欣然的语调网格：数值 → 人话，全部由 tone-grid 查表
    getPromptContext: (state) => grid.getPromptContext(state),
    getStyleGuidance: (state) => grid.getStyleGuidance(state),
    onSave: (state) => saveJiwenState(state),
    onLoad: () => loadJiwenState(),
    verbose: options.verbose ?? false,
    onLog: options.onLog ?? ((msg: string) => log.debug('proactive', msg, undefined, 'FN-06')),
  });

  /** 解析要监听的会话：优先显式绑定，其次 UI 当前会话，最后取最近活跃会话 */
  async function resolveSessionId(): Promise<UUID | undefined> {
    if (sessionId) return sessionId;
    const current = useUiStore.getState().currentSessionId;
    if (current) return current;
    const res = await sessionRepo.listRecent({ limit: 1 });
    return res.ok ? res.value[0]?.id : undefined;
  }

  async function refreshLastMessage(): Promise<void> {
    const sid = await resolveSessionId();
    if (!sid) {
      cachedLast = null;
      return;
    }
    const res = await messageRepo.latest(sid, 1);
    if (!res.ok) return;
    cachedLast = toLastMessage(res.value[res.value.length - 1]);
  }

  async function ensureState(): Promise<JiwenState> {
    // getState() 内部会 ensureLoaded()，先调一次保证后续同步取值有效
    return engine.getState();
  }

  const api: XinranEngine = {
    raw: engine,

    setSessionId: (id) => {
      sessionId = id;
    },

    refreshLastMessage,

    tickMinutes: async (minutes) => {
      if (!Number.isFinite(minutes) || minutes <= 0) return [];
      await refreshLastMessage();
      await ensureState();

      const total = Math.min(minutes, MAX_CATCHUP_MIN);
      let remaining = total;
      let triggers: JiwenTrigger[] = [];
      while (remaining > 0) {
        const chunk = Math.min(MAX_TICK_CHUNK_MIN, remaining);
        // eslint-disable-next-line no-await-in-loop
        const got = await engine.tick(chunk);
        if (got.length > 0) triggers = got;
        remaining -= chunk;
      }
      return triggers;
    },

    applyDelta: (delta) => engine.applyDelta(delta),

    getState: () => engine.getState(),

    getPromptContext: async () => {
      await ensureState();
      return engine.getPromptContext();
    },

    getStyleGuidance: async () => {
      await ensureState();
      return engine.getStyleGuidance();
    },

    getStyleBlock: async (mode) => {
      const state = await ensureState();
      const grid2 = getXinranToneGrid();
      const body = grid2.getUnifiedGuidance(state, mode);
      if (!body) return '';
      const head = mode === 'proactive' ? '【此刻的状态】' : '【说话风格】';
      return `${head}\n${body}`;
    },

    resetConnection: () => engine.resetConnection(),

    setActivity: (type, label) => engine.setActivity(type, label ?? type),

    setUserStatus: (status) => engine.setUserStatus(status),

    getTriggerTrace: async () => buildTriggerTrace(await ensureState()),

    getStateSummary: async () => {
      await ensureState();
      return engine.getStateSummary();
    },

    noteUserMessage: async (message) => {
      cachedLast = toLastMessage(message);
      await engine.setLastChatMessageId(message.id);
      // 收到你的消息，她的躁动先落一半；想念归零要等她真的回复完（由上层调 noteUserReplied）
      await engine.applyDelta({ arousal: -0.05, valence: +0.03 });
    },

    noteProactiveSent: async () => {
      await engine.applyDelta({ ...XINRAN_EVENT_DELTA.proactiveSent });
    },

    noteUserReplied: async () => {
      await engine.applyDelta({ ...XINRAN_EVENT_DELTA.userReplied });
      await engine.resetConnection();
    },

    noteUserAffection: async () => {
      await engine.applyDelta({ ...XINRAN_EVENT_DELTA.userAffection });
      await engine.resetConnection();
    },

    noteUserCold: async () => {
      await engine.applyDelta({ ...XINRAN_EVENT_DELTA.userCold });
    },
  };

  return api;
}

/* ============================================================
   5. 进程内单例（调度器与页面共用同一个引擎，避免两份状态互相覆盖）
   ============================================================ */

let singleton: XinranEngine | undefined;

/** 取全局引擎（首次调用会创建并异步刷新消息缓存） */
export function getXinranEngine(options?: XinranEngineOptions): XinranEngine {
  if (!singleton) {
    singleton = createXinranJiwen(options);
    void singleton.refreshLastMessage().catch(() => undefined);
  } else if (options?.sessionId) {
    singleton.setSessionId(options.sessionId);
  }
  return singleton;
}

/** 丢弃单例（切换角色 / 清空数据时用；状态本身在 Dexie 里，不丢） */
export function resetXinranEngine(): void {
  singleton = undefined;
}

/**
 * 距离上一条「用户消息」过去了多少分钟。
 * 用于调度器判断「该不该 tick」以及给 jiwen 报 userStatus。
 */
export function minutesSinceLastUserMessage(last: Message | undefined): number {
  if (!last) return Number.POSITIVE_INFINITY;
  return diffMinutes(last.createdAt);
}

export default getXinranEngine;
