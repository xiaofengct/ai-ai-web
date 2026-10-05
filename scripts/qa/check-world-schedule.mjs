#!/usr/bin/env node
/**
 * 世界作息计算的断言测试（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么这类代码必须测
 * ═══════════════════════════════════════════════════════════════════════════
 * 排班是"锚点 + 周期"的取模运算，三种错法**都不会报错、只会悄悄算错**：
 *   ① 负数取模：锚点之后的日期正常，锚点**之前**的日期会得到负索引
 *      （JS 的 `-1 % 5 === -1`，直接当数组下标就是 undefined）；
 *   ② 跨午夜时段：`23:00–08:00` 用常规 `from <= x < to` 判定**恒为假** ⇒
 *      深夜静默完全失效，而且没人会发现（表现为"有时候半夜还发消息"）；
 *   ③ 时区：用设备本地时区，在非 UTC+8 的设备上整体偏移一天。
 * 三种都属于"看起来对、实际错"，所以每个都单独断言。
 *
 * ★ 时区那一条尤其重要：本机就在 UTC+8，**本地时区与北京时间恰好一致** ——
 *   也就是说"用错时区"的实现在这台机器上**测不出来**。
 *   所以这里用构造 UTC 时刻的方式断言，而不是依赖本机时区。
 *
 * 用法：npx tsx scripts/qa/check-world-schedule.mjs
 */
import {
  beijingNow,
  clockToMinutes,
  describeShift,
  evaluateWorldGate,
  isActiveNow,
  isMinuteInWindow,
  isQuietNow,
  isoDateToDayNumber,
  shiftOfDate,
} from '@/world/schedule';

/**
 * ★ 本文件是 `.mjs`，**不能写 TS 专有语法**（`import type` / 类型标注会直接被
 *   Node 的 ESM 解析器拒掉 —— 踩过一次：「SyntaxError: Unexpected token '{'」）。
 *   tsx 只负责把**被导入的 `.ts` 模块**编译好，不会把 `.mjs` 当 TS 解析。
 *   ⇒ 类型在这里只作为注释存在，断言靠运行期取值。
 */

let failed = 0;

function eq(name, actual, expected) {
  const ok = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`);
  if (!ok) console.log(`      \x1b[31m实际 ${JSON.stringify(actual)}  期望 ${JSON.stringify(expected)}\x1b[0m`);
}

/** 内置欣然的世界包（本测试用的最小版，周期照 virtual-world.md） */
const PACK = {
  version: 1,
  source: { kind: 'builtin', name: 'test' },
  rhythm: {
    quietHours: { from: '23:00', to: '08:00' },
    activeHours: {
      白班: { from: '09:00', to: '21:00' },
      夜班: { from: '21:00', to: '08:00' },
      休息: { from: '08:00', to: '23:00' },
    },
    gate: { threshold: 60 },
  },
  schedule: {
    anchorDate: '2026-09-05',
    cycle: ['白班', '夜班', '休息', '休息', '休息'],
  },
  entries: [],
  report: { recognized: [], textOnly: [], warnings: [] },
};

console.log('\n═══ 世界作息计算 ═══\n');

/* ─────────── ① 排班：锚点 + 周期 ─────────── */
console.log('① 排班计算（周期 [白班,夜班,休息,休息,休息]，锚点 2026-09-05）');
const EXPECT = [
  ['2026-09-05', '白班', '锚点当天'],
  ['2026-09-06', '夜班', '锚点 +1'],
  ['2026-09-07', '休息', '锚点 +2'],
  ['2026-09-08', '休息', '锚点 +3'],
  ['2026-09-09', '休息', '锚点 +4'],
  ['2026-09-10', '白班', '★ 周期回卷（第 6 天）'],
  ['2026-09-11', '夜班', '回卷 +1'],
  ['2026-09-15', '白班', '第 11 天 → 又一个周期起点'],
  ['2026-10-05', '白班', '一个月后仍是白班（30 % 5 = 0）'],
  ['2026-10-06', '夜班', '一个月后 +1'],
];
for (const [date, want, why] of EXPECT) {
  eq(`${date} → ${want}   （${why}）`, shiftOfDate(date, PACK.schedule), want);
}

console.log('\n①′ 锚点**之前**的日期（负数取模的坑）');
/*
 * ★ 这里我第一次把期望值写错了，是**测试**错了不是实现错了 —— 记一笔。
 *   从锚点（09-05 = idx0 白班）往回推，索引是递减的：
 *     09-05 → idx0 白班
 *     09-04 → idx4 休息
 *     09-03 → idx3 休息
 *     09-02 → idx2 休息   ← 我一开始误写成「夜班」
 *     09-01 → idx1 夜班   ← 我一开始误写成「白班」
 *     08-31 → idx0 白班
 *   直觉容易把"往前推"当成"正向周期的镜像"，但取模是**循环**不是**反转**。
 */
eq('2026-09-04 → 休息（锚点前一天，不应是 undefined）', shiftOfDate('2026-09-04', PACK.schedule), '休息');
eq('2026-09-03 → 休息', shiftOfDate('2026-09-03', PACK.schedule), '休息');
eq('2026-09-02 → 休息', shiftOfDate('2026-09-02', PACK.schedule), '休息');
eq('2026-09-01 → 夜班（锚点前 4 天）', shiftOfDate('2026-09-01', PACK.schedule), '夜班');
eq('2026-08-31 → 白班（锚点前 5 天 = 又一周起点）', shiftOfDate('2026-08-31', PACK.schedule), '白班');
eq('非法日期 → null（不抛错）', shiftOfDate('2026-02-31', PACK.schedule), null);
eq('无 schedule → null', shiftOfDate('2026-09-05', undefined), null);

/* ─────────── ② 日期换算 ─────────── */
console.log('\n② 日期 → 天数（跨月/跨年）');
eq('2026-09-05 有值', typeof isoDateToDayNumber('2026-09-05'), 'number');
eq('2026-09-06 比 2026-09-05 大 1', isoDateToDayNumber('2026-09-06') - isoDateToDayNumber('2026-09-05'), 1);
eq('跨年：2027-01-01 − 2026-12-31 = 1', isoDateToDayNumber('2027-01-01') - isoDateToDayNumber('2026-12-31'), 1);
eq('不存在的日期 → null', isoDateToDayNumber('2026-13-01'), null);

/* ─────────── ③ 时段窗口（含跨午夜） ─────────── */
console.log('\n③ 时段窗口判定');
eq('clockToMinutes("23:00") = 1380', clockToMinutes('23:00'), 1380);
eq('clockToMinutes("00:00") = 0', clockToMinutes('00:00'), 0);

const QUIET = { from: '23:00', to: '08:00' };
const NIGHT_WINDOW = { from: '21:00', to: '08:00' };
const DAY_WINDOW = { from: '09:00', to: '21:00' };

// ★ 跨午夜：这是最容易写错的一处。用 `from <= x < to` 会恒为假。
eq('22:59 不在静默（跨午夜窗口的左外侧）', isMinuteInWindow(clockToMinutes('22:59'), QUIET), false);
eq('23:00 在静默（进入）', isMinuteInWindow(clockToMinutes('23:00'), QUIET), true);
eq('23:59 在静默', isMinuteInWindow(clockToMinutes('23:59'), QUIET), true);
eq('00:00 在静默（跨到次日了）', isMinuteInWindow(clockToMinutes('00:00'), QUIET), true);
eq('03:00 在静默', isMinuteInWindow(clockToMinutes('03:00'), QUIET), true);
eq('07:59 在静默', isMinuteInWindow(clockToMinutes('07:59'), QUIET), true);
eq('08:00 不在静默（右端点开区间，恢复活跃）', isMinuteInWindow(clockToMinutes('08:00'), QUIET), false);
eq('12:00 不在静默', isMinuteInWindow(clockToMinutes('12:00'), QUIET), false);

// 不跨午夜的普通窗口
eq('08:59 不在白班窗', isMinuteInWindow(clockToMinutes('08:59'), DAY_WINDOW), false);
eq('09:00 在白班窗', isMinuteInWindow(clockToMinutes('09:00'), DAY_WINDOW), true);
eq('20:59 在白班窗', isMinuteInWindow(clockToMinutes('20:59'), DAY_WINDOW), true);
eq('21:00 不在白班窗', isMinuteInWindow(clockToMinutes('21:00'), DAY_WINDOW), false);

/* ─────────── ④ 北京时间（不随设备时区） ─────────── */
console.log('\n④ 北京时间换算（★ 本机就在 UTC+8，所以必须用构造的 UTC 时刻来测）');
// 2026-09-05T16:30:00Z → 北京 2026-09-06 00:30
const m1 = beijingNow(new Date('2026-09-05T16:30:00Z'));
eq('UTC 16:30 → 北京日期 2026-09-06', m1.date, '2026-09-06');
eq('UTC 16:30 → 北京时刻 00:30', m1.clock, '00:30');
// 2026-09-05T15:59:00Z → 北京 2026-09-05 23:59（★ 与上一例同一天，但北京日期不同）
const m2 = beijingNow(new Date('2026-09-05T15:59:00Z'));
eq('UTC 15:59 → 北京日期 2026-09-05', m2.date, '2026-09-05');
eq('UTC 15:59 → 北京时刻 23:59', m2.clock, '23:59');
// 跨日边界：北京 00:00 = UTC 前一日 16:00
eq('北京时间跨日边界正确', beijingNow(new Date('2026-09-05T16:00:00Z')).date, '2026-09-06');

/* ─────────── ⑤ 静默 / 活跃 ─────────── */
console.log('\n⑤ 是否静默 / 是否在活跃时段（用北京时刻构造）');
// 休息日 2026-09-07：活跃 08:00–23:00
const restMorning = new Date('2026-09-07T02:00:00Z'); // 北京 10:00
eq('休息日 10:00 不静默', isQuietNow(PACK, restMorning), false);
eq('休息日 10:00 在活跃时段', isActiveNow(PACK, restMorning), true);
// 北京 23:30（09-06 夜班日）
const lateNight = new Date('2026-09-06T15:30:00Z');
eq('北京 23:30 静默', isQuietNow(PACK, lateNight), true);
// 夜班日 2026-09-06 北京 10:00 → 夜班活跃窗是 21:00–08:00，10:00 不在内
const nightShiftMorning = new Date('2026-09-06T02:00:00Z');
eq('夜班日 10:00 不在夜班活跃窗', isActiveNow(PACK, nightShiftMorning), false);
// 夜班日 北京 22:00 → 在夜班活跃窗
eq('夜班日 22:00 在夜班活跃窗', isActiveNow(PACK, new Date('2026-09-06T14:00:00Z')), true);

/* ─────────── ⑥ 概率门 ─────────── */
console.log('\n⑥ 概率门（阈值 60：随机数 ≥ 60 才发）');
// 休息日 10:00（非静默 + 活跃），打不同点数
const okTime = new Date('2026-09-07T02:00:00Z');
eq('掷 59 → 拦下', evaluateWorldGate(PACK, okTime, () => 0.59).allowed, false);
eq('掷 59 的 reason = gateRoll', evaluateWorldGate(PACK, okTime, () => 0.59).reason, 'gateRoll');
eq('掷 60 → 放行', evaluateWorldGate(PACK, okTime, () => 0.6).allowed, true);
eq('掷 99 → 放行', evaluateWorldGate(PACK, okTime, () => 0.99).allowed, true);
eq('掷 0 → 拦下', evaluateWorldGate(PACK, okTime, () => 0).allowed, false);
// 静默期优先于概率门（即便掷出 99 也不能发）
eq('静默期即便掷 99 也拦下', evaluateWorldGate(PACK, lateNight, () => 0.99).reason, 'quietHours');
// 非活跃班次也拦
eq('夜班日 10:00 即便掷 99 也拦下', evaluateWorldGate(PACK, nightShiftMorning, () => 0.99).reason, 'inactiveShift');
// 没有世界包 → 不拦（保持旧行为，避免用户没配世界时功能失效）
eq('无世界包 → 放行', evaluateWorldGate(undefined, okTime, () => 0).allowed, true);
eq('无世界包 → reason = noWorld', evaluateWorldGate(undefined, okTime, () => 0).reason, 'noWorld');

/* ─────────── ⑦ 给模型看的班次说明 ─────────── */
console.log('\n⑦ 班次说明文本（她会知道今天自己上什么班）');
const desc = describeShift(PACK, new Date('2026-09-06T02:00:00Z'));
eq('含日期', desc?.includes('2026-09-06'), true);
eq('含班次', desc?.includes('夜班'), true);
eq('含本周期第几天', desc?.includes('2/5'), true);
eq('无 schedule → null', describeShift({ ...PACK, schedule: undefined }), null);

console.log(`\n═══ ${failed === 0 ? '\x1b[32m全部通过 ✓' : `\x1b[31m${failed} 项失败`}\x1b[0m ═══\n`);
process.exit(failed === 0 ? 0 : 1);
