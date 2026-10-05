/**
 * DOM 探针（可复用诊断工具，不是一次性脚本）。
 *
 * 用途：新页面写断言前，先探一探它真实渲染出来的可交互元素——
 *   可见按钮的文本 / aria-label / 子图标 testid、虚线边框容器（FileDropZone）、
 *   弹窗数量、以及任意自定义表达式的结果。
 *
 * 用法：
 *   node scripts/qa/probe.mjs --url=/distill
 *   node scripts/qa/probe.mjs --url=/ --js="document.querySelectorAll('[role=dialog]').length"
 *   node scripts/qa/probe.mjs --url=/settings --click=导出
 */

import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Cdp, sleep } from './lib/cdp.mjs';
import { startDevServer, startBrowser, killTree } from './lib/harness.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const TMP = path.join(os.tmpdir(), `ai-ai-probe-${Date.now()}`);
let dev;
let browser;
let cdp;

try {
  dev = await startDevServer({ port: 5199 });
  browser = await startBrowser({ port: 9231, profileDir: path.join(TMP, 'profile'), freshProfile: true });
  cdp = await Cdp.attach(9231);
  await cdp.enableDomains();
  console.log('dev.base =', JSON.stringify(dev.base), ' url arg =', JSON.stringify(args.url));
  // 先落到应用 origin 才能写 localStorage（about:blank 是不透明源，会 SecurityError）
  await cdp.goto(`${dev.base}/`, { timeoutMs: 20000 });
  await cdp.evalJs(`localStorage.setItem('ai-ai.guide.v1','1')`);
  await cdp.goto(`${dev.base}${args.url ?? '/'}`, { timeoutMs: 20000 });
  await sleep(1500);

  // --seq=JSON / --seqfile=path  步骤序列：[{"click":"新建蒸馏"},{"type":"小圆"},{"click":"下一步"}]
  // ★ 复杂序列请用 --seqfile：Windows/Git-Bash 下把长 JSON 塞进命令行参数会被引号规则吃掉。
  if (args.seq || args.seqfile) {
    const { readFileSync } = await import('node:fs');
    const steps = JSON.parse(args.seqfile ? readFileSync(String(args.seqfile), 'utf8') : String(args.seq));
    for (const st of steps) {
      if (st.click) {
        await cdp.clickText(st.click).catch((e) => console.log(`click「${st.click}」失败：`, e.message));
      } else if (st.clickAria) {
        const r = await cdp.evalJs(
          `(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label')||'') === ${JSON.stringify(st.clickAria)} && x.getBoundingClientRect().width > 0); if (!b) return 'not-found'; b.click(); return 'clicked'; })()`,
        );
        console.log(`clickAria「${st.clickAria}」→ ${r}`);
      } else if (st.type !== undefined) {
        const r = await cdp.typeIntoSelector('input, textarea', String(st.type)).catch((e) => ({ value: `ERR ${e.message}` }));
        console.log(`type「${st.type}」→ ${JSON.stringify(r.value)}`);
      } else if (st.typeNth) {
        const r = await cdp
          .typeIntoSelector('input, textarea', String(st.typeNth.text), { nth: st.typeNth.nth })
          .catch((e) => ({ value: `ERR ${e.message}` }));
        console.log(`typeNth[${st.typeNth.nth}]「${st.typeNth.text}」→ ${JSON.stringify(r.value)}`);
      } else if (st.wait) {
        const ok = await cdp.waitFor(`document.body.innerText.includes(${JSON.stringify(st.wait)})`, { timeoutMs: st.timeoutMs ?? 8000 });
        console.log(`wait「${st.wait}」→ ${ok}`);
      } else if (st.drop !== undefined) {
        const r = await cdp.dropFile({ nth: st.drop.nth ?? 0, selector: st.drop.selector, name: st.drop.name, content: st.drop.content, mime: st.drop.mime });
        console.log(`drop → ${JSON.stringify(r)}`);
      } else if (st.jsInline) {
        const r = await cdp.evalJs(String(st.jsInline)).catch((e) => `ERR ${e.message}`);
        console.log(`jsInline → ${typeof r === 'string' ? r : JSON.stringify(r)}`);
      } else if (st.sleep) {
        await sleep(st.sleep);
      }
      await sleep(st.after ?? 900);
    }
  }

  if (args.type) {
    const r = await cdp.typeIntoSelector('input, textarea', String(args.type)).catch((e) => ({ value: `ERR ${e.message}` }));
    console.log(`输入「${args.type}」→ DOM value=${JSON.stringify(r.value)}`);
    await sleep(400);
  }
  if (args.click) {
    await cdp.clickText(String(args.click)).catch((e) => console.log('click 失败：', e.message));
    await sleep(1200);
  }
  if (args.clickAria) {
    const r = await cdp.evalJs(
      `(() => {
         const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === ${JSON.stringify(args.clickAria)} && x.getBoundingClientRect().width > 0);
         if (!b) return 'not-found';
         b.click();
         return 'clicked';
       })()`,
    );
    console.log(`clickAria「${args.clickAria}」→ ${r}`);
    await sleep(1500);
  }
  if (args.clicks) {
    for (const label of String(args.clicks).split(',')) {
      await cdp.clickText(label.trim()).catch((e) => console.log(`click「${label}」失败：`, e.message));
      await sleep(1200);
    }
  }

  if (args.drop) {
    const { readFileSync } = await import('node:fs');
    const cfg = JSON.parse(String(args.drop));
    const content = cfg.fixture ? readFileSync(path.join(process.cwd(), cfg.fixture), 'utf8') : (cfg.content ?? '');
    const r = await cdp.dropFile({ selector: cfg.selector, nth: cfg.nth ?? 0, name: cfg.name, content, mime: cfg.mime });
    console.log('=== --drop 结果 ===');
    console.log(JSON.stringify(r, null, 2));
    await sleep(2500);
  }

  if (args.jsfile) {
    const { readFileSync } = await import('node:fs');
    const out = await cdp.evalJs(readFileSync(String(args.jsfile), 'utf8'));
    console.log('=== --jsfile 结果 ===');
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
  }
  if (args.js) {
    const out = await cdp.evalJs(String(args.js));
    console.log('=== --js 结果 ===');
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
  }

  const summary = await cdp.evalJs(
    `(() => {
       const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
       const buttons = [...document.querySelectorAll('button')].filter(vis).map((b) => ({
         text: (b.innerText || '').trim().slice(0, 24),
         ariaLabel: b.getAttribute('aria-label') || '',
         icon: b.querySelector('svg') ? (b.querySelector('svg').getAttribute('data-testid') || '') : '',
       }));
       const dashed = [...document.querySelectorAll('div')].filter((e) => vis(e) && getComputedStyle(e).borderTopStyle === 'dashed')
         .map((e) => ({ text: (e.innerText || '').trim().slice(0, 30), border: getComputedStyle(e).borderTopStyle, w: Math.round(e.getBoundingClientRect().width) }));
       const fileInputs = [...document.querySelectorAll('input[type=file]')].map((e) => ({ accept: e.accept, hidden: e.hidden }));
       return { url: location.pathname, dialogs: document.querySelectorAll('[role=dialog]').length, buttons, dashed, fileInputs };
     })()`,
  );
  console.log('=== 页面概要 ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('=== 控制台告警 / 未捕获异常 ===');
  for (const e of cdp.events) console.log(`  [${e.phase}/${e.kind}] ${String(e.text).slice(0, 400)}`);
  console.log('\n=== body 文本（前 600 字）===');
  console.log((await cdp.bodyText()).slice(0, 600));
} finally {
  cdp?.close();
  killTree(browser?.child);
  killTree(dev?.child);
}
