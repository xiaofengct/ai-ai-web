import { useProactiveStore } from '@/store/proactiveStore';
import { inQuietHours, hourOfDay } from '@/lib/time';
import { evaluateWorldGate } from '@/world/schedule';
import type { WorldPack } from '@/world/types';
import type { ChatSettings } from '@/types/settings';

/**
 * 动态主动性与时间闸门（FN-14 / FN-08 / FN-10）。
 *
 * ★ 职责边界：**这里只做「频率与时段」的换算，不判断她想不想开口。**
 *   「想不想开口」由 jiwen 的五轴决定（`jiwenBridge.ts`）。
 *   两者是「与」关系：jiwen 说想开口 **且** 这里说现在可以发，才真的发。
 */

/** 响应间隔样本落 localStorage 的键（滚动保留最近 N 次，不进 Dexie：小数据、同步读） */
export const RESPONSE_GAPS_KEY = 'ai-ai.proactive.gaps.v1';
/** 滚动样本上限 */
const MAX_GAP_SAMPLES = 20;
/** 基准响应间隔（分钟）：与基准频率 1.0 对应 */
export const BASE_RESPONSE_MIN = 30;
/** 动态系数上下限 */
export const DYNAMIC_FACTOR_RANGE: readonly [number, number] = [0.5, 3];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** 读取响应间隔样本（分钟） */
export function responseGapSamples(): number[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RESPONSE_GAPS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number' && n >= 0) : [];
  } catch {
    return [];
  }
}

/**
 * 记录一次「她主动开口 → 你回复」的间隔（分钟）。
 * 只有**用户真的回复了主动消息**才该调，否则会把「已读不回」算成超快响应。
 */
export function recordResponseGap(minutes: number): void {
  if (!Number.isFinite(minutes) || minutes < 0) return;
  if (typeof localStorage === 'undefined') return;
  const next = [...responseGapSamples(), Math.min(minutes, 24 * 60)].slice(-MAX_GAP_SAMPLES);
  try {
    localStorage.setItem(RESPONSE_GAPS_KEY, JSON.stringify(next));
  } catch {
    /* 存储不可用时忽略：动态系数降级为 1 */
  }
  const avg = averageOf(next);
  if (avg !== undefined) useProactiveStore.getState().setAvgResponse(avg);
}

/** 简单算术平均（样本少时也算，外部自行判断是否可信） */
export function averageOf(samples: readonly number[]): number | undefined {
  if (samples.length === 0) return undefined;
  const sum = samples.reduce((s, n) => s + n, 0);
  return sum / samples.length;
}

/**
 * 动态系数：你回得越快 → 她越勤。
 * `factor = clamp(BASE_RESPONSE_MIN / avg, 0.5, 3)`
 * - avg = 10 分钟 → 3.0（很勤）；
 * - avg = 30 分钟 → 1.0（基准）；
 * - avg = 60 分钟 → 0.5（收敛，别烦人）。
 */
export function computeDynamicFactor(avgResponseMin?: number, enabled = true): number {
  if (!enabled) return 1;
  const avg = avgResponseMin ?? useProactiveStore.getState().avgResponseMin;
  if (avg === undefined || avg <= 0) return 1;
  return clamp(BASE_RESPONSE_MIN / avg, DYNAMIC_FACTOR_RANGE[0], DYNAMIC_FACTOR_RANGE[1]);
}

/** 把基准间隔按动态系数换算成实际间隔（系数越大 → 间隔越短） */
export function effectiveIntervalMin(baseIntervalMin: number, factor: number): number {
  const safeBase = Math.max(1, Math.round(baseIntervalMin));
  return Math.max(1, Math.round(safeBase / Math.max(0.1, factor)));
}

/** 是否在允许发送的时段内（FN-10 全天候 / 免打扰时段） */
export function inAllowedWindow(
  now: Date = new Date(),
  options: { allDay: boolean; quietHours?: { from: string; to: string } } = { allDay: true },
): boolean {
  if (options.allDay) return true;
  const { from, to } = options.quietHours ?? { from: '23:00', to: '07:00' };
  return !inQuietHours(now, from, to);
}

export interface ProactiveGateInput {
  /** 全局（或会话覆盖后的）聊天设置 */
  chat: ChatSettings;
  /** 距上次主动消息过去了的分钟数（`undefined` = 从没发过，立即可发） */
  minutesSinceLastProactive?: number;
  /** 是否已超过停用超时（FN-09） */
  idleStopped: boolean;
  /** 页面是否可见（隐藏时只发系统通知，不插消息） */
  visible: boolean;
  /** 当前时间（注入便于测试） */
  now?: Date;
  /**
   * ★ 当前角色的**世界设定**（2026-10-04 加）。
   *
   * 带上它会多出三关：**深夜静默 → 按班次的活跃时段 → 概率门**。
   * 不带（`undefined`）则这三关全部跳过 —— 即**旧行为**，
   * 保证"没配世界的角色"主动消息照常工作。
   *
   * ★ 为什么在闸门里做、而不是在调用方做：
   *   "要不要发"的判定**必须只有一个入口**，否则日志里说不清是被哪一关拦的。
   *   `GateBlockReason` 里已明确区分了这几种原因（见下）。
   */
  world?: WorldPack;
  /** 掷骰子（注入便于测试：固定序列即可断言门限行为） */
  rng?: () => number;
}

export type GateBlockReason =
  | 'disabled'
  | 'idleStopped'
  | 'quietHours'
  | 'tooSoon'
  | 'hidden'
  /* —— 以下三个来自世界设定（2026-10-04 加）—— */
  /** 世界的深夜静默（如 23:00–08:00） */
  | 'worldQuietHours'
  /** 不在该班次的活跃时段内（如夜班日的白天） */
  | 'worldInactiveShift'
  /** 过了时段，但概率门没过（纯运气，不是设计） */
  | 'worldGateRoll'
  | 'none';

export interface ProactiveGateResult {
  allowed: boolean;
  reason: GateBlockReason;
  /** 实际生效的间隔（分钟） */
  effectiveIntervalMin: number;
  dynamicFactor: number;
  /** 当前班次（世界设定提供时才有；写日志/开发者页用） */
  shift?: string | null;
  /** 概率门的掷点与阈值（便于回答"为什么这次没发"） */
  roll?: { value: number; threshold: number };
}

/**
 * ★ 环境闸门总入口：把 FN-06/08/09/10/14 一次性算清楚。
 * 返回 `allowed=false` 时**必须**带上 reason（写日志 / 开发者页用），不允许静默不发。
 *
 * ★ 2026-10-04 追加了世界设定三关（静默 → 活跃时段 → 概率门）。
 *   顺序：先用户自己的开关与间隔（便宜且是用户显式意愿），
 *   再世界设定（"她今天该不该说话"）—— 这样日志里能分清
 *   "是用户关掉了" 与 "是她的作息不允许"。
 */
export function evaluateProactiveGate(input: ProactiveGateInput): ProactiveGateResult {
  const p = input.chat.proactive;
  const factor = computeDynamicFactor(undefined, p.dynamic);
  const interval = effectiveIntervalMin(p.intervalMin, factor);

  if (!p.enabled) return { allowed: false, reason: 'disabled', effectiveIntervalMin: interval, dynamicFactor: factor };
  if (input.idleStopped) {
    return { allowed: false, reason: 'idleStopped', effectiveIntervalMin: interval, dynamicFactor: factor };
  }
  if (!inAllowedWindow(input.now ?? new Date(), { allDay: p.allDay, quietHours: p.quietHours })) {
    return { allowed: false, reason: 'quietHours', effectiveIntervalMin: interval, dynamicFactor: factor };
  }
  const since = input.minutesSinceLastProactive;
  if (since !== undefined && since < interval) {
    return { allowed: false, reason: 'tooSoon', effectiveIntervalMin: interval, dynamicFactor: factor };
  }

  /* ═══ 世界设定三关（世界包不存在时整段跳过，即旧行为） ═══ */
  if (input.world) {
    const worldGate = evaluateWorldGate(input.world, input.now ?? new Date(), input.rng);
    if (!worldGate.allowed) {
      /**
       * ★ 世界闸门的 reason 直接映射到本函数的原因枚举前缀 `world*`。
       *   `noWorld` 不会出现在这里（那边已判过 `input.world` 存在）。
       */
      const mapped: GateBlockReason =
        worldGate.reason === 'quietHours'
          ? 'worldQuietHours'
          : worldGate.reason === 'inactiveShift'
            ? 'worldInactiveShift'
            : 'worldGateRoll';
      return {
        allowed: false,
        reason: mapped,
        effectiveIntervalMin: interval,
        dynamicFactor: factor,
        shift: worldGate.shift ?? null,
        ...(worldGate.roll ? { roll: worldGate.roll } : {}),
      };
    }
    return {
      allowed: true,
      reason: 'none',
      effectiveIntervalMin: interval,
      dynamicFactor: factor,
      shift: worldGate.shift ?? null,
      ...(worldGate.roll ? { roll: worldGate.roll } : {}),
    };
  }

  return { allowed: true, reason: 'none', effectiveIntervalMin: interval, dynamicFactor: factor };
}

/** 当前小时（UTC+8），桌宠/主动消息的「夜班族」判断用 */
export function currentHour(): number {
  return hourOfDay();
}

/** 清空样本（开发者页「重置主动性统计」用） */
export function resetResponseGaps(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(RESPONSE_GAPS_KEY);
  } catch {
    /* 忽略 */
  }
  useProactiveStore.getState().setAvgResponse(undefined);
}

export default evaluateProactiveGate;
