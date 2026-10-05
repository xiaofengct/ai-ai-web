/**
 * ★ P2 专项独立复测（可复跑）。
 *
 * P2 缺陷（已修复，本轮复测）：
 *   内置版 + `homeLayout='v2'` + 清空 IndexedDB 后硬刷新，**角色轨那一层**
 *   在 `personas` 从 IndexedDB 读回之前，会渲染错误空态文案
 *   「只有我一个。你也可以把别人导进来，我不介意。」（内置版里欣然明明在库里），
 *   随后被真实卡片替换。根因：`personas.length === 0` 无法区分「还没读完」与
 *   「读完了确实没有」；角色轨那层没有用 `personaStore.hydrated`。
 *
 * 本轮修复（被验对象）：
 *   1. `PersonaRail` 新增 `loading?: boolean`（默认 false）；空 + loading 时渲染 2 个 Skeleton，不渲染任何文案；
 *   2. 三个调用点都传 `loading={!personasHydrated}`（HomePage v2 轨 / GuidePage 第 2 步 / NewSessionDialog）；
 *   3. GuidePage 那句 `empty.personas|empty.personasSolo` 改为 `personasHydrated ? t(...) : ''`。
 *
 * 本脚本只做**只读验证**：不修改 `ROOT/src/` 下任何产品代码。
 * 负对照（`--mode=negctl`）只补丁 `.qa-tmp/` 下的**构建产物副本**（还原修复前的空态回落），
 * 用于证明本脚本的 P2 判据**有分辨力**（不是"恰好通过"）。
 *
 * 设计要点（遵守本沙箱硬约束）：
 *   - 一律用**异步** spawn / fetch（同步子进程 API 在本机全线 EBUSY）；
 *   - 自己写静态服务，直接 serve 已构建产物目录（**不做 copy/rm**，绕开 safe-delete 守卫与 EIO）；
 *   - 清 IndexedDB 用 CDP `Storage.clearDataForOrigin`（不依赖页面 JS 上下文）；
 *   - 竞态检测用「document-start 注入的记录器」（MutationObserver + setInterval + rAF），
 *     同时监视 **两句**空态文案 + 「这里还没有人」+ 「欣然」+ **骨架 `[aria-busy="true"]`**。
 *
 * 用法（★ 退出码用重定向取，别用管道）：
 *   node scripts/qa/verify-p2.mjs --flavor=builtin --mode=verify --repeat=5 --throttle=1 > /tmp/p2.log 2>&1; echo "REAL_EXIT=$?"
 *   node scripts/qa/verify-p2.mjs --flavor=builtin --mode=verify --repeat=5 --throttle=8
 *   node scripts/qa/verify-p2.mjs --flavor=builtin --mode=selftest     # 仪表自检（注入 60ms 瞬时闪现）
 *   node scripts/qa/verify-p2.mjs --mode=negctl                        # 负对照（补丁产物副本）
 *   node scripts/qa/verify-p2.mjs --flavor=standalone --mode=verify    # 不内置版同样复测（bonus）
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, readdirSync, copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cdp, sleep } from './lib/cdp.mjs';
import { startBrowser, killTree } from './lib/harness.mjs';

const TS = new Date().toISOString().replace(/[:.]/g, '-');
const HERE = path.dirname(fileURLToPath(import.meta.url)); // ROOT/scripts/qa
const ROOT = existsSync(path.join(process.cwd(), 'src')) ? process.cwd() : path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'scripts', 'qa', 'out', `p2-${TS}`);
const SHOTS = path.join(OUT, 'shots');
const TMP = path.join(ROOT, '.qa-tmp', `p2-${TS}`);

const FLAVORS = {
  builtin: path.join(ROOT, 'android', 'app', 'src', 'builtin', 'assets', 'public'),
  standalone: path.join(ROOT, 'android', 'app', 'src', 'standalone', 'assets', 'public'),
};

const DB = 'ai-ai-web';
const GUIDE_KEY = 'ai-ai.guide.v1';
const SEED_KEY = 'ai-ai.seeded.v1';

// 精确文案（源：src/copy/xinran.ts）
const WRONG_TEXT = '这里还没有人';   // empty.noPersona —— 内置版整页引导，**不该**在本场景出现
const SOLO_TEXT = '只有我一个';       // empty.personas  —— 内置版角色轨空态（错误那句）
const SOLO_SA_TEXT = '还没有角色';    // empty.personasSolo —— 不内置版角色轨空态
const XINRAN = '欣然';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const FLAVOR = String(args.flavor ?? 'builtin');
const MODE = String(args.mode ?? 'verify');
const REPEAT = Number(args.repeat ?? 5);
const THROTTLE = args.throttle ? Number(args.throttle) : 0;

const report = {
  flavor: FLAVOR,
  mode: MODE,
  throttle: THROTTLE,
  repeat: REPEAT,
  base: null,
  productDir: null,
  assertions: [],
  raw: {},
  shots: [],
};

let cdp;
let browser;
let server;
let shotSeq = 0;

/* ============================== 断言记录 ============================== */

function record(id, ok, note, evidence) {
  report.assertions.push({ id, ok, note: note ?? '', evidence: evidence ?? null });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${id}${note ? ` — ${note}` : ''}`);
  return ok;
}

async function shot(name) {
  shotSeq += 1;
  mkdirSync(SHOTS, { recursive: true });
  const rel = `shots/${String(shotSeq).padStart(2, '0')}-${name.replace(/[^\w.-]+/g, '_')}.png`;
  const abs = path.join(OUT, rel);
  try {
    await cdp.screenshot(abs);
    report.shots.push(rel);
    return rel;
  } catch (e) {
    return `(截图失败: ${e.message})`;
  }
}

/* ============================== 静态服务 ============================== */

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
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.data': 'application/octet-stream',
  '.zip': 'application/zip',
};

/** 直接 serve 构建产物目录（无拷贝、无删除，规避本沙箱 fs 守卫）。 */
async function serveStatic(dir, port) {
  if (!existsSync(path.join(dir, 'index.html'))) {
    throw new Error(`构建产物不存在：${path.join(dir, 'index.html')}`);
  }
  const serverInst = createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      let filePath = path.join(dir, decodeURIComponent(url.pathname));
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        filePath = path.join(dir, 'index.html'); // SPA 回退
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(readFileSync(filePath));
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  await new Promise((ok) => serverInst.listen(port, '127.0.0.1', ok));
  return { server: serverInst, port, base: `http://127.0.0.1:${port}` };
}

/* ============================== 记录器（document-start 注入） ============================== */

/**
 * 记录 body 文本里是否出现过目标串（捕获瞬时空态闪出），
 * 并额外记录骨架 `[aria-busy="true"]` 是否出现过 —— 后者是本修复的**正向证据**：
 * 过渡窗口里应看到骨架（说明 loading 门闩生效），而不是任何空态文案。
 *
 * ★ `aria-busy` 在整个 src/ 里**只有** PersonaRail 的骨架分支在用（已 grep 确认），
 *   所以它是无歧义的"角色轨骨架"信号（SessionList 的 loading 用的是文本，不是 aria-busy）。
 */
function recorderSource(markers) {
  const M = JSON.stringify(markers);
  return `(() => {
    const M = ${M};
    const qa = window.__qa = {
      firstSeen: {}, snaps: {}, frames: 0, transitions: [], t0: Date.now(),
      skeletonSeen: false, skeletonFirstSeen: null, skeletonMax: 0,
    };
    let lastSig = '';
    const probe = () => {
      let txt = '';
      try { txt = document.body ? document.body.innerText : ''; } catch (e) { txt = ''; }
      qa.frames++;
      for (const k in M) {
        const s = M[k];
        if (s && txt.indexOf(s) >= 0 && qa.firstSeen[k] == null) {
          qa.firstSeen[k] = Date.now();
          qa.snaps[k] = txt.slice(0, 220);
        }
      }
      try {
        const sk = document.querySelectorAll('[aria-busy="true"]').length;
        if (sk > 0) {
          qa.skeletonSeen = true;
          if (qa.skeletonFirstSeen == null) qa.skeletonFirstSeen = Date.now();
          if (sk > qa.skeletonMax) qa.skeletonMax = sk;
        }
      } catch (e) {}
      const sig = Object.keys(M).map((k) => (txt.indexOf(M[k]) >= 0 ? k[0] : '-')).join('') + ':' + txt.length;
      if (sig !== lastSig) {
        lastSig = sig;
        qa.transitions.push({ t: Date.now(), sig });
        if (qa.transitions.length > 200) qa.transitions.shift();
      }
    };
    setInterval(probe, 8);
    try {
      const mo = new MutationObserver(() => probe());
      const start = () => {
        if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
        else setTimeout(start, 1);
      };
      start();
    } catch (e) {}
    requestAnimationFrame(function loop() { probe(); requestAnimationFrame(loop); });
  })();`;
}

function recorderMarkers() {
  return { wrong: WRONG_TEXT, xinran: XINRAN, solo: SOLO_TEXT, soloSA: SOLO_SA_TEXT };
}

async function readQa() {
  const raw = await cdp.evalJs('JSON.stringify(window.__qa || null)').catch(() => 'null');
  return raw && raw !== 'null' ? JSON.parse(raw) : null;
}

async function clearIndexedDB(origin) {
  await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'indexeddb' });
}
const bodyText = () => cdp.evalJs(`document.body ? document.body.innerText : ''`);
const pathname = () => cdp.evalJs(`location.pathname + location.search`);

async function nav(url, { timeoutMs = 20000, settleMs = 1200 } = {}) {
  await cdp.send('Page.navigate', { url });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await cdp
      .evalJs(`(() => { const r = document.getElementById('root'); return !!r && r.childElementCount > 0; })()`)
      .catch(() => false);
    if (ok) break;
    await sleep(150);
  }
  await sleep(settleMs);
}

/** 精确判断"角色轨里出现某个角色名"：只数「横向滚动(overflowX auto) + 含角色卡(MuiPaper)」容器内的精确命中 */
function railHasExpr(name) {
  return `(() => {
    const want = ${JSON.stringify(name)};
    const exact = [...document.querySelectorAll('p, span, div')].filter((e) => (e.textContent || '').trim() === want);
    const rail = [...document.querySelectorAll('div')].find((d) => {
      try {
        const cs = getComputedStyle(d);
        return cs.overflowX === 'auto' && d.querySelectorAll('.MuiPaper-root').length > 0 && d.getBoundingClientRect().width > 0;
      } catch (e) { return false; }
    });
    const scoped = rail ? [...rail.querySelectorAll('.MuiTypography-root')].filter((e) => (e.textContent || '').trim() === want).length : 0;
    return { nameNodeCount: exact.length, railScopedCount: scoped, railFound: !!rail };
  })()`;
}

/* ============================== 仪表自检（instrument validation） ============================== */

/**
 * 注入一段 **60ms 瞬时**闪现的「只有我一个」+「还没有角色」+「这里还没有人」，
 * 验证记录器确实能捕获 —— 否则 P2-1 的阴性结论无法排除"仪表瞎了"。
 * ★ 用完必须 `Page.removeScriptToEvaluateOnNewDocument`，否则污染后续每次导航。
 */
async function detectorSelftest(port, { injectThrottle = 0 } = {}) {
  console.log('\n— 仪表自检（注入 60ms 瞬时闪现）—');
  const base = `http://127.0.0.1:${port}/`;
  await cdp.evalJs(`localStorage.setItem(${JSON.stringify(GUIDE_KEY)}, '1')`).catch(() => undefined);
  await clearIndexedDB(`http://127.0.0.1:${port}`);
  if (injectThrottle > 0) await cdp.send('Emulation.setCPUThrottlingRate', { rate: injectThrottle });
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const show = () => {
        try {
          const mk = (id, t) => { const d = document.createElement('div'); d.id = id; d.textContent = t; document.body.appendChild(d); setTimeout(() => { try { d.remove(); } catch (e) {} }, 60); };
          mk('qa-injected-solo', ${JSON.stringify(SOLO_TEXT)});
          mk('qa-injected-soloSA', ${JSON.stringify(SOLO_SA_TEXT)});
          mk('qa-injected-wrong', ${JSON.stringify(WRONG_TEXT)});
        } catch (e) {}
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(show, 120));
      else setTimeout(show, 120);
    })();`,
  });
  await cdp.send('Page.navigate', { url: base });
  await sleep(3000);
  const qa = await readQa();
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => undefined);
  if (injectThrottle > 0) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => undefined);
  const caughtSolo = !!(qa && qa.firstSeen && qa.firstSeen.solo != null);
  const caughtSoloSA = !!(qa && qa.firstSeen && qa.firstSeen.soloSA != null);
  const caughtWrong = !!(qa && qa.firstSeen && qa.firstSeen.wrong != null);
  record(
    'P2.st 仪表自检：60ms 瞬时「只有我一个」+「还没有角色」+「这里还没有人」能被记录器捕获',
    caughtSolo && caughtSoloSA && caughtWrong,
    `solo=${caughtSolo} soloSA=${caughtSoloSA} wrong=${caughtWrong}（注入 60ms）`,
    { firstSeen: qa?.firstSeen, snaps: qa?.snaps },
  );
  return { caughtSolo, caughtSoloSA, caughtWrong };
}

/* ============================== P2 主流程 ============================== */

/** 确保落在应用 origin（about:blank 是不透明源，写不了 localStorage） */
async function ensureAtOrigin(port) {
  await nav(`http://127.0.0.1:${port}/`, { settleMs: 400 });
}

/**
 * 直接改 localStorage 里的 UI 快照把 homeLayout 切到目标值。
 * 用于「整页引导态下 v2 开关不可达」的场景（不内置版清 IDB 后就是这种态）。
 * ★ 只改 UI 快照 `ai-ai.settings.v1`，不动 IndexedDB、不动产品代码。
 */
async function setLayoutViaLocalStorage(want) {
  const res = await cdp.evalJs(
    `(() => {
       try {
         const raw = JSON.parse(localStorage.getItem('ai-ai.settings.v1'));
         if (raw && raw.state && raw.state.settings && raw.state.settings.appearance) {
           raw.state.settings.appearance.homeLayout = ${JSON.stringify(want)};
           localStorage.setItem('ai-ai.settings.v1', JSON.stringify(raw));
           return 'ok';
         }
         return 'no-shape';
       } catch (e) { return 'err:' + e.message; }
     })()`,
  );
  const now = await cdp.evalJs(
    `(() => { try { const raw = JSON.parse(localStorage.getItem('ai-ai.settings.v1')); const s = raw && raw.state ? raw.state.settings : raw; return s && s.appearance ? s.appearance.homeLayout : null; } catch { return null; } })()`,
  );
  return { set: res, now };
}

/** 通过真实 UI 把 homeLayout 切到目标值；返回切换后实际值（从 localStorage 读） */
async function setLayoutViaUi(port, want) {
  try {
    await cdp.clickText(want, '.MuiToggleButton-root');
    await sleep(600);
  } catch (e) {
    console.log(`  [warn] 切 ${want} 失败：${e.message}`);
  }
  return cdp.evalJs(
    `(() => { try { const raw = JSON.parse(localStorage.getItem('ai-ai.settings.v1')); const s = raw && raw.state ? raw.state.settings : raw; return s && s.appearance ? s.appearance.homeLayout : null; } catch { return null; } })()`,
  );
}

/**
 * 一轮「清空 IndexedDB → 硬加载首页」的复现。
 * 记录器在整个新文档生命周期里持续采样，故终态与瞬态都能读到。
 */
async function runV2Cycle(port, label) {
  await clearIndexedDB(`http://127.0.0.1:${port}`);
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

  let flashShot = null;
  const deadline = Date.now() + 9000;
  while (Date.now() < deadline) {
    const st = await cdp
      .evalJs(`window.__qa ? { solo: window.__qa.firstSeen.solo, sa: window.__qa.firstSeen.soloSA, sk: window.__qa.skeletonFirstSeen, x: window.__qa.firstSeen.xinran, f: window.__qa.frames } : null`)
      .catch(() => null);
    if (st) {
      if (st.solo != null && !flashShot) {
        flashShot = await shot(`${label}-FLASH-solo`); // 立刻截一帧真实现场
        break;
      }
      if (st.x != null && st.f > 40) break; // 已见到欣然且采样够了
    }
    await sleep(30);
  }
  await sleep(1500); // 等 bootstrap 彻底落定

  const qaObj = await readQa();
  const body = await bodyText();
  const rail = await cdp.evalJs(railHasExpr(XINRAN)).catch(() => null);
  const settledShot = await shot(`${label}-settled`);

  const fs = (qaObj && qaObj.firstSeen) || {};
  return {
    soloFlash: fs.solo != null,
    soloSAFlash: fs.soloSA != null,
    wrongFlash: fs.wrong != null,
    soloSnap: qaObj?.snaps?.solo ?? null,
    xinranAt: fs.xinran ?? null,
    skeletonSeen: !!qaObj?.skeletonSeen,
    skeletonFirstSeen: qaObj?.skeletonFirstSeen ?? null,
    skeletonMax: qaObj?.skeletonMax ?? 0,
    frames: qaObj?.frames ?? 0,
    transitions: qaObj?.transitions ?? null,
    finalHasXinran: body.includes(XINRAN),
    finalNoSolo: !body.includes(SOLO_TEXT),
    finalNoSoloSA: !body.includes(SOLO_SA_TEXT),
    finalNoWrong: !body.includes(WRONG_TEXT),
    rail,
    bodyTail: body.slice(0, 300),
    flashShot,
    settledShot,
  };
}

async function verifyV2Race(port, { flavor }) {
  console.log(`\n— P2 核心：${flavor} homeLayout=v2 + 清 IndexedDB + 硬刷新 —`);
  await ensureAtOrigin(port);
  await cdp.evalJs(`localStorage.setItem(${JSON.stringify(GUIDE_KEY)}, '1')`);
  await cdp.evalJs(`localStorage.setItem(${JSON.stringify(SEED_KEY)}, '1')`);
  await nav(`http://127.0.0.1:${port}/`, { settleMs: 1200 });
  const layoutNow = await setLayoutViaUi(port, 'v2');
  console.log(`  （homeLayout 现为：${layoutNow}）`);
  report.raw.homeLayoutAfterSetup = layoutNow;

  if (layoutNow !== 'v2') {
    record('P2.前置 v2 布局切换成功', false, `切 v2 失败，实为 ${layoutNow} —— 后续 P2 断言不可信`, { layoutNow });
  } else {
    record('P2.前置 v2 布局切换成功', true, `homeLayout=${layoutNow}`, { layoutNow });
  }

  if (THROTTLE > 0) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    console.log(`  （已设 CPU 降速 ${THROTTLE}x）`);
  }

  const cycles = [];
  for (let i = 1; i <= REPEAT; i += 1) {
    const r = await runV2Cycle(port, `P2-i${i}`);
    cycles.push(r);
    console.log(
      `  · 第 ${i} 次：soloFlash=${r.soloFlash} soloSAFlash=${r.soloSAFlash} skeleton=${r.skeletonSeen} xinranSeen=${!!r.xinranAt} rail=${JSON.stringify(r.rail)}`,
    );
  }

  if (THROTTLE > 0) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => undefined);

  // —— P2-1：错误空态「只有我一个」全程不出现 ——
  const anySolo = cycles.some((c) => c.soloFlash);
  const anySoloFinal = cycles.some((c) => !c.finalNoSolo);
  {
    const badIdx = cycles.findIndex((c) => c.soloFlash || !c.finalNoSolo);
    record(
      `P2-1 「${SOLO_TEXT}」全程不出现（${REPEAT} 次硬刷新 @ throttle=${THROTTLE || 1}x，终态+瞬态）`,
      !anySolo && !anySoloFinal,
      badIdx >= 0
        ? `出现！第 ${badIdx + 1} 轮：瞬态=${cycles[badIdx].soloFlash} 终态残留=${!cycles[badIdx].finalNoSolo}`
        : `全部 ${REPEAT} 轮终态与瞬态均未出现`,
      cycles.map((c, i) => ({ i: i + 1, soloFlash: c.soloFlash, snap: c.soloSnap, flashShot: c.flashShot, settledShot: c.settledShot })),
    );
  }

  // —— P2-2：过渡窗口内**任何空态文案**都不出现（两句都监视）——
  const anyEmptyText = cycles.filter((c) => c.soloFlash || c.soloSAFlash || c.wrongFlash).length;
  record(
    `P2-2 过渡窗口内无任何空态文案（「${SOLO_TEXT}」「${SOLO_SA_TEXT}」「${WRONG_TEXT}」三句同监）`,
    anyEmptyText === 0,
    anyEmptyText === 0 ? `全部 ${REPEAT} 轮三句均未出现` : `有 ${anyEmptyText} 轮出现空态文案`,
    cycles.map((c, i) => ({ i: i + 1, solo: c.soloFlash, soloSA: c.soloSAFlash, wrong: c.wrongFlash })),
  );

  // —— 正向证据：过渡窗口里确实渲染了骨架（loading 门闩生效），否则 P2-1 可能是"窗口根本没被触发" ——
  const skeletonSeenAll = cycles.every((c) => c.skeletonSeen);
  const skeletonSeenAny = cycles.some((c) => c.skeletonSeen);
  record(
    'P2.补助 过渡窗口确实渲染了角色轨骨架（[aria-busy] 出现 → 证明 loading 门闩被触发）',
    skeletonSeenAll,
    skeletonSeenAll
      ? `全部 ${REPEAT} 轮均观察到骨架（max 同时 ${Math.max(...cycles.map((c) => c.skeletonMax))} 个）`
      : `仅 ${cycles.filter((c) => c.skeletonSeen).length}/${REPEAT} 轮观察到骨架${skeletonSeenAny ? '' : ' —— 过渡窗口可能过短，P2-1 阴性结论说服力下降'}`,
    cycles.map((c, i) => ({ i: i + 1, skeletonSeen: c.skeletonSeen, skeletonFirstSeen: c.skeletonFirstSeen, skeletonMax: c.skeletonMax, frames: c.frames })),
  );

  // —— P2-3：防过度修复 —— 过渡结束后真卡片必须出现，角色轨内精确命中「欣然」——
  const allXinran = cycles.every((c) => c.rail && c.rail.railScopedCount > 0 && c.finalHasXinran);
  record(
    `P2-3 过渡结束后真卡片出现（角色轨内精确命中「${XINRAN}」）`,
    allXinran,
    allXinran
      ? '每轮角色轨容器内精确命中「欣然」'
      : `有 ${cycles.filter((c) => !(c.rail && c.rail.railScopedCount > 0 && c.finalHasXinran)).length} 轮未命中 —— 骨架可能卡住不动（比原缺陷更严重）`,
    cycles.map((c, i) => ({ i: i + 1, rail: c.rail, finalHasXinran: c.finalHasXinran, bodyTail: c.bodyTail })),
  );

  report.raw.v2Cycles = cycles;
  return cycles;
}

/* ============================== P2-4：v1 布局不受影响 ============================== */

async function verifyV1(port) {
  console.log('\n— P2-4：homeLayout=v1 首页正常（v1 不渲染角色轨）—');
  await ensureAtOrigin(port);
  await cdp.evalJs(`localStorage.setItem(${JSON.stringify(GUIDE_KEY)}, '1')`);
  await cdp.evalJs(`localStorage.setItem(${JSON.stringify(SEED_KEY)}, '1')`);
  await nav(`http://127.0.0.1:${port}/`, { settleMs: 1200 });
  const layoutNow = await setLayoutViaUi(port, 'v1');
  console.log(`  （homeLayout 现为：${layoutNow}）`);

  await clearIndexedDB(`http://127.0.0.1:${port}`);
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await sleep(2500);

  const qa = await readQa();
  const body = await bodyText();
  const rootOk = await cdp.evalJs(`(() => { const r = document.getElementById('root'); return !!r && r.childElementCount > 0; })()`).catch(() => false);
  const crashed = await cdp.isCrashed();
  const rail = await cdp.evalJs(railHasExpr(XINRAN)).catch(() => null);
  const skeletonNow = await cdp.evalJs(`document.querySelectorAll('[aria-busy="true"]').length`).catch(() => -1);
  const s = await shot('P2-4-v1-settled');

  const fs = (qa && qa.firstSeen) || {};
  const noEmptyText = !body.includes(SOLO_TEXT) && !body.includes(SOLO_SA_TEXT) && !body.includes(WRONG_TEXT);
  const soloNeverFlashed = fs.solo == null;
  const ok = layoutNow === 'v1' && rootOk && !crashed && noEmptyText && soloNeverFlashed;

  record(
    'P2-4 v1 首页正常渲染且不受角色轨改动影响（无崩溃/无空态文案/无残留骨架）',
    ok,
    `layout=${layoutNow} rootOk=${rootOk} crashed=${crashed} noEmptyText=${noEmptyText} soloNeverFlashed=${soloNeverFlashed} skeletonNow=${skeletonNow} railFound=${rail?.railFound}`,
    { shot: s, layoutNow, bodyHead: body.slice(0, 240), rail, skeletonNow, firstSeen: qa?.firstSeen },
  );
  report.raw.v1 = { layoutNow, rootOk, crashed, noEmptyText, soloNeverFlashed, skeletonNow, rail, bodyHead: body.slice(0, 240) };
}

/* ============================== P2-5：引导第 2 步角色轨 ============================== */

async function verifyGuideStep2(port) {
  console.log('\n— P2-5：真·首启 → /guide 第 2 步角色轨 —');
  const base = `http://127.0.0.1:${port}`;
  await ensureAtOrigin(port);
  await cdp.evalJs(`localStorage.removeItem(${JSON.stringify(GUIDE_KEY)})`);
  await clearIndexedDB(base);
  if (THROTTLE > 0) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  // ★ 尽快推进到第 2 步：不做 settle，root 一出现就找「下一步」点掉，
  //   争取在 hydration 完成**之前**挂载第 2 步 → 尽量真正压到角色轨的 loading 窗口。
  await cdp.send('Page.navigate', { url: `${base}/` });
  const deadline = Date.now() + 12000;
  let clickedNext = false;
  while (Date.now() < deadline && !clickedNext) {
    clickedNext = await cdp
      .evalJs(
        `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim().includes('下一步')); if (b) { b.click(); return true; } return false; })()`,
      )
      .catch(() => false);
    if (!clickedNext) await sleep(50);
  }
  await sleep(1800);
  const p1 = await pathname();
  const landedGuide = p1.startsWith('/guide');
  const qa = await readQa();
  const body = await bodyText();
  const rail = await cdp.evalJs(railHasExpr(XINRAN)).catch(() => null);
  const s = await shot('P2-5-guide-step2');
  if (THROTTLE > 0) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => undefined);

  const fs = (qa && qa.firstSeen) || {};
  const soloAt = fs.solo ?? null;
  const xinranAt = fs.xinran ?? null;
  // ★ 判据设计（重要）：引导第 2 步顶部**说明文案**本身就是 `empty.personas`
  //   （「只有我一个…」，见 GuidePage:212-217），它在 hydration 完成后与真卡片
  //   **同一帧**出现 —— 这是**合法**的（不是缺陷）。而缺陷（角色轨回落空态）
  //   只会在 hydration **之前**、真卡片出现**之前**闪出。
  //   ⇒ 判据 = 「只有我一个」**不得早于**「欣然」出现（同帧/之后都算合法）。
  const soloBeforeXinran = soloAt != null && (xinranAt == null || soloAt < xinranAt);
  const railOk = !!(rail && rail.railScopedCount > 0);
  const noWrong = !body.includes(WRONG_TEXT);
  const ok = landedGuide && !soloBeforeXinran && railOk && noWrong;

  record(
    'P2-5 引导第 2 步：不闪「先于真卡片」的错误空态 + 终态角色轨有「欣然」',
    ok,
    `landedGuide=${landedGuide} path=${p1} soloBeforeXinran=${soloBeforeXinran}(solo@${soloAt}/xinran@${xinranAt}) noWrong=${noWrong} railScoped=${rail?.railScopedCount} 压到loading窗口=${!!qa?.skeletonSeen}`,
    { shot: s, rail, firstSeen: qa?.firstSeen, skeletonSeen: qa?.skeletonSeen, soloBeforeXinran, bodyHead: body.slice(0, 260) },
  );
  report.raw.guideStep2 = {
    landedGuide,
    path: p1,
    soloAt,
    xinranAt,
    soloBeforeXinran,
    noWrong,
    rail,
    skeletonSeen: qa?.skeletonSeen,
    firstSeen: qa?.firstSeen,
    bodyHead: body.slice(0, 260),
  };
}

/* ============================== 负对照（补丁产物副本） ============================== */

/** 手写递归复制（sync fs 读写安全；避开 cpSync 的 EIO 与 safe-delete 守卫）。只复制、不删除。 */
function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else copyFileSync(s, d);
  }
}

/**
 * ★ 负对照：把 builtin 构建产物**复制一份**，在 minified 的 PersonaRail chunk 里
 *   把 `loading` 门闩去掉（`a.length===0&&p?` → `a.length===0&&!1?`），
 *   使空 + 加载中时**回落到空态文案**（= 修复前行为），再跑同一套 P2 流程。
 *   目的：证明本脚本的 P2-1 判据**真的能抓到**这个缺陷（有分辨力），而不是"恰好通过"。
 *   ★ 只改 `.qa-tmp/` 下的副本，`src/` 一字未动。
 */
async function verifyNegControlP2() {
  console.log('\n— P2 负对照（补丁产物副本：去掉 loading 门闩）—');
  const src = FLAVORS.builtin;
  const buggy = path.join(TMP, 'builtin-negctl');
  copyTree(src, buggy);
  const assetsDir = path.join(buggy, 'assets');

  // 精确定位修复后的 minified 分支：`.length===0&&<loadingVar>?t.jsx(<Box>,{"aria-busy":...`
  const RE = /(\.length===0&&)(\w+)(\?t\.jsx\(\w+,\{"aria-busy")/;
  let patchedFile = null;
  for (const f of readdirSync(assetsDir)) {
    if (!f.endsWith('.js')) continue;
    const p = path.join(assetsDir, f);
    const txt = readFileSync(p, 'utf8');
    if (RE.test(txt)) {
      writeFileSync(p, txt.replace(RE, '$1!1$3'));
      patchedFile = f;
      break;
    }
  }
  if (!patchedFile) throw new Error('未在产物副本里找到 PersonaRail 的 loading 门闩（aria-busy 分支），无法构造负对照');
  console.log(`  已补丁：assets/${patchedFile}（loading 门闩已去掉 → 回落空态）`);
  report.raw.negctlP2 = { patchedFile };

  const port = 4186;
  const served = await serveStatic(buggy, port);
  const oldBase = report.base;
  report.base = served.base;
  try {
    await ensureAtOrigin(port);
    await cdp.evalJs(`localStorage.setItem(${JSON.stringify(GUIDE_KEY)}, '1')`);
    await cdp.evalJs(`localStorage.setItem(${JSON.stringify(SEED_KEY)}, '1')`);
    await nav(`http://127.0.0.1:${port}/`, { settleMs: 1200 });
    const layoutNow = await setLayoutViaUi(port, 'v2');
    console.log(`  （negctl homeLayout 现为：${layoutNow}）`);
    if (THROTTLE > 0) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

    const cycles = [];
    for (let i = 1; i <= REPEAT; i += 1) {
      const r = await runV2Cycle(port, `P2-negctl-i${i}`);
      cycles.push(r);
      console.log(`  · negctl 第 ${i} 次：soloFlash=${r.soloFlash} skeleton=${r.skeletonSeen} rail=${JSON.stringify(r.rail)}`);
    }
    if (THROTTLE > 0) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => undefined);

    const reproduced = cycles.some((c) => c.soloFlash);
    record(
      'P2.negctl 还原修复前行为 → 同一判据确实抓到「只有我一个」瞬态闪现（证明判据有分辨力）',
      reproduced,
      reproduced
        ? `复现成功：${cycles.filter((c) => c.soloFlash).length}/${REPEAT} 轮抓到闪出`
        : `未复现（判据可能无分辨力）：${JSON.stringify(cycles.map((c) => ({ soloFlash: c.soloFlash, skeletonSeen: c.skeletonSeen })))}`,
      cycles.map((c, i) => ({ i: i + 1, soloFlash: c.soloFlash, skeletonSeen: c.skeletonSeen, flashShot: c.flashShot, snap: c.soloSnap })),
    );
    report.raw.negctlP2Cycles = cycles;
  } finally {
    served.server.close();
    report.base = oldBase;
  }
}

/* ============================== 不内置版 bonus ============================== */

async function verifyStandaloneP2(port) {
  console.log('\n— 不内置版 P2 等价复测（bonus）：v2 过渡窗口不闪角色轨空态文案 —');
  await ensureAtOrigin(port);
  await cdp.evalJs(`localStorage.setItem(${JSON.stringify(GUIDE_KEY)}, '1')`);
  await cdp.evalJs(`localStorage.setItem(${JSON.stringify(SEED_KEY)}, '1')`);
  // 不内置版清 IDB 后没有角色 → 首页很快变成整页引导（NoPersonaGuide），v2 开关不可达。
  // ⇒ 直接改 UI 快照把 homeLayout 强制为 v2，才能压到角色轨的 loading 窗口。
  const setRes = await setLayoutViaLocalStorage('v2');
  console.log(`  （强制 v2：set=${setRes.set} now=${setRes.now}）`);
  if (THROTTLE > 0) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  const cycles = [];
  for (let i = 1; i <= REPEAT; i += 1) {
    const r = await runV2Cycle(port, `P2-sa-i${i}`);
    cycles.push(r);
    console.log(`  · 第 ${i} 次：soloSAFlash=${r.soloSAFlash} soloFlash=${r.soloFlash} wrongFlash=${r.wrongFlash}(整页引导,预期) skeleton=${r.skeletonSeen}`);
  }
  if (THROTTLE > 0) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => undefined);

  const layoutV2 = setRes.now === 'v2';
  const anyRailEmpty = cycles.some((c) => c.soloFlash || c.soloSAFlash); // ★ 只判「角色轨空态」，不含整页引导
  const skeletonAny = cycles.some((c) => c.skeletonSeen);
  const guideAny = cycles.filter((c) => c.wrongFlash).length;
  record(
    'P2.bonus 不内置版清 IDB 硬刷新：角色轨过渡窗口不闪角色轨空态文案（「还没有角色」/「只有我一个」）',
    layoutV2 && !anyRailEmpty,
    !layoutV2
      ? `未强制到 v2（now=${setRes.now}）→ 未压到角色轨，结论不可用`
      : anyRailEmpty
        ? '出现角色轨空态文案闪现'
        : `全部 ${REPEAT} 轮无角色轨空态闪现（整页引导「这里还没有人」按预期出现 ${guideAny}/${REPEAT}；骨架窗口命中=${skeletonAny}）`,
    cycles.map((c, i) => ({ i: i + 1, solo: c.soloFlash, soloSA: c.soloSAFlash, wrong: c.wrongFlash, skeletonSeen: c.skeletonSeen })),
  );
  report.raw.standalone = { setRes, layoutV2, anyRailEmpty, skeletonAny, guideAny, cycles };
}

/* ================================ main ================================ */

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(TMP, { recursive: true });
  const dir = args.dir ? path.resolve(String(args.dir)) : FLAVORS[FLAVOR];
  if (!dir) throw new Error(`未知 flavor：${FLAVOR}`);
  report.productDir = dir;
  console.log(`\n=== P2 专项复测 @ ${TS} ===`);
  console.log(`flavor=${FLAVOR} mode=${MODE} repeat=${REPEAT} throttle=${THROTTLE || 1}x`);
  console.log(`产物目录：${dir}`);
  console.log(`输出目录：${OUT}\n`);

  const port = 4185;
  const debugPort = FLAVOR === 'builtin' ? 9245 : 9246;

  try {
    const served = await serveStatic(dir, port);
    server = served.server;
    report.base = served.base;
    console.log(`静态服务就绪：${served.base}`);

    browser = await startBrowser({ port: debugPort, profileDir: path.join(TMP, 'profile'), freshProfile: true });
    cdp = await Cdp.attach(debugPort);
    await cdp.enableDomains();
    await cdp.send('Network.enable');
    // 阻断 SW：避免首次加载注册的 SW 干扰后续硬刷新
    await cdp.send('Network.setBlockedURLs', { urls: ['*/sw.js', '*service-worker*'] }).catch(() => undefined);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: recorderSource(recorderMarkers()) });

    if (MODE === 'selftest') {
      await detectorSelftest(port);
    } else if (MODE === 'negctl') {
      await verifyNegControlP2();
    } else {
      // verify：先自检（仪表可信），再跑 P2 核心 + v1 + 引导
      await detectorSelftest(port);
      if (FLAVOR === 'builtin') {
        await verifyV2Race(port, { flavor: FLAVOR });
        await verifyV1(port);
        await verifyGuideStep2(port);
      } else {
        await verifyStandaloneP2(port);
      }
    }
  } catch (e) {
    console.error('\n[致命]', e);
    report.fatal = String(e.stack ?? e);
  } finally {
    cdp?.close();
    killTree(browser?.child);
    server?.close();
  }

  const failed = report.assertions.filter((a) => !a.ok);
  report.summary = {
    total: report.assertions.length,
    passed: report.assertions.filter((a) => a.ok).length,
    failed: failed.length,
    fatal: report.fatal ?? null,
    finishedAt: new Date().toISOString(),
  };

  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(path.join(OUT, 'report.md'), renderMd(report));

  console.log('\n===== 汇总 =====');
  console.log(`断言：${report.summary.passed}/${report.summary.total} 通过，${report.summary.failed} 失败`);
  for (const a of failed) console.log(`  - ${a.id} → ${a.note}`);
  console.log(`报告：${path.join(OUT, 'report.json')}`);
  if (report.fatal) console.error(`\n[致命] ${report.fatal}`);

  process.exitCode = failed.length > 0 || report.fatal ? 1 : 0;
}

function renderMd(r) {
  const L = [];
  L.push(`# P2 专项复测报告（${r.flavor}）`, '');
  L.push(`- 模式：${r.mode} ｜ 硬刷新次数：${r.repeat} ｜ CPU 降速：${r.throttle || 1}x`);
  L.push(`- 产物目录：${r.productDir}`);
  L.push(`- base：${r.base}`);
  L.push(`- 断言：${r.summary.passed}/${r.summary.total} 通过，${r.summary.failed} 失败`);
  L.push('');
  L.push('## 断言逐条');
  L.push('| 断言 | 结果 | 备注 |');
  L.push('|---|---|---|');
  for (const a of r.assertions) L.push(`| ${a.id} | ${a.ok ? '✅ PASS' : '❌ FAIL'} | ${String(a.note).replace(/\n/g, ' ')} |`);
  L.push('');
  L.push('## 证据截图');
  for (const s of r.shots) L.push(`- ${s}`);
  L.push('');
  L.push('## 原始数据');
  L.push('```json');
  L.push(JSON.stringify(r.raw, null, 2));
  L.push('```');
  return L.join('\n');
}

main().catch((e) => {
  console.error('[脚本异常]', e);
  process.exitCode = 2;
});
