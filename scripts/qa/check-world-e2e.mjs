#!/usr/bin/env node
/**
 * 世界设定「导入 → 识别 → 加载 → 生效」端到端测试（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这个测试在验什么
 * ═══════════════════════════════════════════════════════════════════════════
 * 用户的原话里有四个字是关键：**确保导入后能被正确识别和加载**。
 * 前面三个测试分别覆盖了：
 *   · 排班计算对不对（check-world-schedule）
 *   · 文档能不能被读懂（check-world-parse）
 *   · 内置包有没有漂移（check-world-drift）
 * 但**没有一个**在验"走完导入那一刻之后，设定是不是真的生效了"。
 *
 * ⇒ 本测试走完整链路，终点是"**主动消息的闸门真的被世界设定拦住**" ——
 *   即：导入一份世界 → 它写进了角色卡 → 排班算得出班次 → 世界书条目进了书
 *   → 到了深夜/非活跃班次时主动消息确实不发。
 *
 * ★ 终点为什么选"主动消息闸门"而不是"字段存在"：
 *   字段存在只能证明"存进去了"，证明不了"用上了"。
 *   本项目已经吃过这个亏（`migrate` 写了却没被调用，
 *   注释写着"必须走 migrateSettings"，实际根本没执行 —— 见 docs/13）。
 *   所以断言必须打在**消费端的行为**上。
 *
 * ★ 用真实文件：导入的就是用户 `欣然.skill.zip` 里的 `virtual-world.md`。
 *
 * 用法：npx tsx scripts/qa/check-world-e2e.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createXinranCard } from '@/persona/xinranCard';
import { applyWorldToCard, worldOfCard, describeWorldPack } from '@/world/cardWorld';
import { loadWorldFromText } from '@/world/parseWorldDoc';
import { XINRAN_WORLD } from '@/world/builtinWorlds';
import { isMinuteInWindow, shiftOfDate, clockToMinutes } from '@/world/schedule';
import { evaluateProactiveGate } from '@/proactive/dynamic';
import { DEFAULT_CHAT_SETTINGS } from '@/constants/defaults';
import { BUILTIN_XINRAN } from '@/constants/buildMode';

let failed = 0;
function ok(name, cond, detail) {
  if (!cond) failed += 1;
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? `  ${detail}` : ''}`);
}
function eq(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  ok(name, pass, pass ? '' : `← 实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);
}

const FIX = path.join(process.cwd(), 'scripts', 'qa', 'fixtures', 'world');
/*
 * ★ 私有原始文档的**优雅降级**（与 `check-world-drift.mjs` / `check-world-parse.mjs` 同款约定）：
 *   素材缺失 ⇒ 打印说明 + 跳过 + `exit 0`。判据：**跳过 ≠ 失败，但必须打印**。
 *   （此前用硬 `readFileSync` ⇒ 发布副本无素材时 `ENOENT` 崩溃、退出码 1。）
 */
const readMaybe = (f) => {
  try {
    return readFileSync(path.join(FIX, f), 'utf8');
  } catch {
    return null;
  }
};
const realDoc = readMaybe('virtual-world.md');
const skillDoc = readMaybe('SKILL.md');
if (realDoc === null || skillDoc === null) {
  console.log('\n═══ 世界设定 导入 → 识别 → 加载 → 生效 ═══\n');
  console.log('  \x1b[33m⚠️ 跳过：私有原始文档素材未提供\x1b[0m');
  console.log(`     期望位置：${FIX}`);
  console.log('     需要的文件：virtual-world.md、SKILL.md');
  console.log('  \x1b[90m（该素材含真实私人内容，已故意不入库；本地保留即可跑完整端到端测试）\x1b[0m\n');
  console.log('  → 本次**未执行任何断言**，"通过"不代表已验证。\n');
  process.exit(0);
}

console.log('\n═══ 世界设定 导入 → 识别 → 加载 → 生效 ═══\n');

/* ═══════════ ① 内置版：卡里自带世界 ═══════════ */
console.log('① 内置版（内置欣然）：卡里应当自带世界');
ok('当前构建是内置版（BUILTIN_XINRAN=true）', BUILTIN_XINRAN === true, `实际 ${BUILTIN_XINRAN}`);
const builtinCard = createXinranCard();
const bw = worldOfCard(builtinCard);
ok('内置卡有世界包', Boolean(bw));
ok('来源标记为 builtin', bw?.source.kind === 'builtin');
eq('内置卡的世界 = 内置常量', bw?.schedule?.anchorDate, XINRAN_WORLD.schedule?.anchorDate);
ok('世界书条目已并进 character_book', (builtinCard.data.character_book?.entries.length ?? 0) > 0, `共 ${builtinCard.data.character_book?.entries.length} 条`);
ok('5 层人格没有被世界挤掉', (builtinCard.data.extensions)?.aiyuLayers?.length === 5);
ok('隐私红线仍在（noImage）', builtinCard.privacy?.noImage === true);

/* ═══════════ ② 不内置版：初始没有世界，导入后才有 ═══════════ */
console.log('\n② 不内置版路径：初始无世界 → 导入真实文档 → 生效');
// 模拟"不内置版用户导入一份自己的世界文档"
const imported = loadWorldFromText(realDoc, 'virtual-world.md');
ok('识别出排班', Boolean(imported.schedule));
eq('锚点正确', imported.schedule?.anchorDate, '2026-09-05');
eq('周期正确（休息三天展开为 3 个）', imported.schedule?.cycle, ['白班', '夜班', '休息', '休息', '休息']);
ok('识别出深夜静默', Boolean(imported.rhythm.quietHours));
ok('切出了世界书条目', imported.entries.length > 0, `共 ${imported.entries.length} 条`);

// 造一张"用户自己的角色卡"（不内置版用户导入角色卡后的状态）
const userCard = { ...createXinranCard(), id: 'user-imported-persona', isBuiltin: false, origin: 'external' };
const cleanCard = applyWorldToCard(userCard, null); // 先清干净，模拟"还没有世界"
ok('清空后确实没有世界', worldOfCard(cleanCard) === undefined);
ok('清空后世界书里没有世界条目', (cleanCard.data.character_book?.entries ?? []).every((e) => (e.extensions)?.aiyuWorld !== true));

// 导入
const withWorld = applyWorldToCard(cleanCard, imported);
const w2 = worldOfCard(withWorld);
ok('★ 导入后能读回世界包', Boolean(w2));
eq('★ 读回的锚点与导入的一致', w2?.schedule?.anchorDate, '2026-09-05');
eq('★ 读回的周期与导入的一致', w2?.schedule?.cycle, imported.schedule?.cycle);
eq('★ 世界书条目数一致', withWorld.data.character_book?.entries.length, imported.entries.length);
ok('source.kind 变成 imported', w2?.source.kind === 'imported');
ok('来源文件名被记住（便于用户认出来源）', w2?.source.name === 'virtual-world.md');

/* ═══════════ ③ 加载后：排班真的算得出 ═══════════ */
console.log('\n③ 加载后：用**卡里读回的**世界包算班次（不是用导入变量）');
eq('2026-09-05 → 白班', shiftOfDate('2026-09-05', w2?.schedule), '白班');
eq('2026-09-06 → 夜班', shiftOfDate('2026-09-06', w2?.schedule), '夜班');
eq('2026-09-07 → 休息', shiftOfDate('2026-09-07', w2?.schedule), '休息');
eq('2026-09-09 → 休息', shiftOfDate('2026-09-09', w2?.schedule), '休息');
eq('2026-09-10 → 白班（回卷）', shiftOfDate('2026-09-10', w2?.schedule), '白班');

/* ═══════════ ④ ★ 终点：世界设定真的影响了主动消息 ═══════════ */
console.log('\n④ ★ 终点：主动消息闸门被世界设定拦住（这才是"生效"）');
const baseChat = { ...DEFAULT_CHAT_SETTINGS, proactive: { ...DEFAULT_CHAT_SETTINGS.proactive, enabled: true, allDay: true, intervalMin: 1 } };
const gateInput = (world, at, rng) => ({
  chat: baseChat,
  minutesSinceLastProactive: 999, // 间隔足够久，排除 tooSoon
  idleStopped: false,
  visible: true,
  now: at,
  ...(world ? { world } : {}),
  ...(rng ? { rng } : {}),
});

// 深夜：北京 2026-09-06 23:30（= UTC 15:30）
const lateNight = new Date('2026-09-06T15:30:00Z');
{
  const r = evaluateProactiveGate(gateInput(w2, lateNight, () => 0.99));
  ok('★ 深夜 23:30 被拦（reason=worldQuietHours）', !r.allowed && r.reason === 'worldQuietHours', `reason=${r.reason}`);
}
// 夜班日的白天：北京 2026-09-06 10:00（= UTC 02:00）
const nightShiftDay = new Date('2026-09-06T02:00:00Z');
{
  /*
   * ★ 这里我第一版把期望写错成了"应被拦" —— 记一笔。
   *   实情：`virtual-world.md` **没有**写活跃时段（只有 `SKILL.md` 写了
   *   「白班 09–21、夜班在岗 21–08、休息日 08–23」）。
   *   所以用这份文档导入时，`activeHours` 不存在 ⇒ `isActiveNow` 按
   *   "没有规则就不拦"放行 ⇒ 白天**不该**被拦。
   *   这不是 bug，是"设定里没提这件事，就不替它做决定"。
   */
  const r = evaluateProactiveGate(gateInput(w2, nightShiftDay, () => 0.99));
  ok('virtual-world.md 没有活跃时段 ⇒ 白天不拦（无规则即不限制）', r.allowed, `reason=${r.reason}`);
  eq('  但班次仍被正确算出并带出', r.shift, '夜班');
}

// ★ 换成写了活跃时段的 SKILL.md：白天就该被拦
{
  const withHours = applyWorldToCard(cleanCard, loadWorldFromText(skillDoc, 'SKILL.md'));
  const wh = worldOfCard(withHours);
  ok('SKILL.md 能识别出活跃时段', Boolean(wh?.rhythm.activeHours));
  const r = evaluateProactiveGate(gateInput(wh, nightShiftDay, () => 0.99));
  ok('★ 有活跃时段时，夜班日的白天被拦（reason=worldInactiveShift）', !r.allowed && r.reason === 'worldInactiveShift', `reason=${r.reason}`);
  eq('  并报出当前班次', r.shift, '夜班');
  // 同一个世界，到了夜班活跃窗（北京 22:00）就应放行
  const inShift = evaluateProactiveGate(gateInput(wh, new Date('2026-09-06T14:00:00Z'), () => 0.99));
  ok('★ 同一个世界里，到了夜班活跃窗（22:00）→ 放行', inShift.allowed, `reason=${inShift.reason}`);
}
// 休息日的白天：北京 2026-09-07 10:00 → 休息日活跃窗 08:00–23:00，在内
const restDay = new Date('2026-09-07T02:00:00Z');
{
  const r50 = evaluateProactiveGate(gateInput(w2, restDay, () => 0.5)); // 掷 50 < 60
  ok('★ 休息日白天：过了时段但概率门没过（reason=worldGateRoll）', !r50.allowed && r50.reason === 'worldGateRoll', `reason=${r50.reason}`);
  eq('  报出掷点与阈值（便于回答"为什么这次没发"）', r50.roll, { value: 50, threshold: 60 });
  const r99 = evaluateProactiveGate(gateInput(w2, restDay, () => 0.99)); // 掷 99 >= 60
  ok('★ 休息日白天 + 概率门通过 → 放行', r99.allowed, `reason=${r99.reason}`);
  eq('  放行时也带上班次', r99.shift, '休息');
}

/* ═══════════ ⑤ 回归：没有世界时行为不变（不内置版未导入） ═══════════ */
console.log('\n⑤ 回归：没有世界的角色 → 行为与改动前一致（不被新规则影响）');
{
  const r = evaluateProactiveGate(gateInput(undefined, lateNight, () => 0.99));
  ok('★ 无世界包 → 深夜也放行（旧行为，未引入新约束）', r.allowed, `reason=${r.reason}`);
  eq('  reason = none', r.reason, 'none');
}

/* ═══════════ ⑥ 覆盖导入与清空 ═══════════ */
console.log('\n⑥ 覆盖导入 / 清空');
{
  // 覆盖：换一份只有静默、没有排班的世界
  const minimal = loadWorldFromText('# 时间\n- 深夜静默：22:00-06:00 不主动发消息\n', 'minimal.md');
  const replaced = applyWorldToCard(withWorld, minimal);
  eq('覆盖后静默变成新的 22:00', worldOfCard(replaced)?.rhythm.quietHours?.from, '22:00');
  eq('覆盖后没有排班了', worldOfCard(replaced)?.schedule, undefined);
  ok(
    '★ 覆盖时旧的世界书条目被摘干净（不留残留）',
    (replaced.data.character_book?.entries ?? []).filter((e) => (e.extensions)?.aiyuWorld === true).length === minimal.entries.length,
  );

  // 清空
  const cleared = applyWorldToCard(replaced, null);
  ok('清空后读不到世界', worldOfCard(cleared) === undefined);
  ok(
    '★ 清空后世界书里没有世界条目',
    (cleared.data.character_book?.entries ?? []).every((e) => (e.extensions)?.aiyuWorld !== true),
  );
  ok('清空不影响其它扩展（5 层人格仍在）', (cleared.data.extensions)?.aiyuLayers?.length === 5);
}

/* ═══════════ ⑦ 内置卡不能被"清空"掉世界（产品约束） ═══════════ */
console.log('\n⑦ 产品约束：内置世界的语义（界面不给删除按钮）');
ok('内置卡的世界来源是 builtin（界面据此隐藏删除按钮）', worldOfCard(builtinCard)?.source.kind === 'builtin');
ok('内置世界有排班（不是个空壳）', Boolean(worldOfCard(builtinCard)?.schedule));
console.log(`     内置世界摘要：${describeWorldPack(worldOfCard(builtinCard))}`);

console.log(`\n═══ ${failed === 0 ? '\x1b[32m全部通过 ✓' : `\x1b[31m${failed} 项失败`}\x1b[0m ═══\n`);
process.exit(failed === 0 ? 0 : 1);
