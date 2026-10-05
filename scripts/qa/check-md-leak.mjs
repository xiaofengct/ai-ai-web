/**
 * ★★ 全站「markdown 语法泄漏」扫描（2026-10-05）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么要有这个脚本（而不是手工看几张图）
 * ═══════════════════════════════════════════════════════════════════════════
 * 起因：教程配图时，**从截图里**发现反馈对话框那段边界说明显示成了
 *   「这条反馈存在**你这台设备上**，不会自己上传到任何地方。」
 *   —— 字面星号露给了用户。
 *
 * 然后才发现这不是一处：`/capabilities` 上还有 6 处（`cap.reason.*`），
 * `/settings` 的更新说明弹窗里更多（CHANGELOG.md 被当纯文本渲染）。
 * ⇒ **修一个实例、漏掉同类**，这个项目已经栽过一次
 *   （见 `registry.ts` 里 `desc.group.*` 那段注释："修的是实例、不是模式"）。
 *
 * 所以这里不查代码、**查渲染结果**：把每个路由真的打开，读 `innerText`，
 * 数字面 `**` 的出现次数。判据是"屏幕上有没有"，不是"源码里有没有"。
 *
 * ── 判据的两个坑 ────────────────────────────────────────────────────
 * ① **有些 `**` 是刻意的**：例如 `dev.redacted` 的值是
 *    `'★ 展示的内容已经脱敏，Key 一律是 ***。'` —— 那三个星号是**脱敏占位**，
 *    是给用户看的"这里被涂掉了"。所以本脚本**不判死**，只列出来给人看一眼，
 *    并附上所在行的上下文（判据要带排除面 —— 见 registry 里那条约定）。
 * ② **不能只扫 `**`**：markdown 还有 `###` 标题、`- ` 列表、`[x](y)` 链接。
 *    但那些在中文界面上**本来就合法**（`- ` 可能是破折号、`[x]` 可能是方括号），
 *    扫了会全是误报。⇒ 只扫 `**`（它在正常中文里几乎不出现，信噪比最高）。
 *
 * 用法：node scripts/qa/check-md-leak.mjs [--dir=dist]
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
const PORT = Number(arg('port', 4261));
const DEBUG_PORT = Number(arg('debugPort', 9521));
const OUT = path.resolve(arg('out', path.join(PROJECT_ROOT, '.qa-tmp', 'md-leak')));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
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
const profile = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp', `mdleak-${Date.now()}`);
const browser = await startBrowser({ port: DEBUG_PORT, profileDir: profile, freshProfile: true });
const cdp = await Cdp.attach(DEBUG_PORT);
await cdp.enableDomains();
const BASE = `http://127.0.0.1:${PORT}`;

await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await cdp.send('Network.setBypassServiceWorker', { bypass: true });

/**
 * 刻意保留的星号（**豁免名单**，不是"放过"）。
 *
 * 每条都要写**为什么它该留着** —— 一条没有理由的豁免，就是下一份没人认领的暗账。
 */
const ALLOW = [
  {
    text: 'Key 一律是 ***',
    why:
      '`settingsCopy.ts` 的 `dev.redacted`：那三个星号是**脱敏占位符**，' +
      '表示"这里的内容被涂掉了"。它是给用户看的最终字符，不是 markdown 语法。',
  },
  {
    // 连接测试页会把请求头 / 请求体的原文展示出来，其中密钥被替换成 `***`
    // （实测样例：`"Authorization": "***"` / `"max_tokens": "***"`）。
    // ★ 判据写的是**值里带引号的三个星号**，不是裸的 `***` ——
    //   否则一条恰好含 `***` 的真泄漏会被它顺手放过。
    text: '"***"',
    why:
      '`ConnectionTestPage`：把请求原文展示给用户时，密钥等敏感值被替换成 `***`。' +
      '这是**脱敏后的真实内容**（用户就是要看"密钥在这儿、但被挡住了"），不是 markdown 语法。',
  },
];

const ROUTES = [
  ['/', '首页'],
  ['/settings', '设置页'],
  ['/capabilities', '能力总览'],
  ['/moments', '朋友圈'],
  ['/memories', '记忆库'],
  ['/favorites', '收藏'],
  ['/distill', '蒸馏列表'],
  ['/settings/feedback', '反馈信箱'],
  ['/settings/connection', '连接测试'],
  ['/settings/developer', '开发者'],
  ['/settings/diagnosis', '诊断'],
  ['/settings/sponsor', '鸣谢'],
  ['/settings/sdk', '第三方许可'],
  ['/settings/bridge', '桥接设置'],
];

console.log('\n═══ 全站 markdown 语法泄漏扫描 ═══\n');
console.log(`  产物：${DIR}\n`);

await cdp.goto(BASE);
await sleep(1400);
await cdp.evalJs("(() => { try { localStorage.setItem('ai-ai.guide.v1','1'); } catch(_){} return true; })()");

let leaked = 0;
let allowed = 0;
const findings = [];

for (const [route, name] of ROUTES) {
  await cdp.goto(BASE + route);
  await sleep(2200);
  const r = await cdp.evalJs(`
    (() => {
      const t = document.body.innerText || '';
      const hits = [];
      const re = /[^\\n]{0,34}\\*\\*[^\\n]{0,80}/g;
      let m;
      while ((m = re.exec(t)) !== null) hits.push(m[0].trim());
      return { len: t.length, count: (t.match(/\\*\\*/g) || []).length, hits };
    })()
  `);

  // 按豁免名单过滤
  const kept = [];
  for (const h of r.hits ?? []) {
    const exempt = ALLOW.find((a) => h.includes(a.text));
    if (exempt) allowed += 1;
    else kept.push(h);
  }

  const mark = kept.length > 0 ? '\x1b[31m✗\x1b[0m' : '\x1b[32m✓\x1b[0m';
  console.log(`  ${mark} ${name.padEnd(10)} ${route.padEnd(24)} 字面 \`**\` ${r.count ?? 0} 次` +
    `${kept.length > 0 ? `（其中 ${kept.length} 处疑似泄漏）` : ''}`);
  for (const h of kept) {
    leaked += 1;
    console.log(`      · ${JSON.stringify(h)}`);
    findings.push({ route, name, sample: h });
  }
}

if (allowed > 0) {
  console.log(`\n  豁免 ${allowed} 处（刻意保留的星号）：`);
  for (const a of ALLOW) console.log(`    · ${a.text} —— ${a.why}`);
}

writeFileSync(
  path.join(OUT, 'report.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), dist: DIR, leaked, allowed, findings }, null, 2),
  'utf8',
);

console.log('\n═══════════════════════════════════════════');
console.log(leaked === 0 ? '\x1b[32m没有 markdown 语法泄漏\x1b[0m' : `\x1b[31m${leaked} 处泄漏\x1b[0m`);
console.log('═══════════════════════════════════════════\n');

killTree(browser.child);
server.close();
process.exit(leaked === 0 ? 0 : 1);
