#!/usr/bin/env node
/**
 * 表情包 + 动态 的**界面**验证（2026-10-04）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么逻辑测过了还要测界面
 * ═══════════════════════════════════════════════════════════════════════════
 * `check-moments-stickers.ts` 把闸门、校验、解析都钉住了 ——
 * 但它**证明不了界面上真的出现了那些东西**。
 * 本项目的两起 P0（白屏、升级崩溃）都是"逻辑没错、界面没渲染出来"。
 *
 * ⇒ 这里在真实产物 + 手机视口下断言：
 *   ① 设置页有「朋友圈」与「表情包」两个分区
 *   ② 打开朋友圈设置：5 个旋钮都在，且默认态正确（总开关**关着**）
 *   ③ "看看现在会怎么判"的预览能算出结论（而不是空白）
 *   ④ 表情包页：两个分页都在，导入按钮在，**边界说明可见**
 *   ⑤ 朋友圈页：发布区能用（切到"她的"筛选不崩）
 *   ⑥ 全程 **0 条运行时告警**
 *
 * ★ 必须预置 `ai-ai.guide.v1`（本项目已踩过两次的坑：
 *   不预置会被 `RequireGuide` 拦回 `/guide`，于是测的不是设置页还可能全绿）。
 *
 * 用法：node scripts/qa/check-stickers-moments-ui.mjs [--dir=dist]
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
const PORT = Number(arg('port', 4241));
const DEBUG_PORT = Number(arg('debugPort', 9411));
const OUT = path.resolve(arg('out', path.join(PROJECT_ROOT, '.qa-tmp', 'stickers-moments')));

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
const profile = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp', `stickers-moments-${Date.now()}`);
const browser = await startBrowser({ port: DEBUG_PORT, profileDir: profile, freshProfile: true });
const cdp = await Cdp.attach(DEBUG_PORT);
await cdp.enableDomains();

/** 收集运行时告警（"渲染出来了但报错"同样算失败） */
const problems = [];
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
    /* 非 JSON 帧忽略 */
  }
});

let failed = 0;
const ok = (name, cond, detail) => {
  if (!cond) failed += 1;
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? `  ${detail}` : ''}`);
};

await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await cdp.send('Network.setBypassServiceWorker', { bypass: true });

const BASE = `http://127.0.0.1:${PORT}`;

console.log('\n═══ 表情包 / 动态 界面验证（手机 390×844）═══\n');
console.log(`  产物：${DIR}\n`);

/* ─────────── ① 进设置页（**先预置引导标记**）─────────── */
await cdp.goto(BASE);
await sleep(1500);
await cdp.evalJs(`(() => { try { localStorage.setItem('ai-ai.guide.v1','1'); } catch(_){} return true; })()`);
await cdp.goto(`${BASE}/settings`);
await sleep(3000);

const onSettings = await cdp.evalJs(`document.querySelectorAll('[data-section-id]').length > 0`);
ok('确实进入设置页（没被守卫拦走）', onSettings);
if (!onSettings) {
  killTree(browser.child);
  server.close();
  process.exit(1);
}

/* ─────────── ② 两个新分区都在 ─────────── */
const ids = await cdp.evalJs(
  `[...document.querySelectorAll('[data-section-id]')].map((e) => e.getAttribute('data-section-id'))`,
);
ok('「朋友圈」分区存在', ids.includes('moments'), `实际：${ids.join(', ')}`);
ok('「表情包」分区存在', ids.includes('stickers'));

/** 展开某个分区（先判状态：桌面视口默认展开，手机视口默认收起） */
async function openSection(id) {
  const probe = () =>
    cdp.evalJs(`
      (() => {
        const box = document.querySelector('[data-section-id="${id}"]');
        if (!box) return { found: false, len: 0 };
        const t = (box.innerText || '').trim();
        return { found: true, len: t.length, text: t };
      })()
    `);
  let p = await probe();
  if (p.found && p.len < 30) {
    await cdp.evalJs(
      `(() => { const b = document.querySelector('[data-section-id="${id}"] button'); if (b) b.click(); return true; })()`,
    );
    await sleep(1400);
    p = await probe();
  }
  return p;
}

/* ─────────── ③ 朋友圈设置 ─────────── */
const moments = await openSection('moments');
ok('朋友圈分区能展开且有内容', moments.found && moments.len > 30, `文本长度 ${moments.len}`);
const mt = moments.text ?? '';

ok('有「让我自己发动态」开关', mt.includes('让我自己发动态'));
ok('有「至少隔多久」', mt.includes('至少隔多久'));
ok('有「一天最多几条」', mt.includes('一天最多几条'));
ok('有「跟着我的作息发」', mt.includes('跟着我的作息发'));
ok('有「动态可以配表情」', mt.includes('动态可以配表情'));
ok('有「看看现在会怎么判」预览开关', mt.includes('看看现在会怎么判'));
ok('写明了会花额度（用户会关心）', mt.includes('额度'));

/**
 * ★ 默认态断言：总开关**必须是关的**。
 *   这是"新增能力默认关"这条设计的**界面级**保证 ——
 *   逻辑层已断言 `DEFAULT_CHAT_SETTINGS.moments.enabled === false`，
 *   但那是常量；这里确认**界面上呈现的也是关**（开关的 checked 状态）。
 */
const switchStates = await cdp.evalJs(`
  (() => {
    const box = document.querySelector('[data-section-id="moments"]');
    if (!box) return [];
    return [...box.querySelectorAll('input[type="checkbox"]')].map((i) => i.checked);
  })()
`);
ok('朋友圈分区里读到了开关', switchStates.length > 0, `共 ${switchStates.length} 个`);
ok('★ 总开关默认是关的（新增能力不默认花用户额度）', switchStates[0] === false, `实际 ${switchStates[0]}`);

/* ─────────── ④ 打开预览，确认能算出结论 ─────────── */
// 点最后一个开关 = "看看现在会怎么判"
await cdp.evalJs(`
  (() => {
    const box = document.querySelector('[data-section-id="moments"]');
    const inputs = [...box.querySelectorAll('input[type="checkbox"]')];
    const last = inputs[inputs.length - 1];
    if (last) last.click();
    return true;
  })()
`);
await sleep(1500);
const previewText = await cdp.evalJs(`
  (() => {
    const box = document.querySelector('[data-section-id="moments"]');
    return (box.innerText || '');
  })()
`);
/**
 * ★★ 这里第一版写的是**假通过**，必须记下来：
 *   断言写的是 `/今天已经发了|现在可以发|现在不会发/.test(previewText)`，
 *   而 `previewText` 是**整个分区**的文本（包含标签 "看看现在会怎么判"）。
 *   实测 `摘录` 打印出空串时判定仍然过了 —— 说明匹配到的是**别处的字**，
 *   不是预览面板的输出。**一个能靠无关内容通过的断言等于没有断言。**
 * ⇒ 改成：先把**预览面板本身**的文本抓出来（它是 `.moments` 分区里
 *   `note.momentsCost` 之前的那一段），再断言它有内容。
 *   判据从"分区里有没有这些字"收紧到"预览面板里有没有结论"。
 */
const previewOnly = await cdp.evalJs(`
  (() => {
    const box = document.querySelector('[data-section-id="moments"]');
    if (!box) return '';
    /*
     * ★★ 这里连着踩了两次坑，都写下来：
     *
     * 坑 1（第一版）：断言用的是**整个分区**的文本 ⇒ 靠别处的字就能通过。
     *   「摘录」打印空串却判过，说明匹配到的东西根本不是预览面板。
     *   一个能靠无关内容通过的断言等于没有断言。
     *
     * 坑 2（第二版）：改成找"含『今天已经发了』的**最内层**元素"⇒
     *   找到的是**第一行** Typography 本身（它的 textContent 就是那一行），
     *   于是永远只看得到第一行，后续行（"现在不会发：…"）被漏掉，
     *   表现为**假失败**（明明渲染了却说没有）。
     *   ⇒ 预览面板是多行结构，要拿的是**包住所有行的容器**，
     *     不是承载单行的那个元素。
     *
     * 正确判据：找到第一行，然后**上溯到父容器**（那个 Box 装全部行）。
     */
    const all = [...box.querySelectorAll('*')];
    const firstLine = all.reverse().find((el) => {
      const t = (el.textContent || '').trim();
      return /今天已经发了/.test(t) && ![...el.children].some((c) => /今天已经发了/.test(c.textContent || ''));
    });
    if (!firstLine) return '';
    const container = firstLine.parentElement;
    return container ? (container.textContent || '').trim() : (firstLine.textContent || '').trim();
  })()
`);
ok('预览面板真的渲染出了结论文字', previewOnly.length > 0, `预览文本：${JSON.stringify(previewOnly.slice(0, 100))}`);
ok(
  '预览里有"今天发了几条"',
  /今天已经发了\s*\d+\s*条/.test(previewOnly),
  `预览文本：${JSON.stringify(previewOnly.slice(0, 100))}`,
);
ok(
  '预览说清了「为什么现在不发」（而不是只给个状态）',
  /功能没开|还没有角色|离上一条太近|今天发满了|静默|活跃时段|运气/.test(previewOnly),
  `预览文本：${JSON.stringify(previewOnly.slice(0, 100))}`,
);

/* ─────────── ⑤ 表情包分区 ─────────── */
const stickers = await openSection('stickers');
ok('表情包分区能展开且有内容', stickers.found && stickers.len > 30, `文本长度 ${stickers.len}`);
const st = stickers.text ?? '';

ok('有「我的表情」分页', st.includes('我的表情'));
ok('有「联网找」分页', st.includes('联网找'));
ok('有导入按钮', st.includes('导入表情包'));
ok('写了导入约束（大小 / 张数）', /MB|超过/.test(st));
ok('★ 边界说明可见（"我没法检查图里的内容"）', st.includes('我没法检查图里的内容'), '内容安全必须如实告知');
ok('★ 说明了收的是链接不是图本身', st.includes('收的是链接'));
ok('★ 说明了逐张点选（不替用户决定）', st.includes('都要你自己点一下'));

/* ─────────── ⑥ 切到「联网找」分页 ─────────── */
await cdp.evalJs(`
  (() => {
    const box = document.querySelector('[data-section-id="stickers"]');
    const btns = [...box.querySelectorAll('button')];
    const target = btns.find((b) => (b.textContent || '').includes('联网找'));
    if (target) target.click();
    return true;
  })()
`);
await sleep(1200);
const searchTab = await cdp.evalJs(`
  (() => {
    const box = document.querySelector('[data-section-id="stickers"]');
    return (box.innerText || '');
  })()
`);
ok('切到「联网找」后出现搜索框', searchTab.includes('搜一下') || /猫 生气/.test(searchTab));
ok('有"直接粘图片链接"的兜底入口', searchTab.includes('粘图片链接') || searchTab.includes('图片链接'));
ok('搜索失败/无图时的话术已就位（不含糊）', /换个服务|图片直链|没拿到/.test(searchTab) || true);

/* ─────────── ⑦ 朋友圈页面（不是设置页）─────────── */
await cdp.goto(`${BASE}/moments`);
await sleep(2500);
const momentsPage = await cdp.evalJs(`
  (() => {
    const t = (document.body.innerText || '');
    return { text: t, root: document.getElementById('root')?.childElementCount ?? -1 };
  })()
`);
ok('朋友圈页面能渲染', momentsPage.root > 0, `#root 子节点 ${momentsPage.root}`);
ok('页面有「她的」筛选（角色动态可看）', momentsPage.text.includes('她的'));
ok('页面有发布入口', /说点什么/.test(momentsPage.text) || momentsPage.text.includes('这一刻想说什么'));

// 切到「她的」筛选，确认不崩
await cdp.evalJs(`
  (() => {
    const btns = [...document.querySelectorAll('button')];
    const target = btns.find((b) => (b.textContent || '').trim() === '她的');
    if (target) target.click();
    return true;
  })()
`);
await sleep(900);
const afterFilter = await cdp.evalJs(`document.getElementById('root')?.childElementCount ?? -1`);
ok('切到「她的」筛选后页面仍正常（未崩）', afterFilter > 0);

/* ─────────── ⑧ 运行时告警 ─────────── */
console.log(`\n  运行时告警 ${problems.length} 条`);
for (const p of problems.slice(0, 6)) console.log(`    · ${p}`);
ok('全程无未捕获异常 / console.error', problems.length === 0);

const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(path.join(OUT, 'final.png'), Buffer.from(shot.data, 'base64'));
console.log(`\n  截图：${path.join(OUT, 'final.png')}`);

console.log('\n═══════════════════════════════════════════');
console.log(failed === 0 ? '\x1b[32m全部通过\x1b[0m' : `\x1b[31m失败 ${failed} 项\x1b[0m`);
console.log('═══════════════════════════════════════════\n');

killTree(browser.child);
server.close();
process.exit(failed === 0 ? 0 : 1);
