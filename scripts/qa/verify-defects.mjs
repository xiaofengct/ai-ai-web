/**
 * ★ 双缺陷独立验证（可复跑，非一次性脚本）。
 *
 * 覆盖两处**已修复**缺陷：
 *   A. 内置版「空态误显示」竞态 —— 首启不得闪出整页「这里还没有人」引导，角色轨须有「欣然」。
 *   B. 不内置版「导入后选中值停在幻影 id」—— 导入角色后新建会话，会话必须绑到**真实导入的**角色。
 *
 * 设计要点（遵守本沙箱硬约束）：
 *   - 一律用**异步** spawn / fetch（同步子进程 API 在本机全线 EBUSY）；
 *   - 自己写静态服务，直接 serve 已构建产物目录（**不做 copy/rm**，绕开 safe-delete 守卫与 EIO）；
 *   - 清 IndexedDB 用 CDP `Storage.clearDataForOrigin`（不依赖页面 JS 上下文）；
 *   - 竞态检测用「document-start 注入的记录器」（MutationObserver + setInterval），
 *     捕获瞬时空态闪出，单次截图捕不到的东西它捕得到。
 *
 * 用法：
 *   node scripts/qa/verify-defects.mjs --flavor=builtin --mode=verify
 *   node scripts/qa/verify-defects.mjs --flavor=standalone --mode=verify
 *   node scripts/qa/verify-defects.mjs --flavor=builtin --mode=verify --repeat=5
 *   node scripts/qa/verify-defects.mjs --flavor=builtin --mode=verify --throttle=8
 *   node scripts/qa/verify-defects.mjs --flavor=standalone --mode=dump   # 只看真实渲染（写断言前先探）
 *
 * ★ 退出码用重定向取：`... > log 2>&1; echo $?`（管道会吃掉退出码）。
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, readdirSync, copyFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Cdp, sleep } from './lib/cdp.mjs';
import { PROJECT_ROOT, startBrowser, killTree } from './lib/harness.mjs';

const TS = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(PROJECT_ROOT, 'scripts', 'qa', 'out', `defects-${TS}`);
const SHOTS = path.join(OUT, 'shots');
const TMP = path.join(PROJECT_ROOT, '.qa-tmp', `defects-${TS}`);

const FLAVORS = {
  builtin: path.join(PROJECT_ROOT, 'android', 'app', 'src', 'builtin', 'assets', 'public'),
  standalone: path.join(PROJECT_ROOT, 'android', 'app', 'src', 'standalone', 'assets', 'public'),
};

const DB = 'ai-ai-web';
const GUIDE_KEY = 'ai-ai.guide.v1';
const SEED_KEY = 'ai-ai.seeded.v1';
const WRONG_TEXT = '这里还没有人';      // HomePage 整页空态引导（内置版**不该**出现）
const SOLO_TEXT = '只有我一个';          // PersonaRail 空态（以"欣然已存在"为前提）
const PERSONA_SOLO_TEXT = '还没有角色';  // PersonaRail standalone 空态
const PERSONAS_EMPTY_TITLE = '我们说过的话';
const IMPORT_PERSONA_NAME = 'QA测试卡';  // fixtures/persona-sample.json 里的 name
const PHANTOM_ID = 'persona-xinran-builtin'; // XINRAN_PERSONA_ID（不内置版里永不存在的幻影 id）

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
  assertions: [], // { id, ok, note, evidence }
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
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
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
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(readFileSync(filePath));
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  await new Promise((ok) => serverInst.listen(port, '127.0.0.1', ok));
  return { server: serverInst, port, base: `http://127.0.0.1:${port}` };
}

/* ============================== CDP 辅助 ============================== */

/** document-start 注入：记录 body 文本里是否出现过目标串（捕获瞬时闪出） */
function recorderSource(markers) {
  const M = JSON.stringify(markers);
  return `(() => {
    const M = ${M};
    const qa = window.__qa = { firstSeen: {}, snaps: {}, frames: 0, transitions: [], t0: Date.now() };
    let lastSig = '';
    const probe = () => {
      let txt = '';
      try { txt = document.body ? document.body.innerText : ''; } catch (e) { txt = ''; }
      qa.frames++;
      for (const k in M) {
        const s = M[k];
        if (s && txt.indexOf(s) >= 0 && qa.firstSeen[k] == null) {
          qa.firstSeen[k] = Date.now();
          qa.snaps[k] = txt.slice(0, 200);
        }
      }
      const sig = Object.keys(M).map((k) => (txt.indexOf(M[k]) >= 0 ? k[0] : '-')).join('') + ':' + txt.length;
      if (sig !== lastSig) { lastSig = sig; qa.transitions.push({ t: Date.now(), sig }); if (qa.transitions.length > 150) qa.transitions.shift(); }
    };
    setInterval(probe, 10);
    try {
      const mo = new MutationObserver(() => probe());
      const start = () => { if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true }); else setTimeout(start, 1); };
      start();
    } catch (e) {}
    requestAnimationFrame(function loop() { probe(); requestAnimationFrame(loop); });
  })();`;
}

/** 记录器标记（按 flavor 选「空态文本」） */
function recorderMarkers() {
  return {
    wrong: WRONG_TEXT,
    xinran: '欣然',
    emptyRail: FLAVOR === 'builtin' ? SOLO_TEXT : PERSONA_SOLO_TEXT,
  };
}

async function readQa() {
  const raw = await cdp.evalJs('JSON.stringify(window.__qa || null)').catch(() => 'null');
  return raw && raw !== 'null' ? JSON.parse(raw) : null;
}

/** 清空 IndexedDB（保留 localStorage），CDP 层直接清，避免页面连接占用导致 deleteDatabase 被阻塞 */
async function clearIndexedDB(origin) {
  await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'indexeddb' });
}

async function bodyText() {
  return cdp.evalJs(`document.body ? document.body.innerText : ''`);
}
async function pathname() {
  return cdp.evalJs(`location.pathname + location.search`);
}
async function origin() {
  return cdp.evalJs(`location.origin`).catch(() => '');
}

/** 导航并等到应用落定（root 有内容 + 记录器已采样若干帧） */
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

/** 精确判断"角色轨里出现某个角色名"：找 trimmed 文本 === name 的节点 */
function railHasExpr(name) {
  return `(() => {
    const want = ${JSON.stringify(name)};
    const exact = [...document.querySelectorAll('p, span, div')].filter((e) => (e.textContent || '').trim() === want);
    const typo = [...document.querySelectorAll('.MuiTypography-root')].filter((e) => (e.textContent || '').trim() === want);
    const cards = [...document.querySelectorAll('.MuiPaper-root')].filter((p) => (p.textContent || '').trim().includes(want));
    // ★ 角色轨专属容器：横向滚动(overflowX:auto) + 内含角色卡(MuiPaper)，排除会话列表里的角色名 chip
    const rail = [...document.querySelectorAll('div')].find((d) => {
      try {
        const cs = getComputedStyle(d);
        return cs.overflowX === 'auto' && d.querySelectorAll('.MuiPaper-root').length > 0 && d.getBoundingClientRect().width > 0;
      } catch (e) { return false; }
    });
    const scoped = rail ? [...rail.querySelectorAll('.MuiTypography-root')].filter((e) => (e.textContent || '').trim() === want).length : 0;
    return { nameNodeCount: exact.length, typographyCount: typo.length, cardCount: cards.length, railScopedCount: scoped, railFound: !!rail };
  })()`;
}

/* ==================== 检测器自检 / 放大竞态 ==================== */

/**
 * 检测器自检：注入一段**60ms 瞬时**闪现的「这里还没有人」，验证记录器能捕获。
 * 这是仪表校验（instrument validation），不是产品断言 —— 若连它都捕不到，
 * 那么 A.a 的"阴性结论"就没有说服力。
 */
async function detectorSelftest(port) {
  console.log('\n— 检测器自检（注入 60ms 瞬时闪现）—');
  const base = `http://127.0.0.1:${port}/`;
  await cdp.evalJs(`localStorage.setItem(${JSON.stringify(GUIDE_KEY)}, '1')`).catch(() => undefined);
  await clearIndexedDB(`http://127.0.0.1:${port}`);
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const show = () => {
        try {
          const d = document.createElement('div');
          d.id = 'qa-injected-flash';
          d.textContent = ${JSON.stringify(WRONG_TEXT)};
          document.body.appendChild(d);
          setTimeout(() => { try { d.remove(); } catch (e) {} }, 60);
        } catch (e) {}
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(show, 120));
      else setTimeout(show, 120);
    })();`,
  });
  await cdp.send('Page.navigate', { url: base });
  await sleep(3000);
  const qa = await readQa();
  const caught = !!(qa && qa.firstSeen && qa.firstSeen.wrong != null);
  // ★ 必须移除注入脚本：否则它会在后续每次导航里都注入闪现，污染竞态检测
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => undefined);
  record(
    'A.detector 自检：60ms 瞬时闪现能被记录器捕获',
    caught,
    caught ? `捕获到（wrongAt=${qa.firstSeen.wrong}）` : '未捕获 —— 记录器分辨率不足，A.a 阴性结论不可信',
    qa,
  );
  return caught;
}

/* ================== 缺陷 B 负对照（补丁"构建产物副本"，不动 src/）================== */

/** 手写递归复制（sync fs 读写安全；避开 cpSync 的 EIO 与 safe-delete 守卫） */
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
 * ★ 负对照：把 standalone 构建产物**复制一份**，把 `pickCurrentId`
 *   在 minified bundle 里**还原成修复前的写法**（`some(prev)?prev:XINRAN`），
 *   然后跑同一套 B.c 流程。
 *
 *   目的：证明我的 B.c 判据**真的能抓到**这个缺陷（有分辨力），
 *        而不是"恰好通过"。★ 只改 `.qa-tmp/` 下的副本，`src/` 一字未动。
 */
async function verifyNegControlB() {
  console.log('\n— 缺陷 B 负对照（补丁产物副本，还原幻影回落）—');
  const src = FLAVORS.standalone;
  const buggy = path.join(TMP, 'standalone-buggy-copy');
  copyTree(src, buggy);
  const assetsDir = path.join(buggy, 'assets');
  const BEFORE = 't!==void 0&&e.some(n=>n.id===t)?t:e.some(n=>n.id===Oe)?Oe:e[0]?.id';
  const AFTER = 'e.some(n=>n.id===t)?t:Oe';
  let patchedFile = null;
  for (const f of readdirSync(assetsDir)) {
    if (!f.endsWith('.js')) continue;
    const p = path.join(assetsDir, f);
    const txt = readFileSync(p, 'utf8');
    if (txt.includes(BEFORE)) {
      writeFileSync(p, txt.replace(BEFORE, AFTER));
      patchedFile = f;
      break;
    }
  }
  if (!patchedFile) throw new Error('未在产物副本里找到 pickCurrentId 的 minified 片段，无法构造负对照');
  console.log(`  已补丁：assets/${patchedFile}（还原为 ${AFTER}）`);

  const port = 4183;
  const served = await serveStatic(buggy, port);
  const base = `http://127.0.0.1:${port}`;
  try {
    // 该 origin 的 localStorage/IndexedDB 都是全新的（端口不同 = 不同 origin）
    await nav(`${base}/`, { settleMs: 800 });
    await cdp.evalJs(`localStorage.setItem(${JSON.stringify(GUIDE_KEY)}, '1')`);
    await clearIndexedDB(base);
    await nav(`${base}/`, { settleMs: 1500 });

    const imp = await importPersonaViaHome(port);
    const created = await createSessionViaDialog(port);
    const s = created.ok && created.newOnes.length >= 1 ? created.newOnes[created.newOnes.length - 1] : null;
    const importedId = (imp.after?.rows ?? []).find((r) => r.name === IMPORT_PERSONA_NAME)?.id;
    const reproduced = !!s && s.personaId === PHANTOM_ID && s.personaId !== importedId;
    record(
      'A/B.negctl 负对照：还原幻影回落 → 会话确实绑到幻影 id（证明判据有分辨力）',
      reproduced,
      reproduced
        ? `复现成功：personaId=${s.personaId} title=${JSON.stringify(s.title)}（≠ 导入的 ${importedId}）`
        : `未复现：session=${JSON.stringify(s)} importedId=${importedId}`,
      { patchedFile, session: s, importedId, allNewSessions: created.newOnes },
    );
    report.raw.negControlB = { patchedFile, session: s, importedId };
  } finally {
    served.server.close();
  }
}

/**
 * 真·首启路径：删 guide 标记 + 清 IndexedDB → 应被 RequireGuide 拦到 /guide；
 * 走到第 2 步（人设）时角色轨须有「欣然」。
 * ★ 诚实声明：这一步靠"用户点击"推进，时序上比竞态窗口晚，**对瞬时闪现分辨力弱**；
 *   它的价值在验证"真首启的整页不是错误引导 + 角色轨确实渲染出欣然"。
 */
async function verifyGuideFirstLaunch(port) {
  console.log('\n— 缺陷 A（真·首启 → /guide 角色轨）—');
  const base = `http://127.0.0.1:${port}`;
  await cdp.evalJs(`localStorage.removeItem(${JSON.stringify(GUIDE_KEY)})`);
  await clearIndexedDB(base);
  await nav(`${base}/`, { settleMs: 1200 });
  const p1 = await pathname();
  const landedGuide = p1.startsWith('/guide');
  // 内置版 4 步：第 1 步=接入模型，点「下一步」→ 第 2 步（人设）
  await cdp.clickText('下一步').catch(() => undefined);
  await sleep(1200);
  const rail = await cdp.evalJs(railHasExpr('欣然')).catch(() => null);
  const body = await bodyText();
  const qa = await readQa();
  const emptyRailSeen = !!(qa && qa.firstSeen && qa.firstSeen.emptyRail != null);
  const shotG = await shot('A-guide-first-launch');
  const ok = landedGuide && !!(rail && rail.railScopedCount > 0) && !body.includes(WRONG_TEXT);
  record(
    'A.c 真·首启落到 /guide 且第 2 步角色轨有「欣然」（非整页错误引导）',
    ok,
    `landedGuide=${landedGuide} path=${p1} railScoped=${rail?.railScopedCount} 首启曾闪「${SOLO_TEXT}」=${emptyRailSeen}`,
    { shot: shotG, rail, emptyRailSeen, emptyRailSnap: qa?.snaps?.emptyRail },
  );
  report.raw.guideFirstLaunch = { landedGuide, path: p1, rail, emptyRailSeen };
  return emptyRailSeen;
}

/* ======================== 缺陷 A：内置版空态竞态 ======================== */

async function ensureAtOrigin(port) {
  // 先落到应用 origin 才能写 localStorage（about:blank 是不透明源）
  await nav(`http://127.0.0.1:${port}/`, { settleMs: 400 });
}

/**
 * 一轮「清空 IndexedDB → 硬加载首页」的首启复现。
 * 返回 { wrongFlash, wrongSnippet, xinranAt, transitions, finalHasXinran, rail, noGuide, bodyTail }
 */
async function runBuiltinCycle(port, label) {
  await clearIndexedDB(`http://127.0.0.1:${port}`);
  // 重新导航前把记录器重置（新文档会自动新建 window.__qa，无需手动）
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

  // Node 侧tight 轮询：一旦记录器报出"闪出"，立刻截一帧真实截图
  let flashShot = null;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const st = await cdp
      .evalJs(`window.__qa ? { w: window.__qa.firstSeen.wrong, f: window.__qa.frames, x: window.__qa.firstSeen.xinran } : null`)
      .catch(() => null);
    if (st && st.w != null && !flashShot) {
      flashShot = await shot(`${label}-FLASH-wrong-guide`);
      break;
    }
    if (st && st.x != null && st.f > 30) break; // 已见到欣然且采样够了
    await sleep(40);
  }
  await sleep(1500); // 等 bootstrap 彻底落定

  const qaObj = await readQa();
  const body = await bodyText();
  const rail = await cdp.evalJs(railHasExpr('欣然')).catch(() => null);
  const noGuide = !body.includes(WRONG_TEXT);
  const settledShot = await shot(`${label}-settled`);

  const fs = (qaObj && qaObj.firstSeen) || {};
  return {
    wrongFlash: fs.wrong != null,
    wrongSnippet: qaObj && qaObj.snaps ? qaObj.snaps.wrong : null,
    xinranAt: fs.xinran ?? null,
    emptyRailAt: fs.emptyRail ?? null,
    emptyRailSnap: qaObj && qaObj.snaps ? qaObj.snaps.emptyRail : null,
    transitions: qaObj ? qaObj.transitions : null,
    durationMs: fs.wrong != null && fs.xinran != null ? fs.xinran - fs.wrong : null,
    finalHasXinran: body.includes('欣然'),
    finalNoWrongGuide: noGuide,
    rail,
    bodyTail: body.slice(0, 300),
    flashShot,
    settledShot,
  };
}

async function verifyBuiltin(port) {
  console.log('\n— 缺陷 A（内置版）—');
  // ★ 先跑检测器自检：证明"记录器能捕获瞬时闪现"，A.a 的阴性结论才有意义
  await detectorSelftest(port);
  // 先把 homeLayout 切到 v2（角色轨可见），并写 guide 标记（模拟"老用户清了 IndexedDB"）
  await ensureAtOrigin(port);
  // 通过真实 UI 把布局切 v2（走产品代码，不手搓 localStorage）
  await cdp.evalJs(`localStorage.setItem(${JSON.stringify(GUIDE_KEY)}, '1')`);
  await cdp.evalJs(`localStorage.setItem(${JSON.stringify(SEED_KEY)}, '1')`);
  await nav(`http://127.0.0.1:${port}/`, { settleMs: 1200 });
  try {
    await cdp.clickText('v2', '.MuiToggleButton-root');
    await sleep(600);
  } catch (e) {
    console.log(`  [warn] 切 v2 失败：${e.message}`);
  }
  const layoutNow = await cdp.evalJs(`(() => { try { const raw = JSON.parse(localStorage.getItem('ai-ai.settings.v1')); const s = raw && raw.state ? raw.state.settings : raw; return s && s.appearance ? s.appearance.homeLayout : null; } catch { return null; } })()`);
  console.log(`  （homeLayout 现为：${layoutNow}）`);

  // CPU 降速（可选，用于放大竞态）
  if (THROTTLE > 0) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    console.log(`  （已设 CPU 降速 ${THROTTLE}x）`);
  }

  const cycles = [];
  for (let i = 1; i <= REPEAT; i += 1) {
    const r = await runBuiltinCycle(port, `A-i${i}`);
    cycles.push(r);
    console.log(`  · 第 ${i} 次：wrongFlash=${r.wrongFlash} xinranSeen=${!!r.xinranAt} finalRail=${JSON.stringify(r.rail)}`);
  }

  if (THROTTLE > 0) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => undefined);
  }

  const anyFlash = cycles.some((c) => c.wrongFlash);
  const allHaveXinran = cycles.every((c) => c.finalHasXinran && c.rail && c.rail.railScopedCount > 0);
  const allNoWrong = cycles.every((c) => c.finalNoWrongGuide);

  record(
    `A.a 首启不出现「${WRONG_TEXT}」(${REPEAT} 次硬刷新, throttle=${THROTTLE || 1}x)`,
    !anyFlash && allNoWrong,
    anyFlash ? `捕获到闪出！首次于第 ${cycles.findIndex((c) => c.wrongFlash) + 1} 轮` : `全部 ${REPEAT} 轮均未出现`,
    cycles.map((c, i) => ({ i: i + 1, wrongFlash: c.wrongFlash, flashShot: c.flashShot, settledShot: c.settledShot })),
  );
  record(
    `A.b 首启角色轨有「欣然」(${REPEAT} 次)`,
    allHaveXinran,
    allHaveXinran ? '每轮角色轨容器内精确命中「欣然」' : `有 ${cycles.filter((c) => !(c.rail && c.rail.railScopedCount > 0)).length} 轮未命中`,
    cycles.map((c, i) => ({ i: i + 1, rail: c.rail, finalBodyHead: c.bodyTail })),
  );

  report.raw.builtinCycles = cycles;
  report.raw.homeLayoutAfterSetup = layoutNow;
  // ★ 新观察（非本次要求的断言）：HomePage v2 在 personas 落地前，角色轨会短暂渲染
  //   「只有我一个」（EmptyState empty.personas）。若观察到，作为新缺陷如实记录。
  const emptyRailFlashes = cycles.filter((c) => c.emptyRailAt != null).length;
  report.raw.observation_homeRailTransientEmpty = emptyRailFlashes;
  if (emptyRailFlashes > 0) {
    console.log(`  [观察] ${emptyRailFlashes}/${REPEAT} 轮中，首页角色轨曾短暂出现「${SOLO_TEXT}」（personas 落地前的过渡态）`);
  }

  // —— A.c：真·首启路径（走 /guide）——
  await verifyGuideFirstLaunch(port);
}

/* ==================== 缺陷 B：不内置版幻影 id ==================== */

/** 在首页整页引导块上点「导入人设」→ 人设弹窗 → 导入 → 确认，返回是否成功 */
async function importPersonaViaHome(port) {
  const before = await cdp.storeDump(DB, 'personas', '(r)=>({id:r.id,name:r.data&&r.data.name,isBuiltin:r.isBuiltin})');
  // 引导块上的「导入人设」按钮
  await cdp.clickText('导入人设');
  await cdp.waitFor(`document.querySelectorAll('[role="dialog"]').length >= 1`, { timeoutMs: 6000 });
  await shot('B-import-persona-dialog');
  // 人设页里的「导入」按钮 → 打开 PersonaImportDialog
  const openedImport = await cdp.evalJs(
    `(() => {
       const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '导入' && x.getBoundingClientRect().width > 0 && !x.disabled);
       if (!b) return false; b.click(); return true;
     })()`,
  );
  if (!openedImport) return { ok: false, reason: '找不到人设页里的「导入」按钮', before };
  await cdp.waitFor(`document.querySelectorAll('[role="dialog"]').length >= 2`, { timeoutMs: 6000 });
  const fixture = readFileSync(path.join(PROJECT_ROOT, 'scripts', 'qa', 'fixtures', 'persona-sample.json'), 'utf8');
  const drop = await cdp.dropFile({ nth: -1, name: 'persona-sample.json', content: fixture, mime: 'application/json' });
  await cdp.waitFor(`document.body.innerText.includes('成了') || document.body.innerText.includes('成功')`, { timeoutMs: 6000 }).catch(() => false);
  await sleep(700);
  const confirmed = await cdp.evalJs(
    `(() => {
       const dlgs = [...document.querySelectorAll('[role="dialog"]')];
       const dlg = dlgs[dlgs.length - 1];
       const btn = [...dlg.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '导入');
       if (!btn || btn.disabled) return false; btn.click(); return true;
     })()`,
  );
  await sleep(2500);
  const after = await cdp.storeDump(DB, 'personas', '(r)=>({id:r.id,name:r.data&&r.data.name,isBuiltin:r.isBuiltin,origin:r.origin})');
  const added = (after.rows ?? []).filter((r) => r.name === IMPORT_PERSONA_NAME);
  return { ok: confirmed && added.length >= 1, reason: confirmed ? '' : '导入确认按钮不可用', drop, before, after, added };
}

/** 导入后新建会话：真开弹窗 → 真点确认 → 从 IndexedDB 读回会话 */
async function createSessionViaDialog(port) {
  // 关掉可能残留的弹窗
  await cdp.evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(400);
  // 回到首页
  await nav(`http://127.0.0.1:${port}/`, { settleMs: 1200 });
  const homeBody = await bodyText();
  const stillGuide = homeBody.includes(WRONG_TEXT);

  const beforeSessions = await cdp.storeDump(DB, 'sessions', '(r)=>({id:r.id,title:r.title,personaId:r.personaId})');

  // 打开新建会话弹窗
  const clickedNew = await cdp.evalJs(
    `(() => {
       const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim().includes('新建会话') && x.getBoundingClientRect().width > 0);
       if (!b) return false; b.click(); return true;
     })()`,
  );
  if (!clickedNew) return { ok: false, reason: '找不到「新建会话」按钮', stillGuide, beforeSessions };
  await cdp.waitFor(`document.querySelector('[role="dialog"]') !== null`, { timeoutMs: 5000 });
  await sleep(400);

  // 探针：弹窗里当前选中的角色 + 标题输入框的值
  const dialogProbe = await cdp.evalJs(
    `(() => {
       const dlgs = [...document.querySelectorAll('[role="dialog"]')];
       const dlg = dlgs[dlgs.length - 1];
       if (!dlg) return null;
       const inputs = [...dlg.querySelectorAll('input')].map((i) => ({ value: i.value, placeholder: i.placeholder }));
       // 被选中角色卡：边框 primary 的那张（避免依赖颜色，改用 aria/文本近似）
       const selected = [...dlg.querySelectorAll('.MuiPaper-root')].filter((p) => {
         const txt = (p.textContent || '').trim();
         return txt.includes(${JSON.stringify(IMPORT_PERSONA_NAME)});
       }).length;
       return { inputs, selected };
     })()`,
  );
  await shot('B-before-create');

  const confirmed = await cdp.evalJs(
    `(() => {
       const dlgs = [...document.querySelectorAll('[role="dialog"]')];
       const dlg = dlgs[dlgs.length - 1];
       const btns = [...dlg.querySelectorAll('button')];
       // NewSessionDialog 的确认键文案 = t('common.confirm') = '好'
       const b = btns.find((x) => ['好', '确认', '确定', '创建'].includes((x.innerText || '').trim()));
       if (!b) return { ok: false, texts: btns.map((x) => (x.innerText || '').trim()) };
       if (b.disabled) return { ok: false, reason: 'disabled', texts: btns.map((x) => (x.innerText || '').trim()) };
       b.click(); return { ok: true, clicked: (b.innerText || '').trim() };
     })()`,
  );
  await sleep(2500);

  const afterSessions = await cdp.storeDump(DB, 'sessions', '(r)=>({id:r.id,title:r.title,personaId:r.personaId,createdAt:r.createdAt})');
  const beforeIds = new Set((beforeSessions.rows ?? []).map((s) => s.id));
  const newOnes = (afterSessions.rows ?? []).filter((s) => !beforeIds.has(s.id));
  const personasAll = await cdp.storeDump(DB, 'personas', '(r)=>({id:r.id,name:r.data&&r.data.name})');
  const personaIds = new Set((personasAll.rows ?? []).map((p) => p.id));
  const finalPath = await pathname();
  await shot('B-after-create');

  return { ok: true, stillGuide, dialogProbe, confirmed, beforeSessions, afterSessions, newOnes, personasAll, personaIds: [...personaIds], finalPath };
}

async function verifyStandalone(port) {
  console.log('\n— 缺陷 B（不内置版）—');
  if (THROTTLE > 0) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  }
  await ensureAtOrigin(port);
  await cdp.evalJs(`localStorage.setItem(${JSON.stringify(GUIDE_KEY)}, '1')`);
  await cdp.evalJs(`localStorage.setItem(${JSON.stringify(SEED_KEY)}, '1')`);
  await clearIndexedDB(`http://127.0.0.1:${port}`);

  // —— 断言 a：首启无角色，首页整页引导；不是「只有我一个」——
  await nav(`http://127.0.0.1:${port}/`, { settleMs: 1500 });
  const homeBody = await bodyText();
  const personaCount = (await cdp.storeDump(DB, 'personas', '(r)=>({id:r.id})')).count;
  const shotA = await shot('B-a-empty-home');
  // 正对照：standalone 首启**本就该**出现「这里还没有人」——记录器若捕不到，说明仪表失灵
  const qaPositive = await readQa();
  report.raw.positiveControl_standaloneSawGuide = !!(qaPositive && qaPositive.firstSeen && qaPositive.firstSeen.wrong != null);
  const a1 = homeBody.includes(WRONG_TEXT);
  const a2 = !homeBody.includes(SOLO_TEXT);
  const a3 = personaCount === 0;
  record(
    'B.a 首启无角色 + 首页整页引导（且非「只有我一个」）',
    a1 && a2 && a3,
    `personas=${personaCount} hasNoPersonaGuide=${a1} hasSoloText=${!a2} 记录器正对照=${report.raw.positiveControl_standaloneSawGuide}`,
    { shot: shotA, personaCount, homeHead: homeBody.slice(0, 200), positiveControl: report.raw.positiveControl_standaloneSawGuide },
  );
  report.raw.standaloneHome = homeBody.slice(0, 400);

  // —— 断言 b2：引导块上的第二个入口（文案=`nav.distill`「蒸馏」，即"导入聊天记录"）→ /distill 向导可开 ——
  let b2 = { ok: false, note: '未走到' };
  try {
    const clicked = await cdp.evalJs(
      `(() => {
         // ★ 精确定位引导块内的按钮：以「导入人设」为锚，取其同容器内的「蒸馏」
         //   （页面别处也有「蒸馏」导航项，全局匹配会命错）
         const importBtn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '导入人设');
         if (!importBtn) return { ok: false, reason: 'no 导入人设 btn' };
         const stack = importBtn.parentElement;
         const target = [...stack.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '蒸馏');
         if (!target) return { ok: false, reason: 'no 蒸馏 btn in guide block' };
         target.click();
         return { ok: true };
       })()`,
    );
    await cdp.waitFor(`location.pathname === '/distill'`, { timeoutMs: 6000 }).catch(() => false);
    const distPath = await pathname();
    const distillBody = await bodyText();
    const distillShot = await shot('B-b2-distill');
    let wizardOpened = false;
    let step = 0;
    if (distPath === '/distill') {
      wizardOpened = await cdp.evalJs(
        `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.innerText||'').trim().includes('新建蒸馏') && x.getBoundingClientRect().width>0); if (!b) return false; b.click(); return true; })()`,
      );
      await sleep(1300);
      step = await cdp.activeStep();
    }
    b2 = {
      ok: clicked.ok && distPath === '/distill' && !(await cdp.isCrashed()) && wizardOpened && step >= 1,
      note: `clickedGuideBlock=${clicked.ok} path=${distPath} wizardStep=${step} bodyHasDistill=${/蒸馏|原材料/.test(distillBody)}`,
      shot: distillShot,
      clicked,
      wizardOpened,
    };
  } catch (e) {
    b2 = { ok: false, note: String(e.message) };
  }
  record('B.b2 引导块「蒸馏/导入聊天记录」入口 → /distill 向导可开', b2.ok, b2.note, b2);

  // —— 断言 b1：导入人设真的成功（先回到首页整页引导态）——
  await nav(`http://127.0.0.1:${port}/`, { settleMs: 1200 });
  const imp = await importPersonaViaHome(port);
  record(
    'B.b1 「导入人设」打开弹窗并真的导入成功',
    imp.ok,
    imp.ok ? `落库 ${imp.added.length} 张：${imp.added.map((x) => x.id).join(',')}` : imp.reason,
    { before: imp.before, after: imp.after, added: imp.added },
  );
  report.raw.importPersona = { ok: imp.ok, reason: imp.reason, beforeCount: imp.before?.count, afterCount: imp.after?.count, added: imp.added };

  // —— 断言 c：导入后新建会话，personaId 必须指向真实导入角色 ——
  const created = await createSessionViaDialog(port);
  let cAssert = { ok: false, note: '未走到' };
  if (created.ok && created.newOnes.length >= 1) {
    const s = created.newOnes[created.newOnes.length - 1];
    const importedCard = (imp.after.rows ?? []).find((r) => r.name === IMPORT_PERSONA_NAME);
    const importedId = importedCard?.id;
    const condPersona = s.personaId === importedId;
    const condNotPhantom = s.personaId !== PHANTOM_ID && s.personaId !== 'xinran';
    const condExists = created.personaIds.includes(s.personaId);
    const condTitle = s.title === IMPORT_PERSONA_NAME;
    cAssert = {
      ok: condPersona && condNotPhantom && condExists && condTitle,
      note: `personaId=${s.personaId} title=${JSON.stringify(s.title)}`,
      session: s,
      importedId,
      condPersona,
      condNotPhantom,
      condExists,
      condTitle,
      allNewSessions: created.newOnes,
      dialogProbe: created.dialogProbe,
      personasAll: created.personasAll.rows,
    };
  } else {
    cAssert = { ok: false, note: created.reason ?? '新建会话未产生新记录', created };
  }
  record('B.c 新建会话的 personaId = 导入角色 id（非幻影/非 xinran/存在）', cAssert.ok, cAssert.note, cAssert);
  report.raw.sessionVerify = cAssert;

  // —— 断言 d：导入后不再整页引导，角色轨出现刚导入的角色 ——
  // 切 v2 看角色轨
  await nav(`http://127.0.0.1:${port}/`, { settleMs: 1200 });
  const homeAfter = await bodyText();
  const d1 = !homeAfter.includes(WRONG_TEXT);
  try {
    await cdp.clickText('v2', '.MuiToggleButton-root');
    await sleep(600);
  } catch { /* 可能已在 v2 或按钮不存在 */ }
  const railImported = await cdp.evalJs(railHasExpr(IMPORT_PERSONA_NAME)).catch(() => null);
  const shotD = await shot('B-d-after-import-home');
  const d2 = !!(railImported && railImported.railScopedCount > 0);
  record(
    'B.d 导入后不再整页引导 + 角色轨出现导入角色',
    d1 && d2,
    `noGuide=${d1} railHasImported=${d2} (${JSON.stringify(railImported)})`,
    { shot: shotD, rail: railImported, homeHead: homeAfter.slice(0, 200) },
  );
  report.raw.afterImportHome = { noGuide: d1, rail: railImported, head: homeAfter.slice(0, 300) };
}

/* ================================ dump ================================ */

async function dump(port) {
  await ensureAtOrigin(port);
  await cdp.evalJs(`localStorage.setItem(${JSON.stringify(GUIDE_KEY)}, '1')`);
  await clearIndexedDB(`http://127.0.0.1:${port}`);
  await nav(`http://127.0.0.1:${port}/`, { settleMs: 1800 });
  const summary = await cdp.evalJs(
    `(() => {
       const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
       return {
         path: location.pathname,
         dialogs: document.querySelectorAll('[role=dialog]').length,
         buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => ({ t: (b.innerText||'').trim().slice(0,24), aria: b.getAttribute('aria-label')||'' })).slice(0, 30),
         papers: [...document.querySelectorAll('.MuiPaper-root')].filter(vis).map((p) => (p.textContent||'').trim().slice(0,30)).slice(0, 20),
       };
     })()`,
  );
  const body = await bodyText();
  console.log('=== dump summary ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('=== body (first 800) ===');
  console.log(body.slice(0, 800));
  const personas = await cdp.storeDump(DB, 'personas', '(r)=>({id:r.id,name:r.data&&r.data.name,isBuiltin:r.isBuiltin})').catch((e) => ({ err: String(e) }));
  const sessions = await cdp.storeDump(DB, 'sessions', '(r)=>({id:r.id,title:r.title,personaId:r.personaId})').catch((e) => ({ err: String(e) }));
  const guideVal = await cdp.evalJs(`localStorage.getItem(${JSON.stringify(GUIDE_KEY)})`).catch(() => 'ERR');
  console.log('=== personas ==='); console.log(JSON.stringify(personas, null, 2));
  console.log('=== sessions ==='); console.log(JSON.stringify(sessions, null, 2));
  console.log('=== guide marker ===', JSON.stringify(guideVal));
  await shot('dump');
}

/* ================================ main ================================ */

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(TMP, { recursive: true });
  const dir = args.dir ? path.resolve(String(args.dir)) : FLAVORS[FLAVOR];
  if (!dir) throw new Error(`未知 flavor：${FLAVOR}`);
  console.log(`\n=== 缺陷验证 @ ${TS} ===`);
  console.log(`flavor=${FLAVOR} mode=${MODE} repeat=${REPEAT} throttle=${THROTTLE || 1}x`);
  console.log(`产物目录：${dir}`);
  console.log(`输出目录：${OUT}\n`);

  const port = 4181;
  const debugPort = FLAVOR === 'builtin' ? 9241 : 9242;

  try {
    const served = await serveStatic(dir, port);
    server = served.server;
    report.base = served.base;
    console.log(`静态服务就绪：${served.base}`);

    browser = await startBrowser({
      port: debugPort,
      profileDir: path.join(TMP, 'profile'),
      freshProfile: true,
    });
    cdp = await Cdp.attach(debugPort);
    await cdp.enableDomains();
    await cdp.send('Network.enable');
    // 阻断 SW：避免首次加载注册的 SW 干扰后续硬刷新（fresh profile 下首帧即阻断）
    await cdp.send('Network.setBlockedURLs', { urls: ['*/sw.js', '*service-worker*'] }).catch(() => undefined);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: recorderSource(recorderMarkers()),
    });

    if (MODE === 'dump') {
      await dump(port);
    } else if (MODE === 'detector') {
      await ensureAtOrigin(port);
      await detectorSelftest(port);
    } else if (MODE === 'negctl-B') {
      await verifyNegControlB();
    } else if (FLAVOR === 'builtin') {
      await verifyBuiltin(port);
    } else {
      await verifyStandalone(port);
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

  const { writeFileSync } = await import('node:fs');
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
  L.push(`# 缺陷独立验证报告（${r.flavor}）`, '');
  L.push(`- 模式：${r.mode} ｜ 硬刷新次数：${r.repeat} ｜ CPU 降速：${r.throttle || 1}x`);
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
