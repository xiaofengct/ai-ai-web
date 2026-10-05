#!/usr/bin/env node
/**
 * 白屏诊断（2026-10-04，用户真机录屏报"应用打开是黑屏，无法使用"）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么不能靠读代码判断
 * ═══════════════════════════════════════════════════════════════════════════
 * 用户录屏抽帧实测：从约 1.0s 到录制结束（7.66s）**全程纯黑/纯白，无任何 UI 元素**。
 * 这不是"某个控件错位"，而是 **React 压根没渲染出来**（`#root` 是空的）。
 *
 * 这类问题的成因全都藏在**运行时**：模块求值顺序、循环依赖、某个 import 抛错、
 * Service Worker 抢缓存、`window.Capacitor` 不存在导致的分支异常……静态读代码捞不出来。
 * 所以本脚本的目标只有一个：**把浏览器控制台里那句真正的报错捞出来**。
 *
 * ★ 用 `--dir=` 指定要诊断的产物目录，默认直接诊断**打进 APK 的那份**
 *   （`android/app/src/builtin/assets/public`），而不是 `dist/` ——
 *   因为 APK 里跑的是前者，两者不同步时 `dist/` 的诊断结论会骗人。
 *
 * ★ 三条实测出来的规矩（沿用 `docs/07` §8）：
 *   - 不用 agent-browser daemon，直连 CDP + 固定 `--user-data-dir`；
 *   - viewport 必须显式设成**手机尺寸**（1440x3200@2.5 → CSS 576x1280 那种），
 *     桌面宽度下很多布局 bug 不复现；
 *   - 判定"白屏"用**可断言的数字**（`#root` 子节点数、innerText 长度），不靠肉眼。
 *
 * 用法：
 *   node scripts/qa/diagnose-blank.mjs
 *   node scripts/qa/diagnose-blank.mjs --dir=dist
 *   node scripts/qa/diagnose-blank.mjs --dir=android/app/src/standalone/assets/public
 *   node scripts/qa/diagnose-blank.mjs --native     # 额外模拟 Capacitor 原生壳环境
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Cdp, sleep } from './lib/cdp.mjs';
import { PROJECT_ROOT, startBrowser, killTree } from './lib/harness.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  return process.argv.includes(`--${name}`) ? true : dflt;
};

const DIR = path.resolve(arg('dir', path.join(PROJECT_ROOT, 'android/app/src/builtin/assets/public')));
const PORT = Number(arg('port', 4301));
const DEBUG_PORT = Number(arg('debugPort', 9361));
const NATIVE = arg('native', false) === true;
const GUIDED = arg('guided', false) === true;
/**
 * `--legacy`：**模拟老版 Android System WebView**。
 *
 * ★★ 这是本次白屏问题的关键实验（2026-10-04）。
 *
 * 背景：用户真机录屏是**纯 #111111 空白**（= 系统深色窗口背景），
 *   即 WebView 里的 JS **完全没渲染出东西**。而同一份产物在 Chrome 里一切正常。
 *   ⇒ 差异只可能在**运行环境的能力集**上。
 *
 * 实测产物（`dist/assets/*.js`）里用到的、**有版本门槛的运行时 API**：
 *   structuredClone        9 次   ← Chrome 98+（2022-02）
 *   Object.hasOwn          5 次   ← Chrome 93+
 *   WeakRef                3 次   ← Chrome 84+
 *   FinalizationRegistry   2 次   ← Chrome 84+
 *   Array.prototype.at            ← Chrome 92+
 *   showOpenFilePicker            ← Chrome 86+
 *
 * 而 `src/constants/defaults.ts` 在**模块初始化**阶段就调 `structuredClone(...)`
 * （`chat` / `appearance` / `ilink` 三个分组各一次）——
 * 老 WebView 上它不存在 ⇒ `TypeError` ⇒ React 整棵树渲染失败。
 *
 * ★ 为什么 ErrorBoundary 兜不住：`<ErrorBoundary>` 挂在 `App` **内部**，
 *   而错误发生在 `App` 自身的求值过程（store 初始化）中 ——
 *   边界**在错误点的下方**，抓不到。React 于是卸载整棵树 ⇒ 纯空白。
 *   这也解释了为什么屏幕上**没有**出现崩溃页。
 *
 * 本开关就是把这个假设变成**可复现的实验**：在页面脚本执行前删掉这些 API。
 * 复现成功 = 根因确认；修完再跑，应当恢复渲染。
 */
const LEGACY = arg('legacy', false) === true;
/**
 * `--break`：**故意让入口脚本 404**，验证"失败可见"的兜底是否真的生效。
 *
 * 为什么需要这个实验：本次修复对外承诺了一句很硬的话 ——
 *   「白屏在物理上不可能发生了」。这种断言必须能被证伪才算数。
 * 本开关模拟最坏情况：入口 JS 加载失败（资源被拦 / 打包漏文件 / CDN 挂了）。
 * 期望结果**不是**"能正常用"，而是"**用户看得到错误面板**" ——
 * 有信息、能重载、能截图反馈，而不是一片空白。
 */
const BREAK = arg('break', false) === true;
/**
 * `--stale`：**模拟"从旧版覆盖升级"的 localStorage**，复现真实崩溃。
 *
 * ★★ 这是 2026-10-04 第二个真机 P0 的回归测试。
 *
 * 现场：用户覆盖安装后打开应用，拿到启动失败面板：
 *     TypeError: Cannot read properties of undefined (reading 'enabled')
 *         at Object.ensureRunning
 * 根因：`ilink`（微信 ClawBot）是**新加**的设置分组，而老用户 localStorage 里的
 *   settings **没有这个键** ⇒ `settings.ilink` 为 `undefined` ⇒ 读 `.enabled` 抛错。
 *   又因为错误发生在 `App` 自身的 effect 里，而 `<ErrorBoundary>` 挂在 App 子树中，
 *   边界**捕获不到父组件自身的错误** ⇒ React 卸载整棵树 ⇒ 空白。
 *
 * 本开关把那个场景搬到本地：写入一份**故意不含 `ilink`** 的旧 settings。
 *
 * ★ 两个关键细节（写错就复现不出来）：
 *   ① **存储格式是 `{ state: {...}, version: N }`**（zustand persist 的包装），
 *      不是裸的 settings —— 见 `node_modules/zustand/middleware.js:373`。
 *   ② **`version` 必须与当前 `SETTINGS_VERSION` 相同**（都是 1）。
 *      若写成别的值，zustand 会去调 `migrate` 把数据修好，就复现不出这个 bug 了 ——
 *      而真实故障恰恰是"加了新分组但没递增 version"。
 */
const STALE = arg('stale', false) === true;

/**
 * ★ 「旧版数据」用**两阶段**构造，而不是硬编码一份假 settings。
 *
 * 为什么不用硬编码（我第一版就是那么写的，随后发现问题）：
 *   手写一份"旧 settings"必须把所有早期分组都写对，否则测的就不是
 *   "缺 ilink"，而是"缺 appearance 的某个子字段" ——
 *   我第一版写 `appearance: {}`，结果先崩在主题代码的
 *   `Cannot read properties of undefined (reading 'bg')`，**没测到目标错误**。
 *
 * 正确做法（两阶段，贴近真实）：
 *   ① 先让应用**正常启动一次** ⇒ localStorage 里落下**真实完整**的 settings；
 *   ② 再**只删掉 `ilink` 这一个键** —— 这正是"新版加了分组、老用户还没写过"的状态；
 *   ③ 重新加载 ⇒ 观察是否崩。
 * 这样被测的变量只有一个（ilink 的有无），因果干净。
 */
const DELETE_ILINK_JS = `(() => {
  try {
    var raw = JSON.parse(localStorage.getItem('ai-ai.settings.v1') || 'null');
    if (!raw || !raw.state || !raw.state.settings) return 'no-settings';
    var had = Object.prototype.hasOwnProperty.call(raw.state.settings, 'ilink');
    delete raw.state.settings.ilink;
    localStorage.setItem('ai-ai.settings.v1', JSON.stringify(raw));
    return had ? 'deleted' : 'already-absent';
  } catch (e) { return 'error:' + e.message; }
})()`;

/** 模拟"老 WebView 缺哪些 API"。删掉的都是**有明确版本门槛**的成员。 */
const LEGACY_STRIP = `
(() => {
  const kill = (obj, name) => { try { delete obj[name]; } catch (e) {} };
  // Chrome 98+ / WebView 98+
  kill(window, 'structuredClone');
  // Chrome 93+
  kill(Object, 'hasOwn');
  // Chrome 84+
  kill(window, 'WeakRef');
  kill(window, 'FinalizationRegistry');
  // Chrome 92+
  kill(Array.prototype, 'at');
  kill(String.prototype, 'at');
  // Chrome 90+
  kill(window, 'reportError');
  // Chrome 104+
  kill(Array.prototype, 'findLast');
  kill(Array.prototype, 'findLastIndex');
  // Chrome 111+
  kill(Array.prototype, 'toSorted');
  kill(Array.prototype, 'toReversed');
})();
`;
const TS = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(PROJECT_ROOT, 'scripts', 'qa', 'out', `blank-${TS}`);
const TMP = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp', 'blank-profile');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(dir, port, { breakEntry = false } = {}) {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const clean = decodeURIComponent(url.pathname);

      // ★ `--break`：把入口 chunk 变成 404，模拟"资源加载失败"
      if (breakEntry && /\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(clean)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('(simulated missing entry chunk)');
        return;
      }

      let fp = path.join(dir, clean);
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

/**
 * 关键量测：`#root` 到底有没有东西。
 * 判据全部是数字，避免"看起来像白屏"这种主观描述。
 */
const PROBE = `(() => {
  const root = document.getElementById('root');
  const bodyText = (document.body.innerText || '').trim();
  const rootText = root ? (root.innerText || '').trim() : '';
  const firstLevel = root ? Array.from(root.children).map(e => e.tagName + '.' + (e.className || '').toString().slice(0, 60)) : [];
  return {
    hasRoot: !!root,
    rootChildCount: root ? root.children.length : -1,
    rootHtmlLen: root ? root.innerHTML.length : -1,
    rootTextLen: rootText.length,
    rootTextSample: rootText.slice(0, 120),
    bodyTextLen: bodyText.length,
    bodyTextSample: bodyText.slice(0, 120),
    firstLevelChildren: firstLevel,
    // 页面上所有可见的、有文字的元素数量（白屏时接近 0）
    visibleTextNodes: Array.from(document.querySelectorAll('body *')).filter(e => {
      if (e.children.length > 0) return false;
      const t = (e.textContent || '').trim();
      if (!t) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).length,
    htmlClass: document.documentElement.className,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    // 入口脚本是否 404（Vite 产物里的 module script）
    scriptTags: Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src')),
    // 是否有 CSS 生效
    styleSheets: document.styleSheets.length,
    // ★ 兜底层状态：静态启动页与错误面板是否可见
    bootVisible: (() => {
      const b = document.getElementById('boot');
      if (!b) return false;
      const cs = getComputedStyle(b);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && b.getBoundingClientRect().height > 0;
    })(),
    errorVisible: (() => {
      const p = document.getElementById('boot-error');
      if (!p) return false;
      const cs = getComputedStyle(p);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && p.getBoundingClientRect().height > 0;
    })(),
    errorText: (() => {
      const p = document.getElementById('boot-error-detail');
      return p ? (p.textContent || '').slice(0, 600) : '';
    })(),
  };
})()`;

async function main() {
  console.log(`\n═══ 白屏诊断 ═══`);
  console.log(`产物目录：${DIR}`);
  console.log(`模拟原生壳：${NATIVE ? '是（注入 window.Capacitor）' : '否'}`);
  console.log(`模拟已引导：${GUIDED ? '是（写入 ai-ai.guide.v1）' : '否'}`);
  console.log(`模拟老 WebView：${LEGACY ? '★ 是（删掉 structuredClone / Object.hasOwn 等）' : '否'}`);
  console.log(`模拟旧版数据：${STALE ? '★ 是（settings 里刻意不含 ilink 分组）' : '否'}\n`);

  if (!existsSync(path.join(DIR, 'index.html'))) {
    console.error(`✗ 该目录下没有 index.html：${DIR}`);
    process.exit(2);
  }

  mkdirSync(OUT, { recursive: true });
  const { base } = await serveStatic(DIR, PORT, { breakEntry: BREAK });
  console.log(`静态服务：${base}`);
  if (BREAK) console.log('★ 已启用 --break：入口 chunk 将返回 404（模拟资源加载失败）');

  const browser = await startBrowser({
    port: DEBUG_PORT,
    profileDir: TMP,
    freshProfile: true,
    windowSize: '576,1280',
  });
  const cdp = await Cdp.attach(DEBUG_PORT);
  await cdp.enableDomains();

  // ★ 手机 viewport：用户手机是 1440x3200 / DPR 2.5 ⇒ CSS 576x1280。
  //   桌面宽度下布局 bug 不复现，这一段不能省。
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 576,
    height: 1280,
    deviceScaleFactor: 2.5,
    mobile: true,
  });

  // ★ 模拟原生壳：Capacitor 在 WebView 里注入 window.Capacitor。
  //   代码里任何 `Capacitor.isNativePlatform()` 分支在纯浏览器下走的是另一条路，
  //   所以"纯浏览器正常"**不能**推出"APK 正常"。用 --native 把这条路也走一遍。
  if (NATIVE) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        window.Capacitor = {
          isNativePlatform: () => true,
          getPlatform: () => 'android',
          isPluginAvailable: () => true,
          Plugins: {},
          convertFileSrc: (p) => p,
        };
      `,
    });
  }

  /**
   * ★★ `--guided`：注入"引导已完成"标记，模拟**升级安装 / 复访**状态。
   *
   * 为什么必须单独测这条路（而不是只测首次启动）：
   *   全新状态走的是**引导页**（`/guide`），而已引导状态走的是**主界面**。
   *   两者是不同的渲染路径，首次启动正常**不能**推出复访正常。
   *   用户是装过旧版的，所以真实场景恰恰是后者。
   *
   * 键名取自 `src/constants/storageKeys.ts` 的 `guide`，不硬编码猜测。
   */
  if (GUIDED) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        try { localStorage.setItem('ai-ai.guide.v1', '1'); } catch (e) {}
      `,
    });
  }

  // ★ 老 WebView 模拟必须放在**所有其它注入之前执行**（先删 API，再跑页面脚本）
  if (LEGACY) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: LEGACY_STRIP });
  }

  // ★ `--stale` 不需要在这里预注入：它走"先正常启动一次、再删 ilink、再重载"的
  //   两阶段流程（见下方主流程的 STALE 分支），这样测的才是**真实完整**的设置
  //   只缺一个键，而不是一份手写的假数据。

  cdp.setPhase('load');
  const t0 = Date.now();
  /**
   * 告警计时的起点：要按阶段取。
   * 常规 = 从首次导航算；
   * `--stale` = 从**重载前**算（否则会把第一阶段正常启动的噪音算进来，
   *   而第一阶段本来就是"干净"的，混进来会淹没真正要看的错误）。
   */
  let watchFrom = t0;
  // ★★ 必须导航到**根路径 `/`**，不能导航到 `/index.html`。
  //   踩过的坑（我第一版就这么写的，并因此得出一个**假结论**）：
  //   React Router 的路由表里没有 `/index.html` 这一条，于是请求命中
  //   `ROUTE.notFound` 兜底路由 → 渲染 `CrashPage variant="notFound"`。
  //   日志里看到"崩溃页 + 0 条错误"时，我一度以为复现了用户的崩溃 ——
  //   其实那只是**我自己的测试路径不对**。静态服务器会把 `/` 回落到 index.html，
  //   与 Capacitor WebView 的行为一致（它加载的也是根路径）。
  //   ⇒ 教训：诊断脚本本身也会造假象；看到"异常结果"先怀疑测法。
  await cdp.send('Page.navigate', { url: `${base}/` });

  /**
   * `--stale` 的第一阶段：先正常启动一次，让 localStorage 落下**真实完整**的设置；
   * 然后只删掉 `ilink` 键，再重载 —— 这才是"覆盖升级后老用户"的真实状态。
   */
  if (STALE) {
    await sleep(6000);
    const delResult = await cdp.evalJs(DELETE_ILINK_JS);
    console.log(`\n[stale] 删除 ilink 键：${delResult}`);
    cdp.setPhase('reload-after-stale');
    // ★ 计时从**重载前**开始，只统计第二阶段
    watchFrom = Date.now();
    await cdp.send('Page.navigate', { url: `${base}/?stale=1` });
  }

  /**
   * 等待时长：
   *   常规 6s 足够首屏 + 懒加载 + 种子数据。
   *   `--break` 下必须**超过看门狗的 10s**，否则错误面板还没到显示时机。
   */
  await sleep(BREAK ? 12000 : 6000);

  const probe = await cdp.evalJs(PROBE);
  const events = cdp.eventsSince(watchFrom);

  await cdp.screenshot(path.join(OUT, 'screen.png'));

  console.log(`\n────── 渲染结果（等待 6s 后）──────`);
  console.log(`  #root 存在          ${probe.hasRoot}`);
  console.log(`  #root 一级子节点数  ${probe.rootChildCount}`);
  console.log(`  #root innerHTML 长度 ${probe.rootHtmlLen}`);
  console.log(`  #root 可见文本长度  ${probe.rootTextLen}`);
  console.log(`  body 文本长度       ${probe.bodyTextLen}`);
  console.log(`  可见叶子文字节点数  ${probe.visibleTextNodes}`);
  console.log(`  html class          "${probe.htmlClass}"`);
  console.log(`  body 背景色         ${probe.bodyBg}`);
  console.log(`  样式表数量          ${probe.styleSheets}`);
  console.log(`  入口 script 标签    ${JSON.stringify(probe.scriptTags)}`);
  if (probe.firstLevelChildren.length) {
    console.log(`  一级子节点          ${JSON.stringify(probe.firstLevelChildren, null, 0)}`);
  }
  if (probe.rootTextSample) console.log(`  文本样本            ${probe.rootTextSample}`);
  else if (probe.bodyTextSample) console.log(`  body 文本样本       ${probe.bodyTextSample}`);

  console.log(`\n────── 运行时告警（${events.length} 条）──────`);
  if (events.length === 0) {
    console.log('  （无 uncaught / console.error / log.error）');
  } else {
    for (const e of events) {
      console.log(`  [${e.kind}] ${e.text}`);
      if (e.url) console.log(`         at ${e.url}:${e.line ?? '?'}`);
    }
  }

  // 判定
  const blank = probe.rootChildCount <= 0 && probe.rootHtmlLen <= 0;
  console.log(`\n────── 兜底层状态 ──────`);
  console.log(`  静态启动页 #boot 可见  ${probe.bootVisible}`);
  console.log(`  错误面板 #boot-error 可见 ${probe.errorVisible}`);
  if (probe.errorText) {
    console.log(`  面板内容（截断）：`);
    for (const line of probe.errorText.split('\n').slice(0, 12)) console.log(`    ${line}`);
  }

  console.log(`\n────── 判定 ──────`);
  if (BREAK) {
    /**
     * `--break` 的验收口径**不是**"能正常用"，而是"**失败可见**"。
     * 白屏（连兜底层都没了）才算失败。
     */
    if (probe.errorVisible) {
      console.log('  \x1b[32m✓ 兜底生效：入口脚本 404 时，用户看到的是错误面板而不是白屏\x1b[0m');
    } else if (probe.bootVisible) {
      console.log('  \x1b[33m! 只看到静态启动页，错误面板没出现 —— 看门狗可能没触发\x1b[0m');
    } else {
      console.log('  \x1b[31m✗ 白屏：兜底层完全没有显示 ⇒ "失败可见"的承诺不成立\x1b[0m');
    }
  } else if (blank) {
    console.log('  \x1b[31m✗ 白屏确认：#root 完全为空 ⇒ React 未渲染\x1b[0m');
    if (events.length === 0) {
      console.log('  ⚠️ 但没有捕获到任何错误 —— 说明失败发生在**更早**的地方：');
      console.log('     入口 module script 可能 404、或解析失败（语法错误不会被 runtime 捕获）');
      console.log('     下一步：核对 index.html 里引用的 assets/*.js 是否真实存在');
    }
  } else {
    console.log(`  \x1b[32m✓ 有渲染\x1b[0m（#root ${probe.rootChildCount} 个子节点，可见文字节点 ${probe.visibleTextNodes} 个）`);
  }

  console.log(`\n产物：${OUT}`);
  console.log(`  截图 screen.png\n`);

  cdp.close();
  killTree(browser.child);
  // --break 模式下，"错误面板可见"就是成功
  process.exit(BREAK ? (probe.errorVisible ? 0 : 1) : blank ? 1 : 0);
}

main().catch((e) => {
  console.error(`\n诊断脚本自身出错：${e.message}\n${e.stack}`);
  process.exit(3);
});
