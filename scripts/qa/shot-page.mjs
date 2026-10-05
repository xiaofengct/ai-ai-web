#!/usr/bin/env node
/**
 * 页面截图（通用）—— 手机视口下渲染任意路由并截图（2026-10-04）。
 *
 * ★ 为什么要有它：`shot-settings.mjs` 只测设置页。加了新页面（朋友圈）之后，
 *   需要一条**不挑页面**的通路来确认"它真的能渲染出来"——
 *   编译通过 ≠ 运行能渲染（本项目两起 P0 都是这么来的：
 *   构建全绿、装机白屏）。
 *
 * ★ 自动做的三件事（都是踩过才知道必须做的）：
 *   ① **预置引导标记** —— 不预置会被 `RequireGuide` 拦回 `/guide`，
 *      于是"测了但测的不是那个页面"，还可能全绿（假通过）；
 *   ② **手机视口** —— 390×844@3，视觉问题必须在目标视口下看；
 *   ③ **收运行时告警** —— 渲染出来了但有 uncaught 异常，同样算失败。
 *
 * 用法：
 *   node scripts/qa/shot-page.mjs --path=/moments --out=.qa-tmp/shots
 *   node scripts/qa/shot-page.mjs --path=/settings --width=390 --height=844
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Cdp, sleep } from './lib/cdp.mjs';
import { PROJECT_ROOT, killTree, startBrowser } from './lib/harness.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const DIR = path.resolve(arg('dir', path.join(PROJECT_ROOT, 'dist')));
const PORT = Number(arg('port', 4221));
const DEBUG_PORT = Number(arg('debugPort', 9391));
const OUT = path.resolve(arg('out', path.join(PROJECT_ROOT, '.qa-tmp', 'shots')));
const WIDTH = Number(arg('width', 390));
const HEIGHT = Number(arg('height', 844));
const FULL_PAGE = arg('full', '0') === '1';

/**
 * ★★ 规范化 `--path` —— 这里必须处理一个 Git Bash / MSYS 的经典坑。
 *
 * 现象：在 Windows 的 Git Bash 里执行
 *     node scripts/qa/shot-page.mjs --path=/moments
 *   MSYS 会把**看起来像 Unix 绝对路径的参数值**自动转换成 Windows 路径，
 *   于是脚本收到的是 `C:/Program Files/Git/moments`，
 *   拼出 `http://127.0.0.1:4221C:/Program Files/Git/moments`
 *   ⇒ CDP 报 `Cannot navigate to invalid URL`。
 *   （实测报错就是这个，而它**指不到"是 shell 干的"这个原因**。）
 *
 * 两种解法，这里都做了：
 *   ① 命令行侧：`MSYS_NO_PATHCONV=1 node ... --path=/moments`（治本，但依赖使用者记得加）；
 *   ② 脚本侧：识别出被转换的前缀并还原（**兜底**，让人不加环境变量也能用）。
 *   ★ 只做 ② 不做 ① 是不够的：其他以 `/` 开头的参数（将来新增的）还会中招；
 *     所以在脚本文档里同时写明 ① 的用法。
 */
function normalizeRoute(raw) {
  let p = raw;
  // 剥掉 MSYS 注入的 Git 安装前缀（形如 C:/Program Files/Git/moments）
  const msysPrefix = /^[A-Za-z]:[\\/].*?[\\/](?:Git|PortableGit)[\\/]/;
  if (msysPrefix.test(p)) {
    const marker = p.match(msysPrefix)[0];
    p = `/${p.slice(marker.length)}`;
  }
  if (!p.startsWith('/')) p = `/${p}`;
  return p;
}
const PAGE = normalizeRoute(arg('path', '/'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
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

mkdirSync(OUT, { recursive: true });
const profile = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp', `shot-page-profile-${Date.now()}`);
const browser = await startBrowser({ port: DEBUG_PORT, profileDir: profile, freshProfile: true });
const cdp = await Cdp.attach(DEBUG_PORT);
await cdp.enableDomains();

/** 收集未捕获异常与 console.error —— "渲染出来了但有报错"同样要报 */
const problems = [];
cdp.events = cdp.events ?? [];
const origSend = cdp.send.bind(cdp);
cdp.ws.addEventListener('message', (ev) => {
  try {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params?.exceptionDetails;
      problems.push(`uncaught: ${d?.exception?.description ?? d?.text ?? 'unknown'}`);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      problems.push(`console.error: ${(msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
  } catch {
    /* 忽略非 JSON 帧 */
  }
});
void origSend;

await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 2,
  mobile: true,
});
await cdp.send('Network.setBypassServiceWorker', { bypass: true });

// ① 先到首页并预置"已引导"（否则新页面可能被守卫拦走）
await cdp.goto(`http://127.0.0.1:${PORT}/`);
await cdp.evalJs(`(() => { try { localStorage.setItem('ai-ai.guide.v1','1'); } catch(_){} return true; })()`);

// ② 再进目标页
await cdp.goto(`http://127.0.0.1:${PORT}${PAGE}`);
await sleep(2500);

// 关掉可能弹出的对话框（更新说明等）
await cdp.evalJs(`
  (() => {
    for (const b of document.querySelectorAll('button')) {
      const t = (b.textContent || '').trim();
      if (['关闭','好','知道了','算了'].includes(t)) { b.click(); break; }
    }
    return true;
  })()
`);
await sleep(800);

const info = await cdp.evalJs(`
  (() => {
    const r = document.getElementById('root');
    const visibleText = (document.body.innerText || '').trim();
    return {
      url: location.pathname,
      rootChildren: r ? r.childElementCount : -1,
      textLength: visibleText.length,
      sample: visibleText.slice(0, 200),
      docHeight: document.documentElement.scrollHeight,
      viewportHeight: document.documentElement.clientHeight,
    };
  })()
`);

if (FULL_PAGE) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: Math.max(HEIGHT, info.docHeight),
    deviceScaleFactor: 2,
    mobile: true,
  });
  await sleep(400);
}

const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
const name = PAGE.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
const file = path.join(OUT, `${name}.png`);
writeFileSync(file, Buffer.from(shot.data, 'base64'));

console.log(`\n═══ 页面截图：${PAGE} ═══\n`);
console.log(`  实际路径   ${info.url}`);
console.log(`  #root 子节点 ${info.rootChildren}`);
console.log(`  可见文本   ${info.textLength} 字符`);
console.log(`  文档高     ${info.docHeight}px（视口 ${info.viewportHeight}px）`);
console.log(`  文本开头   ${JSON.stringify(info.sample.slice(0, 80))}`);
console.log(`\n  运行时告警 ${problems.length} 条`);
for (const p of problems.slice(0, 5)) console.log(`    · ${p}`);
console.log(`\n  截图：${file}\n`);

killTree(browser.child);
server.close();
process.exit(problems.length === 0 && info.rootChildren > 0 ? 0 : 1);
