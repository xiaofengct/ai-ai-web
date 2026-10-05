#!/usr/bin/env node
/**
 * 只验一件事：能力总览的四档分布（运行时真值）。
 *
 * ★ 为什么要单独一个脚本：
 *   本轮把 PG-23 / SV-02 / SV-03 从 `unavailable` 上调为 `partial`，
 *   而 `scripts/qa/run-regression.mjs` 里**写死了**分档数字（82/40/7/12）。
 *   那些数字必须用**运行时真值**核对，不能靠"改了 3 行所以 +3"的算术 ——
 *   推算在计数类问题上恰恰是最容易出错的地方（本仓库已有过一次口径教训）。
 *
 * 用法：node scripts/qa/check-capability-levels.mjs [--dir=dist]
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Cdp, sleep } from './lib/cdp.mjs';
import { PROJECT_ROOT, killTree, startBrowser } from './lib/harness.mjs';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const DIR = path.resolve(arg('dir', path.join(PROJECT_ROOT, 'dist')));
const PORT = Number(arg('port', 4193));
const DEBUG_PORT = Number(arg('debugPort', 9253));
const TMP = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

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

/** 与 run-regression.mjs 里**完全相同**的取值方式（同一口径才可比） */
const COUNT = `(() => {
  const rows = [...document.querySelectorAll('[data-capability-id]')];
  const by = { full: 0, partial: 0, alternative: 0, unavailable: 0 };
  for (const r of rows) { const l = r.getAttribute('data-capability-level'); if (l in by) by[l] += 1; }
  return { total: rows.length, by };
})()`;

/** 库里应有的期望值（与 capabilities.ts 的声明一致；改一处必须同步另一处） */
const EXPECT = { total: 141, full: 82, partial: 40, alternative: 7, unavailable: 12 };

let server;
let browser;
let cdp;
let bad = 0;

try {
  mkdirSync(TMP, { recursive: true });
  server = (await serveStatic(DIR, PORT)).server;
  const base = `http://127.0.0.1:${PORT}`;
  console.log(`\n═══ 能力分档运行时核对 ═══\n产物：${DIR}\n`);

  browser = await startBrowser({
    port: DEBUG_PORT,
    profileDir: path.join(TMP, `profile-capcheck-${Date.now()}`),
  });
  cdp = await Cdp.attach(DEBUG_PORT);
  await cdp.enableDomains();
  // 跳过引导，否则被 RequireGuide 拦走
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('ai-ai.guide.v1', '1'); } catch (_) {}`,
  });
  await cdp.goto(`${base}/capabilities`, {
    readyExpr: `document.querySelectorAll('[data-capability-id]').length > 0`,
    settleMs: 500,
  });
  await sleep(400);

  const got = await cdp.evalJs(COUNT);
  console.log(`  实测：total ${got.total}｜full ${got.by.full}｜partial ${got.by.partial}｜alternative ${got.by.alternative}｜unavailable ${got.by.unavailable}`);
  console.log(`  期望：total ${EXPECT.total}｜full ${EXPECT.full}｜partial ${EXPECT.partial}｜alternative ${EXPECT.alternative}｜unavailable ${EXPECT.unavailable}\n`);

  const check = (name, ok, d) => {
    if (!ok) bad += 1;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${d ? `  — ${d}` : ''}`);
  };
  check('总数 141', got.total === EXPECT.total, `实测 ${got.total}`);
  check('full = 82', got.by.full === EXPECT.full, `实测 ${got.by.full}`);
  check('partial = 40（本轮 +3）', got.by.partial === EXPECT.partial, `实测 ${got.by.partial}`);
  check('alternative = 7', got.by.alternative === EXPECT.alternative, `实测 ${got.by.alternative}`);
  check('unavailable = 12（本轮 −3）', got.by.unavailable === EXPECT.unavailable, `实测 ${got.by.unavailable}`);

  // 抽出本轮上调的三条，确认它们真的在 partial 里
  const moved = await cdp.evalJs(`(() => {
    const want = ['PG-23','SV-02','SV-03'];
    const out = {};
    for (const r of document.querySelectorAll('[data-capability-id]')) {
      const id = r.getAttribute('data-capability-id');
      if (want.includes(id)) out[id] = r.getAttribute('data-capability-level');
    }
    return out;
  })()`);
  console.log(`\n  本轮上调的三条实际档位：${JSON.stringify(moved)}`);
  check('PG-23 / SV-02 / SV-03 都在 partial', ['PG-23', 'SV-02', 'SV-03'].every((k) => moved[k] === 'partial'));
} catch (e) {
  console.error(`\n[致命] ${e.message}`);
  bad += 1;
} finally {
  try { cdp?.close(); } catch { /* 忽略 */ }
  killTree(browser?.child);
  try { server?.close(); } catch { /* 忽略 */ }
}

console.log(`\n═══ ${bad === 0 ? '全部通过' : `${bad} 项不一致`} ═══\n`);
process.exit(bad === 0 ? 0 : 1);
