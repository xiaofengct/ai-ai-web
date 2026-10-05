/// <reference lib="webworker" />

/**
 * ★ 主动消息心跳 Worker（SV-06 / PL-10 的降级实现）。
 *
 * 为什么需要它：浏览器会把**后台标签页的主线程定时器**节流到分钟级甚至完全冻结，
 * 而 Worker 里的 `setInterval` 受节流影响小得多。
 * 页面隐藏时主线程可能一次都跑不到，Worker 至少能按 5 分钟的粗粒度把「时间过去了」这件事报出去，
 * 等页面恢复时由 `proactive/scheduler.ts` 一次性补偿 tick。
 *
 * ★ 这个 Worker **不碰 Dexie、不调模型**：它只负责计时与报时。
 *   真正的状态推进与消息生已脱敏在主线程，避免多写者冲突（决策 A9：单写者）。
 */

import { TICK_HIDDEN_MS } from '@/constants/limits';

/** 主线程 → Worker */
export type HeartbeatInMessage =
  | { type: 'start'; intervalMs?: number }
  | { type: 'stop' }
  | { type: 'setInterval'; intervalMs: number }
  | { type: 'ping' };

/** Worker → 主线程 */
export type HeartbeatOutMessage =
  | { type: 'ready'; intervalMs: number }
  | { type: 'tick'; at: string; seq: number }
  | { type: 'stopped' }
  | { type: 'pong'; at: string };

/** 允许的最小间隔，防止误配成 1ms 把 CPU 打满 */
const MIN_INTERVAL_MS = 5_000;
/** 允许的最大间隔（超过这个就没意义了，直接按 30 分钟算） */
const MAX_INTERVAL_MS = 30 * 60_000;

let timer: ReturnType<typeof setInterval> | undefined;
let intervalMs: number = TICK_HIDDEN_MS;
let seq = 0;

function post(message: HeartbeatOutMessage): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
}

function normalize(ms: number | undefined): number {
  if (!Number.isFinite(ms) || (ms as number) <= 0) return TICK_HIDDEN_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, ms as number));
}

function stop(): void {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
  post({ type: 'stopped' });
}

function start(ms?: number): void {
  stop();
  intervalMs = normalize(ms ?? intervalMs);
  // 立刻报一次，让主线程知道「我活着」
  seq += 1;
  post({ type: 'tick', at: new Date().toISOString(), seq });
  timer = setInterval(() => {
    seq += 1;
    post({ type: 'tick', at: new Date().toISOString(), seq });
  }, intervalMs);
  post({ type: 'ready', intervalMs });
}

self.addEventListener('message', (event: MessageEvent<HeartbeatInMessage>) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  switch (data.type) {
    case 'start':
      start(data.intervalMs);
      break;
    case 'setInterval':
      intervalMs = normalize(data.intervalMs);
      if (timer !== undefined) start(intervalMs);
      else post({ type: 'ready', intervalMs });
      break;
    case 'stop':
      stop();
      break;
    case 'ping':
      post({ type: 'pong', at: new Date().toISOString() });
      break;
    default:
      break;
  }
});

// 首次加载即告知主线程可用（不自动开始计时，由主线程显式 start）
post({ type: 'ready', intervalMs });

export {};
