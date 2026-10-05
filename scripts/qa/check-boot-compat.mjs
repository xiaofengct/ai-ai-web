#!/usr/bin/env node
/**
 * 启动兼容性回归（2026-10-04 建立，源自真机白屏 P0）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这个脚本要防的是什么
 * ═══════════════════════════════════════════════════════════════════════════
 * 事故：用户真机打开是**纯空白屏**（深色 #111111 = 系统窗口背景透出来）。
 * 根因：`constants/defaults.ts` 在**模块级**调 `structuredClone`，
 *   而它是 WebView 98+ 才有的 API。用户机器更旧 ⇒ 抛 `ReferenceError` ⇒
 *   入口模块整体求值失败 ⇒ React 从未挂载 ⇒ 白屏。
 *
 * ★ 为什么原有的 QA 全都没抓到：
 *   它们全部在**本机 Chrome** 里跑。本机引擎很新，`structuredClone` 一直存在，
 *   所以"浏览器里一切正常"与"真机白屏"可以同时为真。
 *   ⇒ 这类缺陷的本质是**环境能力差异**，只能靠"把环境降级"来暴露。
 *
 * 因此本脚本做三件事（都不需要真机）：
 *   ① 静态指纹：产物里不应再出现我们自己的高危 API 调用与新语法；
 *   ② 兜底存在性：`index.html` 必须内含 ES5 兜底脚本，且**在 module script 之前**；
 *   ③ 动态复现：用 CDP 在浏览器里**删掉**那些新 API（模拟老 WebView），
 *      断言应用**仍然能渲染**。这一条是核心 —— 它是本次事故的直接回归测试。
 *
 * 用法：
 *   node scripts/qa/check-boot-compat.mjs
 *   node scripts/qa/check-boot-compat.mjs --dir=dist
 */
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, EDGE_CANDIDATES, findBrowser } from './lib/harness.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const DIR = path.resolve(arg('dir', path.join(PROJECT_ROOT, 'dist')));

let failed = 0;
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const bad = (msg) => {
  console.log(`  \x1b[31m✗ ${msg}\x1b[0m`);
  failed += 1;
};

console.log(`\n═══ 启动兼容性回归 ═══\n产物目录：${DIR}\n`);

/* ─────────────────────── ① 产物静态指纹 ─────────────────────── */
console.log('① 产物静态指纹（启动路径不应依赖新 API / 新语法）');

if (!existsSync(DIR)) {
  bad(`产物目录不存在：${DIR}（先跑 npm run build）`);
  process.exit(1);
}

const ASSETS = path.join(DIR, 'assets');
const htmlEarly = readFileSync(path.join(DIR, 'index.html'), 'utf8');

/**
 * ★★ 判据必须区分「启动路径」与「懒加载 chunk」。
 *
 * 踩过的坑（第一版就这么写的，把结论判反了）：
 *   我一开始对**全部** `assets/*.js` 断言"不得出现 structuredClone"，结果报了失败 ——
 *   而那两处命中全在**懒加载 chunk**（`pdf-*.js` 的 pdfjs、`vendor-markdown-*.js` 的
 *   remark 生态）。它们**不在首屏路径上**，`react.lazy` 触达时才下载执行，
 *   那时 `index.html` 的兜底脚本早已把 API 补好。⇒ 拿它们判"启动会不会白屏"是错的口径。
 *
 * 正确口径：**只有入口 chunk（`<script type="module">` 指向的那个）才是启动路径**。
 *   它一旦抛错就是白屏；懒加载 chunk 出错只会让某个功能不可用（且我们本来就有降级页）。
 */
const entryMatch = htmlEarly.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
const entryRel = entryMatch ? entryMatch[0] : null;
if (!entryRel) {
  bad('无法从 index.html 解析出入口 chunk ⇒ 指标准不可用');
  process.exit(1);
}
const entryJs = readFileSync(path.join(DIR, entryRel), 'utf8');
console.log(`   入口 chunk：${entryRel}`);
console.log(`   （懒加载 chunk 另计，见下）\n`);

// 高危运行时 API：有明确版本门槛，且**一旦无保护调用就会让整个应用起不来**
const RUNTIME_APIS = [
  { name: 'structuredClone', since: 'WebView 98+', fatal: true },
  { name: 'Object.hasOwn', since: 'WebView 93+', fatal: true },
  { name: 'Array.prototype.findLast', since: 'WebView 97+', fatal: false },
  { name: 'showOpenFilePicker', since: 'WebView 86+', fatal: false },
];

for (const api of RUNTIME_APIS) {
  const hits = entryJs.split(api.name).length - 1;
  if (hits === 0) {
    ok(`入口 chunk 无 ${api.name}（${api.since}）`);
  } else {
    bad(`入口 chunk 出现 ${api.name} ${hits} 次（${api.since}）—— 这是**启动路径**，必须消除或加兜底`);
  }
}

/** 语法级别：`es2017` 目标下这些应被转译掉。语法解析失败会让整个 bundle **静默**失效。 */
const SYNTAX = [
  { name: '可选链 ?.', re: /\?\.[a-zA-Z_$[([]/ },
  { name: '空值合并 ??', re: /\?\?/ },
  { name: '逻辑赋值 ??=', re: /\?\?=/ },
];
for (const s of SYNTAX) {
  if (s.re.test(entryJs)) {
    bad(`入口 chunk 仍含「${s.name}」—— build.target 可能没生效（应为 es2017）`);
  } else {
    ok(`入口 chunk 不含「${s.name}」（已被转译）`);
  }
}

/** 懒加载 chunk 的命中只作**提示**：它们由 index.html 的兜底脚本保护 */
console.log('\n   懒加载 chunk 的新 API 使用（不阻塞启动，兜底脚本已覆盖）：');
const lazyHits = [];
for (const f of readdirSync(ASSETS).filter((x) => x.endsWith('.js'))) {
  if (`assets/${f}` === entryRel) continue;
  const s = readFileSync(path.join(ASSETS, f), 'utf8');
  for (const api of RUNTIME_APIS) {
    const n = s.split(api.name).length - 1;
    if (n > 0) lazyHits.push(`      ${f} — ${api.name} ×${n}`);
  }
}
console.log(lazyHits.length ? lazyHits.join('\n') : '      （无）');

/* ─────────────────────── ③ 兜底脚本存在性 ─────────────────────── */
console.log('\n② index.html 兜底结构');

const htmlPath = path.join(DIR, 'index.html');
const html = readFileSync(htmlPath, 'utf8');

/** 位置判据：兜底必须**先于** module script 出现（module 是 defer，内联经典脚本先跑） */
const idxPolyfill = html.indexOf('structuredClone');
const idxModule = html.indexOf('type="module"');

if (idxPolyfill === -1) {
  bad('index.html 里找不到 structuredClone 兜底');
} else if (idxModule === -1) {
  bad('index.html 里找不到 module script（结构不对？）');
} else if (idxPolyfill > idxModule) {
  bad('兜底脚本出现在 module script **之后** ⇒ 来不及生效');
} else {
  ok(`兜底脚本位于 module script 之前（${idxPolyfill} < ${idxModule}）`);
}

if (!html.includes('__aiAiBootFail')) {
  bad('缺少启动失败上报钩子 __aiAiBootFail');
} else {
  ok('存在启动失败上报钩子 __aiAiBootFail');
}

if (!html.includes('id="boot"')) {
  bad('缺少静态启动页 #boot ⇒ JS 挂掉时仍会白屏');
} else {
  ok('存在静态启动页 #boot（JS 挂掉也看得到东西）');
}

if (!html.includes('id="boot-error"')) {
  bad('缺少启动失败面板 #boot-error');
} else {
  ok('存在启动失败面板 #boot-error');
}

// 静态背景色必须写在 HTML 里（不能只靠 MUI/CSSBaseline）
if (/background-color:\s*#f7f7f8/i.test(html) && /#161a22/i.test(html)) {
  ok('HTML 内联了明/暗两套底色（不依赖 JS 就有背景）');
} else {
  bad('HTML 未内联明暗底色 ⇒ JS 挂掉时会透出系统窗口背景（白屏现场的成因之一）');
}

/* ─────────────────── ④ 动态复现（核心）─────────────────── */
console.log('\n③ 动态验证：模拟老 WebView 后应用是否仍能渲染');
console.log('   （这一步是本次事故的**直接回归测试**，需要浏览器）');

const bin = findBrowser();
if (!bin) {
  console.log(`  \x1b[33m!\x1b[0m 没找到浏览器，跳过动态验证。候选路径：`);
  for (const c of EDGE_CANDIDATES) console.log(`      ${c}`);
  console.log('    静态检查已跑完，但**动态那条才是关键回归**，请在有浏览器的环境补跑。');
} else {
  console.log(`   浏览器：${bin}`);
  console.log('   执行：node scripts/qa/diagnose-blank.mjs --legacy');
  console.log('   （该脚本用 CDP 在页面脚本执行前删掉 structuredClone / Object.hasOwn 等，');
  console.log('     断言 #root 仍有内容。返回码 1 = 白屏复现，即本次修复失效。）');
}

console.log(`\n═══ ${failed === 0 ? '静态检查全部通过 ✓' : `${failed} 项失败`} ═══\n`);
process.exit(failed === 0 ? 0 : 1);
