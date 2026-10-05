#!/usr/bin/env node
/**
 * 设置页**溢出**检查（2026-10-04 加，起因是真机截图里的横向溢出）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么必须量像素，不能"看起来好了"
 * ═══════════════════════════════════════════════════════════════════════════
 * 用户给的真机截图里，FN-33 / FN-50 两行的禁用原因
 * （「欣然的图像不生成，这是硬规矩，谁来都不行。」）**冲出屏幕右边缘被硬截断**。
 * 根因是用 `<Chip>` 装整句话 —— Chip 是单行不换行的短标签组件。
 *
 * 改成可换行文本之后，"应该好了"是不够的：**换行文本也可能因为父容器缺
 * `min-width: 0` 而不收缩**（flex 子项默认 `min-width: auto`）。
 * 那正是这类修复最常见的"改对了但没生效"。
 *
 * ⇒ 本脚本量两个数，都必须是 0：
 *   · `documentElement.scrollWidth - clientWidth`（整页横向溢出）
 *   · 每个元素 `scrollWidth - clientWidth`（元素自身内容溢出）
 * 只要有一个 > 1px（容 1px 亚像素误差），就报出来并指出是哪个元素。
 *
 * ★ 只在**手机宽度**下测：桌面宽度下这些内容本来就放得下，
 *   在宽屏通过不能说明手机端没问题（本项目的教训：视觉问题必须按目标视口测）。
 *
 * 用法：node scripts/qa/check-settings-overflow.mjs [--dir=dist]
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Cdp, sleep } from './lib/cdp.mjs';
import { PROJECT_ROOT, killTree, startBrowser } from './lib/harness.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const DIR = path.resolve(arg('dir', path.join(PROJECT_ROOT, 'dist')));
const PORT = Number(arg('port', 4211));
const DEBUG_PORT = Number(arg('debugPort', 9381));
const PROFILE = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp', 'overflow-profile');

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
  return { server, port };
}

let failed = 0;
const line = (ok, msg, detail) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}${detail ? `\n      ${detail}` : ''}`);
};

const { server } = await serveStatic(DIR, PORT);
mkdirSync(PROFILE, { recursive: true });
const browser = await startBrowser({ port: DEBUG_PORT, profileDir: PROFILE, freshProfile: true });

const cdp = await Cdp.attach(DEBUG_PORT);
await cdp.enableDomains();

/**
 * 手机视口（与真机截图接近）：CSS 宽 390、高 844，DPR 3。
 * ★ 用 `Emulation.setDeviceMetricsOverride` 而不是改窗口大小 ——
 *   后者在 headless 下不生效，而且拿不到正确的 `deviceScaleFactor`。
 */
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
});
// ★ 关 Service Worker：它会把上一轮构建的产物缓存住，测的就不是当前这份了
await cdp.send('Network.setBypassServiceWorker', { bypass: true });
await cdp.send('Page.enable');

/**
 * ★★ 先预置「已引导」标记，再导航到设置页。
 *
 * 不预置会怎样（本次实测踩到）：直接 `goto('/settings')` 会被
 * `RequireGuide` 拦回 `/guide`，页面停在引导页 ——
 * 而引导页**没有任何横向溢出**，于是整页检查"全部通过"，
 * 「点击了 0 个分组标题」这个唯一的异常线索很容易被当成无害噪音。
 * ⇒ 那就是一次**假通过**：测的根本不是设置页。
 *
 * ★ 正确的做法本项目**早就写在** `shot-settings.mjs` 里了
 *   （`const PRESET = ...localStorage.setItem('ai-ai.guide.v1','1')`）。
 *   我没有复用那段，而是重新写了一遍 —— 于是把同一个坑又踩了一次。
 *   教训：写新脚本前先看同类既有脚本，它里面每一行怪代码都可能是踩出来的。
 *
 * ★ 预置必须在**导航之前**注入，且要在页面上下文中执行：
 *   先导航到 `about:blank` 同源页拿到 localStorage 权限，再写、再跳转。
 *   （CDP 的 `Page.addScriptToEvaluateOnNewDocument` 在这里更麻烦，
 *    因为 service worker 与新文档的时序不好控。）
 */
await cdp.goto(`http://127.0.0.1:${PORT}/`);
await cdp.evalJs(`(() => { try { localStorage.setItem('ai-ai.guide.v1', '1'); } catch (_) {} return true; })()`);

await cdp.goto(`http://127.0.0.1:${PORT}/settings`);
await sleep(3500);

// 确认真的进了设置页（而不是又被拦回引导页）—— 这是后面所有断言的前提
const landedOn = await cdp.evalJs(`document.body.innerText.slice(0, 60)`);
const onSettings = await cdp.evalJs(`document.querySelectorAll('[data-section-id]').length > 0`);
line(onSettings, `确实进入设置页（页面开头：${JSON.stringify(landedOn.slice(0, 30))}）`, onSettings ? '' : '被重定向了，后面的量测都测不到设置页');

// 关掉可能弹出的更新说明弹窗（它会盖住页面，且自身可能有溢出）
await cdp.evalJs(`
  (() => {
    const btns = [...document.querySelectorAll('button')];
    const close = btns.find((b) => /关闭|知道了|知道了，谢谢|close/i.test(b.textContent || ''));
    if (close) close.click();
    return true;
  })()
`);
await sleep(800);

// 展开全部分组（窄屏默认收起，不展开就量不到里面的字段）
//
// ★ 判据用「文本长度增长」而不是「class 名里有没有 hidden」：
//   第一版查的是 `MuiCollapse-hidden`，结果稳定返回"展开了 0 个"——
//   而 `shot-settings.mjs` 用同样的选择器能拿到 13 个分组标题，
//   说明**是判据错了，不是页面没渲染**（MUI 的 Collapse 在不同版本/配置下
//   类名与 DOM 结构会变，而"点完之后文字变多了"是任何实现都躲不掉的事实）。
//   ⇒ 无条件点击每个分组的 header，再用可见文本长度对比来确认是否真的展开了。
//     这是"看结果、不看过程"的判据 —— 过程（class 名）会随实现漂，结果（文字多了）不会。
const beforeText = await cdp.evalJs(`document.body.innerText.length`);
const clicked = await cdp.evalJs(`
  (() => {
    let n = 0;
    for (const box of document.querySelectorAll('[data-section-id]')) {
      const btn = box.querySelector('button');
      if (btn) { btn.click(); n += 1; }
    }
    return n;
  })()
`);
await sleep(1800);
const afterText = await cdp.evalJs(`document.body.innerText.length`);

console.log(`\n═══ 设置页溢出检查（手机 390×844）═══\n`);
console.log(`  产物：${DIR}`);
console.log(`  点击了 ${clicked} 个分组标题｜可见文本 ${beforeText} → ${afterText} 字符`);
line(afterText > beforeText, `分组已展开（文本增加了 ${afterText - beforeText} 字符）`, afterText <= beforeText ? '点击后内容没变多 ⇒ 分组仍是收起的，下面的量测测不到字段' : '');

/** 量整页横向溢出 + 逐元素溢出 */
const report = await cdp.evalJs(`
  (() => {
    const de = document.documentElement;
    const pageOverflow = de.scrollWidth - de.clientWidth;

    /**
     * ★★ 判据只认**用户看得见**的三类问题 —— 这不是"放宽到能过"，
     *    而是把"DOM 数值异常"与"用户看到截断"区分开。
     *
     *   第一版只写了「scrollWidth > clientWidth 就算失败」，结果必然红：
     *   报出来的是 MUI 自己的结构性溢出，一个都不是真 bug —— 而**永远红的检查等于没有检查**
     *   （这与本项目 ‘docs/07 §8‘ 记过的"判据本身也要验"是同一类教训）。
     *
     *   反过来也不能一律放过：改成"只看出屏"之后漏掉了 68px 那个真 bug 的兄弟情况，
     *   直到加上「被裁」这一类才把「取几条结果」输入框抓出来（已修）。
     *
     *   ① **出屏**：元素右边界超出视口 ⇒ 用户看到被屏幕切断。硬失败。
     *      排除 MUI Switch 的隐藏 input：它 ‘position: absolute; opacity: 0‘，
     *      刻意做得比可视区域大以扩大无障碍点击目标，**看不见也不占位**。
     *   ② **被裁**：元素 ‘overflow-x‘ 为 hidden/clip，且内容比自身宽
     *      ⇒ 内容**真的被裁掉了**（用户读不全）。这是截图里那种"文字少了一截"的形态。
     *   ③ **看不见的容器**不再单列 —— 父元素 ‘overflow: visible‘ 时，
     *      子元素"比父元素宽"是正常现象（会照常画出来），不是问题。
     */
    const isHiddenInput = (el, style) =>
      el.tagName === 'INPUT' && (style.opacity === '0' || el.getAttribute('type') === 'hidden');

    const outOfViewport = [];
    const clipped = [];
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (isHiddenInput(el, style)) continue;

      const cls = el.className && typeof el.className === 'string' ? el.className : '';
      const past = Math.round(rect.right - de.clientWidth);
      const self = el.scrollWidth - el.clientWidth;
      const text = (el.textContent || '').trim();
      const short = { tag: el.tagName.toLowerCase(), cls: cls.split(' ').slice(0, 3).join(' '), text: text.slice(0, 50) };

      if (past > 1) {
        outOfViewport.push({ ...short, pastRight: past });
      } else if (
        self > 1 &&
        text !== '' &&
        /hidden|clip/.test(style.overflowX) &&
        // ★★ 只认「**文字本身**被裁」—— 判据是"这个元素直接持有文字"。
        //   为什么必须这样收窄：容器级 ‘overflow-x: hidden‘ 的 scrollWidth 差异
        //   还可能来自**装饰性结构**（Slider 的圆形 thumb 在轨道端点时
        //   会按半径伸出去几 px，MUI 的设计如此，用户看不出问题）。
        //   加这条之前的实测结果：整个设置页只剩 1 项"被裁 5px"，
        //   而它在分组卡片上 —— 那是 thumb 造成的，不是文字。
        //   ⇒ 判据要问的是「**用户会不会读不全一句话**」，
        //     所以锚在"直接持有文字的元素"上，而不是任意容器。
        el.childNodes.length > 0 &&
        [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim() !== '')
      ) {
        clipped.push({ ...short, overflow: style.overflowX, selfOverflow: self });
      }
    }
    return {
      pageOverflow,
      outOfViewport: outOfViewport.slice(0, 8),
      clipped: clipped.slice(0, 8),
    };
  })()
`);

line(report.pageOverflow <= 1, `整页横向溢出 = ${report.pageOverflow}px`, report.pageOverflow > 1 ? '页面被撑宽了，说明有元素超出视口' : '');
line(
  report.outOfViewport.length === 0,
  `超出视口的可见元素 = ${report.outOfViewport.length} 个`,
  report.outOfViewport
    .map((o, i) => `${i + 1}. <${o.tag}> .${o.cls}　超出右边界 ${o.pastRight}px　文本：${o.text}`)
    .join('\n      '),
);
line(
  report.clipped.length === 0,
  `内容被容器裁掉的元素 = ${report.clipped.length} 个`,
  report.clipped
    .map((o, i) => `${i + 1}. <${o.tag}> .${o.cls}　overflow-x:${o.overflow}　裁掉 ${o.selfOverflow}px　文本：${o.text}`)
    .join('\n      '),
);

/** 针对性地确认两处红线原因用的是文本（可换行）而不是 Chip */
const chipCheck = await cdp.evalJs(`
  (() => {
    const needle = '欣然的图像不生成';
    const hits = [];
    for (const el of document.querySelectorAll('body *')) {
      const txt = (el.textContent || '').trim();
      if (!txt.includes(needle)) continue;
      // 找最内层持有该文本的元素
      if ([...el.children].some((c) => (c.textContent || '').includes(needle))) continue;
      const style = getComputedStyle(el);
      hits.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && typeof el.className === 'string' ? el.className : '').split(' ')[0],
        whiteSpace: style.whiteSpace,
        isChip: (el.className && typeof el.className === 'string' ? el.className : '').includes('MuiChip'),
        lines: Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight || '16')),
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
      });
    }
    return hits;
  })()
`);

console.log('\n  ── 红线原因的渲染形态 ──');
if (chipCheck.length === 0) {
  console.log('    （当前角色不是欣然 / 该分组未展开，未命中——不算失败）');
} else {
  for (const h of chipCheck) {
    line(!h.isChip, `用 <${h.tag}> 渲染（不是 Chip）`, h.isChip ? '仍在用 Chip 装长句，会单行不换行' : '');
    line(h.scrollW - h.clientW <= 1, `自身未溢出（scrollW=${h.scrollW} clientW=${h.clientW}）`);
  }
}

console.log('\n═══════════════════════════════════════════');
console.log(failed === 0 ? '\x1b[32m全部通过：手机宽度下无横向溢出\x1b[0m' : `\x1b[31m失败 ${failed} 项\x1b[0m`);
console.log('═══════════════════════════════════════════\n');

killTree(browser.child);
server.close();
process.exit(failed === 0 ? 0 : 1);
