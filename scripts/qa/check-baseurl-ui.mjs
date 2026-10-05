#!/usr/bin/env node
/**
 * 验证「接口地址」字段的引导行为（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 要验证的是"用户填错时会看到什么"
 * ═══════════════════════════════════════════════════════════════════════════
 * 起因：真机上用户把**完整端点** `https://api.deepseek.com/chat/completions`
 * 填进了「接口地址」（该字段期望基础地址）⇒ 地址被拼两遍 ⇒ HTTP 404。
 *
 * `check-url-join.mjs` 已经断言了**拼接逻辑**正确；本脚本验证**界面引导**到位：
 *   ① 推荐地址有没有显示出来；
 *   ② 偏离推荐值时有没有提醒 + 一键换回；
 *   ③ "实际会请求的地址"显示的是不是真的对。
 *
 * ★ 为什么必须走真实渲染而不是断言字符串：
 *   这一整页的价值就在"用户看得见"。逻辑对了但 UI 没渲染出来（条件写错、
 *   样式把它藏了、被 CapabilityGate 拦了），对用户来说等于没做。
 *
 * ★ 两阶段造数据（沿用 `diagnose-blank.mjs --stale` 的思路）：
 *   硬编码一份 settings 很容易因为漏字段而先崩在别处（我踩过），
 *   所以先让应用自己写出完整设置，再**只改 baseUrl 一个字段**，然后重载。
 *
 * 用法：
 *   node scripts/qa/check-baseurl-ui.mjs
 *   node scripts/qa/check-baseurl-ui.mjs --dir=dist
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Cdp, sleep } from './lib/cdp.mjs';
import { PROJECT_ROOT, startBrowser, killTree } from './lib/harness.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const DIR = path.resolve(arg('dir', path.join(PROJECT_ROOT, 'dist')));
const PORT = Number(arg('port', 4311));
const DEBUG_PORT = Number(arg('debugPort', 9371));
const OUT = path.join(PROJECT_ROOT, 'scripts', 'qa', 'out');
const TMP = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp', 'baseurl-profile');

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
};

async function serveStatic(dir, port) {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      let fp = path.join(dir, decodeURIComponent(url.pathname));
      if (!existsSync(fp) || statSync(fp).isDirectory()) fp = path.join(dir, 'index.html');
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(fp).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(readFileSync(fp));
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  return { server, base: `http://127.0.0.1:${port}` };
}

/** 跳过引导（否则被 RequireGuide 拦在 /guide，看不到设置页） */
const SKIP_GUIDE = `(() => { try { localStorage.setItem('ai-ai.guide.v1','1'); } catch(e){} })();`;

/** 把 activeProvider 的 baseUrl 改成指定值（只动这一个字段） */
const setBaseUrl = (url) => `(() => {
  try {
    var raw = JSON.parse(localStorage.getItem('ai-ai.settings.v1') || 'null');
    if (!raw || !raw.state || !raw.state.settings) return 'no-settings';
    var s = raw.state.settings;
    var ps = s.providers || [];
    var t = ps.find(function (p) { return p.id === s.activeProviderId; }) || ps[0];
    if (!t) return 'no-provider';
    t.baseUrl = ${JSON.stringify(url)};
    localStorage.setItem('ai-ai.settings.v1', JSON.stringify(raw));
    return 'ok:' + t.name;
  } catch (e) { return 'error:' + e.message; }
})()`;

/** 读出接口地址那一行的可见文本 + "实际会请求"里显示的 URL */
const READ_ROW = `(() => {
  const body = document.body.innerText || '';
  // 找"实际会请求"后面那一串
  const m = body.match(/实际会请求\\s*\\n?\\s*(\\S+)/);
  return {
    hasRecommendLabel: body.includes('推荐地址'),
    hasUseButton: body.includes('用它'),
    isUsingRecommended: body.includes('正在用推荐地址'),
    hasOffRecommendHint: body.includes('不是推荐地址'),
    resolvedUrl: m ? m[1] : '(未找到)',
    rowExcerpt: (body.split('接口地址')[1] || '').slice(0, 260).replace(/\\n+/g, ' | '),
  };
})()`;

let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${extra ? `  ${extra}` : ''}`);
};

async function main() {
  console.log(`\n═══ 接口地址引导验证 ═══\n产物：${DIR}\n`);
  mkdirSync(OUT, { recursive: true });

  const { base } = await serveStatic(DIR, PORT);
  const browser = await startBrowser({
    port: DEBUG_PORT,
    profileDir: TMP,
    freshProfile: true,
    windowSize: '576,1280',
  });
  const cdp = await Cdp.attach(DEBUG_PORT);
  await cdp.enableDomains();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 576, height: 1280, deviceScaleFactor: 2.5, mobile: true,
  });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SKIP_GUIDE });

  // 阶段①：干净启动一次，让应用写出完整 settings
  await cdp.send('Page.navigate', { url: `${base}/` });
  await sleep(5000);

  /** 打开设置页 → 关掉可能自动弹出的对话框 → 展开「模型」分组 → 读那一行 */
  async function readSettings(expectName) {
    /**
     * ★ 路径必须是 `/settings`，**不是 `#/settings`**。
     *   本项目用的是 `createBrowserRouter`（history 模式，见 `router/index.tsx:298`），
     *   hash 形式的 URL 它不认 ⇒ 落到 notFound ⇒ 整页读不到目标文案（我踩过一次，7 项全红）。
     *
     * ★ 必须**先展开分组**：移动端设置页的分组默认是收起的，
     *   不点开就只能读到 11 个分组标题，读不到任何字段（我第二次跑就是这样，
     *   截图里只看到两列折叠标题）。做法沿用 `shot-settings.mjs`：
     *   点 `[data-section-id="model"] button`。
     *
     * ★ 还要关掉首次访问自动弹出的「更新说明」对话框（FN-35）——
     *   它是模态的，会盖住页面。这是**测试前置**，不是产品缺陷。
     */
    await cdp.goto(`${base}/settings`, {
      readyExpr: '!!document.querySelector("[data-section-id]")',
      settleMs: 500,
    });

    await cdp.evalJs(`(() => {
      const btns = document.querySelectorAll('.MuiDialog-root button');
      for (const b of btns) {
        const txt = (b.textContent || '').trim();
        if (txt === '关闭' || txt === '好' || txt === '知道了' || txt === '算了') { b.click(); return 'closed'; }
      }
      return 'no-dialog';
    })()`);
    await sleep(400);

    const opened = await cdp.evalJs(`(() => {
      const b = document.querySelector('[data-section-id="model"] button');
      if (!b) return 'no-section';
      b.click();
      return 'clicked';
    })()`);
    await sleep(700);

    const r = await cdp.evalJs(READ_ROW);
    console.log(`\n── 场景：${expectName}（展开分组：${opened}）`);
    console.log(`   推荐地址标签 ${r.hasRecommendLabel ? '有' : '无'}｜「用它」按钮 ${r.hasUseButton ? '有' : '无'}｜正在用推荐 ${r.isUsingRecommended ? '是' : '否'}｜偏离提醒 ${r.hasOffRecommendHint ? '有' : '无'}`);
    console.log(`   实际会请求：${r.resolvedUrl}`);
    return r;
  }

  /* ——— 场景 A：用户当时的输入（完整端点） ——— */
  const setA = await cdp.evalJs(setBaseUrl('https://api.deepseek.com/chat/completions'));
  console.log(`[准备] 写入用户当时的地址 → ${setA}`);
  const a = await readSettings('用户当时的输入：…/chat/completions');
  check('A 能识别出是哪家（显示推荐地址）', a.hasRecommendLabel);
  check('A 提供「用它」把写法还原成推荐值', a.hasUseButton);
  check(
    'A 实际会请求的地址正确（不再重复拼接）',
    a.resolvedUrl === 'https://api.deepseek.com/v1/chat/completions',
    a.resolvedUrl === 'https://api.deepseek.com/v1/chat/completions' ? '' : `← 实际 ${a.resolvedUrl}`,
  );
  /**
   * ★ A 场景**不该**报偏离警告。
   *   用户填的虽然写法不规整，但实际请求完全正确 —— 报错属于误报，
   *   会让人去改一个本来就能正常工作的配置。
   */
  check('A 不误报偏离警告（请求地址等价）', !a.hasOffRecommendHint);
  await cdp.screenshot(path.join(OUT, 'baseurl-guide-user-input.png'));

  /* ——— 场景 B：推荐地址本身 ——— */
  const setB = await cdp.evalJs(setBaseUrl('https://api.deepseek.com/v1'));
  console.log(`\n[准备] 写入推荐地址 → ${setB}`);
  const b = await readSettings('推荐地址（预设默认值）');
  check('B 显示「正在用推荐地址」', b.isUsingRecommended);
  check('B 不显示偏离提醒', !b.hasOffRecommendHint);
  check('B 不显示「用它」按钮（已经是了）', !b.hasUseButton);
  check(
    'B 实际会请求的地址正确',
    b.resolvedUrl === 'https://api.deepseek.com/v1/chat/completions',
    b.resolvedUrl,
  );

  /* ——— 场景 C：不带 /v1 的基础地址 ——— */
  const setC = await cdp.evalJs(setBaseUrl('https://api.deepseek.com'));
  console.log(`\n[准备] 写入裸域名 → ${setC}`);
  const c = await readSettings('裸域名（不带 /v1）');
  check(
    'C 自动补到 /v1/chat/completions',
    c.resolvedUrl === 'https://api.deepseek.com/v1/chat/completions',
    c.resolvedUrl,
  );
  check('C 不误报偏离警告（等价写法）', !c.hasOffRecommendHint);

  /* ——— 场景 D：真偏离（请求地址确实不同） ———
     ★ 这个场景必须存在，否则"把提醒功能关掉"也能让 A/C 通过 —— 那就成了假通过。
  */
  const setD = await cdp.evalJs(setBaseUrl('https://api.deepseek.com/v2'));
  console.log(`\n[准备] 写入真偏离值 → ${setD}`);
  const d = await readSettings('真偏离：…/v2（请求地址确实不同）');
  check(
    'D 实际会请求 /v2/chat/completions（确认判据生效）',
    d.resolvedUrl === 'https://api.deepseek.com/v2/chat/completions',
    d.resolvedUrl,
  );
  check('D 显示偏离提醒', d.hasOffRecommendHint);
  check('D 提供「用它」换回推荐值', d.hasUseButton);
  await cdp.screenshot(path.join(OUT, 'baseurl-guide-off-recommend.png'));

  console.log(`\n截图：${OUT}/baseurl-guide-*.png`);
  console.log(`\n═══ ${failed === 0 ? '\x1b[32m全部通过 ✓' : `\x1b[31m${failed} 项失败`}\x1b[0m ═══\n`);

  cdp.close();
  killTree(browser.child);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n脚本出错：${e.message}\n${e.stack}`);
  process.exit(3);
});
