#!/usr/bin/env node
/**
 * 内置世界包 vs 用户原始文档 —— **对账测试**（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么需要"对账"
 * ═══════════════════════════════════════════════════════════════════════════
 * `builtinWorlds.ts` 是**手写常量**（理由见该文件头：关键功能不该依赖
 * "启动时解析用户风格文档"这种会失手的东西）。
 * 但"手写"有个必然的代价：**可能与原始文档漂移** ——
 * 文档改了锚点、这边忘了改，于是内置版算的班次全错，而且没人会发现。
 *
 * ⇒ 本测试把两者对起来：
 *   - **结构化参数**逐值比对（锚点、周期、活跃时段）；
 *   - **语义**比对跨端点的时段（不是字符串相等，见下）；
 *   - **事实覆盖**比对（内置包里必须真的写有这些关键事实）。
 *
 * ★ 为什么不用"字符串完全相等"对时段：
 *   源文档写 `23:00–07:59`，内置包写 `23:00–08:00`（半开区间的正确表达，
 *   见 builtinWorlds.ts 文件头 ①）。
 *   真正要保证的是**语义**：07:59 静默、08:00 不静默。
 *   断言语义比断言字符串更能表达意图，也不会因为"差一分钟的等价写法"误报。
 *
 * 用法：npx tsx scripts/qa/check-world-drift.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { XINRAN_WORLD, XINRAN_WORLD_ANCHOR, XINRAN_WORLD_CYCLE } from '@/world/builtinWorlds';
import { parseWorldDoc } from '@/world/parseWorldDoc';
import { clockToMinutes, isMinuteInWindow, shiftOfDate } from '@/world/schedule';

let failed = 0;
function eq(name, actual, expected) {
  const ok = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`);
  if (!ok) console.log(`      \x1b[31m实际 ${JSON.stringify(actual)}\n      期望 ${JSON.stringify(expected)}\x1b[0m`);
}
function ok(name, cond, detail) {
  if (!cond) failed += 1;
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? `  ${detail}` : ''}`);
}

function printSummary() {
  console.log(`\n═══ ${failed === 0 ? '\x1b[32m全部通过 ✓' : `\x1b[31m${failed} 项失败`}\x1b[0m ═══\n`);
}

/* ─────────── ⑥ 内置包自身的结构健全性（抽成函数，见下"为什么"）───────────
 *
 * ★ 为什么单独抽成函数：它在**两条路径**上都要跑 ——
 *   · 正常路径：§⑤ 之后照常执行；
 *   · 占位副本：§①–§⑤ 因"内置数据 vs 原始文档"不适用而跳过，但 §⑥ 测的是
 *     **内置包自身的结构健全性**（占位数据同样必须结构完整）⇒ 仍必须执行。
 *   ★ 判据：跳过时要区分"因**不适用**而跳过"与"因**仍适用**而必须跑"——
 *     一刀切整段退出会把后者也误伤（净损失覆盖）。
 */
function structuralChecks() {
  console.log('\n⑥ 结构健全性');
  ok('每个条目都有非空正文', XINRAN_WORLD.entries.every((e) => e.content.trim().length > 0));
  ok('每个条目都有 comment（便于在 UI 里辨认）', XINRAN_WORLD.entries.every((e) => (e.comment ?? '').length > 0));
  ok('有且仅有少量常驻条目（避免超 token 预算）', XINRAN_WORLD.entries.filter((e) => e.keys.length === 0).length <= 4);
  ok('条目数在合理范围（3–20）', XINRAN_WORLD.entries.length >= 3 && XINRAN_WORLD.entries.length <= 20);
  ok('source.kind = builtin', XINRAN_WORLD.source.kind === 'builtin');

  /*
   * ★ 关键词的重复：**同一词出现在不同条目里是允许的**（一个话题词当然可能
   *   同时点亮两三个条目），真正该禁的是**同一个条目内重复** —— 纯粹的浪费。
   *   所以这里分两级断言，而不是笼统地"不许重复"。
   *   （我最初写成"全局不许重复"，跑出来只报了 `台里` 一处，
   *     而它出现在「电视台与栏目」与「工作日发什么」里都说得通 ⇒ 改判据。）
   */
  const withinEntryDup = XINRAN_WORLD.entries.flatMap((e) =>
    e.keys.length !== new Set(e.keys).size ? [e.comment ?? '(无名)'] : [],
  );
  ok('没有条目**自己内部**重复关键词', withinEntryDup.length === 0, `问题条目：${JSON.stringify(withinEntryDup)}`);

  const keyOwners = new Map();
  for (const e of XINRAN_WORLD.entries) for (const k of e.keys) keyOwners.set(k, [...(keyOwners.get(k) ?? []), e.comment]);
  const crossDup = [...keyOwners.entries()].filter(([, owners]) => owners.length > 1);
  console.log(`     跨条目共用的关键词：${crossDup.length ? crossDup.map(([k, o]) => `${k}(${o.length})`).join('、') : '（无）'}  —— 属正常，仅提示`);

  // 总字符量（粗估 token：中文约 1 token/字）—— 提醒别把世界写得太肥
  const totalChars = XINRAN_WORLD.entries.reduce((n, e) => n + e.content.length, 0);
  const residentChars = XINRAN_WORLD.entries.filter((e) => e.keys.length === 0).reduce((n, e) => n + e.content.length, 0);
  console.log(`\n     世界书总字数 ${totalChars}（常驻部分 ${residentChars}）`);
  console.log(`     常驻部分每次请求都会注入 —— 已控制在 ${residentChars < 1200 ? '可接受' : '偏大'}范围`);
}

/*
 * ★★ 私有素材的**优雅降级**（2026-10-05 隐私脱敏配套改动）。
 *
 * ── 为什么改 ──────────────────────────────────────────────────────
 * 对账用的原始文档副本（`scripts/qa/fixtures/world/`）**含真实地址**，
 * 因此已**移出版本库**（本地保留、不入库，见 .gitignore）。
 * ⇒ 别人 clone 本仓库后这个目录是空的，而原来的 `read()` 直接
 *   `readFileSync` 会**抛异常**，整个脚本崩掉。
 *
 * ── 怎么改（判据：跳过 ≠ 失败）────────────────────────────────────
 * 素材缺失时**打印明确说明并以 0 退出**。理由：
 *   · 这是"素材没提供"，不是"代码有问题" ⇒ 不该报失败；
 *   · 但**必须打印说明**，否则会静默什么都不做（那比崩更糟 ——
 *     一个"总是成功"的检查等于没有检查）。
 *   · 本地（有素材）仍走完整对账，行为不变。
 */
const FIX = path.join(process.cwd(), 'scripts', 'qa', 'fixtures', 'world');
function readMaybe(f) {
  try {
    return readFileSync(path.join(FIX, f), 'utf8');
  } catch {
    return null;
  }
}

/*
 * ★★ 占位数据识别 —— 用**结构化标志**，不是"断言失败就跳过"。
 *
 * 判据：`XINRAN_WORLD.source.name` 以「示例」开头 ⇒ 内置数据是**发布副本里的占位示例**
 *   （真实数据为「内置世界（欣然）」；占位模板为「示例世界（兜底数据）」，
 *    见 `scripts/publish/sanitize/world.placeholder.txt`）。
 *
 * ★ 为什么**整段**跳过：本脚本比的是「内置数据 vs 原始文档」，而发布路线会把内置数据
 *   **整块换成占位示例** ⇒ 占位数据与真实文档**天然不一致**，整个对账都不适用。
 *   实测（占位数据 + 原始文档都在时）：§①④⑤ 共 **22 项**会红 —— 不止"两条栏目"；
 *   若只跳过 §⑤，会留下 §①④ 的红 ⇒ 必须整段跳过。
 *
 * ★ 关键：这是按**占位标志**跳过，**不是**把"断言失败"改写成"通过"——
 *   判据是"数据来源本身就是占位"，与断言是否通过无关。把标志改回真实后，
 *   断言会**照常执行、照常报错**。
 */
const isPlaceholderWorld = /^示例/.test(XINRAN_WORLD.source?.name ?? '');
if (isPlaceholderWorld) {
  console.log('\n═══ 内置世界包 vs 原始文档 对账 ═══\n');
  console.log('  \x1b[33m⚠️ §①–§⑤ 跳过：内置世界数据为占位示例（未提供私有数据）⇒ 对账不适用\x1b[0m');
  console.log(`  \x1b[90m（内置 source.name = 「${XINRAN_WORLD.source?.name}」⇒ 占位副本；\x1b[0m`);
  console.log('  \x1b[90m  本脚本比的是"内置数据 vs 原始文档"，占位数据与真实文档必然不一致。）\x1b[0m');
  console.log('  \x1b[90m  → 该跳过由**占位标志**触发，不是"断言失败被吞掉"；改回真实数据后 §①–§⑤ 照常执行。\x1b[0m');
  console.log('  \x1b[90m  → §⑥（内置包自身结构健全性）对占位数据同样适用 ⇒ 仍照常执行。\x1b[0m');
  structuralChecks();
  printSummary();
  process.exit(failed === 0 ? 0 : 1);
}

const vwRaw = readMaybe('virtual-world.md');
const skillRaw = readMaybe('SKILL.md');

if (vwRaw === null || skillRaw === null) {
  console.log('\n═══ 内置世界包 vs 原始文档 对账 ═══\n');
  console.log('  \x1b[33m⚠️ 跳过：私有原始文档素材未提供\x1b[0m');
  console.log(`     期望位置：${FIX}`);
  console.log('     需要的文件：virtual-world.md、SKILL.md');
  console.log('  \x1b[90m（该素材含真实地址，已故意不入库；本地保留即可跑完整对账）\x1b[0m\n');
  console.log('  → 本次**未执行任何对账断言**，"通过"不代表已验证。\n');
  process.exit(0);
}

const vw = parseWorldDoc(vwRaw, { fileName: 'virtual-world.md' });
const skill = parseWorldDoc(skillRaw, { fileName: 'SKILL.md' });

console.log('\n═══ 内置世界包 vs 原始文档 对账 ═══\n');

/* ─────────── ① 排班：逐值比对 ─────────── */
console.log('① 排班（内置包 vs virtual-world.md）');
eq('锚点一致', XINRAN_WORLD.schedule?.anchorDate, vw.schedule?.anchorDate);
eq('周期一致', [...(XINRAN_WORLD.schedule?.cycle ?? [])], [...(vw.schedule?.cycle ?? [])]);
eq('锚点常量与包内一致', XINRAN_WORLD_ANCHOR, XINRAN_WORLD.schedule?.anchorDate);
eq('周期常量与包内一致', [...XINRAN_WORLD_CYCLE], [...(XINRAN_WORLD.schedule?.cycle ?? [])]);

// 内置包能真正算出班次（不只是"有字段"）
eq('内置包算 2026-09-05 → 白班', shiftOfDate('2026-09-05', XINRAN_WORLD.schedule), '白班');
eq('内置包算 2026-09-06 → 夜班', shiftOfDate('2026-09-06', XINRAN_WORLD.schedule), '夜班');
eq('内置包算 2026-09-09 → 休息', shiftOfDate('2026-09-09', XINRAN_WORLD.schedule), '休息');
eq('内置包算 2026-09-10 → 白班（回卷）', shiftOfDate('2026-09-10', XINRAN_WORLD.schedule), '白班');

/* ─────────── ② 静默：**语义**比对 ─────────── */
console.log('\n② 深夜静默（比语义，不比字符串 —— 端点写法有意不同）');
const builtinQuiet = XINRAN_WORLD.rhythm.quietHours;
const docQuiet = vw.rhythm.quietHours;
eq('左端点一致', builtinQuiet?.from, docQuiet?.from);
eq('右端点一致（解析器已把文档的 :59 归一化成整点）', builtinQuiet?.to, docQuiet?.to);
console.log(`     内置包 ${builtinQuiet?.from}–${builtinQuiet?.to}｜文档 ${docQuiet?.from}–${docQuiet?.to}`);
// ★ 语义断言：源文档的意图是「23:00–07:59 静默」⇒ 07:59 必须静默、08:00 必须不静默
ok('07:59 在内置包里是静默的（与文档意图一致）', isMinuteInWindow(clockToMinutes('07:59'), builtinQuiet));
ok('08:00 在内置包里不静默（恢复活跃）', !isMinuteInWindow(clockToMinutes('08:00'), builtinQuiet));
ok('23:00 在内置包里是静默的', isMinuteInWindow(clockToMinutes('23:00'), builtinQuiet));
ok('22:59 在内置包里不静默', !isMinuteInWindow(clockToMinutes('22:59'), builtinQuiet));
ok('07:59 在文档抽出的窗口里也是静默的', isMinuteInWindow(clockToMinutes('07:59'), docQuiet));

/* ─────────── ③ 活跃时段：比对 SKILL.md（只有它写了） ─────────── */
console.log('\n③ 活跃时段（内置包 vs SKILL.md）');
eq('白班一致', XINRAN_WORLD.rhythm.activeHours?.白班, skill.rhythm.activeHours?.白班);
eq('夜班一致', XINRAN_WORLD.rhythm.activeHours?.夜班, skill.rhythm.activeHours?.夜班);
eq('休息一致', XINRAN_WORLD.rhythm.activeHours?.休息, skill.rhythm.activeHours?.休息);

/**
 * ★ 一个必须成立的不变量：`activeHours` 的键必须**覆盖周期里出现的每个班次名**。
 *   否则 `activeHours[shift]` 取不到 ⇒ 按"没有规则就不拦"回落到放行 ⇒
 *   那个班次完全没有时段约束（静默以外的约束全失效）。
 *   这是我在写 builtinWorlds 时特意标注过的坑，这里固化成断言。
 */
const cycleNames = [...new Set(XINRAN_WORLD.schedule?.cycle ?? [])];
const ahKeys = Object.keys(XINRAN_WORLD.rhythm.activeHours ?? {});
ok(
  `活跃时段的键覆盖周期里所有班次名（周期：${cycleNames.join('/')}）`,
  cycleNames.every((n) => ahKeys.includes(n)),
  `缺失：${JSON.stringify(cycleNames.filter((n) => !ahKeys.includes(n)))}`,
);

/* ─────────── ④ 概率门：说明差异是有意的 ─────────── */
console.log('\n④ 概率门（源资料自相矛盾，取多数且更保守）');
eq('内置包 = 60', XINRAN_WORLD.rhythm.gate?.threshold, 60);
eq('virtual-world.md = 60', vw.rhythm.gate?.threshold, 60);
eq('SKILL.md = 30（与另两份矛盾）', skill.rhythm.gate?.threshold, 30);
ok(
  '内置包与"多数文档"一致（不是随口取的）',
  XINRAN_WORLD.rhythm.gate?.threshold === vw.rhythm.gate?.threshold,
);
ok(
  '差异已被写进内置包的 warnings（不藏着）',
  XINRAN_WORLD.report.warnings.some((w) => w.includes('概率门')),
);

/* ─────────── ⑤ 事实覆盖：内置包真的写有这些关键事实吗 ─────────── */
console.log('\n⑤ 事实覆盖（内置包里必须真的写有这些关键事实）');
const builtinText = XINRAN_WORLD.entries.map((e) => e.content).join('\n');
/*
 * ★ 这里只保留**公开**事实：
 *   · 栏目名 = 全国性节目名（新闻联播 / 朝闻天下），不含指向性；
 *   · 锚点 / 时段 = 功能参数（排班演示必需）。
 *   **真实专名**（朋友名、常去城市等）已移入**不入库**的私有清单 —— 见下方"私有事实断言"段。
 *   判据：**会公开的脚本不得内联任何真实值**（与发布闸门里硬编码台标是同一类缺陷）。
 */
const FACTS = [
  ['排班锚点', '2026-09-05'],
  ['休息三天', '休息三天'],
  ['栏目 · 新闻联播', '新闻联播'],
  ['栏目 · 朝闻天下', '朝闻天下'],
  ['静默起点', '23:00'],
];

/*
 * ★★ 含**真实值**的事实断言已移出本文件（2026-10-05 隐私脱敏）。
 *
 * 为什么：本脚本会公开，而这类断言把真实门牌号 / 学校 / 工作单位 / **朋友名 / 常去城市**
 *   当**期望值**写死，等于把隐私内容又复制了一份到脚本里
 *   （排查时先发现 5 条，后又补出「电视台」1 条，再补出朋友名与城市名若干条）。
 *
 * 怎么处理：改为从**不入库**的 `private-facts.json` 读（与本目录其他私有素材同级）。
 *   结构：`{ facts: [["标签", "期望子串"], ...], worldKeys: {...} }`
 *   —— `facts` 会被追加到上面的 FACTS 里；`worldKeys` 供**世界文档解析测试**
 *   （`scripts/qa/check-world-parse.mjs`）复用同一份私有清单，避免私有值散落多处。
 *   （兼容旧的**扁平数组** `[["标签", "期望子串"], ...]` 结构。）
 *
 * 缺失时的行为：**跳过并打印说明** —— 不要静默跳过
 *   （静默跳过会让"事实覆盖"这一段看起来通过，实际没验）。
 */
const privateFactsRaw = readMaybe('private-facts.json');
if (privateFactsRaw !== null) {
  try {
    const parsed = JSON.parse(privateFactsRaw);
    /* 兼容两种结构：新对象 { facts, worldKeys }，或旧的扁平数组 */
    const extra = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.facts)
        ? parsed.facts
        : null;
    if (Array.isArray(extra)) {
      for (const item of extra) {
        if (Array.isArray(item) && item.length === 2) FACTS.push(item);
      }
      console.log(`  \x1b[90m（已并入 ${extra.length} 条私有事实断言）\x1b[0m`);
    } else {
      console.log('  \x1b[33m⚠️ private-facts.json 结构不识别（既非数组也无 facts），已忽略\x1b[0m');
    }
  } catch (e) {
    console.log(`  \x1b[33m⚠️ private-facts.json 解析失败，已忽略：${e.message}\x1b[0m`);
  }
} else {
  console.log('  \x1b[33m⚠️ 未提供 private-facts.json ⇒ 含真实地址 / 学校 / 朋友名 / 城市名的断言未执行\x1b[0m');
  console.log('  \x1b[90m（这一段"通过"不代表这些事实已验证）\x1b[0m');
}

for (const [label, needle] of FACTS) {
  ok(`写有「${label}」`, builtinText.includes(needle));
}

/* §⑥ 结构健全性（定义见文件上部 `structuralChecks`）—— 正常路径在此处执行 */
structuralChecks();

printSummary();
process.exit(failed === 0 ? 0 : 1);
