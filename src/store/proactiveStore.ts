import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SK } from '@/constants/storageKeys';
import { TICK_HIDDEN_MS, TICK_VISIBLE_MS } from '@/constants/limits';
import { nowISO } from '@/lib/time';
import { createBroadcast } from '@/lib/emitter';
import { log } from './logStore';
import type { ISODate } from '@/types/common';

/**
 * 主动消息运行时 Store（架构文档 §6.6）：lastProactiveAt、missedTicks、动态系数。
 * **不做定时**（定时由 `proactive/scheduler.ts` + Worker 心跳负责，T12）。
 *
 * ★ 后台降级（D6）：
 * - 页面可见 → 每 30s tick；
 * - 页面隐藏 → Worker 心跳 5min（粗粒度），标签页被冻结则丢失 tick；
 * - 页面恢复 → 计算 missedTicks 并发一次 `app:resume` 事件，由 UI 补发提示。
 */

export interface ProactiveState {
  enabled: boolean;
  lastProactiveAt?: ISODate;
  lastTickAt?: ISODate;
  lastActiveAt?: ISODate;
  /** 页面隐藏期间丢失的 tick 数（恢复时补偿） */
  missedTicks: number;
  /** 动态主动性系数：1 = 基准，>1 更频繁（FN-14） */
  dynamicFactor: number;
  /** 用户平均响应间隔（分钟），用于计算 dynamicFactor */
  avgResponseMin?: number;
  /** 页面是否可见 */
  visible: boolean;

  setEnabled(on: boolean): void;
  markProactive(at?: ISODate): void;
  tick(): void;
  /** 记录一次 tick 丢失（页面隐藏期间由 Worker 触发） */
  addMissedTick(n?: number): void;
  consumeMissedTicks(): number;
  markActive(): void;
  setVisible(v: boolean): void;
  setDynamicFactor(f: number): void;
  setAvgResponse(min?: number): void;
  /** 距离下次可发送还剩多少毫秒（<0 表示可以发了） */
  msUntilNext(intervalMin: number): number;
  /** 是否处于空闲停用状态（FN-09） */
  isIdleStopped(idleTimeoutMin: number): boolean;
}

/**
 * 跨标签页广播：只让**一个**标签页做调度。
 * 多个标签页同时发主动消息会重复插入消息，这里用 BroadcastChannel 互相告知「我刚发过」。
 */
export const proactiveBroadcast = createBroadcast<{ type: 'proactive'; at: ISODate }>(
  'ai-ai.proactive.v1',
  (payload) => {
    if (payload?.type === 'proactive') {
      useProactiveStore.getState().markProactive(payload.at);
    }
  },
);

export const useProactiveStore = create<ProactiveState>()(
  persist(
    (set, get) => ({
      enabled: false,
      lastProactiveAt: undefined,
      lastTickAt: undefined,
      lastActiveAt: nowISO(),
      missedTicks: 0,
      dynamicFactor: 1,
      avgResponseMin: undefined,
      visible: true,

      setEnabled: (on) => set({ enabled: on }),

      markProactive: (at) => {
        const now = at ?? nowISO();
        set({ lastProactiveAt: now });
        proactiveBroadcast.post({ type: 'proactive', at: now });
      },

      tick: () => set({ lastTickAt: nowISO() }),

      addMissedTick: (n = 1) => set((state) => ({ missedTicks: state.missedTicks + n })),

      consumeMissedTicks: () => {
        const n = get().missedTicks;
        if (n > 0) set({ missedTicks: 0 });
        return n;
      },

      markActive: () => set({ lastActiveAt: nowISO() }),

      setVisible: (v) => {
        const prev = get().visible;
        set({ visible: v });
        if (!prev && v) {
          // 从隐藏恢复：粗粒度补偿（按隐藏时长 / 隐藏 tick 间隔估算）
          const last = get().lastTickAt;
          const elapsed = last ? Date.now() - new Date(last).getTime() : 0;
          const missed = Math.max(0, Math.floor(elapsed / TICK_HIDDEN_MS));
          if (missed > 0) {
            set((state) => ({ missedTicks: state.missedTicks + missed }));
            log.info('proactive', '页面恢复，补偿丢失的 tick', { missed }, 'SV-06');
          }
        }
        set({ lastTickAt: nowISO() });
      },

      setDynamicFactor: (f) => set({ dynamicFactor: Math.max(0.25, Math.min(4, f)) }),
      setAvgResponse: (min) => set({ avgResponseMin: min }),

      msUntilNext: (intervalMin) => {
        const last = get().lastProactiveAt;
        if (!last) return -1;
        const effective = Math.max(1, Math.round(intervalMin / get().dynamicFactor));
        return new Date(last).getTime() + effective * 60_000 - Date.now();
      },

      isIdleStopped: (idleTimeoutMin) => {
        const lastActive = get().lastActiveAt;
        if (!lastActive) return false;
        return Date.now() - new Date(lastActive).getTime() > idleTimeoutMin * 60_000;
      },
    }),
    {
      name: SK.proactive,
      version: 1,
      partialize: (state) =>
        ({
          enabled: state.enabled,
          lastProactiveAt: state.lastProactiveAt,
          lastTickAt: state.lastTickAt,
          lastActiveAt: state.lastActiveAt,
          missedTicks: state.missedTicks,
          dynamicFactor: state.dynamicFactor,
          avgResponseMin: state.avgResponseMin,
        }) as unknown as ProactiveState,
    },
  ),
);

/** 可见/隐藏时的 tick 间隔（供 scheduler 使用） */
export function tickInterval(visible: boolean): number {
  return visible ? TICK_VISIBLE_MS : TICK_HIDDEN_MS;
}

export default useProactiveStore;
