#!/usr/bin/env node
/**
 * 世界文档解析器识别测试（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么用**真实文件**而不是手造样本
 * ═══════════════════════════════════════════════════════════════════════════
 * 用户的要求里有四个字是重点：**正确识别**。
 * 手造样本只能证明"我写的正则能跑通我自己造的句子"，
 * 证明不了它能读懂**用户真实那份文档**。
 *
 * 所以这里的样本直接取自用户给的 `欣然.skill.zip`：
 *   - `virtual-world.md`（世界设定主文档）
 *   - `SKILL.md`（同一套设定的另一种写法 + 活跃时段/概率门）
 * 两者写法**完全不同**（一个用「白班一天 → 夜班一天 → 休息三天」，
 * 另一个用「cycle == 1 → 白班」），正好覆盖两条识别路径。
 *
 * ★ 断言的是**具体值**（锚点日期、周期数组、时段），不是"识别到了什么"。
 *   后者太弱 —— 识别出一个错的锚点也能算"识别到了"。
 *
 * 用法：npx tsx scripts/qa/check-world-parse.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadWorldFromText, parseWorldDoc } from '@/world/parseWorldDoc';
import { clockToMinutes, isMinuteInWindow, shiftOfDate } from '@/world/schedule';

let failed = 0;

function eq(name, actual, expected) {
  const ok = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`);
  if (!ok) console.log(`      \x1b[31m实际 ${JSON.stringify(actual)}\n      期望 ${JSON.stringify(expected)}\x1b[0m`);
}
function ge(name, actual, min) {
  const ok = typeof actual === 'number' && actual >= min;
  if (!ok) failed += 1;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`);
  if (!ok) console.log(`      \x1b[31m实际 ${JSON.stringify(actual)}，期望 >= ${min}\x1b[0m`);
}

const FIX = path.join(process.cwd(), 'scripts', 'qa', 'fixtures', 'world');
/*
 * ★ 私有素材的**优雅降级**读取（与 `check-world-drift.mjs` 同一约定）：
 *   文件缺失 ⇒ 返回 null（由调用处打印说明后跳过相应断言），**不抛异常**。
 *   判据沿用本项目已确立的：**「跳过 ≠ 失败，但必须打印」**。
 */
const readMaybe = (f) => {
  try {
    return readFileSync(path.join(FIX, f), 'utf8');
  } catch {
    return null;
  }
};

/*
 * ★ 私有原始文档的**优雅降级**（与 `check-world-drift.mjs` 同一约定）：
 *   素材缺失 ⇒ 打印说明 + 跳过（exit 0）。判据：**跳过 ≠ 失败，但必须打印**。
 *   （此前用硬 `read` ⇒ 发布副本无素材时 `ENOENT` 崩溃、退出码 1。）
 */
const vwRaw = readMaybe('virtual-world.md');
const skillRaw = readMaybe('SKILL.md');
if (vwRaw === null || skillRaw === null) {
  console.log('\n═══ 世界文档解析（用真实文件） ═══\n');
  console.log('  \x1b[33m⚠️ 跳过：私有原始文档素材未提供\x1b[0m');
  console.log(`     期望位置：${FIX}`);
  console.log('     需要的文件：virtual-world.md、SKILL.md');
  console.log('  \x1b[90m（该素材含真实私人内容，已故意不入库；本地保留即可跑完整解析测试）\x1b[0m\n');
  console.log('  → 本次**未执行任何解析断言**，"通过"不代表已验证。\n');
  process.exit(0);
}

console.log('\n═══ 世界文档解析（用真实文件） ═══\n');

/* ═══════════════ ① virtual-world.md ═══════════════ */
console.log('① virtual-world.md（用户的真实世界设定）');
const vw = vwRaw;
const p1 = parseWorldDoc(vw, { fileName: 'virtual-world.md' });

eq('识别到排班锚点 = 2026-09-05', p1.schedule?.anchorDate, '2026-09-05');
eq(
  '★ 周期 = [白班,夜班,休息,休息,休息]（休息三天的「三」要展开成 3 个，否则班次整体错位）',
  p1.schedule?.cycle,
  ['白班', '夜班', '休息', '休息', '休息'],
);
eq('周期长度 = 5', p1.schedule?.cycle.length, 5);
// 用真实解析出的规则反推班次，确认端到端可用
eq('用解析出的规则算 2026-09-05 → 白班', shiftOfDate('2026-09-05', p1.schedule), '白班');
eq('用解析出的规则算 2026-09-06 → 夜班', shiftOfDate('2026-09-06', p1.schedule), '夜班');
eq('用解析出的规则算 2026-09-07 → 休息', shiftOfDate('2026-09-07', p1.schedule), '休息');
eq('用解析出的规则算 2026-09-10 → 白班（回卷）', shiftOfDate('2026-09-10', p1.schedule), '白班');

eq('识别到深夜静默 23:00', p1.rhythm.quietHours?.from, '23:00');
/*
 * ★ 期望值是 `08:00` 而不是文档字面写的 `07:59` —— 这是**有意的语义归一化**。
 *   时间窗是半开区间 `[from, to)`，文档写「23:00–07:59 静默」的意图是
 *   "到 08:00 恢复"，所以 `:59` 被翻译成下一个整点。
 *   照抄 07:59 会导致**07:59 那一分钟不静默**，且与内置包（写 08:00）对不上。
 *   详见 `parseWorldDoc.ts` 的 `normalizeWindowEnd`。
 */
eq('深夜静默右端点归一化为 08:00（文档字面是 07:59，:59 视为下一个整点）', p1.rhythm.quietHours?.to, '08:00');
eq('07:59 确实落在静默窗内（验证归一化的目的达成）', isMinuteInWindow(clockToMinutes('07:59'), p1.rhythm.quietHours), true);

ge('切出世界书条目（>= 8 条）', p1.entries.length, 8);
const vwResident = p1.entries.filter((e) => e.keys.length === 0).map((e) => e.comment);
eq(
  '「时间系统」是常驻条目（不靠关键词触发）',
  vwResident.some((t) => t.includes('时间系统')),
  true,
);
eq(
  '「工作节奏」是常驻条目',
  vwResident.some((t) => t.includes('工作节奏')),
  true,
);
// 地图相关：注意 `## 虚拟世界地图` 自身正文为空（内容全在 `###` 子节里），
// 所以它以子节的形式成为条目 —— 断言要打在**有正文的子节**上，不是父标题。
/*
 * ★★ 期望出现的**真实专名**（常去城市 / 朋友名）从**不入库**的私有清单读（2026-10-05 隐私脱敏）。
 *
 * 为什么：本脚本会公开，把真实城市名 / 朋友名当**期望值**内联，等于把隐私内容
 *   又复制一份到脚本里（与发布闸门里硬编码台标是同一类缺陷）。
 * 怎么处理：读 `private-facts.json` 的 `worldKeys`（与 `check-world-drift.mjs` 共用同一份清单）。
 * 缺失时的行为：**跳过这两条断言并打印说明**（跳过 ≠ 失败，但必须打印）——
 *   静默跳过会让它们看起来通过，实际没验。
 */
const privateRaw = readMaybe('private-facts.json');
let mapCityKeys = null;
let friendNameKeys = null;
if (privateRaw !== null) {
  try {
    const wk = JSON.parse(privateRaw)?.worldKeys;
    if (Array.isArray(wk?.mapCities)) mapCityKeys = wk.mapCities;
    if (Array.isArray(wk?.friendNames)) friendNameKeys = wk.friendNames;
  } catch (e) {
    console.log(`     \x1b[33m⚠️ private-facts.json 解析失败，含真实专名的断言将跳过：${e.message}\x1b[0m`);
  }
} else {
  console.log('     \x1b[33m⚠️ 未提供 private-facts.json ⇒ 含真实城市名 / 朋友名的关键词断言未执行\x1b[0m');
  console.log('     \x1b[90m（这两条"通过"不代表已验证；本地保留私有素材即可跑全）\x1b[0m');
}

const mapEntry = p1.entries.find((e) => e.comment?.includes('休息日常去'));
eq('「休息日常去」是关键词触发（keys 非空）', (mapEntry?.keys.length ?? 0) > 0, true);
if (mapCityKeys) {
  eq(
    '★ 关键词抓到了正文里的城市名（靠加粗专名提取，不是靠标题猜）',
    mapCityKeys.every((c) => mapEntry?.keys.includes(c)),
    true,
  );
}
console.log(`     （地图条目 keys：${JSON.stringify(mapEntry?.keys)}）`);

const socialEntry = p1.entries.find((e) => e.comment?.includes('社交圈'));
if (friendNameKeys) {
  eq(
    '★ 朋友圈条目的关键词包含全部朋友名',
    friendNameKeys.every((n) => socialEntry?.keys.includes(n)),
    true,
  );
}
console.log(`     （朋友圈条目 keys：${JSON.stringify(socialEntry?.keys)}）`);

const homeEntry = p1.entries.find((e) => e.comment?.includes('主场'));
eq('「主场」条目存在且为关键词触发', (homeEntry?.keys.length ?? 0) > 0, true);
console.log(`     （主场条目 keys：${JSON.stringify(homeEntry?.keys)}）`);

console.log(`     识别报告 recognized：`);
for (const r of p1.report.recognized) console.log(`       · ${r}`);
if (p1.report.warnings.length) {
  console.log(`     识别报告 warnings：`);
  for (const w of p1.report.warnings) console.log(`       · ${w}`);
}

/* ═══════════════ ② SKILL.md ═══════════════ */
console.log('\n② SKILL.md（同一套设定的另一种写法 —— 走 cycle==N 那条路径）');
const skill = skillRaw;
const p2 = parseWorldDoc(skill, { fileName: 'SKILL.md' });

eq('识别到锚点 = 2026-09-05', p2.schedule?.anchorDate, '2026-09-05');
eq(
  '识别出周期（写法是 cycle == 1/2/∈{3,4,5}）',
  p2.schedule?.cycle,
  ['白班', '夜班', '休息', '休息', '休息'],
);
eq('静默时段 23:00–08:00（同上的 :59 归一化）', [p2.rhythm.quietHours?.from, p2.rhythm.quietHours?.to], ['23:00', '08:00']);
eq('识别到活跃时段：白班 09–21', p2.rhythm.activeHours?.白班, { from: '09:00', to: '21:00' });
eq('识别到活跃时段：夜班 21–08', p2.rhythm.activeHours?.夜班, { from: '21:00', to: '08:00' });
eq('识别到活跃时段：休息 08–23', p2.rhythm.activeHours?.休息, { from: '08:00', to: '23:00' });
eq('识别到概率门 = 30（SKILL.md 写的是 ≥30）', p2.rhythm.gate?.threshold, 30);

/**
 * ★ 关键：把两份**写法完全不同**的文件喂进去，结构化结果必须一致。
 *   这才是"正确识别"的真正含义 —— 识别结果不该取决于用户抄的是哪一份。
 */
console.log('\n③ 两份写法不同的文件，结构化结果应完全一致');
eq('锚点一致', p2.schedule?.anchorDate, p1.schedule?.anchorDate);
eq('周期一致', p2.schedule?.cycle, p1.schedule?.cycle);
eq('静默一致', p2.rhythm.quietHours, p1.rhythm.quietHours);
eq('排班算出的班次一致', shiftOfDate('2026-09-15', p2.schedule), shiftOfDate('2026-09-15', p1.schedule));

/* ═══════════════ ④ 矛盾检测（★ 必须报告，不能默默选一个） ═══════════════ */
console.log('\n④ 设定矛盾要被报出来（SKILL.md 写 ≥30，virtual-world.md 写 ≥60）');
const p3 = parseWorldDoc(vw, { fileName: 'virtual-world.md' });
eq('virtual-world.md 的概率门 = 60', p3.rhythm.gate?.threshold, 60);
// 把两份拼起来喂，模拟"用户把两份都塞进一个文件"
const merged = `${vw}\n\n${skill}`;
const p4 = parseWorldDoc(merged, { fileName: 'merged.md' });
eq(
  '两份合并时能发现"有多个不同阈值"',
  p4.report.warnings.some((w) => w.includes('多个不同的概率门阈值')),
  true,
);
eq('合并时取更保守的（更大）阈值 = 60', p4.rhythm.gate?.threshold, 60);
console.log(`     warning 原文：${p4.report.warnings.find((w) => w.includes('概率门')) ?? '(无)'}`);

/* ═══════════════ ⑤ 边界：不该识别错 ═══════════════ */
console.log('\n⑤ 边界情况（宁可少识别，不可错识别）');
// 日期不应被误认为时间区间
const p5 = parseWorldDoc('# 随便\n- 今天 2026-09-05 天气不错\n', { fileName: 'x.md' });
eq('无锚点关键词 → 不抽排班', p5.schedule, undefined);
eq('无静默关键词 → 不抽静默', p5.rhythm.quietHours, undefined);
eq('无随机数关键词 → 不抽概率门', p5.rhythm.gate, undefined);

// 锚点与周期首日矛盾时，应放弃抽排班（宁可不算，不要算错）
const contradictory = `
### 排班
- 锚点：**2026-09-05 ＝ 白班**
- 电视台排班：**夜班一天 → 白班一天 → 休息三天**
`;
const p6 = parseWorldDoc(contradictory, { fileName: 'c.md' });
eq('锚点说白班、周期首日却是夜班 → 拒绝抽取（避免算错）', p6.schedule, undefined);
eq('并给出 warning', p6.report.warnings.some((w) => w.includes('排班')), true);

// 空文件 / 垃圾文件不能抛错
const p7 = parseWorldDoc('', { fileName: 'empty.md' });
eq('空文件 → 有 warning 不抛错', p7.report.warnings.length > 0, true);
eq('空文件 → entries 为空', p7.entries.length, 0);

/* ═══════════════ ⑥ JSON 与 markdown 两条入口 ═══════════════ */
console.log('\n⑥ 两条入口：先当 JSON，不是再当 markdown');
const jsonRound = JSON.stringify(p1);
const p8 = loadWorldFromText(jsonRound, 'world.json');
eq('JSON 入口 → 锚点保留', p8.schedule?.anchorDate, '2026-09-05');
eq('JSON 入口 → 周期保留', p8.schedule?.cycle, p1.schedule?.cycle);
eq('JSON 入口 → 条目数保留', p8.entries.length, p1.entries.length);
eq('JSON 入口 → source.kind = imported', p8.source.kind, 'imported');

const p9 = loadWorldFromText(vw, 'virtual-world.md');
eq('markdown 入口 → 锚点保留', p9.schedule?.anchorDate, '2026-09-05');
eq('markdown 入口 → 条目数保留', p9.entries.length, p1.entries.length);

// ★ 顺序不能反：markdown 解析器对任何文本都返回结果，先跑它会把 JSON 当成无标题长文
const p10 = loadWorldFromText('{"version":1,"rhythm":{},"entries":[]}', 'j.json');
eq('合法 JSON 不会被当成 markdown（否则排班全丢）', Array.isArray(p10.entries), true);
eq('合法 JSON 走 JSON 分支（entries 为空数组，而非被切成一整篇）', p10.entries.length, 0);

console.log(`\n═══ ${failed === 0 ? '\x1b[32m全部通过 ✓' : `\x1b[31m${failed} 项失败`}\x1b[0m ═══\n`);
process.exit(failed === 0 ? 0 : 1);
