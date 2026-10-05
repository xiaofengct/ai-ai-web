#!/usr/bin/env node
/**
 * 验证「种子数据初始化失败」这条路径 —— 检查我修的那处回归是否真的修好了。
 *
 * ★ 为什么要有这个脚本（这是一处**我自己引入的回归**）：
 *
 *   背景：`personaStore` 新增了 `hydrated`（区分「还没读完」与「读完了确实没有」）。
 *   而 `App.tsx` 原来是 `bootstrap().then(() => reloadPersonas())` ——
 *   但 `bootstrap()` 在 `db/bootstrap.ts:147/183/199/208` 会 `throw AppError('DB_FAILED', …)`
 *   （IndexedDB 配额耗尽 / 库损坏 / 隐私模式等）。
 *   **种子一失败，读取就永不执行** ⇒ `hydrated` 永为 false ⇒
 *   角色轨骨架永久卡死、引导页文案空白、而「一个角色都没有」的整页引导也**永不显示**
 *   （它的判据需要 `personasHydrated`）—— 不内置版用户连导入入口都看不到。
 *
 *   修法：`App.tsx` 改用 `.finally()`，**等种子结束（成功或失败）都读一次**。
 *
 * ★ 怎么造出这条路径：用 CDP 的 `Page.addScriptToEvaluateOnNewDocument`
 *   在**应用脚本执行之前**把 `indexedDB.open` / `deleteDatabase` 换成抛异常的桩。
 *
 * ★ 断言（全部从 DOM 观测，不读产品内部状态）：
 *   1. 注入生效（`window.__QA_IDB_BROKEN__` 为真）—— 否则整轮测试无意义
 *   2. **骨架不永久卡住**：稳定后不应再有 `[aria-busy="true"]`（本次回归的核心判据）
 *   3. 应用没崩：`#root` 非空、未落到崩溃页
 *   4. 最终出现「一个角色都没有」的整页引导（证明 `hydrated` 确实被置位了）
 *   5. 全程不出现「只有我一个」（内置版里这句是错的）
 *
 * 用法：
 *   node scripts/qa/verify-bootstrap-failure.mjs --flavor=builtin
 *   node scripts/qa/verify-bootstrap-failure.mjs --flavor=standalone
 * 退出码非 0 表示有断言失败。
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Cdp, sleep } from './lib/cdp.mjs';
import { PROJECT_ROOT, killTree, startBrowser } from './lib/harness.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const FLAVORS = {
  builtin: path.join(PROJECT_ROOT, 'android', 'app', 'src', 'builtin', 'assets', 'public'),
  standalone: path.join(PROJECT_ROOT, 'android', 'app', 'src', 'standalone', 'assets', 'public'),
};

const FLAVOR = arg('flavor', 'builtin');
/**
 * ★ `--dir=` 允许直接指定产物目录，用于"只想重建 dist、不碰 android flavor 目录"的场景
 *   （例如另一个验证者正从 flavor 目录起服务时，避免抽掉它脚下的文件）。
 */
const EXPLICIT_DIR = arg('dir', null);
const PORT = Number(arg('port', 4187));
const DEBUG_PORT = Number(arg('debugPort', FLAVOR === 'builtin' ? 9233 : 9234));
const TS = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(PROJECT_ROOT, 'scripts', 'qa', 'out', `bootstrap-failure-${TS}`);
const TMP = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip',
};

/** 静态服务（SPA 回退到 index.html）。不用 cpSync/不删文件，规避本机守卫。 */
async function serveStatic(dir, port) {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      let fp = path.join(dir, decodeURIComponent(url.pathname));
      if (!existsSync(fp) || statSync(fp).isDirectory()) fp = path.join(dir, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] ?? 'application/octet-stream' });
      res.end(readFileSync(fp));
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  return { server, base: `http://127.0.0.1:${port}` };
}

/** 在页面任何脚本之前把 indexedDB 打死，并预置 v2 布局 */
const BREAK_IDB = `
(() => {
  const boom = () => { throw new DOMException('QA: IndexedDB blocked', 'InvalidStateError'); };
  try { indexedDB.open = boom; } catch (_) {}
  try { indexedDB.deleteDatabase = boom; } catch (_) {}
  window.__QA_IDB_BROKEN__ = true;

  // ★ 必须切到 v2 布局，否则角色轨根本不渲染 —— 第一版脚本就栽在这里：
  //   homeLayout 默认 'v1'，v1 首页没有 PersonaRail，
  //   于是"骨架未永久卡住"以**空转**的方式通过（骨架从未出现），是假绿。
  //   uiStore 用 zustand persist 存 localStorage（键见 constants/storageKeys.ts），
  //   homeLayout 在其 partialize 清单里 ⇒ 预置这个键即可。
  try {
    localStorage.setItem('ai-ai.ui.v1', JSON.stringify({ state: { homeLayout: 'v2' }, version: 1 }));
  } catch (_) {}

  // ★ 还要写「已看过引导」标记 —— 第二版脚本栽在这里：
  //   全新 profile 没有 ai-ai.guide.v1，RequireGuide 会把路由拦到 /guide，
  //   而引导第 1 步（接入模型）没有角色轨 ⇒ 又测错了页面。
  //   值必须是字符串 '1'（见 router/RouteGuards.tsx 的 markGuideDone）。
  try { localStorage.setItem('ai-ai.guide.v1', '1'); } catch (_) {}
})();
`;

/**
 * 瞬时记录器（在第一版脚本上补的）。
 *
 * ★ 为什么需要它：断言"骨架未永久卡住"在**骨架从未渲染**时也会通过 ——
 *   这是典型的"假绿"。要排除空转，必须**证明这个分支真的被走到过**。
 *   MutationObserver + 10ms 轮询记录：aria-busy 曾出现的最大数量、以及几句关键文案是否**出现过**。
 */
const recorderSource = () => `
(() => {
  window.__QA_REC__ = { ariaBusyMax: 0, texts: [], ticks: 0 };
  const MARKS = ['只有我一个', '还没有角色', '这里还没有人'];
  const scan = () => {
    window.__QA_REC__.ticks += 1;
    const n = document.querySelectorAll('[aria-busy="true"]').length;
    if (n > window.__QA_REC__.ariaBusyMax) window.__QA_REC__.ariaBusyMax = n;
    const t = document.body ? document.body.innerText : '';
    for (const m of MARKS) {
      if (t.includes(m) && !window.__QA_REC__.texts.includes(m)) window.__QA_REC__.texts.push(m);
    }
  };
  const start = () => {
    scan();
    try {
      new MutationObserver(scan).observe(document.body, { childList: true, subtree: true, characterData: true });
    } catch (_) {}
    setInterval(scan, 10);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
`;

const results = [];
const check = (id, ok, detail) => {
  results.push({ id, ok: Boolean(ok), detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? `  — ${detail}` : ''}`);
};

let server;
let browser;
let cdp;

try {
  const dir = EXPLICIT_DIR ? path.resolve(EXPLICIT_DIR) : FLAVORS[FLAVOR];
  if (!dir || !existsSync(path.join(dir, 'index.html'))) throw new Error(`产物不存在：${dir}`);
  mkdirSync(OUT, { recursive: true });
  mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  mkdirSync(TMP, { recursive: true });

  console.log(`\n═══ 种子失败路径验证（${FLAVOR}）═══`);
  console.log(`产物目录：${dir}`);

  const served = await serveStatic(dir, PORT);
  server = served.server;
  console.log(`静态服务就绪：${served.base}\n`);

  browser = await startBrowser({
    port: DEBUG_PORT,
    /**
     * ★ profile 目录必须**每次唯一**，不能复用同一个再 `freshProfile: true` 去删。
     *   原因：本环境的删除守卫会拦下 `startBrowser` 内部的 `rmSync`
     *   （实测报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED {"count":341,"threshold":50}`），
     *   而后台进程没有 TTY 可确认 ⇒ 整轮测试在**第一步就挂**。
     *   ⇒ 用带时间戳的新目录，结构上不需要删除任何东西。
     */
    profileDir: path.join(TMP, `profile-bootfail-${FLAVOR}-${Date.now()}`),
  });
  cdp = await Cdp.attach(DEBUG_PORT);
  await cdp.enableDomains();
  await cdp.send('Network.enable');
  // 阻断 SW：避免 SW 缓存干扰（与既有脚本一致）
  await cdp.send('Network.setBlockedURLs', { urls: ['*/sw.js', '*service-worker*'] }).catch(() => undefined);

  // ★ 记录器必须在 goto 之前注入（要在应用首帧前就开始记）
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: recorderSource() });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: BREAK_IDB });

  await cdp.goto(served.base, { readyExpr: 'document.querySelector("#root") !== null', settleMs: 300 });

  // 1) 注入自检 —— 不通过则后面全是空转
  const injected = await cdp.evalJs('window.__QA_IDB_BROKEN__ === true');
  check('注入生效（indexedDB 已在应用启动前被破坏）', injected);
  if (!injected) throw new Error('注入未生效，本轮测试无效');

  const layoutSeeded = await cdp.evalJs(
    'JSON.parse(localStorage.getItem("ai-ai.ui.v1") ?? "{}")?.state?.homeLayout === "v2"',
  );
  check('已预置 v2 布局（否则角色轨不渲染，断言会空转）', layoutSeeded);

  // 2) 核心断言：等稳定后骨架**不能**永久卡住
  await sleep(4500);
  const rec = await cdp.evalJs('window.__QA_REC__ ?? null');
  const skeletonLate = await cdp.evalJs('document.querySelectorAll(\'[aria-busy="true"]\').length');

  // ★ 反空转 + 不卡死，合成一条**条件式**断言：
  //   「骨架若出现过，就必须已消失」。
  //   为什么不做成"必须出现过"：修复后引导块会**先于角色轨**渲染（判据只看 personas），
  //   角色轨可能整个生命周期都不渲染 ⇒ 峰值 0 是**合法**的，不能判死。
  //   而这条条件式断言仍能抓住回归：负对照（修复前产物）里峰值为 1 且稳定后仍为 1 ⇒ FAIL。
  check(
    '骨架若出现过，必须已消失（不永久卡住）',
    rec && (rec.ariaBusyMax === 0 || skeletonLate === 0),
    `峰值 ${rec?.ariaBusyMax ?? 'n/a'}，稳定后剩余 ${skeletonLate}`,
  );
  console.log(`  （参考：本次 aria-busy 峰值 = ${rec?.ariaBusyMax ?? 'n/a'}）`);

  const body = await cdp.bodyText();
  const rootLen = await cdp.evalJs('(document.querySelector("#root")?.innerText ?? "").length');
  const sawTexts = rec?.texts ?? [];

  // 3) 没崩
  check('应用未崩（#root 有内容）', rootLen > 0, `#root 文本 ${rootLen} 字符`);
  check('未落到崩溃页', !/崩了|出错了|crash/i.test(body.slice(0, 400)));

  // 4) hydrated 真的置位了 → 整页引导出现
  check('出现整页引导「这里还没有人」（证明 hydrated 已置位）', body.includes('这里还没有人'));

  // 5) 全程不该出现的错误文案（用记录器判"出现过"，比只看终态严格）
  check('全程未出现错误的「只有我一个」', !sawTexts.includes('只有我一个'), `记录到 [${sawTexts.join(', ')}]`);

  await cdp.screenshot(path.join(OUT, 'shots', `01-${FLAVOR}-no-seed.png`));
  writeFileSync(
    path.join(OUT, 'report.json'),
    `${JSON.stringify(
      {
        flavor: FLAVOR,
        distDir: dir,
        base: served.base,
        recorder: rec,
        skeletonLate,
        rootLen,
        results,
        bodyHead: body.slice(0, 700),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\n报告：${path.join(OUT, 'report.json')}`);
} catch (e) {
  console.error(`\n[致命] ${e.message}`);
  results.push({ id: 'harness', ok: false, detail: e.message });
} finally {
  try { cdp?.close(); } catch { /* 忽略 */ }
  killTree(browser?.child);
  try { server?.close(); } catch { /* 忽略 */ }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n═══ ${results.length - failed.length}/${results.length} 通过 ═══`);
for (const f of failed) console.log(`  ✗ ${f.id} — ${f.detail ?? ''}`);
process.exit(failed.length === 0 ? 0 : 1);
