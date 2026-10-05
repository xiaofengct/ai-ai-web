import { useEffect, useRef, useState } from 'react';
import type { JiwenUserStatus } from '@clarashafiq/jiwen';
import { DEFAULT_IDLE_TIMEOUT_MIN } from '@/constants/limits';
import { useProactiveStore } from '@/store/proactiveStore';

/**
 * 空闲 / 停用判定（FN-09「停用超时」）。
 *
 * 规则：鼠标移动、键盘、触摸、滚动、输入、页面恢复都算「还在」，
 * 超过 `timeoutMin` 分钟没有活动 → 主动消息**停止发送**（不是减慢，是停）。
 *
 * ★ 顺带产出 jiwen 需要的 `userStatus`：
 *   active → busy → away → sleeping，让引擎知道「对方是在忙还是睡了」，
 *   从而决定想念该涨多快（`connectionRateFn` 之外的第二层输入）。
 */

/** 计入「活跃」的事件（与 `hooks/useIdle.ts` 保持一致，避免两套行为） */
export const IDLE_EVENTS: readonly (keyof WindowEventMap)[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'wheel',
  'touchstart',
  'pointerdown',
  'focus',
];

/** 用户状态判定的分钟阈值 */
export const USER_STATUS_THRESHOLD_MIN: Readonly<Record<'busy' | 'away' | 'sleeping', number>> = {
  /** 5 分钟没动静：可能在忙 */
  busy: 5,
  /** 30 分钟没动静：大概率离开了 */
  away: 30,
  /** 3 小时没动静：当她睡了（想念涨得最慢） */
  sleeping: 180,
};

/**
 * 安装空闲监听。
 * @returns 卸载函数
 */
export function installIdleListeners(onActive: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const handler = (): void => onActive();
  for (const e of IDLE_EVENTS) window.addEventListener(e, handler, { passive: true });
  document.addEventListener('visibilitychange', handler);

  return () => {
    for (const e of IDLE_EVENTS) window.removeEventListener(e, handler);
    document.removeEventListener('visibilitychange', handler);
  };
}

/** 是否已被「停用超时」拦下（FN-09） */
export function isIdleStopped(lastActiveAt: number | undefined, timeoutMin: number): boolean {
  if (!lastActiveAt) return false;
  return Date.now() - lastActiveAt > timeoutMin * 60_000;
}

/** 距上次活跃过去了多少分钟 */
export function minutesSinceActive(lastActiveAt: number | undefined): number {
  if (!lastActiveAt) return 0;
  return Math.max(0, (Date.now() - lastActiveAt) / 60_000);
}

/** 由静默时长推断对方状态（喂给 jiwen 的 `setUserStatus`） */
export function deriveUserStatus(minutes: number): JiwenUserStatus {
  if (!Number.isFinite(minutes)) return 'away';
  if (minutes >= USER_STATUS_THRESHOLD_MIN.sleeping) return 'sleeping';
  if (minutes >= USER_STATUS_THRESHOLD_MIN.away) return 'away';
  if (minutes >= USER_STATUS_THRESHOLD_MIN.busy) return 'busy';
  return 'active';
}

export interface IdleSnapshot {
  /** 上次活跃的时间戳（毫秒） */
  lastActiveAt: number;
  /** 距上次活跃的分钟数 */
  minutesSinceActive: number;
  /** 是否已超过停用阈值 */
  idle: boolean;
  /** 推断出的对方状态 */
  userStatus: JiwenUserStatus;
}

/** 由 store 里的 lastActiveAt 算一份快照（不订阅、不触发渲染） */
export function readIdleSnapshot(timeoutMin = DEFAULT_IDLE_TIMEOUT_MIN): IdleSnapshot {
  const lastActiveAt = useProactiveStore.getState().lastActiveAt;
  const ms = lastActiveAt ? new Date(lastActiveAt).getTime() : undefined;
  const minutes = minutesSinceActive(ms);
  return {
    lastActiveAt: ms ?? Date.now(),
    minutesSinceActive: minutes,
    idle: isIdleStopped(ms, timeoutMin),
    userStatus: deriveUserStatus(minutes),
  };
}

/**
 * React 侧的空闲闸门：返回是否停用 + 自动把活跃时间写回 proactiveStore。
 * ★ 与 `hooks/useIdle.ts` 的区别：这里额外产出 `userStatus`，
 *   并且**不**自己维护 timer（timer 在调度器里，避免重复计时）。
 */
export function useIdleGate(timeoutMin = DEFAULT_IDLE_TIMEOUT_MIN, enabled = true): IdleSnapshot {
  const markActive = useProactiveStore((s) => s.markActive);
  const [snapshot, setSnapshot] = useState<IdleSnapshot>(() => readIdleSnapshot(timeoutMin));
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setSnapshot((prev) => ({ ...prev, idle: false }));
      return undefined;
    }

    const recompute = (): void => {
      setSnapshot(readIdleSnapshot(timeoutMin));
    };

    const onActive = (): void => {
      markActive();
      recompute();
    };

    const dispose = installIdleListeners(onActive);
    // 每 30 秒重算一次「是否停用」，这样即使用户只是看着不动也能正确进入停用态
    timerRef.current = window.setInterval(recompute, 30_000);
    recompute();

    return () => {
      dispose();
      if (timerRef.current !== undefined) window.clearInterval(timerRef.current);
    };
  }, [timeoutMin, enabled, markActive]);

  return snapshot;
}

export default useIdleGate;
