/**
 * EX-06~EX-10 真浏览器验证（临时脚本，不进 verify 链、不进构建）。
 *
 * 验什么：蒸馏向导「零原材料」路径 —— 用户不提供任何聊天记录时，
 *   ① 能不能一路走到第 5 步并写入成功（EX-09 / EX-10 写入与快照）
 *   ② 成功提示**不得**宣称「她说话的样子我大概记住了」（不编造共同回忆红线）
 *   ③ 必须出现 `distill.write.skeletonDone` 的空架子说明（EX-06 降级可见）
 *
 * 方法按 `docs/07-交付说明.md` §8：
 *   - §8.2 直连 CDP + 固定 `--user-data-dir`（不用 daemon，避免 localStorage 丢失）
 *   - §8.3 真输入：CDP `Input.insertText`，不用 `element.value =`
 *   - §8.5 允许多种实现：只要"骨架提示出现"即通过，不限定它是 warning 还是别的 severity
 *
 * 用法：node scripts/tmp-ex-verify.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9222;
const BASE = 'http://127.0.0.1:5173';
const PROFILE = path.join(os.tmpdir(), 'ai-ai-ex-verify-profile');
const SHOT_DIR = path.join(os.tmpdir(), 'ai-ai-ex-verify-shots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ CDP 客户端 ============================ */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.log = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Runtime.exceptionThrown') {
        this.log.push(msg.method);
      }
    });
  }

  static async attach() {
    for (let i = 0; i < 60; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        const list = await res.json();
        const page = list.find((t) => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) {
          const ws = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((ok, bad) => {
            ws.addEventListener('open', ok, { once: true });
            ws.addEventListener('error', bad, { once: true });
          });
          return new Cdp(ws);
        }
      } catch {
        /* 还没起来，继续等 */
      }
      await sleep(500);
    }
    throw new Error('CDP 端口 30 秒内未就绪');
  }

  send(method, params = {}) {
    const id = (this.id += 1);
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 30000);
    });
  }

  async evalJs(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`页面内异常：${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
    }
    return r.result.value;
  }

  async goto(url) {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Page.navigate', { url });
    await sleep(2500);
  }

  /** §8.4：只看可见控件；按文本找元素并返回中心点 */
  /**
   * §8.4：只看可见控件。
   * ★ 必须先 `scrollIntoView` 再量坐标：蒸馏向导页面很长，按钮常常在视口之外，
   *   `getBoundingClientRect()` 给出的 y 会超出窗口高度，CDP 鼠标点到那里等于点到空气
   *   （表现：按钮"点了没反应"，实际是坐标没落在按钮上）。
   */
  async rectOfText(text, selector = 'button, [role="button"], a') {
    const found = await this.evalJs(
      `(() => {
        // ★ 先清掉上一次的标记：否则第二次量坐标会 querySelector 到上一个元素
        document.querySelectorAll('[data-ex-target]').forEach((e) => e.removeAttribute('data-ex-target'));
        const list = [...document.querySelectorAll(${JSON.stringify(selector)})];
        const el = list.find((e) => {
          const r = e.getBoundingClientRect();
          const visible = r.width > 0 && r.height > 0;
          return visible && (e.textContent || '').trim().includes(${JSON.stringify(text)});
        });
        if (!el) return null;
        el.setAttribute('data-ex-target', '1');
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        return { text: el.textContent.trim(), disabled: !!el.disabled };
      })()`,
    );
    if (!found) return null;
    // 滚完等一帧再量坐标（页面若有平滑滚动，立刻量会拿到滚动前的旧坐标）
    await sleep(350);
    const rect = await this.evalJs(
      `(() => {
        const el = document.querySelector('[data-ex-target="1"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          inViewport: r.y >= 0 && r.y <= window.innerHeight,
        };
      })()`,
    );
    if (!rect) return null;
    return { ...found, ...rect };
  }

  async clickText(text, selector) {
    const rect = await this.rectOfText(text, selector);
    if (!rect) throw new Error(`找不到可见元素：${text}`);
    if (rect.disabled) throw new Error(`元素存在但 disabled：${text}`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type,
        x: rect.x,
        y: rect.y,
        button: 'left',
        clickCount: 1,
        buttons: type === 'mousePressed' ? 1 : 0,
      });
    }
    await sleep(900);
    return rect;
  }

  /** §8.3：真输入，逐个可见输入框找第一个匹配的，点聚焦后 insertText */
  async typeIntoNth(nth, text) {
    const box = await this.evalJs(
      `(() => {
        const list = [...document.querySelectorAll('input,textarea')].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && !e.readOnly && e.getAttribute('aria-hidden') !== 'true';
        });
        const el = list[${nth}];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName, type: el.type || '' };
      })()`,
    );
    if (!box) throw new Error(`第 ${nth} 个可见输入框不存在`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type,
        x: box.x,
        y: box.y,
        button: 'left',
        clickCount: 1,
        buttons: type === 'mousePressed' ? 1 : 0,
      });
    }
    await sleep(200);
    await this.send('Input.insertText', { text });
    await sleep(400);
    const value = await this.evalJs(
      `(() => {
        const list = [...document.querySelectorAll('input,textarea')].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && !e.readOnly && e.getAttribute('aria-hidden') !== 'true';
        });
        return list[${nth}] ? String(list[${nth}].value) : null;
      })()`,
    );
    return { box, value };
  }

  async bodyText() {
    return this.evalJs(`document.body.innerText.replace(/\\n{2,}/g, '\\n')`);
  }

  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(SHOT_DIR, `${name}.png`);
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
}

/* ============================ 主流程 ============================ */

const SKELETON = '写好了，但你没给我原材料，所以这只是个空架子，不是我记得的她。';
const FORBIDDEN = '她说话的样子我大概记住了';

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const edge = spawn(
    EDGE,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      // ★ 必须关代理：本沙箱里 `HTTP_PROXY` 指向 127.0.0.1:59036，Edge 默认会走它，
      //   于是 `127.0.0.1:5173` 被送去代理 → ERR_CONNECTION_REFUSED（dev server 明明活着）。
      '--no-proxy-server',
      '--proxy-bypass-list=<-loopback>',
      '--window-size=1280,900',
      '--allow-insecure-localhost',
      // ★ 不加 `--single-process`：实测 Edge 154 + `--headless=new` 加这个参数后
      //   **调试端口根本不开**（`/json/version` 连不上，脚本超时"30 秒未就绪"）。
      //   §8.2 要 `--single-process` 的**目的**是别让 localStorage 丢——
      //   本脚本用的是"直连启动 + 固定 `--user-data-dir`"，数据本来就落在磁盘上，不受影响。
      //   （记录这次观测，免得下一个人照抄 §8.2 又踩一遍。）
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
  );

  const result = { stages: [] };
  try {
    const cdp = await Cdp.attach();
    const stage = (name, extra) => {
      result.stages.push({ name, ...extra });
      console.log(`\n─── ${name} ───`);
      if (extra?.text) console.log(String(extra.text).slice(0, 900));
    };

    await cdp.goto(`${BASE}/distill`);
    let landing = await cdp.bodyText();
    if (landing.includes('先接个模型')) {
      // ★ 首次访问任何路由都会被 `RequireGuide` 拦到 4 步引导页，走完才写 `ai-ai.guide.v1`。
      //   这是真实现象（不是脚本问题），单独记一个 stage。
      stage('⓪ 首次访问 /distill 被引导页拦截', { text: landing, shot: await cdp.shot('00-guide-1') });
      for (let i = 0; i < 3; i += 1) {
        const has = await cdp.rectOfText('下一步');
        if (!has) break;
        await cdp.clickText('下一步');
        await sleep(600);
      }
      landing = await cdp.bodyText();
      stage('⓪b 引导第 4 步', { text: landing, shot: await cdp.shot('00-guide-4') });
      // 「算了」= finishWithoutSession：写标记 + 跳回原本要去的路由（/distill）
      await cdp.clickText('算了');
      await sleep(1500);
      landing = await cdp.bodyText();
    }
    stage('① /distill 列表页', { text: landing, shot: await cdp.shot('01-list') });

    await cdp.clickText('新建蒸馏');
    stage('② 第1步 先说说她', { text: await cdp.bodyText(), shot: await cdp.shot('02-intake') });

    // 真实键盘输入：称呼（第一个可见输入框）
    const typed = await cdp.typeIntoNth(0, '小圆');
    stage('③ 输入称呼（真键盘）', { text: `DOM value = ${JSON.stringify(typed.value)}` });

    await cdp.clickText('下一步');
    stage('④ 第2步 原材料', { text: await cdp.bodyText(), shot: await cdp.shot('03-sources') });

    await cdp.clickText('先跳过');
    stage('⑤ 第3步 我来读（零原材料）', { text: await cdp.bodyText(), shot: await cdp.shot('04-analyze') });

    await cdp.clickText('开始分析');
    await sleep(3500);
    stage('⑥ 第4步 预览', { text: await cdp.bodyText(), shot: await cdp.shot('05-preview') });

    await cdp.clickText('就这样，写进去');
    await sleep(1200);
    stage('⑦ 第5步 写进去', { text: await cdp.bodyText(), shot: await cdp.shot('06-write') });

    await cdp.clickText('开始写入');
    await sleep(3500);
    const finalText = await cdp.bodyText();
    const shotFile = await cdp.shot('07-written');
    stage('⑧ 写入结果', { text: finalText, shot: shotFile });

    /* 判定 */
    const hasSkeleton = finalText.includes(SKELETON);
    const hasForbidden = finalText.includes(FORBIDDEN);
    const hasDone = finalText.includes('写好了。要不要把她变成能聊天的角色？');
    result.assert = {
      skeletonDoneShown: hasSkeleton,
      forbiddenPhraseShown: hasForbidden,
      normalDoneShown: hasDone,
      dbWritten: await cdp.evalJs(
        `(() => new Promise((resolve) => {
          const req = indexedDB.open('ai-ai');
          req.onsuccess = () => {
            const db = req.result;
            const names = [...db.objectStoreNames];
            resolve({ stores: names });
          };
          req.onerror = () => resolve({ stores: [], error: 'open failed' });
        }))()`,
      ),
    };
    console.log('\n─── 判定 ───');
    console.log(JSON.stringify(result.assert, null, 2));
    console.log('\n截图目录：', SHOT_DIR);
  } finally {
    try {
      edge.kill();
    } catch {
      /* 忽略 */
    }
  }
}

main().catch((e) => {
  console.error('\n[EX-VERIFY 失败]', e.message);
  process.exitCode = 1;
});
