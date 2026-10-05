#!/usr/bin/env node
/**
 * ★★ 图文教程的配图产出（2026-10-05）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么要单独一个脚本，而不是用现成的 `shot-page.mjs`
 * ═══════════════════════════════════════════════════════════════════════════
 * `shot-page.mjs` 的能力是「**一个路由一张图**」。教程需要的是另一种东西：
 *
 *   ① **带交互的图** —— 设置页的分区**默认是收起的**，直接截只会得到一行标题；
 *      反馈的第二步必须**真的填内容并提交**才会出现。这些不是"换个路由"能拿到的。
 *   ② **正好是那一个区块的图** —— 设置页很长，截整页会让配图里 80% 是与
 *      该步骤无关的内容。⇒ 用 CDP 的 `clip` 按**元素的文档坐标**裁。
 *   ③ **一次跑完、命名稳定** —— 图文教程正文会**逐张引用**这些文件名，
 *      命名必须固定、可复现，不能带时间戳。
 *
 * ── 三条踩过的坑，写在这里省得重踩 ────────────────────────────────────
 * 1. **必须预置 `ai-ai.guide.v1`**，否则任何路由都被 `RequireGuide` 拦回 `/guide`
 *    —— 本项目在 QA 脚本里为此栽过两次（"测了但测的不是那个页面"，还可能全绿）。
 *    唯一的例外是**故意要截引导页**的那一张，见 `shotGuide()`。
 * 2. **`clip` 用的是文档坐标**（含滚动偏移），不是视口坐标。
 *    直接用 `getBoundingClientRect()` 会在页面滚动后偏掉。
 * 3. **展开分区不能"点一下"就完事**：MUI 的分区头是 **toggle**，
 *    点第二次会又收起来。所以判据是"展开后文本变长"，不是"点过了"。
 *
 * 用法：
 *   MSYS_NO_PATHCONV=1 node scripts/qa/shot-tutorial.mjs
 *   MSYS_NO_PATHCONV=1 node scripts/qa/shot-tutorial.mjs --out=draft_xxx/img
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
const PORT = Number(arg('port', 4257));
const DEBUG_PORT = Number(arg('debugPort', 9517));
const OUT = path.resolve(arg('out', path.join(PROJECT_ROOT, '.qa-tmp', 'tutorial-shots')));

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
const profile = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp', `shots-${Date.now()}`);
const browser = await startBrowser({ port: DEBUG_PORT, profileDir: profile, freshProfile: true });
const cdp = await Cdp.attach(DEBUG_PORT);
await cdp.enableDomains();
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * 手机视口 390×844。
 * ★ `deviceScaleFactor: 2` —— 教程正文里图片会被缩到 300~360 px 宽显示，
 *   2 倍图在缩放后仍然清晰；1 倍图缩放后会发虚，3 倍图则让单图体积翻倍
 *   （飞书上传有体积限制，且文档会变慢）。
 */
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await cdp.send('Network.setBypassServiceWorker', { bypass: true });

const shots = [];
let warned = 0;

/** 统一的视口截图（含遮罩/对话框的场景用它，比元素裁剪更有"现场感"） */
async function shotViewport(file, { fullPage = false } = {}) {
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: fullPage,
  });
  const out = path.join(OUT, file);
  writeFileSync(out, Buffer.from(r.data, 'base64'));
  const bytes = statSync(out).size;
  shots.push({ file, bytes, kind: fullPage ? 'fullpage' : 'viewport' });
  console.log(`  ✓ ${file.padEnd(30)} ${(bytes / 1024).toFixed(0)} KB  (${fullPage ? '全页' : '视口'})`);
  return out;
}

/**
 * 按元素裁剪截图。
 *
 * ★ 三个必须做的处理（少一个就会得到错图或糊图）：
 *   ① 先 `scrollIntoView` —— 元素在视口外时，某些渲染（如 sticky 头、
 *      懒加载的图片）还没就位，直接裁会拿到空白或未完成的画面；
 *   ② 坐标要**加上滚动偏移** —— `clip` 是文档坐标；
 *   ③ `pad` 留一点边距，否则裁出来的图边缘贴着文字，放进文档很难看。
 *
 * @param maxHeight 超过这个高度就只截顶部（手机上的长列表没必要全要）
 */
async function shotElement(selector, file, { pad = 8, maxHeight = 1800, nth = 0 } = {}) {
  const box = await cdp.evalJs(`
    (() => {
      const list = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 4 && r.height > 4;
      });
      const el = list[${nth}];
      if (!el) return null;
      el.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return {
        x: r.left + window.scrollX,
        y: r.top + window.scrollY,
        w: r.width,
        h: r.height,
        textLen: (el.innerText || '').trim().length,
      };
    })()
  `);
  if (!box) {
    console.log(`  ✗ ${file.padEnd(30)} 找不到元素 ${selector}`);
    warned += 1;
    return null;
  }
  await sleep(400); // 等重排稳定（滚动是 instant，但要等一帧布局）
  const h = Math.min(box.h, maxHeight);
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.w + pad * 2,
      height: h + pad * 2,
      scale: 2,
    },
  });
  const out = path.join(OUT, file);
  writeFileSync(out, Buffer.from(r.data, 'base64'));
  const bytes = statSync(out).size;
  shots.push({ file, bytes, kind: 'element', selector, textLen: box.textLen, h: Math.round(h) });
  console.log(
    `  ✓ ${file.padEnd(30)} ${(bytes / 1024).toFixed(0)} KB  ${Math.round(box.w)}×${Math.round(h)}` +
      `  文本 ${box.textLen} 字${box.h > maxHeight ? '（已截顶）' : ''}`,
  );
  return out;
}

/**
 * 按「两个已知元素的最小公共祖先」裁剪截图。
 *
 * ★ 为什么需要它（第一版直接写 `form, [class*="composer"]` 恒找不到）：
 *   `Composer` 的根是一个 MUI `<Box>`，编译后**没有任何语义标签或类名**
 *   （MUI 的 `sx` 生成的是 `css-1x2y3z` 这种随机类名，写死不靠谱）。
 *   而它内部有**稳定锚点** —— `aria-label` 的按钮（`拍照` / `发送`）。
 *   ⇒ 判据从"猜容器长什么样"换成"**从已知锚点往上找**"，这才是稳的。
 *
 * 实现：取两个锚点元素，沿父链找第一个同时包含两者的节点。
 */
async function shotBetween(anchorSelA, anchorSelB, file, { pad = 8, maxHeight = 300 } = {}) {
  const box = await cdp.evalJs(`
    (() => {
      const pick = (sel) => [...document.querySelectorAll(sel)].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const a = pick(${JSON.stringify(anchorSelA)});
      const b = pick(${JSON.stringify(anchorSelB)});
      if (!a || !b) return { err: 'anchor missing: ' + (!a ? 'A' : 'B') };
      // 沿 a 的父链找同时包含 a 和 b 的第一个节点
      let node = a;
      while (node && node !== document.body) {
        if (node.contains(b)) break;
        node = node.parentElement;
      }
      if (!node || node === document.body) return { err: 'no common ancestor' };
      /* ★ **不要再往上走一层**（第一版走了，结果把底部导航栏也框进来了）。
       *   原因：Composer 就贴在视口底部，而底部 Tab 是 ‘position: fixed‘ 的，
       *   只要裁剪框往下多出一像素，固定的底栏就会被拍进图里
       *   —— 图上表现为"截图底部多了一条红色横条"。
       *   ⇒ 精确停在公共祖先，且下面**不留 padding**（见 clip 的 height 计算）。
       */
      node.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'instant' });
      const r = node.getBoundingClientRect();
      return {
        x: r.left + window.scrollX,
        y: r.top + window.scrollY,
        w: r.width,
        h: r.height,
        textLen: (node.innerText || '').trim().length,
      };
    })()
  `);
  if (!box || box.err) {
    console.log(`  ✗ ${file.padEnd(30)} ${box?.err ?? '未知错误'}`);
    warned += 1;
    return null;
  }
  await sleep(420);
  const h = Math.min(box.h, maxHeight);
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.w + pad * 2,
      height: h + pad * 2,
      scale: 3, // 输入区是窄条，3 倍图放大后按钮图标才看得清
    },
  });
  const out = path.join(OUT, file);
  writeFileSync(out, Buffer.from(r.data, 'base64'));
  const bytes = statSync(out).size;
  shots.push({ file, bytes, kind: 'between', anchorA: anchorSelA, anchorB: anchorSelB, h: Math.round(h) });
  console.log(`  ✓ ${file.padEnd(30)} ${(bytes / 1024).toFixed(0)} KB  ${Math.round(box.w)}×${Math.round(h)}`);
  return out;
}

/** 展开一个设置分区（MUI 折叠头是 toggle，所以要按"展开后文本是否变长"判断） */async function expandSection(sectionId) {
  const probe = () =>
    cdp.evalJs(`
      (() => {
        const b = document.querySelector('[data-section-id="${sectionId}"]');
        return b ? (b.innerText || '').trim().length : 0;
      })()
    `);
  const before = await probe();
  if (before === 0) {
    console.log(`    ⚠️ 分区 ${sectionId} 不存在`);
    warned += 1;
    return false;
  }
  // 已经展开（文本够长）就不点 —— 点一下反而会收起来
  if (before > 60) return true;
  await cdp.evalJs(`
    (() => {
      const box = document.querySelector('[data-section-id="${sectionId}"]');
      const b = box && box.querySelector('button');
      if (b) b.click();
      return !!b;
    })()
  `);
  await sleep(1200);
  const after = await probe();
  if (after <= before) {
    console.log(`    ⚠️ 分区 ${sectionId} 展开后文本没变长（${before} → ${after}）`);
    warned += 1;
    return false;
  }
  return true;
}

const has = (expr) => cdp.waitFor(expr, { timeoutMs: 8000 });

console.log('\n═══ 图文教程配图产出 ═══\n');
console.log(`  产物：${DIR}`);
console.log(`  输出：${OUT}\n`);

/* ═══════════════ ① 首次启动引导（★ 这一张**故意不清** guide 标记）═══════════════ */
console.log('① 首启引导');
await cdp.goto(BASE);
await sleep(1400);
// 全新 profile ⇒ localStorage 是空的 ⇒ RequireGuide 会把人拦到 /guide
const onGuide = await cdp.evalJs(`location.pathname`);
if (onGuide !== '/guide') {
  console.log(`    ⚠️ 期望落在 /guide，实际在 ${onGuide}（profile 不干净？）`);
  warned += 1;
  await cdp.goto(`${BASE}/guide`);
  await sleep(1200);
}
await has(`document.body.innerText.includes('1 / 4')`);
await shotViewport('01-guide.png');

/* 之后所有图都需要 guide 标记，否则会被拦回引导页 */
await cdp.evalJs(`(() => { try { localStorage.setItem('ai-ai.guide.v1','1'); } catch(_){} return true; })()`);

/* ═══════════════ ② 首页（会话列表）═══════════════ */
console.log('\n② 首页');
await cdp.goto(`${BASE}/`);
await sleep(2500);
await has(`document.body.innerText.length > 20`);
await shotViewport('02-home.png');

/* ═══════════════ ③ 聊天页：重点看输入框那一排图标 ═══════════════ */
console.log('\n③ 聊天页与输入区（教程的核心一张）');
const sessionId = await cdp.evalJs(
  `
  (async () => {
    const open = () => new Promise((ok, bad) => {
      const req = indexedDB.open('ai-ai-web');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error);
    });
    const db = await open();
    const rows = await new Promise((ok, bad) => {
      const tx = db.transaction('sessions', 'readonly');
      const req = tx.objectStore('sessions').getAll();
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error);
    });
    return rows && rows.length > 0 ? rows[0].id : null;
  })()
`,
  { awaitPromise: true },
);
if (!sessionId) {
  console.log('    ⚠️ 库里没有会话，聊天页相关截图跳过（内置版应该首启种一个）');
  warned += 1;
} else {
  await cdp.goto(`${BASE}/chat/${sessionId}`);
  await sleep(2800);
  await shotViewport('03-chat.png');
  // 输入区单独裁一张：教程要逐个数那排按钮，单独一张放大更清楚。
  // ★ 锚点用 `aria-label` 的按钮（稳定），而不是猜容器类名 —— 理由见 `shotBetween`。
  await shotBetween('button[aria-label="拍照"]', 'button[aria-label="发送"]', '03b-composer.png');
}

/* ═══════════════ ④ 拍照对话框 ═══════════════ */
console.log('\n④ 拍照对话框');
if (sessionId) {
  await cdp.send('Emulation.setPermissionOverrides', {
    permissions: [{ origin: BASE, name: 'videoCapture', setting: 'granted' }],
  }).catch(() => undefined);
  const opened = await cdp.evalJs(`
    (() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === '拍照');
      if (b) b.click();
      return !!b;
    })()
  `);
  if (opened) {
    await sleep(2600);
    await shotViewport('04-camera.png');
    // 关掉，别影响后面的截图
    await cdp.evalJs(`
      (() => {
        const d = document.querySelector('[role="dialog"]');
        const b = d && [...d.querySelectorAll('button')].find((x) => (x.textContent || '').includes('关掉'));
        if (b) b.click();
        return !!b;
      })()
    `);
    await sleep(900);
  } else {
    console.log('    ⚠️ 找不到相机按钮');
    warned += 1;
  }
}

/* ═══════════════ ⑤ 设置页：顶部总览 + 四个关键分区 ═══════════════ */
console.log('\n⑤ 设置页');
await cdp.goto(`${BASE}/settings`);
await sleep(3000);
await shotViewport('05-settings-top.png');

const SECTIONS = [
  ['model', '06-settings-model.png'],
  ['backup', '07-settings-backup.png'],
  ['feedback', '08-settings-feedback.png'],
  ['stickers', '09-settings-stickers.png'],
  ['world', '10-settings-world.png'],
];
for (const [id, file] of SECTIONS) {
  console.log(`\n   分区 ${id}`);
  const okExpand = await expandSection(id);
  if (!okExpand) continue;
  // 展平后重新定位（展开会改变后续元素位置）
  await shotElement(`[data-section-id="${id}"]`, file, { pad: 10, maxHeight: 1700 });
}

/* ═══════════════ ⑥ 反馈：第一步（填内容）+ 第二步（交出去）═══════════════ */
console.log('\n⑥ 反馈对话框（两步流程）');
const dialogOpened = await cdp.evalJs(`
  (() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('我要反馈'));
    if (b) b.click();
    return !!b;
  })()
`);
if (!dialogOpened) {
  console.log('    ⚠️ 找不到「我要反馈」入口');
  warned += 1;
} else {
  await sleep(1400);
  await shotElement('[role="dialog"]', '11-feedback-step1.png', { pad: 6, maxHeight: 1700 });

  // 填内容 → 提交 → 第二步
  const FILL = '教程配图用：反馈提交后，页面会提示「想让我真看到，就点发出去」。';
  await cdp.typeIntoSelector('[role="dialog"] textarea', FILL);
  await sleep(400);
  await cdp.clickText('交上去', '[role="dialog"] button');
  await sleep(1600);
  await shotElement('[role="dialog"]', '12-feedback-step2.png', { pad: 6, maxHeight: 1400 });

  // 关掉对话框
  await cdp.evalJs(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      const b = d && [...d.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '关掉');
      if (b) b.click();
      return !!b;
    })()
  `);
  await sleep(1000);
}

/* ═══════════════ ⑦ 反馈信箱 ═══════════════ */
console.log('\n⑦ 反馈信箱');
await cdp.goto(`${BASE}/settings/feedback`);
await sleep(2400);
await shotViewport('13-feedback-inbox.png');

/* ═══════════════ ⑧ 朋友圈 ═══════════════ */
console.log('\n⑧ 朋友圈');
await cdp.goto(`${BASE}/moments`);
await sleep(2400);
await shotViewport('14-moments.png');

/* ═══════════════ ⑨ 能力总览（教程里"哪些做不到"的落点）═══════════════ */
console.log('\n⑨ 能力总览');
await cdp.goto(`${BASE}/capabilities`);
await sleep(2600);
await shotViewport('15-capabilities.png');

/* ═══════════════ ⑩ 更新说明弹窗（★ 同时验证 markdown 真的渲染了）═══════════════ */
console.log('\n⑩ 更新说明弹窗');
await cdp.goto(`${BASE}/settings`);
await sleep(2800);
// 「关于」分区默认收起，先展开
await expandSection('about');
// 点「去看看」打开弹窗（比依赖"首次自动弹"更稳 —— 那个由 updateNotesSeenVersion 门控）
const openedNotes = await cdp.evalJs(`
  (() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim().includes('去看看'));
    if (b) b.click();
    return !!b;
  })()
`);
if (!openedNotes) {
  console.log('    ⚠️ 找不到「去看看」按钮');
  warned += 1;
} else {
  await sleep(2200);
  /**
   * ★ 这一步才是"修复真的生效"的判据，而不是"图里没星号"。
   *
   *   「没有星号」有两种可能：① markdown 被正确渲染了；② CHANGELOG 里的
   *   星号被删掉了。两者观感完全不同 —— 前者标题有层级、列表有缩进、
   *   加粗是真的粗；后者是一坨纯文本。⇒ 断言**渲染出来的标签数量**。
   */
  const mdProbe = await cdp.evalJs(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return { open: false };
      const t = d.innerText || '';
      return {
        open: true,
        strong: d.querySelectorAll('strong, b').length,
        h: d.querySelectorAll('h1, h2, h3, h4').length,
        ul: d.querySelectorAll('ul, ol').length,
        li: d.querySelectorAll('li').length,
        code: d.querySelectorAll('code').length,
        literalStars: (t.match(/\\*\\*/g) || []).length,
        textLen: t.length,
      };
    })()
  `);
  console.log(
    `     渲染探针：弹窗${mdProbe.open ? '已开' : '未开'}｜<strong> ${mdProbe.strong}｜标题 ${mdProbe.h}｜` +
      `列表 ${mdProbe.ul}（项 ${mdProbe.li}）｜<code> ${mdProbe.code}｜字面星号 ${mdProbe.literalStars}｜文本 ${mdProbe.textLen} 字`,
  );
  const mdOk = mdProbe.open === true && mdProbe.strong > 0 && mdProbe.h > 0 && mdProbe.literalStars === 0;
  if (!mdOk) {
    console.log('    ⚠️ 更新说明没有渲染成 markdown（或仍有字面星号）');
    warned += 1;
  } else {
    console.log('    ✓ markdown 渲染生效（有 strong / 标题 / 列表，且零字面星号）');
  }
  shots.push({
    file: '16-changelog.png',
    kind: 'probe',
    // ★ 必须带 `bytes`，否则下面求总体积时 `undefined` 会算出 `NaN MB`
    //   （第一版就漏了，页脚打印出"总体积 NaN MB" —— 一个明显但不致命的坏输出）。
    bytes: 0,
    mdProbe,
  });
  await shotElement('[role="dialog"]', '16-changelog.png', { pad: 6, maxHeight: 1400 });
  // 关掉
  await cdp.evalJs(`
    (() => {
      const d = document.querySelector('[role="dialog"]');
      const b = d && [...d.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '关掉');
      if (b) b.click();
      return !!b;
    })()
  `);
  await sleep(800);
}

/* ═══════════════ ⑪ 备份分区（换机流程要用）═══════════════ */
console.log('\n⑪ 备份分区（已在上面的 SECTIONS 里截过）');

/* ═══════════════ 收尾 ═══════════════ */
console.log('\n───────────────────────────────────────');
console.log(`  共 ${shots.length} 张，告警 ${warned} 条`);
const total = shots.reduce((s, x) => s + (x.bytes ?? 0), 0);
console.log(`  总体积 ${(total / 1024 / 1024).toFixed(2)} MB`);
console.log('───────────────────────────────────────\n');

// 落一份清单，供正文引用时核对（文件名是正文的契约，必须有据可查）
writeFileSync(
  path.join(OUT, 'SHOTS.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), dist: DIR, shots }, null, 2),
  'utf8',
);

killTree(browser.child);
server.close();
process.exit(warned === 0 ? 0 : 1);
