/**
 * 世界作息计算 —— **纯函数，可单元断言**。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么"能算的别让模型猜"
 * ═══════════════════════════════════════════════════════════════════════════
 * "今天是白班还是夜班"有唯一答案（锚点 + 周期）。交给 LLM 推理会得到两种坏结果：
 * 算错、或每次算得不一样（同一句话问两遍答案不同，这最伤真实感）。
 * ⇒ 全部在这里算，结果直接进提示词与主动消息判定。
 *
 * ★★ 一个容易错的关键点：**必须用北京时间，不能用设备时区**。
 *   原设定写明「虚拟世界与现实世界共用北京时间（Asia/Shanghai）」。
 *   如果代码用 `new Date()` 的本地字段，那么：
 *     - 手机在 UTC+8（重庆/北京）时看起来正常；
 *     - 一旦设备时区不对（或用户出国、模拟器默认 UTC），
 *       "今天上什么班"就会算错一天，静默时段也会整体平移 ——
 *       而且**不报错**，只是悄悄地不对。
 *   ⇒ 所以下面所有取"现在几点"的地方都过 `beijingNow()`，
 *     它显式按 UTC+8 换算，**不读设备本地时区**。
 *     （UTC+8 无夏令时，固定偏移即可，不需要时区数据库。）
 */

import type { ScheduleRule, ShiftName, TimeWindow, WorldPack } from './types';

/** 北京时间相对 UTC 的固定偏移（毫秒）。UTC+8，无夏令时 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 北京时间下的当前时刻（拆成便于计算的字段） */
export interface BeijingMoment {
  /** `YYYY-MM-DD`（北京日期） */
  date: string;
  /** 当日分钟数 0–1439 */
  minutes: number;
  /** `HH:mm` */
  clock: string;
}

/**
 * 取"现在的北京时间"。
 * ★ 实现方式：把时间戳加上 8 小时后，读 **UTC 字段** ——
 *   这样得到的就是北京墙上时间，且完全不受设备时区影响。
 *   （用 `getHours()` 等本地字段会在非 UTC+8 的设备上算错。）
 */
export function beijingNow(at: Date = new Date()): BeijingMoment {
  const t = new Date(at.getTime() + BEIJING_OFFSET_MS);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  const hh = t.getUTCHours();
  const mm = t.getUTCMinutes();
  return {
    date: `${y}-${m}-${d}`,
    minutes: hh * 60 + mm,
    clock: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
  };
}

/** `HH:mm` → 当日分钟数。非法输入返回 0（调用方应先用 `isClockTime` 校验） */
export function clockToMinutes(clock: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((clock ?? '').trim());
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return 0;
  return h * 60 + min;
}

/**
 * `YYYY-MM-DD` → 自纪元以来的**天数**（UTC 归一化）。
 *
 * ★ 用"天数差"而不是"毫秒差 / 86400000"：
 *   后者在跨夏令时的时区会得到非整数（23 或 25 小时的一天），
 *   取整方向一错就差一天。这里把日期本身当作 UTC 零点再除，是精确的。
 */
export function isoDateToDayNumber(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((isoDate ?? '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const t = new Date(ms);
  // 反查一遍，挡住 2026-02-31 这类"格式对但日期不存在"的输入
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return Math.floor(ms / DAY_MS);
}

/**
 * 算某一天是哪个班次。
 *
 * `cycle = ((今天 - 锚点) mod 周期长度 + 周期长度) mod 周期长度`
 * ★ 两层 mod：JS 的 `%` 对负数返回负数（锚点在未来的日期会得到负值），
 *   加一次周期长度再 mod 才能保证落在 `[0, len)`。
 */
export function shiftOfDate(isoDate: string, rule: ScheduleRule | undefined): ShiftName | null {
  if (!rule || rule.cycle.length === 0) return null;
  const today = isoDateToDayNumber(isoDate);
  const anchor = isoDateToDayNumber(rule.anchorDate);
  if (today === null || anchor === null) return null;
  const len = rule.cycle.length;
  const idx = (((today - anchor) % len) + len) % len;
  return rule.cycle[idx] ?? null;
}

/**
 * 判断某分钟是否落在时间窗内。
 *
 * ★ 跨午夜要单独处理：「23:00–07:59」这种窗 `from > to`，
 *   它表示的是"从 23:00 到次日 07:59"，判定条件是 `now >= from || now < to`，
 *   而不是常规的 `from <= now < to`（那样恒为假，静默会完全失效）。
 */
export function isMinuteInWindow(minutes: number, window: TimeWindow | undefined): boolean {
  if (!window) return false;
  const from = clockToMinutes(window.from);
  const to = clockToMinutes(window.to);
  if (from === to) return true; // 同值视为"全天"
  if (from < to) return minutes >= from && minutes < to;
  // 跨午夜
  return minutes >= from || minutes < to;
}

/** 现在是否处于「绝对静默」时段（内置欣然：23:00–07:59） */
export function isQuietNow(pack: WorldPack | undefined, at: Date = new Date()): boolean {
  if (!pack?.rhythm.quietHours) return false;
  return isMinuteInWindow(beijingNow(at).minutes, pack.rhythm.quietHours);
}

/**
 * 现在是否在"该班次的活跃时段"内。
 *
 * ★ 语义：按**今天的班次**取对应的活跃窗。
 *   取不到（没配 schedule、或该班次没有活跃窗定义）时返回 `true` ——
 *   即"没有规则就不拦"。理由：宁可多发一条，也不要在用户没配规则时把主动消息全掐掉
 *   （那会表现为"功能坏了"）。
 */
export function isActiveNow(pack: WorldPack | undefined, at: Date = new Date()): boolean {
  const windows = pack?.rhythm.activeHours;
  if (!windows) return true;
  const moment = beijingNow(at);
  const shift = shiftOfDate(moment.date, pack?.schedule);
  if (!shift) return true;
  const window = windows[shift];
  if (!window) return true;
  return isMinuteInWindow(moment.minutes, window);
}

/** 概率门判定结果（`reason` 用于日志与开发者页，不做静默丢弃） */
export interface GateResult {
  allowed: boolean;
  reason: 'ok' | 'quietHours' | 'inactiveShift' | 'gateRoll' | 'noWorld';
  /** 命中的班次（便于日志展示） */
  shift?: ShiftName | null;
  /** 概率门的阈值与掷出的点数（便于排查"为什么没发"） */
  roll?: { value: number; threshold: number };
}

/**
 * 主动消息的总闸门：**静默 → 活跃 → 概率**，三关全过才允许。
 *
 * ★ 顺序不是随意的：便宜的判定放前面（先算时段，不必掷骰子），
 *   而且日志里能明确区分"因为深夜静默被拦"和"运气不好没过门" ——
 *   这两件事对用户的意义完全不同（前者是设计，后者是概率）。
 *
 * ★ `rng` 可注入（默认 `Math.random`）：测试里传一个固定序列就能
 *   断言"阈值 60 时，掷出 59 应被拦、掷出 60 应放行"。
 */
export function evaluateWorldGate(
  pack: WorldPack | undefined,
  at: Date = new Date(),
  rng: () => number = Math.random,
): GateResult {
  if (!pack) return { allowed: true, reason: 'noWorld' };

  const moment = beijingNow(at);
  const shift = shiftOfDate(moment.date, pack.schedule);

  if (isQuietNow(pack, at)) return { allowed: false, reason: 'quietHours', shift };
  if (!isActiveNow(pack, at)) return { allowed: false, reason: 'inactiveShift', shift };

  const threshold = pack.rhythm.gate?.threshold;
  if (typeof threshold === 'number') {
    // 掷 0–99 的整数，与源设定的"随机数 ≥ 60"同口径（0-100 区间描述）
    const value = Math.floor(rng() * 100);
    if (value < threshold) return { allowed: false, reason: 'gateRoll', shift, roll: { value, threshold } };
    return { allowed: true, reason: 'ok', shift, roll: { value, threshold } };
  }

  return { allowed: true, reason: 'ok', shift };
}

/**
 * 把世界作息渲染成一段**给人/给模型看的**简短说明。
 *
 * ★ 用途：写进提示词的 `timeSegment` 附近，让她**知道今天自己上什么班**。
 *   光有计算不够 —— 计算影响的是"发不发消息"，
 *   而她聊天时也需要知道自己"刚下夜班"或"今天休息"才能说对内容。
 */
export function describeShift(
  pack: WorldPack | undefined,
  at: Date = new Date(),
): string | null {
  if (!pack?.schedule) return null;
  const moment = beijingNow(at);
  const shift = shiftOfDate(moment.date, pack.schedule);
  if (!shift) return null;
  const len = pack.schedule.cycle.length;
  const today = isoDateToDayNumber(moment.date);
  const anchor = isoDateToDayNumber(pack.schedule.anchorDate);
  const idx = today !== null && anchor !== null ? (((today - anchor) % len) + len) % len : 0;
  return `今天是 ${moment.date}（北京 ${moment.clock}），她的班次：${shift}（本周期第 ${idx + 1}/${len} 天）。`;
}
