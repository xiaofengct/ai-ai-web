import { evaluateWorldGate, describeShift } from '@/world/schedule';
import type { WorldPack } from '@/world/types';
import type { ChatSettings } from '@/types/settings';

/**
 * ★★ 角色主动发动态 —— 发布闸门（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 触发条件（用户明确要求写清楚，这里是**唯一真源**）
 * ═══════════════════════════════════════════════════════════════════════════
 * 下面六关**串联**，全过才发。任一不过就记下 `reason` 并跳过（**不静默丢弃**）。
 *
 * ① `disabled`       —— 用户没打开「让她自己发动态」（**默认就是关的**）
 * ② `noPersona`      —— 没有角色（不内置版首启）⇒ 没有"她"，无从发
 * ③ `tooSoon`        —— 距上一条不足 `intervalMin` 分钟
 * ④ `dailyCap`       —— 今天已经发满 `maxPerDay` 条（**硬上限**）
 * ⑤ `worldQuiet`     —— 世界设定的深夜静默（如 23:00–08:00）
 * ⑥ `notActiveHours` —— `onlyActiveHours` 打开且当前不在她的活跃时段
 *                       （夜班日的白天她该在睡觉 —— 这是动态"像真的"的关键）
 * ⑦ `worldRoll`      —— 世界概率门没过（纯运气，不是设计）
 *
 * ── 三个刻意的设计取舍 ──────────────────────────────────────────────────
 *
 * **① 为什么"间隔"与"每日上限"是**与**关系，而不是二选一。**
 *   只用间隔：用户把间隔设成 60 分钟 ⇒ 一天最多 24 条，太多。
 *   只用上限：3 条可以在一小时内连发完 ⇒ 像刷屏。
 *   两个一起管，才同时约束"别连着发"与"别发太多"。
 *
 * **② 为什么每日上限是硬上限、不参与概率门。**
 *   概率门（世界设定）表达的是"这次有没有兴致"，是**内容层面**的随机；
 *   而每日上限是**成本与打扰**的红线 —— 用户设了 3 条就是 3 条，
 *   不该因为"掷骰子运气好"变成 5 条。把红线也做成概率的，红线就不叫红线了。
 *
 * **③ 为什么"没有世界设定"时仍然可以发（而不是拦下）。**
 *   与 `proactive/dynamic.ts` 的既有口径一致：**无世界 = 无约束 = 放行**。
 *   不内置版用户没导入世界时，动态功能照样要能用。
 *   只是 `onlyActiveHours` 那一关在没有世界时**自动跳过**
 *   （没有排班就无从判断"活跃时段"，不能因此判她"不在活跃时段"）。
 */

export type MomentBlockReason =
  | 'disabled'
  | 'noPersona'
  | 'tooSoon'
  | 'dailyCap'
  | 'worldQuiet'
  | 'notActiveHours'
  | 'worldRoll'
  | 'none';

export interface MomentGateInput {
  /** 生效的聊天设置（含 `moments` 分组） */
  chat: ChatSettings;
  /** 当前角色 id（无角色传 undefined） */
  personaId?: string;
  /** 距上一条**角色发的**动态过了多少分钟（`undefined` = 从没发过） */
  minutesSinceLast?: number;
  /** 今天（北京时间）角色已经发了几条 */
  todayCount: number;
  /** 当前角色的世界设定（无则跳过世界相关三关） */
  world?: WorldPack;
  now?: Date;
  /** 掷骰子（注入便于测试） */
  rng?: () => number;
}

export interface MomentGateResult {
  allowed: boolean;
  reason: MomentBlockReason;
  /** 当前班次（世界设定提供时才有） */
  shift?: string | null;
  /** 今天还能发几条（供界面显示"今日还能发 N 条"） */
  remainingToday: number;
  /** 距离可以再发还差多少分钟（`tooSoon` 时有值，用于界面解释） */
  waitMinutes?: number;
}

/** 北京时间的一天（用于"今天发了几条"的切分） */
export function beijingDayKey(at: Date = new Date()): string {
  // ★ 用 UTC 字段读"北京墙上时间"（与 `world/schedule.ts` 同一套口径）：
  //   `+8h` 之后取 UTC 的年月日，就是北京那天的日期，且**不受设备时区影响**。
  //   直接 `getDate()` 在别的时区会算错"今天"是哪天。
  const bj = new Date(at.getTime() + 8 * 3600_000);
  const y = bj.getUTCFullYear();
  const m = String(bj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(bj.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function evaluateMomentGate(input: MomentGateInput): MomentGateResult {
  const m = input.chat.moments;
  const remainingToday = Math.max(0, m.maxPerDay - input.todayCount);
  const base = { remainingToday };

  // ① 用户没开
  if (!m.enabled) return { allowed: false, reason: 'disabled', ...base };
  // ② 没有角色
  if (!input.personaId) return { allowed: false, reason: 'noPersona', ...base };
  // ③ 间隔不够（NaN / 负数按"从没发过"处理）
  if (input.minutesSinceLast !== undefined && input.minutesSinceLast < m.intervalMin) {
    return {
      allowed: false,
      reason: 'tooSoon',
      waitMinutes: Math.ceil(m.intervalMin - input.minutesSinceLast),
      ...base,
    };
  }
  // ④ 今日上限（**硬上限**，理由见文件头 ②）
  if (remainingToday <= 0) return { allowed: false, reason: 'dailyCap', ...base };

  // ⑤⑥⑦ 世界相关三关
  if (input.world) {
    const shift = describeShift(input.world, input.now);
    /**
     * ★ `onlyActiveHours` 关闭时，**不能**直接把 world 传成 undefined ——
     *   那会连"深夜静默"也一起跳过（静默是"别吵到别人"，与"她在不在班"无关）。
     *   ⇒ 做法：**单独调一次静默判断**，再按开关决定要不要做活跃时段判断。
     *     这里用 `evaluateWorldGate` 的一个**只判静默**的变体不值得新开 API；
     *     直接用它的结果，在"未通过且原因是 inactiveShift"时按开关放行。
     */
    const gate = evaluateWorldGate(input.world, input.now, input.rng);

    if (!gate.allowed) {
      if (gate.reason === 'quietHours') {
        return { allowed: false, reason: 'worldQuiet', shift: shift ?? null, ...base };
      }
      if (gate.reason === 'inactiveShift' && m.onlyActiveHours) {
        return { allowed: false, reason: 'notActiveHours', shift: shift ?? null, ...base };
      }
      if (gate.reason === 'gateRoll' && m.onlyActiveHours) {
        return { allowed: false, reason: 'worldRoll', shift: shift ?? null, ...base };
      }
      // `inactiveShift` 但用户关了 `onlyActiveHours` ⇒ **放行**（她可以在非活跃时段发）
      // ★ 这是刻意的：用户关掉那个开关，表达的就是"不用管她的作息"。
    }
    return { allowed: true, reason: 'none', shift: shift ?? null, ...base };
  }

  return { allowed: true, reason: 'none', ...base };
}

/** 闸门原因 → 人话（日志与开发者页用；**不静默丢弃**是既有约定） */
export const MOMENT_BLOCK_TEXT: Record<MomentBlockReason, string> = {
  disabled: '功能没开',
  noPersona: '还没有角色',
  tooSoon: '离上一条太近',
  dailyCap: '今天发满了',
  worldQuiet: '她的深夜静默时段',
  notActiveHours: '不在她的活跃时段（大概在睡）',
  worldRoll: '这次运气没过概率门',
  none: '',
};

/**
 * 统计"今天（北京）她发了几条、上一条是多久前"。
 *
 * ★ 放在闸门模块而不是仓储：这是**闸门的输入**，两者必须用同一套时间口径
 *   （北京日界 + 相对分钟）。放到仓储会让 `momentRepo` 反过来依赖设置语义。
 */
export function summarizeRecentMoments(
  moments: readonly { authorKind: string; createdAt: string }[],
  now: Date = new Date(),
): { todayCount: number; minutesSinceLast?: number } {
  const key = beijingDayKey(now);
  let todayCount = 0;
  let lastMs: number | undefined;

  for (const m of moments) {
    if (m.authorKind !== 'persona') continue;
    // ★ 用北京日界判断"今天"，而不是本地日界（与 `beijingDayKey` 同口径）
    if (beijingDayKey(new Date(m.createdAt)) === key) todayCount += 1;
    const ms = new Date(m.createdAt).getTime();
    if (!Number.isNaN(ms) && (lastMs === undefined || ms > lastMs)) lastMs = ms;
  }

  const minutesSinceLast =
    lastMs === undefined ? undefined : Math.max(0, (now.getTime() - lastMs) / 60_000);
  return { todayCount, ...(minutesSinceLast !== undefined ? { minutesSinceLast } : {}) };
}
