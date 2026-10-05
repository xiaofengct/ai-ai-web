import { Emitter, appEmitter, createBroadcast, type Broadcast } from '@/lib/emitter';
import { TICK_HIDDEN_MS, TICK_VISIBLE_MS } from '@/constants/limits';
import { useProactiveStore } from '@/store/proactiveStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { log } from '@/store/logStore';
import type { HeartbeatInMessage, HeartbeatOutMessage } from '@/workers/heartbeat.worker';
import type { JiwenState, JiwenTrigger } from '@clarashafiq/jiwen';
import type { UUID } from '@/types/common';
import { getXinranEngine, type TriggerTrace } from './jiwenBridge';
import { computeDynamicFactor, evaluateProactiveGate, recordResponseGap } from './dynamic';
import { deriveUserStatus, readIdleSnapshot } from './idle';
import { deliverProactiveMessage, flushPendingResume, markPendingResume } from './notify';
import { markSessionProactiveSent, minutesSinceSessionProactive } from './inherit';
import { pickActivity } from './xinranRates';
import { activeWorldPack } from '@/world/activeWorld';
import { activeWorldCard } from '@/world/activeWorld';
import { describeShift } from '@/world/schedule';
import { momentRepo } from '@/db/repo/momentRepo';
import { MOMENT_BLOCK_TEXT, evaluateMomentGate, summarizeRecentMoments } from './momentGate';

/**
 * ★★ 主动消息调度器 —— **纯浏览器环境适配层**（`docs/04-开源复用评估.md` §2.4）。
 *
 * ★★ 它只管三件事，一行都不判断「她想不想开口」：
 *   1. `visibilitychange`：页面隐藏 → 停掉主线程定时器；恢复 → 一次性补偿 tick；
 *   2. 隐藏期间累积的分钟数，在恢复时（或 Worker 心跳唤醒时）**一次性 tick 补偿**；
 *   3. `BroadcastChannel` + `navigator.locks` 保证**跨标签页只有一个写者**（决策 A9）。
 *
 * 「想不想开口、什么语气」全部来自 jiwen（`jiwenBridge.ts`）；
 * 「说什么」由订阅 `proactive:trigger` 的上游（聊天页 / 记忆库 + LLM）决定。
 * 本文件只回答：**浏览器现在允许不允许推进状态、以及该推进多少分钟。**
 */

/* ============================================================
   事件契约（上游订阅这里，不要自己去调 jiwen）
   ============================================================ */

export interface ProactiveTriggerPayload {
  action: JiwenTrigger['action'];
  reason?: string;
  /** 0~1 的急迫度（jiwen 给） */
  urgency: number;
  /** 是否撞到强制开口线 */
  forced: boolean;
  /** 本次推进了多少分钟 */
  minutes: number;
  /** 五轴状态快照 */
  state: JiwenState;
  /** 「为什么是这个行为 / 还差多少」的人话解释 */
  trace: TriggerTrace;
  /** 她此刻的状态描述（proactive 模式，注入提示词用） */
  promptContext: string;
  /** 说话风格指引 */
  styleGuidance: string;
  sessionId?: UUID;
}

export interface ProactiveEvents extends Record<string, unknown> {
  /** jiwen 判定「她想开口」且环境闸门放行 */
  'proactive:trigger': ProactiveTriggerPayload;
  /** 每次推进状态后发出（含被闸门拦下的时候） */
  'proactive:tick': { minutes: number; visible: boolean; blockedReason: string };
  /** 她想开口，但被环境闸门拦下（写日志 / 开发者页用，不静默丢弃） */
  'proactive:blocked': { reason: string; trace: TriggerTrace; wantedAction: JiwenTrigger['action'] };
  /**
   * ★★ 该发一条动态了（2026-10-04 加）。
   *
   * ★ 为什么走**事件**而不是在这里直接生成：
   *   调度器在**定时器回调**里跑，属于"环境"层；而生成要调 LLM + 落库，
   *   属于"内容"层。既有约定是内容层由 `useLiveSession` 订阅事件完成
   *   （`proactive:trigger` 就是这么做的）—— 沿用它，而不是在调度器里开个口子。
   *   好处：调度器保持"零业务依赖"（可单测）、生成失败不会拖垮 tick。
   *
   * ★ 事件里**不带正文**（要现生成），只带"该发了"这个事实 + 情境信息。
   */
  'proactive:moment': {
    /** 世界情境（今天是白班/夜班…），供提示词用；无世界设定时为 undefined */
    situation?: string;
    /** 今天的第几条（用于日志与"别重复"的程度判断） */
    index: number;
  };
  /** 动态被闸门拦下（写日志 / 开发者页用，**不静默丢弃**） */
  'proactive:momentBlocked': { reason: string };
}

export const proactiveEvents = new Emitter<ProactiveEvents>();

/* ============================================================
   跨标签页单写者（决策 A9）
   ============================================================ */

const WRITER_LOCK_NAME = 'ai-ai-proactive-writer';
const WRITER_CHANNEL = 'ai-ai.proactive.writer.v1';
/** 写者心跳间隔 */
const WRITER_PING_MS = 5_000;
/** 读者多久没收到心跳就重新竞选 */
const WRITER_PING_TIMEOUT_MS = 15_000;
/** 无 navigator.locks 时的竞选等待窗口 */
const ELECTION_WINDOW_MS = 800;

type WriterMessage =
  | { type: 'claim'; id: string }
  | { type: 'ping'; id: string; at: number }
  | { type: 'release'; id: string };

interface LockManagerLike {
  request(
    name: string,
    options: { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<unknown> | unknown,
  ): Promise<unknown>;
}

function getLockManager(): LockManagerLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { locks?: LockManagerLike }).locks;
}

/* ============================================================
   运行时状态
   ============================================================ */

export interface SchedulerState {
  running: boolean;
  /** 本标签页是否是唯一写者 */
  writer: boolean;
  visible: boolean;
  /** 上次推进状态的墙上时间（毫秒） */
  lastTickAt: number;
  /** 隐藏期间累计待补偿的分钟数 */
  pendingHiddenMinutes: number;
  /** Worker 心跳是否可用 */
  heartbeat: boolean;
  /** 本标签页 id（竞选用） */
  tabId: string;
}

const TAB_ID = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const runtime: SchedulerState & {
  timer?: number;
  worker?: Worker;
  channel?: Broadcast<WriterMessage>;
  releaseLock?: () => void;
  pingTimer?: number;
  readerTimer?: number;
  disposeVisibility?: () => void;
  lastWriterPingAt: number;
  startedAt: number;
  /**
   * 启动代数：每次 `startProactiveScheduler()` 自增。
   * 用于作废「在竞选 await 期间被 stop 掉」的旧竞选结果——
   * 否则 dev 下 StrictMode 双挂载会出现「已停止的标签页仍持有 writer 心跳」。
   */
  generation: number;
} = {
  running: false,
  writer: false,
  visible: typeof document === 'undefined' ? true : !document.hidden,
  lastTickAt: Date.now(),
  pendingHiddenMinutes: 0,
  heartbeat: false,
  tabId: TAB_ID,
  lastWriterPingAt: 0,
  startedAt: 0,
  generation: 0,
};

export function getSchedulerState(): SchedulerState {
  return {
    running: runtime.running,
    writer: runtime.writer,
    visible: runtime.visible,
    lastTickAt: runtime.lastTickAt,
    pendingHiddenMinutes: runtime.pendingHiddenMinutes,
    heartbeat: runtime.heartbeat,
    tabId: runtime.tabId,
  };
}

/* ============================================================
   核心：推进状态
   ============================================================ */

/** 结算「从上次 tick 到现在过去了多少分钟」，并把 lastTickAt 推到当下 */
function consumeElapsedMinutes(): number {
  const now = Date.now();
  const minutes = Math.max(0, (now - runtime.lastTickAt) / 60_000);
  runtime.lastTickAt = now;
  useProactiveStore.getState().tick();
  return minutes;
}

/**
 * 推进一次状态。
 * ★ 顺序：**jiwen 先算动机 → 环境闸门再决定放不放行**（两者是与关系）。
 */
async function runTick(minutes: number, source: 'visible' | 'hidden' | 'resume'): Promise<void> {
  if (minutes <= 0) return;

  const store = useProactiveStore.getState();
  const settings = useSettingsStore.getState();
  const chat = settings.settings.chat;
  const sessionId = useUiStore.getState().currentSessionId;

  const engine = getXinranEngine({ sessionId });

  // ① 把「对方是在忙还是睡了」告诉引擎（影响想念累积速率）
  const idle = readIdleSnapshot(chat.proactive.idleTimeoutMin);
  await engine.setUserStatus(deriveUserStatus(idle.minutesSinceActive));

  // ② jiwen 推进五轴 —— 唯一决定「她想不想开口」的地方
  const triggers = await engine.tickMinutes(minutes);
  const state = await engine.getState();
  const trace = await engine.getTriggerTrace();

  // ③ 环境闸门：间隔 / 停用超时 / 全天候 / 动态系数（FN-06/08/09/10/14）
  //    ★ 2026-10-04 起把**当前角色的世界设定**也传进去 ⇒ 多出三关：
  //      深夜静默 → 按班次的活跃时段 → 概率门（见 dynamic.ts 的 ProactiveGateInput.world）。
  //      没有世界设定的角色（不内置版未导入时）`activeWorldPack()` 返回 undefined，
  //      三关整段跳过，行为与改动前完全一致。
  const sinceProactive = sessionId ? await minutesSinceSessionProactive(sessionId) : undefined;
  const gate = evaluateProactiveGate({
    chat,
    minutesSinceLastProactive: sinceProactive,
    idleStopped: idle.idle,
    visible: runtime.visible,
    world: activeWorldPack(),
  });
  store.setDynamicFactor(gate.dynamicFactor);

  let blockedReason = gate.reason;

  const contact = triggers.find((t) => t.action === 'contact');
  const activity = triggers.find((t) => t.action === 'find_activity');

  if (activity) {
    /**
     * 她决定「先找点事做」。
     * jiwen 只给结论，做什么由人格决定（`pickActivity`）；
     * 设置沉浸度后 connection 会被 `activityConnectionRelief` 部分缓解——
     * 找事做是缓冲，不是替代品（jiwen README 原话）。
     */
    const picked = pickActivity(activity.reason);
    await engine.setActivity(picked.type, picked.label);
    log.debug('proactive', `积温触发自我调节：${activity.reason ?? 'unknown'} → ${picked.label}`, trace, 'FN-14');
  }

  if (contact) {
    if (gate.allowed) {
      const promptContext = await engine.getPromptContext();
      const styleGuidance = await engine.getStyleGuidance();
      // 开口 ≠ 被回复：只部分缓解想念（jiwen README 明确要求）
      await engine.noteProactiveSent();
      store.markProactive();
      if (sessionId) await markSessionProactiveSent(sessionId);
      if (!runtime.visible) markPendingResume();

      blockedReason = 'none';
      proactiveEvents.emit('proactive:trigger', {
        action: 'contact',
        reason: contact.reason,
        urgency: contact.urgency ?? (trace.gapToForce === 0 ? 1 : 0.5),
        forced: contact.forced === true,
        minutes,
        state,
        trace,
        promptContext,
        styleGuidance,
        sessionId,
      });
      log.info(
        'proactive',
        `欣然想开口了（${source}，推进 ${minutes.toFixed(1)} 分钟）`,
        { connection: state.connection, pride: state.pride, blockedBy: trace.blockedBy },
        'FN-06',
      );
    } else {
      proactiveEvents.emit('proactive:blocked', {
        reason: gate.reason,
        trace,
        wantedAction: 'contact',
      });
      log.debug('proactive', `她想开口，但被环境闸门拦下：${gate.reason}`, trace, 'FN-06');
    }
  }

  // ④ ★★ 动态发布检查（2026-10-04 加）
  //    ★ 放在**所有聊天相关判断之后、tick 事件之前**：
  //      发不发动态与"她想不想对你说话"是**两条独立的路**
  //      （她可能不想跟你说话，但想发条动态；反之亦然）。
  //      所以它**不看** `triggers`/`gate` 的结果，只看自己的那套闸门。
  await maybePublishMoment();

  proactiveEvents.emit('proactive:tick', { minutes, visible: runtime.visible, blockedReason });
}

/**
 * ★★ 检查"该不该发动态"，该发就发事件（2026-10-04 加）。
 *
 * ★ 为什么单独一个函数而不是塞进 `runTick` 主体：
 *   两者共用"每分钟被调用一次"这个时机，但**判定逻辑完全没有交集** ——
 *   混在一起会让人以为发动态也要先满足"她想开口"（那是个错误的耦合）。
 *   抽出来之后，`runTick` 里那一行读作"顺便也看看动态"，
 *   而不是"在主动消息逻辑里夹了一段动态判断"。
 *
 * ★ 这里的 try/catch 是**必须的**：动态检查失败（读库出错、时间算错）
 *   绝不能影响主动消息那条已经成熟的路。降级为"这次不发动态"。
 */
async function maybePublishMoment(): Promise<void> {
  try {
    const chat = useSettingsStore.getState().settings.chat;
    if (!chat.moments?.enabled) return; // ★ 早退：没开就不该有任何开销

    const card = activeWorldCard();
    // 读最近动态：既用于"今天发了几条"，也用于"别重复"。
    // ★ 只取 20 条：够算出今日计数与前一条时间，不必全量（动态可能累积很多）。
    const recentRes = await momentRepo.listRecent(20);
    if (!recentRes.ok) return;
    const recent = recentRes.value;

    const { todayCount, minutesSinceLast } = summarizeRecentMoments(recent);
    const gate = evaluateMomentGate({
      chat,
      ...(card?.id ? { personaId: card.id } : {}),
      ...(minutesSinceLast !== undefined ? { minutesSinceLast } : {}),
      todayCount,
      world: activeWorldPack(),
    });

    if (!gate.allowed) {
      proactiveEvents.emit('proactive:momentBlocked', { reason: gate.reason });
      // ★ `tooSoon` / `disabled` 这类高频原因为 **debug** 级 ——
      //   每个 tick 都写一条 info 会把日志淹掉，真正要看的事件反而找不到。
      log.debug('proactive', `这次不发动态：${MOMENT_BLOCK_TEXT[gate.reason]}`, { reason: gate.reason }, 'FN-28');
      return;
    }

    const world = activeWorldPack();
    const shift = describeShift(world);
    proactiveEvents.emit('proactive:moment', {
      ...(shift ? { situation: `今天是${shift}` } : {}),
      index: todayCount + 1,
    });
    log.info('proactive', `准备发一条动态（今天第 ${todayCount + 1} 条）`, { shift }, 'FN-28');
  } catch (e) {
    // 动态失败不影响主动消息 —— 降级为"这次不发"
    log.warn('proactive', '动态检查失败，跳过本次', String(e));
  }
}

/* ============================================================
   visibilitychange：暂停 / 补偿
   ============================================================ */

function stopVisibleTimer(): void {
  if (runtime.timer !== undefined) {
    window.clearInterval(runtime.timer);
    runtime.timer = undefined;
  }
}

function startVisibleTimer(): void {
  stopVisibleTimer();
  runtime.timer = window.setInterval(() => {
    const minutes = consumeElapsedMinutes();
    void runTick(minutes, 'visible').catch((e) => {
      log.error('proactive', '主动消息 tick 失败', { error: String(e) }, 'FN-06');
    });
  }, TICK_VISIBLE_MS);
}

function onVisibilityChange(): void {
  const visible = typeof document === 'undefined' ? true : !document.hidden;
  if (visible === runtime.visible) return;
  runtime.visible = visible;
  useProactiveStore.getState().setVisible(visible);

  if (visible) {
    // ★ 恢复：一次性补偿隐藏期间累积的分钟数（页面被冻结时主线程一次都没跑）
    const minutes = Math.max(consumeElapsedMinutes(), runtime.pendingHiddenMinutes);
    runtime.pendingHiddenMinutes = 0;
    startVisibleTimer();
    flushPendingResume();
    const missed = useProactiveStore.getState().consumeMissedTicks();
    appEmitter.emit('app:resume', { missedTicks: missed });
    void runTick(minutes, 'resume').catch((e) => {
      log.error('proactive', '恢复补偿 tick 失败', { error: String(e) }, 'SV-06');
    });
  } else {
    // 隐藏：停掉主线程定时器，交给 Worker 心跳粗粒度推进
    stopVisibleTimer();
    runtime.lastTickAt = Date.now();
  }
}

/* ============================================================
   Worker 心跳（页面隐藏时的粗粒度时钟）
   ============================================================ */

function startHeartbeat(): void {
  if (typeof Worker === 'undefined') return;
  try {
    const worker = new Worker(new URL('../workers/heartbeat.worker.ts', import.meta.url), {
      type: 'module',
    });
    runtime.worker = worker;
    runtime.heartbeat = true;

    worker.onmessage = (event: MessageEvent<HeartbeatOutMessage>) => {
      const data = event.data;
      if (!data) return;
      if (data.type !== 'tick') return;
      // Worker 只是「报时」：真正推进多少分钟按墙钟算，
      // 这样即使 Worker 被节流、漏报几次也不会少算。
      const minutes = consumeElapsedMinutes();
      if (!runtime.visible) {
        runtime.pendingHiddenMinutes += minutes;
      }
      void runTick(minutes, runtime.visible ? 'visible' : 'hidden').catch((e) => {
        log.error('proactive', '心跳 tick 失败', { error: String(e) }, 'SV-06');
      });
    };
    worker.onerror = () => {
      runtime.heartbeat = false;
      log.warn('proactive', '心跳 Worker 出错，降级为仅页面可见时调度', undefined, 'SV-06');
    };

    const startMsg: HeartbeatInMessage = { type: 'start', intervalMs: TICK_HIDDEN_MS };
    worker.postMessage(startMsg);
  } catch (e) {
    runtime.heartbeat = false;
    log.warn('proactive', '心跳 Worker 不可用，降级为仅页面可见时调度', { error: String(e) }, 'SV-06');
  }
}

function stopHeartbeat(): void {
  if (!runtime.worker) return;
  try {
    const stopMsg: HeartbeatInMessage = { type: 'stop' };
    runtime.worker.postMessage(stopMsg);
    runtime.worker.terminate();
  } catch {
    /* 忽略 */
  }
  runtime.worker = undefined;
  runtime.heartbeat = false;
}

/* ============================================================
   单写者竞选
   ============================================================ */

function postWriter(msg: WriterMessage): void {
  runtime.channel?.post(msg);
}

/** 用 navigator.locks 抢锁（拿不到说明别的标签页已经是写者） */
function acquireByLock(): Promise<boolean> {
  const locks = getLockManager();
  if (!locks) return electByBroadcast();
  return new Promise<boolean>((resolve) => {
    let settled = false;
    void locks.request(WRITER_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, (lock) => {
      if (!lock) {
        if (!settled) {
          settled = true;
          resolve(false);
        }
        return Promise.resolve();
      }
      if (!settled) {
        settled = true;
        resolve(true);
      }
      // ★ 一直挂住这把锁，直到本标签页主动释放（页面卸载 / stop）
      return new Promise<void>((release) => {
        runtime.releaseLock = release;
      });
    });
  });
}

/**
 * 无 `navigator.locks` 时的兜底竞选：
 * 广播自己的 id，等待一个短窗口，若没人比自己更小则当选。
 */
function electByBroadcast(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (typeof BroadcastChannel === 'undefined') {
      resolve(true);
      return;
    }
    let smallest = TAB_ID;
    let settled = false;
    // 竞选专用的一次性频道：避免与常驻的 ping/claim 监听互相干扰
    const channel = new BroadcastChannel(WRITER_CHANNEL);
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      channel.close();
      resolve(smallest === TAB_ID);
    }, ELECTION_WINDOW_MS);

    channel.onmessage = (event: MessageEvent<WriterMessage>) => {
      const msg = event.data;
      if (!msg || msg.type !== 'claim') return;
      // 字典序更小的 id 优先（先到先得 + 稳定排序，避免两个标签页同时当选）
      if (msg.id < smallest) {
        smallest = msg.id;
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          channel.close();
          resolve(false);
        }
      }
    };

    // BroadcastChannel 不会把消息发给自己，所以只会收到其它标签页的 claim
    channel.postMessage({ type: 'claim', id: TAB_ID });
  });
}

/** 停止后是否仍属于同一次启动（用于作废过期的竞选结果） */
function isStale(generation: number): boolean {
  return !runtime.running || generation !== runtime.generation;
}

async function becomeWriter(generation: number): Promise<void> {
  if (runtime.writer) return;
  const okWriter = await acquireByLock();
  // ★ 竞选是异步的：等待期间可能已被 stop（StrictMode 双挂载 / 切角色清空数据）
  if (isStale(generation)) {
    runtime.releaseLock?.();
    runtime.releaseLock = undefined;
    return;
  }
  runtime.writer = okWriter;
  if (!okWriter) {
    log.info('proactive', '本标签页不是主动消息写者（已有别的标签页在调度）', { tabId: TAB_ID }, 'SV-07');
    // 读者：盯着写者心跳，心跳断了就重新竞选
    runtime.readerTimer = window.setInterval(() => {
      const stale = Date.now() - runtime.lastWriterPingAt > WRITER_PING_TIMEOUT_MS;
      if (runtime.lastWriterPingAt === 0 || stale) {
        void becomeWriter(generation);
      }
    }, WRITER_PING_TIMEOUT_MS);
    return;
  }

  if (runtime.readerTimer !== undefined) {
    window.clearInterval(runtime.readerTimer);
    runtime.readerTimer = undefined;
  }
  runtime.lastWriterPingAt = Date.now();
  runtime.pingTimer = window.setInterval(() => {
    runtime.lastWriterPingAt = Date.now();
    postWriter({ type: 'ping', id: TAB_ID, at: runtime.lastWriterPingAt });
  }, WRITER_PING_MS);

  runtime.lastTickAt = Date.now();
  if (runtime.visible) startVisibleTimer();
  log.info('proactive', '本标签页成为主动消息写者', { tabId: TAB_ID }, 'SV-07');
}

function releaseWriter(): void {
  if (runtime.pingTimer !== undefined) {
    window.clearInterval(runtime.pingTimer);
    runtime.pingTimer = undefined;
  }
  if (runtime.readerTimer !== undefined) {
    window.clearInterval(runtime.readerTimer);
    runtime.readerTimer = undefined;
  }
  if (runtime.writer) postWriter({ type: 'release', id: TAB_ID });
  runtime.writer = false;
  runtime.releaseLock?.();
  runtime.releaseLock = undefined;
}

/* ============================================================
   启动 / 停止
   ============================================================ */

/**
 * 启动调度器（可重复调用，第二次直接返回）。
 * ★ 只有写者标签页会真正推进状态；其余标签页只接收广播，不写库。
 */
export function startProactiveScheduler(): void {
  if (runtime.running) return;
  runtime.running = true;
  runtime.generation += 1;
  runtime.startedAt = Date.now();
  runtime.lastTickAt = Date.now();
  runtime.visible = typeof document === 'undefined' ? true : !document.hidden;

  const generation = runtime.generation;
  if (typeof BroadcastChannel !== 'undefined') {
    runtime.channel = createBroadcast<WriterMessage>(WRITER_CHANNEL, (msg) => {
      if (!msg) return;
      if (isStale(generation)) return;
      if (msg.type === 'ping') {
        runtime.lastWriterPingAt = Date.now();
      } else if (msg.type === 'release') {
        runtime.lastWriterPingAt = 0;
        if (!runtime.writer) void becomeWriter(generation);
      }
    });
  }

  const onVis = (): void => onVisibilityChange();
  document.addEventListener('visibilitychange', onVis);
  runtime.disposeVisibility = () => document.removeEventListener('visibilitychange', onVis);

  // 页面卸载时释放锁，让另一个标签页尽快接管
  window.addEventListener('pagehide', releaseWriter);
  window.addEventListener('beforeunload', releaseWriter);
  // ★ FN-20「后台消息退出确认」：有进行中的后台消息时拦一下退出
  window.addEventListener('beforeunload', confirmExitOnBackgroundMessage);

  startHeartbeat();
  void becomeWriter(generation);
}

/** 停止调度器（切换角色 / 清空数据 / 卸载时用） */
export function stopProactiveScheduler(): void {
  if (!runtime.running) return;
  runtime.running = false;
  stopVisibleTimer();
  stopHeartbeat();
  releaseWriter();
  runtime.disposeVisibility?.();
  runtime.disposeVisibility = undefined;
  runtime.channel?.close();
  runtime.channel = undefined;
  window.removeEventListener('pagehide', releaseWriter);
  window.removeEventListener('beforeunload', releaseWriter);
  window.removeEventListener('beforeunload', confirmExitOnBackgroundMessage);
}

/**
 * ★ FN-20「后台消息退出确认」的 `beforeunload` 拦截（PRD 通知类，P1，部分实现）。
 *
 * **只在「本标签页正在推进后台消息」时才拦**（`running` 且是本标签页持写者锁）：
 * 不在这个状态下拦的话，用户每关一次页面都被浏览器弹一次通用确认，纯骚扰，
 * 而且会让人养成无脑点「离开」的习惯，真要拦的时候反而拦不住。
 *
 * ⚠️ **浏览器不允许自定义这里的文案**——只能出浏览器自带的通用提示。
 *   所以「真的问你一句、把原因说清楚」走的是**应用内确认**：
 *   `src/layouts/TopBar.tsx` 双击 Logo → `FloatingLayer` 弹二次确认。
 *   两条路合起来才是 FN-20 的完整边界（PRD 的「部分实现」就差在自定义文案这条）。
 *
 * ★ 监听的注册 / 注销与调度器生命周期绑定（`start` / `stop`），
 *   避免调度器停了之后还残留一个会拦退出的监听器。
 */
function confirmExitOnBackgroundMessage(event: BeforeUnloadEvent): void {
  if (!runtime.running || !runtime.writer) return;
  event.preventDefault();
  // 老浏览器（Chrome < 119 等）只认 returnValue，两个都给才稳
  event.returnValue = '';
}

/**
 * ★ 上游生成完主动消息正文后调用：负责「送到用户眼前」。
 * 页面隐藏 → 系统通知；没通知权限 → 标记待补发，页面回来时提示。
 */
export function deliverProactive(text: string): 'in-app' | 'notification' | 'pending' {
  return deliverProactiveMessage(text, { visible: runtime.visible });
}

/**
 * 用户回复了一条**主动消息**时调用（用于动态主动性的统计，FN-14）。
 * 只统计「主动消息 → 用户回复」的间隔，普通对话不计入。
 */
export function noteUserRepliedProactive(waitMinutes: number): void {
  recordResponseGap(waitMinutes);
  void getXinranEngine().noteUserReplied();
}

/** 开发者页用：手动推进一次（便于观察五轴轨迹） */
export async function debugTick(minutes: number): Promise<void> {
  await runTick(minutes, 'visible');
}

/** 开发者页用：当前动态系数 */
export function debugDynamicFactor(): number {
  return computeDynamicFactor(undefined, useSettingsStore.getState().settings.chat.proactive.dynamic);
}

export default startProactiveScheduler;
