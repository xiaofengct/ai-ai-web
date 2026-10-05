#!/usr/bin/env node
/**
 * 世界设定**回填**验证（2026-10-04，针对用户报告的问题）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 用户报告
 * ═══════════════════════════════════════════════════════════════════════════
 * > 「内置的欣然版 apk 文件中似乎没有将世界设定相关内容打包进去，
 * >   请确认并补充完善该部分内容，确保安装后世界设定能够正常加载和显示。」
 *
 * ── 实际根因（不是"没打包"，而是"打包了但老用户拿不到"）──────────────
 * 产物里**确实有**世界数据（可从 APK 里搜到排班锚点与世界书条目）。
 * 问题在 `db/bootstrap.ts` 的**幂等播种**：
 *   它靠「固定 ID 有没有那张卡」判断要不要建卡，
 *   而世界包是 v8 才加进 `createXinranCard()` 的。
 *   老用户的库里早就有那张卡了 ⇒ 走 else 分支 ⇒ 永不重建 ⇒ **世界永不写入**。
 *
 * ── 这个脚本怎么验 ─────────────────────────────────────────────────────
 * 关键：**要复现"老用户的库"**，而不是测"全新安装"。
 * 全新安装走的是建卡分支，必然带上世界 —— 那测不出这个 bug
 * （这也正是它当初能漏过验收的原因）。
 *
 * 步骤：
 *   ① 全新打开 → 等 bootstrap 完成 → 确认卡里有世界（基线）
 *   ② **手工摘掉**卡里的 `extensions.aiyu.world` 与世界书条目
 *      —— 这一步就是"把库改成老用户的样子"
 *   ③ 重新加载页面 → 等 bootstrap 再跑一次
 *   ④ 断言世界**回来了**（回填生效）
 *   ⑤ 反向验证：用户自己导入的世界**不被内置世界覆盖**
 *
 * ★ 第 ⑤ 步不能省：回填逻辑写错成"无条件覆盖"的话，
 *   ①~④ 照样全绿，但用户导入的世界每次重启都会被打回内置的 ——
 *   那是个比原 bug 更糟的问题（用户改了东西自己又变回去了）。
 *
 * 用法：node scripts/qa/check-world-backfill.mjs [--dir=dist]
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Cdp, sleep } from './lib/cdp.mjs';
import { PROJECT_ROOT, killTree, startBrowser } from './lib/harness.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const DIR = path.resolve(arg('dir', path.join(PROJECT_ROOT, 'dist')));
const PORT = Number(arg('port', 4231));
const DEBUG_PORT = Number(arg('debugPort', 9401));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let fp = path.join(DIR, decodeURIComponent(url.pathname));
    if (!existsSync(fp) || statSync(fp).isDirectory()) fp = path.join(DIR, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] ?? 'application/octet-stream' });
    res.end(readFileSync(fp));
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});
await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));

const profile = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp', `world-backfill-${Date.now()}`);
const browser = await startBrowser({ port: DEBUG_PORT, profileDir: profile, freshProfile: true });
const cdp = await Cdp.attach(DEBUG_PORT);
await cdp.enableDomains();

let failed = 0;
const line = (ok, msg, detail) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}${detail ? `\n      ${detail}` : ''}`);
};

/**
 * ★★ 先预置「已引导」标记（在第一次导航时就做）。
 *
 * 不预置会怎样（**这个坑我在同一天里踩了第二次**）：
 *   `goto('/settings')` 会被 `RequireGuide` 拦回 `/guide`，
 *   而引导页当然没有 `[data-section-id="world"]` ⇒
 *   第 ④ 步「『世界设定』分区存在」**直接假红**。
 *   同类问题在 `check-settings-overflow.mjs` 里已经踩过一次并写了注释，
 *   这里是第二次 —— ⇒ 只要是"打开设置页"的脚本，**第一件事就该是预置它**。
 *   `shot-settings.mjs` 的 `PRESET` 常量就是为此存在的（已存在很久）。
 */
const BASE = `http://127.0.0.1:${PORT}`;
const presetGuide = async () => {
  await cdp.evalJs(
    `(() => { try { localStorage.setItem('ai-ai.guide.v1','1'); } catch(_){} return true; })()`,
  );
};

console.log('\n═══ 世界设定回填验证 ═══\n');
console.log(`  产物：${DIR}\n`);

/* ─────────── ① 全新打开：基线 ─────────── */
console.log('① 全新安装（走建卡分支）—— 基线');
await cdp.goto(BASE);
await sleep(1500);
await presetGuide();
await sleep(3000);

/**
 * 读 IndexedDB 里内置卡的世界状态。
 * ★ 直接开 Dexie 的库（库名与表名取自应用的常量，写死在这里是**刻意的**：
 *   这个脚本要独立于应用代码运行，不 import 任何 `@/` 模块 ——
 *   否则"用同一份实现验证自己"就成了循环论证）。
 */
const READ_CARD = `
  (async () => {
    const open = () => new Promise((ok, bad) => {
      const req = indexedDB.open('ai-ai-web');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error);
    });
    const db = await open();
    const row = await new Promise((ok, bad) => {
      const tx = db.transaction('personas', 'readonly');
      const req = tx.objectStore('personas').get('persona-xinran-builtin');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error);
    });
    if (!row) return { found: false };
    const world = row.data && row.data.extensions && row.data.extensions.aiyu
      ? row.data.extensions.aiyu.world : undefined;
    const entries = (row.data && row.data.character_book && row.data.character_book.entries) || [];
    return {
      found: true,
      hasWorld: !!world,
      worldSourceKind: world ? world.source && world.source.kind : null,
      worldSourceName: world ? world.source && world.source.name : null,
      hasSchedule: !!(world && world.schedule),
      anchor: world && world.schedule ? world.schedule.anchorDate : null,
      cycleLen: world && world.schedule ? (world.schedule.cycle || []).length : 0,
      worldEntryCount: entries.filter((e) => e.extensions && e.extensions.aiyuWorld === true).length,
      otherEntryCount: entries.filter((e) => !(e.extensions && e.extensions.aiyuWorld === true)).length,
    };
  })()
`;

console.log('\n═══ 世界设定回填验证 ═══\n');
console.log(`  产物：${DIR}\n`);

/* ─────────── ① 全新打开：基线 ─────────── */
console.log('① 全新安装（走建卡分支）—— 基线');
const fresh = await cdp.evalJs(READ_CARD, { awaitPromise: true });
line(fresh.found, '内置欣然卡已创建');
line(fresh.hasWorld, '卡里带了世界包', fresh.hasWorld ? '' : '★ createXinranCard() 没把世界写进卡');
line(fresh.hasSchedule === true, `世界包含排班规则（锚点 ${fresh.anchor}，周期 ${fresh.cycleLen} 天）`);
line(fresh.worldEntryCount > 0, `世界书条目已并进角色卡（${fresh.worldEntryCount} 条）`);
line(fresh.worldSourceKind === 'builtin', `世界来源标记为内置（${fresh.worldSourceKind}）`);

/* ─────────── ② 把库改成"老用户"的样子 ─────────── */
console.log('\n② 模拟老用户的库（摘掉世界，保留卡本身）');
const stripped = await cdp.evalJs(
  `
  (async () => {
    const open = () => new Promise((ok, bad) => {
      const req = indexedDB.open('ai-ai-web');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error);
    });
    const db = await open();
    const row = await new Promise((ok, bad) => {
      const tx = db.transaction('personas', 'readonly');
      const req = tx.objectStore('personas').get('persona-xinran-builtin');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error);
    });
    if (!row) return { ok: false, why: '卡不存在' };
    const data = { ...row.data };
    const ext = { ...(data.extensions || {}) };
    const aiyu = { ...(ext.aiyu || {}) };
    delete aiyu.world;                       // ← 摘掉世界包（v8 之前的形态）
    ext.aiyu = aiyu;
    data.extensions = ext;
    const book = data.character_book || { entries: [] };
    // ← 同时摘掉世界书条目，并**保留**一条"非世界"条目用于第 ⑤ 步验证
    data.character_book = {
      entries: [
        ...(book.entries || []).filter((e) => !(e.extensions && e.extensions.aiyuWorld === true)),
        { keys: ['测试'], content: '用户自己写的条目', enabled: true, insertion_order: 1 },
      ],
    };
    await new Promise((ok, bad) => {
      const tx = db.transaction('personas', 'readwrite');
      tx.objectStore('personas').put({ ...row, data });
      tx.oncomplete = ok;
      tx.onerror = () => bad(tx.error);
    });
    return { ok: true };
  })()
`,
  { awaitPromise: true },
);
line(stripped.ok === true, '已摘掉世界包与世界书条目（模拟升级前的老用户）', stripped.why ?? '');

const afterStrip = await cdp.evalJs(READ_CARD, { awaitPromise: true });
line(afterStrip.hasWorld === false, '确认已摘除（此时卡内无世界）');
line(afterStrip.otherEntryCount === 1, `用户自建条目仍在（${afterStrip.otherEntryCount} 条）`);

/* ─────────── ③ 重新加载：触发回填 ─────────── */
console.log('\n③ 重新加载页面（bootstrap 再跑一次）');
await cdp.goto(`${BASE}/settings`);
await sleep(4000);
const afterReload = await cdp.evalJs(READ_CARD, { awaitPromise: true });
line(afterReload.hasWorld === true, '★ 世界包被回填（老用户拿得到世界设定）', afterReload.hasWorld ? '' : '★ 回填没生效 —— 老用户仍然看不到世界设定');
line(afterReload.hasSchedule === true, `回填后含排班规则（锚点 ${afterReload.anchor}，周期 ${afterReload.cycleLen} 天）`);
line(afterReload.worldEntryCount > 0, `回填后世界书条目已并回（${afterReload.worldEntryCount} 条）`);

/* ─────────── ④ 界面确认（不只看数据） ─────────── */
console.log('\n④ 设置页「世界设定」分区实际显示了什么');
/**
 * ★ 展开方式：**先判状态，再决定点不点**。
 *
 * ★★ 这里踩到的坑值得记：第一版无条件点击每个分组 header，
 *   结果「可见文本 7124 → 185 字符」—— **越点越少**。
 *   原因：MUI 的折叠块是 **toggle**，已展开的再点一下会**收起**。
 *   而本脚本没设手机视口（桌面宽度），设置页在宽屏下**默认就是展开的**
 *   ⇒ 13 次点击把 13 个分组全部关上了。
 *
 * ★ 这条同时说明「不能靠假设知道状态」：
 *   同一个脚本在 `shot-settings.mjs` 里跑 mobile 视口时要"点开"，
 *   在桌面视口下要"别动" —— 而写代码时很容易只想着其中一种。
 *   ⇒ 判据用**内容本身**：这个分组里除了标题还有没有别的字。
 *     有内容 = 已展开（别动）；只有标题 = 收起（点开）。
 *     这是"看结果、不看过程"—— MUI 的类名会变，但这个事实不会。
 */
const sectionProbe = (id) => `
  (() => {
    const box = document.querySelector('[data-section-id="${id}"]');
    if (!box) return { found: false };
    const text = (box.innerText || '').trim();
    return { found: true, text, hasBody: text.length > 6 && !/^[^\\n]*$/.test(text) };
  })()
`;

let probe = await cdp.evalJs(sectionProbe('world'));
if (probe.found && !probe.hasBody) {
  await cdp.evalJs(
    `(() => { const b = document.querySelector('[data-section-id="world"] button'); if (b) b.click(); return true; })()`,
  );
  await sleep(2000);
  probe = await cdp.evalJs(sectionProbe('world'));
}
const worldText = probe.found ? probe.text : '';

line(probe.found === true, '「世界设定」分区存在');
line(probe.found && probe.hasBody, '「世界设定」分区有内容（不只是标题）', `实际内容：${JSON.stringify(worldText.slice(0, 140))}`);
line(/内置/.test(worldText), '界面显示为「内置」世界');
line(/排班|静默|世界书/.test(worldText), '界面展示了世界包摘要（排班/静默/世界书条数）');
line(/今天/.test(worldText), '界面算出了「今天的班次」（说明规则真的在跑，不只是有数据）');

/* ─────────── ⑤ 反向验证：不覆盖用户导入的世界 ─────────── */
console.log('\n⑤ 反向验证：用户自己导入的世界不被内置覆盖');
/**
 * ★★ 这里注入的必须是一个**可用**的世界包（有 entries），不能是空壳。
 *
 * 第一版注入的就是空壳（`entries: []`、`rhythm: {}`），结果这一项报红 ——
 * 但**报红是对的，只是原因不是"代码有 bug"**：
 * `hasWorld()` 走 `isWorldPackUsable()`，它的判据是
 * "有 entries ∥ 有 schedule ∥ 有静默时段" —— 三者皆无的空包**等于没导入**，
 * 于是回填照常触发、把内置世界补上。这个行为**是正确的**：
 * 一个空包不该阻止内置世界生效（否则用户在设置页点一下"清空"，
 * 世界就永久性地回不来了）。
 *
 * ⇒ 修的是**测试数据**，不是代码。要验的是"**用户的可用世界**不被覆盖"，
 *   所以得注入一个真的有内容的世界。
 *
 * ★ 这条也说明判据要写清楚"到底在验什么"：
 *   「用户的世界不被覆盖」隐含了「那个世界是有效的」这个前提，
 *   不写出来就会得到一个指不到原因的假失败。
 */
const injected = await cdp.evalJs(
  `
  (async () => {
    const open = () => new Promise((ok, bad) => {
      const req = indexedDB.open('ai-ai-web');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error);
    });
    const db = await open();
    const row = await new Promise((ok, bad) => {
      const tx = db.transaction('personas', 'readonly');
      const req = tx.objectStore('personas').get('persona-xinran-builtin');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error);
    });
    if (!row) return { ok: false };
    const data = { ...row.data };
    const ext = { ...(data.extensions || {}) };
    const aiyu = { ...(ext.aiyu || {}) };
    // 用户导入了一整套**有内容**的世界：来源标 imported、锚点与内置明显不同
    aiyu.world = {
      version: 1,
      source: { kind: 'imported', name: '用户导入的世界.md' },
      rhythm: { quietHours: { from: '22:00', to: '06:00' } },
      schedule: { anchorDate: '2030-01-01', cycle: ['早班', '中班', '晚班'] },
      entries: [{ keys: ['班次'], content: '用户自己的排班规则', comment: '用户条目' }],
      report: { recognized: ['排班（3 天一轮）'], textOnly: [], warnings: [] },
    };
    ext.aiyu = aiyu;
    data.extensions = ext;
    await new Promise((ok, bad) => {
      const tx = db.transaction('personas', 'readwrite');
      tx.objectStore('personas').put({ ...row, data });
      tx.oncomplete = ok;
      tx.onerror = () => bad(tx.error);
    });
    return { ok: true };
  })()
`,
  { awaitPromise: true },
);
line(injected.ok === true, '已注入「用户导入的可用世界」（来源 imported、锚点 2030-01-01）');

await cdp.goto(`${BASE}/settings`);
await sleep(4000);
const finalState = await cdp.evalJs(READ_CARD, { awaitPromise: true });
line(
  finalState.worldSourceKind === 'imported',
  `★ 用户导入的世界**没有被覆盖**（当前来源：${finalState.worldSourceKind} / ${finalState.worldSourceName}）`,
  finalState.worldSourceKind === 'builtin' ? '★ 被内置世界覆盖了 —— 用户导入的设定每次重启都会被打回，比原 bug 更糟' : '',
);
line(
  finalState.anchor === '2030-01-01',
  `用户世界的排班锚点保持不变（${finalState.anchor}）`,
  finalState.anchor === '2026-09-05' ? '★ 锚点被换成了内置世界的' : '',
);

console.log('\n═══════════════════════════════════════════');
console.log(failed === 0 ? '\x1b[32m全部通过：世界设定可正常加载、且不覆盖用户设定\x1b[0m' : `\x1b[31m失败 ${failed} 项\x1b[0m`);
console.log('═══════════════════════════════════════════\n');

killTree(browser.child);
server.close();
process.exit(failed === 0 ? 0 : 1);
