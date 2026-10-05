#!/usr/bin/env node
/**
 * 设置页视觉验收：在手机宽度与桌面宽度下截图，并与「改造前的问题清单」逐条比对。
 *
 * ★ 为什么要专门截图（而不是只看代码）：
 *   这次任务的靶子是**视觉**问题，而视觉问题只能看。用户给的真机截图暴露了三件事：
 *     ① 分组标题被能力编号挤成竖排（一字一行）；
 *     ② 顶栏「设置」被系统状态栏压住；
 *     ③ 十个面板同权重、满屏边框分割线 ⇒ 繁琐。
 *   代码层面"应该修好了"和屏幕上"真的好了"是两件事 —— 这个脚本负责后者。
 *
 * ★ 同时输出**可断言的数值**（标题宽度、是否竖排、编号是否还在 DOM 里），
 *   因为"看起来对"同样需要证据。
 *
 * 用法：
 *   node scripts/qa/shot-settings.mjs
 *   node scripts/qa/shot-settings.mjs --dir=dist
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

const DIR = path.resolve(arg('dir', path.join(PROJECT_ROOT, 'dist')));
const PORT = Number(arg('port', 4191));
const DEBUG_PORT = Number(arg('debugPort', 9251));
const TS = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(PROJECT_ROOT, 'scripts', 'qa', 'out', `settings-shot-${TS}`);
const TMP = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp');

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
  return { server, base: `http://127.0.0.1:${port}` };
}

/** 预置：跳过引导（否则被 RequireGuide 拦到 /guide，看不到设置页） */
const PRESET = `
(() => {
  try { localStorage.setItem('ai-ai.guide.v1', '1'); } catch (_) {}
})();
`;

/**
 * 量出「标题是否被挤成竖排」。
 * 判据：标题元素的**渲染宽度** < 其字数 × 最小可读字宽（约 0.9em）⇒ 一行放不下一个字，
 * 就会逐字换行。同时也直接量高度/行数。
 */
const MEASURE = `(() => {
  const out = { sections: [], capabilityIdsInDom: 0, leakSamples: [], docHeight: 0, topbar: null };
  // ① 每个分组标题的尺寸
  for (const box of document.querySelectorAll('[data-section-id]')) {
    const btn = box.querySelector('button');
    // ★ 选择器必须包含 h1~h6：Typography 的 variant 决定渲染成 p 还是 h6
    //   （subtitle1 → h6、body1 → p）。第一版只查了 p/span/div，
    //   于是 emphasis:'primary' 的「模型」分组被整个漏掉 —— 量测漏项会伪装成"没问题"。
    const t = btn ? btn.querySelector('h1,h2,h3,h4,h5,h6,p,span,div') : null;
    if (!t) {
      out.sections.push({ id: box.getAttribute('data-section-id'), label: '(量不到标题)', missing: true });
      continue;
    }
    const r = t.getBoundingClientRect();
    const cs = getComputedStyle(t);
    const fs = parseFloat(cs.fontSize) || 16;
    const lh = parseFloat(cs.lineHeight) || fs * 1.2;
    out.sections.push({
      id: box.getAttribute('data-section-id'),
      label: (t.textContent || '').trim(),
      width: Math.round(r.width),
      height: Math.round(r.height),
      fontSize: Math.round(fs),
      // 行数 ≈ 高度 / 行高
      lines: Math.max(1, Math.round(r.height / lh)),
      // 宽度不足一个字宽 ⇒ 必然逐字换行
      tooNarrow: r.width < fs * 0.9,
    });
  }
  // ② 能力编号是否还渲染在可见文本里（FN-xx / PG-xx / SV-xx / PL-xx / EX-xx / XR-xx）
  //    ★ 必须排除弹窗内容：AboutSection 的「更新说明」会把整个 CHANGELOG.md 渲染进
  //      一个 <pre>（内含 "对应 FN-35 …"，那是**文档正文**不是 UI 编号，会误报）。
  //      首次访问该弹窗会自动打开，所以这条排除是必需的，不是洁癖。
  const textOf = (root) => {
    if (!root) return '';
    const clone = root.cloneNode(true);
    for (const d of clone.querySelectorAll('.MuiDialog-root, [role="dialog"]')) d.remove();
    return clone.innerText || '';
  };
  const bodyText = textOf(document.body);
  const hits = bodyText.match(/\\b(FN|PG|SV|PL|EX|XR)-\\d+/g) || [];
  out.capabilityIdsInDom = hits.length;
  // 定位残留：找出**含编号文本的最小可见元素**，报出它所在的分组与文本片段
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length > 0) continue; // 只看叶子节点
    if (el.closest('.MuiDialog-root, [role="dialog"]')) continue; // 跳过弹窗内的正文
    const txt = (el.textContent || '').trim();
    if (!/\\b(FN|PG|SV|PL|EX|XR)-\\d+/.test(txt)) continue;
    const sec = el.closest('[data-section-id]');
    out.leakSamples.push({
      text: txt.slice(0, 80),
      section: sec ? sec.getAttribute('data-section-id') : '(不在分组内)',
      tag: el.tagName.toLowerCase(),
      visible: el.getBoundingClientRect().height > 0,
    });
  }
  out.docHeight = document.documentElement.scrollHeight;

  // ④ ★ 行标签塌方检查（2026-10-04 补：截图先发现了，量测当时只查了分组标题）
  //    判据与标题一致：渲染宽度不足一个字宽 ⇒ 中文必然逐字换行 = 竖排。
  //    同时排除"控件本身型"的行（纯按钮行没有标签，跳过）。
  out.narrowRowLabels = [];
  for (const line of document.querySelectorAll('[data-feature-id], .MuiStack-root')) {
    const label = line.querySelector(':scope > p');
    if (!label) continue;
    const cur = getComputedStyle(label).cursor;
    if (cur === 'pointer') continue; // 标签本身可点（如链接型），另算
    const r = label.getBoundingClientRect();
    if (r.height === 0) continue;
    const fs = parseFloat(getComputedStyle(label).fontSize) || 16;
    const lh = parseFloat(getComputedStyle(label).lineHeight) || fs * 1.2;
    const lines = Math.max(1, Math.round(r.height / lh));
    if (r.width < fs * 0.9 || lines > 2) {
      const sec = label.closest('[data-section-id]');
      out.narrowRowLabels.push({
        text: (label.textContent || '').trim().slice(0, 30),
        section: sec ? sec.getAttribute('data-section-id') : '?',
        width: Math.round(r.width),
        lines,
      });
    }
  }
  // ③ 顶栏几何（看是否被状态栏压住 / 高度是否含安全区）
  const appbar = document.querySelector('header.MuiAppBar-root');
  if (appbar) {
    const r = appbar.getBoundingClientRect();
    const cs = getComputedStyle(appbar);
    out.topbar = { top: Math.round(r.top), height: Math.round(r.height), paddingTop: cs.paddingTop };
  }
  return out;
})()`;

/**
 * 安全区**接线**验证。
 *
 * ★ 为什么需要它：真机上的 `env(safe-area-inset-top)` 由系统注入，
 *   桌面浏览器恒为 0 ⇒ 光看截图**无法证明**顶栏真的会为状态栏让位。
 *   （CDP 也没有直接设置 safe-area insets 的能力。）
 *   ⇒ 改成验证**接线是否正确**：覆盖 `--ai-ai-safe-top` 为一个非零值，
 *     若顶栏高度随之增加、且内容下移，说明 `calc()` 与 `var()` 链路是通的。
 *   这不能替代真机，但能把"完全没接线"这种错误排除掉。
 */
const SAFE_AREA_PROBE = `(() => {
  const before = document.querySelector('header.MuiAppBar-root').getBoundingClientRect().height;
  document.documentElement.style.setProperty('--ai-ai-safe-top', '40px');
  // 强制重排后读取
  void document.body.offsetHeight;
  const el = document.querySelector('header.MuiAppBar-root');
  const after = el.getBoundingClientRect().height;
  const pt = getComputedStyle(el).paddingTop;
  document.documentElement.style.removeProperty('--ai-ai-safe-top');
  return { before: Math.round(before), after: Math.round(after), paddingTop: pt };
})()`;;

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

let server;
let browser;
let cdp;

try {
  if (!existsSync(path.join(DIR, 'index.html'))) throw new Error(`产物不存在：${DIR}`);
  mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  mkdirSync(TMP, { recursive: true });

  const served = await serveStatic(DIR, PORT);
  server = served.server;
  console.log(`\n═══ 设置页视觉验收 ═══\n产物：${DIR}\n服务：${served.base}\n`);

  for (const vp of [
    { name: 'mobile', width: 388, height: 844, scale: 2 },
    { name: 'desktop', width: 1280, height: 900, scale: 1 },
  ]) {
    console.log(`── ${vp.name} ${vp.width}×${vp.height} ──`);
    browser = await startBrowser({
      port: DEBUG_PORT,
      profileDir: path.join(TMP, `profile-shot-${vp.name}-${Date.now()}`),
    });
    cdp = await Cdp.attach(DEBUG_PORT);
    await cdp.enableDomains();
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.scale,
      mobile: vp.name === 'mobile',
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PRESET });

    await cdp.goto(`${served.base}/settings`, {
      readyExpr: '!!document.querySelector("[data-section-id]")',
      settleMs: 600,
    });

    /*
     * ★ 先关掉自动弹出的「更新说明」对话框。
     *   全新 profile 首次访问时它**按设计**会自动弹（FN-35，已读版本写入
     *   `updateNotesSeenVersion`），但它是模态的，会盖住设置页 ——
     *   第一版脚本就是这样截到一屏 changelog 的。
     *   这是**测试前置**，不是产品缺陷。
     */
    await cdp.evalJs(`(() => {
      const dlgs = document.querySelectorAll('.MuiDialog-root');
      if (dlgs.length === 0) return 'no-dialog';
      const btns = document.querySelectorAll('.MuiDialog-root button');
      for (const b of btns) {
        const txt = (b.textContent || '').trim();
        if (txt === '关闭' || txt === '好' || txt === '知道了' || txt === '算了') { b.click(); return 'closed:' + txt; }
      }
      // 退一步：派发 Escape（MUI Dialog 默认响应）
      dlgs[dlgs.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      return 'esc';
    })()`);
    await sleep(600);

    // 移动端默认收起 ⇒ 先展开一个典型分组再截图，否则量不到标题
    if (vp.name === 'mobile') {
      await cdp.evalJs(`(() => {
        const b = document.querySelector('[data-section-id="model"] button');
        if (b) b.click();
        return true;
      })()`);
      await sleep(500);
    }

    const m = await cdp.evalJs(MEASURE);
    writeFileSync(path.join(OUT, `measure-${vp.name}.json`), `${JSON.stringify(m, null, 2)}\n`);

    console.log(`    分组数 ${m.sections.length}｜文档高 ${m.docHeight}px｜页内能力编号出现 ${m.capabilityIdsInDom} 次`);
    if (m.topbar) console.log(`    顶栏 top=${m.topbar.top} height=${m.topbar.height} paddingTop=${m.topbar.paddingTop}`);
    for (const s of m.sections) {
      if (s.missing) {
        console.log(`      · ${String(s.id).padEnd(11)} ${s.label} ← 量测不到`);
        continue;
      }
      console.log(`      · ${s.id.padEnd(11)} 「${s.label}」 宽${s.width} 字${s.fontSize} 行${s.lines}${s.tooNarrow ? ' ← 过窄!' : ''}`);
    }
    for (const L of m.leakSamples) {
      console.log(`      ⚠ 残留编号 ${JSON.stringify(L.text)} @ ${L.section} <${L.tag}> visible=${L.visible}`);
    }

    // ★ 不写死分组数：分组会随功能增删而变（本轮就新增了「微信 ClawBot」）。
    //   真正要保证的是"每个分组都量得到标题且不竖排"，数量多一个少一个不该判失败。
    check(`${vp.name}：每个分组都量到标题（共 ${m.sections.length} 个）`, m.sections.length > 0 && m.sections.every((s) => !s.missing));
    check(`${vp.name}：没有标题被挤成竖排`, m.sections.every((s) => s.missing || (!s.tooNarrow && s.lines <= 2)));
    check(`${vp.name}：页面上不再出现能力编号`, m.capabilityIdsInDom === 0, `出现 ${m.capabilityIdsInDom} 次`);
    check(
      `${vp.name}：没有行标签被挤成竖排`,
      (m.narrowRowLabels ?? []).length === 0,
      (m.narrowRowLabels ?? []).map((x) => `${x.section}/${x.text}(${x.width}px,${x.lines}行)`).join(' | '),
    );

    // 安全区接线（两档视口都验）
    const sa = await cdp.evalJs(SAFE_AREA_PROBE);
    console.log(`    安全区接线：--ai-ai-safe-top=40px 时顶栏 ${sa.before} → ${sa.after}，paddingTop=${sa.paddingTop}`);
    check(
      `${vp.name}：顶栏高度会随安全区增加（接线正确）`,
      sa.after === sa.before + 40 && sa.paddingTop === '40px',
      `${sa.before} → ${sa.after}（期望 +40）`,
    );

    await cdp.screenshot(path.join(OUT, 'shots', `${vp.name}-settings.png`));

    cdp.close();
    killTree(browser.child);
    browser = null;
  }
} catch (e) {
  console.error(`\n[致命] ${e.message}`);
  results.push({ name: 'harness', ok: false, detail: e.message });
} finally {
  try { cdp?.close(); } catch { /* 忽略 */ }
  killTree(browser?.child);
  try { server?.close(); } catch { /* 忽略 */ }
}

writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify({ dir: DIR, results }, null, 2)}\n`);
const failed = results.filter((r) => !r.ok);
console.log(`\n═══ ${results.length - failed.length}/${results.length} 通过 ═══`);
for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail ?? ''}`);
console.log(`\n截图：${path.join(OUT, 'shots')}`);
process.exit(failed.length === 0 ? 0 : 1);
