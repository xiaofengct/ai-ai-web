/**
 * QA 回归专用：极简 CDP 客户端 + 交互原语（零第三方依赖）。
 *
 * 为什么手写 CDP 而不是 puppeteer/playwright：
 *   1. 项目刻意没有引入任何浏览器自动化依赖（package.json 只有 vite/tsx）；
 *   2. `docs/07-交付说明.md` §8 的经验都是围绕「直连 CDP + 固定 --user-data-dir」写的，
 *      沿用同一套方法可以和文档里的历史结论对齐。
 *
 * ★ 所有交互原语都遵守 `docs/07` §8 的三条硬规矩：
 *   - §8.2：直连 CDP + 固定 `--user-data-dir`（不用 agent-browser daemon，避免 localStorage 丢）；
 *   - §8.3：输入用真实键盘（`Input.insertText`）+ React 原生 setter 兜底，**绝不** `el.value =`；
 *   - §8.4：数控件只看**可见**（有布局尺寸）的元素，不数 MUI 的影子节点。
 *
 * 本文件是「可复跑」的：后续双版本 APK / 生产构建回归都复用它，不要写成一次性临时脚本。
 */

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 本沙箱 ExitCode 取法：重定向取 $?，不要用管道（管道会吃掉退出码）。 */

/* ============================== CDP 客户端 ============================== */

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    /** 收集的运行时告警（console.error/warn、未捕获异常、Log.entryAdded） */
    this.events = [];
    /** 当前阶段标签，便于把告警归到某一步 */
    this.phase = 'init';
    ws.addEventListener('message', (ev) => this._onMessage(ev));
    ws.addEventListener('close', () => {
      for (const [, p] of this.pending) p.reject(new Error('CDP 连接被关闭'));
      this.pending.clear();
    });
  }

  _onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
      else resolve(msg.result);
      return;
    }
    this._collect(msg);
  }

  _collect(msg) {
    const at = Date.now();
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params?.exceptionDetails ?? {};
      this.events.push({
        at,
        phase: this.phase,
        kind: 'uncaught',
        text: `${d.exception?.description ?? d.text ?? 'unknown exception'}`,
        url: d.url,
        line: d.lineNumber,
      });
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const level = msg.params?.type;
      if (level === 'error' || level === 'warning') {
        const text = (msg.params?.args ?? [])
          .map((a) => a.value ?? a.description ?? a.unserializableValue ?? '')
          .join(' ');
        this.events.push({ at, phase: this.phase, kind: `console.${level}`, text });
      }
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params?.entry ?? {};
      if (e.level === 'error' || e.level === 'warning') {
        this.events.push({ at, phase: this.phase, kind: `log.${e.level}`, text: `${e.text ?? ''} ${e.url ?? ''}`.trim() });
      }
    }
  }

  static async attach(port, { timeoutMs = 40000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        const list = await res.json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) {
          const ws = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((ok, bad) => {
            ws.addEventListener('open', ok, { once: true });
            ws.addEventListener('error', () => bad(new Error('WebSocket 连接失败')), { once: true });
          });
          const cdp = new Cdp(ws);
          cdp.pageTargetId = page.id;
          return cdp;
        }
      } catch {
        /* 端口还没起来，继续等 */
      }
      await sleep(400);
    }
    throw new Error(`CDP 调试端口 ${port} 在 ${timeoutMs}ms 内未就绪`);
  }

  send(method, params = {}, { timeoutMs = 30000 } = {}) {
    const id = (this.id += 1);
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, timeoutMs);
    });
  }

  /** 开关域名导航 / 页面事件域，打开后才会收到 exceptionThrown 等 */
  async enableDomains() {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Log.enable').catch(() => undefined);
  }

  setPhase(name) {
    this.phase = name;
  }

  /** 取自某时间点起的告警（用于按阶段归因） */
  eventsSince(t) {
    return this.events.filter((e) => e.at >= t);
  }

  /* ------------------------------ 页面求值 ------------------------------ */

  async evalJs(expression, { awaitPromise = true, returnByValue = true } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue,
      awaitPromise,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`页面内异常：${d.exception?.description ?? d.text}`);
    }
    return r.result.value;
  }

  /** 导航并等待页面稳定（不再依赖固定 sleep，按条件轮询） */
  async goto(url, { readyExpr, timeoutMs = 12000, settleMs = 150 } = {}) {
    await this.send('Page.navigate', { url });
    await this.waitFor(
      `(() => { const r = document.getElementById('root'); return ${readyExpr ?? '!!r && r.childElementCount > 0'}; })()`,
      { timeoutMs, settleMs },
    ).catch(() => false);
    await sleep(200);
  }

  /** 轮询条件表达式返回 truthy 即返回 true；超时返回 false */
  async waitFor(expr, { timeoutMs = 8000, intervalMs = 200, settleMs = 0 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = await this.evalJs(`(() => { try { return !!(${expr}); } catch { return false; } })()`).catch(() => false);
      if (ok) {
        if (settleMs) await sleep(settleMs);
        return true;
      }
      await sleep(intervalMs);
    }
    return false;
  }

  /** body 纯文本（压缩空行） */
  bodyText() {
    return this.evalJs(`document.body ? document.body.innerText.replace(/\\n{2,}/g, '\\n') : ''`);
  }

  pathname() {
    return this.evalJs(`location.pathname + location.search`);
  }

  /** 可见元素计数（§8.4：只数有布局尺寸的） */
  countVisible(selector) {
    return this.evalJs(
      `[...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => {
         const r = el.getBoundingClientRect();
         return r.width > 0 && r.height > 0;
       }).length`,
    );
  }

  /** 是否出现崩溃页文案 */
  async isCrashed() {
    const txt = await this.bodyText();
    return txt.includes('我这边出问题了。') || txt.includes('不是你操作错了');
  }

  /* ------------------------------ 点击 ------------------------------ */

  /**
   * 按可见文本找元素并返回其命中信息 + 中心点。
   * ★ 先 `scrollIntoView`（§8.6 坑 3，长页面按钮在视口外点了没反应），
   *   再等一帧量坐标（平滑滚动时立刻量会拿到旧坐标）。
   */
  async locateByText(text, selector = 'button, [role="button"], a, .MuiToggleButton-root, .MuiChip-root, .MuiMenuItem-root') {
    const info = await this.evalJs(
      `(() => {
         document.querySelectorAll('[data-qa-target]').forEach((e) => e.removeAttribute('data-qa-target'));
         const list = [...document.querySelectorAll(${JSON.stringify(selector)})];
         const el = list.find((e) => {
           const r = e.getBoundingClientRect();
           const visible = r.width > 0 && r.height > 0;
           const txt = (e.textContent || '').trim();
           return visible && txt.includes(${JSON.stringify(text)});
         });
         if (!el) return null;
         el.setAttribute('data-qa-target', '1');
         el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
         return { text: (el.textContent || '').trim(), disabled: !!el.disabled, tag: el.tagName };
       })()`,
    );
    if (!info) return null;
    await sleep(320);
    const rect = await this.evalJs(
      `(() => {
         const el = document.querySelector('[data-qa-target="1"]');
         if (!el) return null;
         const r = el.getBoundingClientRect();
         return { x: r.x + r.width / 2, y: r.y + r.height / 2, inViewport: r.y >= 0 && r.y <= innerHeight };
       })()`,
    );
    return rect ? { ...info, ...rect } : null;
  }

  async clickAt(x, y) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        clickCount: 1,
        buttons: type === 'mousePressed' ? 1 : 0,
      });
    }
  }

  /**
   * ★ 按文本定位并**直接派发 DOM click**（主路径）。
   *
   * 为什么不用坐标点击打头：headless Edge 下 `Input.dispatchMouseEvent` 会受
   * 「测量坐标 → 派发事件」之间页面重排（标签 chips、汇总区出现导致布局跳动）、
   * 以及元素被浮层/滚动位置遮挡影响，实测**偶发「点了但没反应」**。
   * React 17+ 把 onClick 委托挂在容器上，DOM `el.click()` 会冒泡到同一处理器，
   * **走的是产品真实代码路径**，不是绕过验证（这点很重要，别误当成"没真点"）。
   * 需要的场合（依赖真实指针序列的组件）用 `clickTextCoord`。
   */
  async clickText(text, selector) {
    const hit = await this.evalJs(
      `(() => {
         document.querySelectorAll('[data-qa-target]').forEach((e) => e.removeAttribute('data-qa-target'));
         const list = [...document.querySelectorAll(${JSON.stringify(
           selector ?? 'button, [role="button"], a, .MuiToggleButton-root, .MuiChip-root, .MuiMenuItem-root',
         )})];
         const el = list.find((e) => {
           const r = e.getBoundingClientRect();
           return r.width > 0 && r.height > 0 &&
             (e.textContent || '').trim().includes(${JSON.stringify(text)});
         });
         if (!el) return null;
         const info = { text: (el.textContent || '').trim(), disabled: !!el.disabled, tag: el.tagName };
         if (el.disabled) return info;
         el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
         el.click();
         return info;
       })()`,
    );
    if (!hit) throw new Error(`找不到可见元素：${text}`);
    if (hit.disabled) throw new Error(`元素存在但被禁用：${text}`);
    await sleep(700);
    return hit;
  }

  /** 坐标点击（真实指针序列）；用于必须走 pointer 事件的组件 */
  async clickTextCoord(text, selector) {
    const hit = await this.locateByText(text, selector);
    if (!hit) throw new Error(`找不到可见元素：${text}`);
    if (hit.disabled) throw new Error(`元素存在但被禁用：${text}`);
    await this.clickAt(hit.x, hit.y);
    await sleep(700);
    return hit;
  }

  /**
   * 带校验 + 双通道重试的点击：DOM click → 坐标点击 交替，直到 `untilExpr` 成立。
   */
  async clickTextUntil(text, untilExpr, { timeoutMs = 6000, selector } = {}) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const via = attempt % 2 === 0 ? 'dom' : 'coord';
      let last;
      try {
        last = via === 'dom' ? await this.clickText(text, selector) : await this.clickTextCoord(text, selector);
      } catch (e) {
        last = { error: String(e.message) };
      }
      const ok = await this.waitFor(untilExpr, { timeoutMs: attempt === 0 ? timeoutMs : 2500 });
      if (ok) return { ok: true, attempts: attempt + 1, via, hit: last };
    }
    return { ok: false, attempts: 4 };
  }

  /** 当前 MUI Stepper 的激活步骤（1-based）；没有 Stepper 返回 0 */
  activeStep() {
    return this.evalJs(
      `(() => {
         const labels = [...document.querySelectorAll('.MuiStepLabel-root')];
         const i = labels.findIndex((l) => l.querySelector('.Mui-active'));
         return i < 0 ? 0 : i + 1;
       })()`,
    );
  }

  /** 点击 CSS 选择器命中的（第一个可见）元素 */
  async clickSelector(selector) {
    const rect = await this.evalJs(
      `(() => {
         const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => {
           const r = e.getBoundingClientRect();
           return r.width > 0 && r.height > 0;
         });
         if (!el) return null;
         el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
         const r = el.getBoundingClientRect();
         return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
       })()`,
    );
    if (!rect) throw new Error(`找不到可见元素：${selector}`);
    await sleep(250);
    await this.clickAt(rect.x, rect.y);
    await sleep(700);
    return rect;
  }

  /* ------------------------------ 输入 ------------------------------ */

  /**
   * 真键盘输入（§8.3）。
   * 流程：点聚焦 → `Input.insertText` 写入 → 校验 DOM value 是否真的变了。
   * ★ 若 insertText 因受控组件时序没生效，回退到「React 原生 setter + dispatch input」。
   *   绝不用 `el.value =`（那是 §8.3 明确踩过的坑）。
   */
  async typeIntoSelector(selector, text, { nth = 0 } = {}) {
    const box = await this.evalJs(
      `(() => {
         const list = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => {
           const r = el.getBoundingClientRect();
           return r.width > 0 && r.height > 0 && !el.readOnly && el.getAttribute('aria-hidden') !== 'true';
         });
         const el = list[${nth}];
         if (!el) return null;
         el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
         el.setAttribute('data-qa-input', '1');
         const r = el.getBoundingClientRect();
         return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName };
       })()`,
    );
    if (!box) throw new Error(`第 ${nth} 个可见输入框不存在：${selector}`);
    await sleep(200);
    await this.clickAt(box.x, box.y);
    await sleep(120);
    await this.evalJs(`(() => { const el = document.querySelector('[data-qa-input="1"]'); if (el) el.focus(); })()`);
    await this.send('Input.insertText', { text });
    await sleep(250);
    const value = await this.evalJs(`(() => { const el = document.querySelector('[data-qa-input="1"]'); return el ? String(el.value) : null; })()`);
    if (value !== text) {
      // 兜底：React 原生 setter + input 事件（仍在 §8.3 允许的实现里，不是 el.value 直赋）
      await this.evalJs(
        `(() => {
           const el = document.querySelector('[data-qa-input="1"]');
           if (!el) return false;
           const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
           const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
           setter.call(el, ${JSON.stringify(text)});
           el.dispatchEvent(new Event('input', { bubbles: true }));
           return true;
         })()`,
      );
      await sleep(250);
    }
    const finalValue = await this.evalJs(`(() => { const el = document.querySelector('[data-qa-input="1"]'); return el ? String(el.value) : null; })()`);
    return { tag: box.tag, value: finalValue };
  }

  /**
   * 合成 drop 注入文件（用于 FileDropZone：Chromium 走 showOpenFilePicker，系统弹窗无法自动化）。
   * ★ 这里只替换「操作系统文件选择」这一不可测环节，drop 之后走的是**真实**的
   *   `onDrop → handleFiles → 解析器 → 落库` 全链路，所以仍是对产品代码的端到端验证。
   *
   * @param opts.selector  CSS 选择器；省略或传 '@dropzone' 时用「虚线边框」启发式定位 DropZone
   *                       （`FileDropZone` 的根 Box 有 `border: 2px dashed`，这是唯一稳定特征）。
   * @param opts.nth       命中多个时的序号（负数表示从末尾数，默认 0=第一个；用 -1 取最上层弹窗里的那个）。
   */
  async dropFile({ selector, nth = 0, name, content, mime = 'text/plain', waitZonesMs = 8000 } = {}) {
    const useHeuristic = !selector || selector === '@dropzone';
    const findExpr = useHeuristic
      ? `[...document.querySelectorAll('div')].filter((e) => {
           const r = e.getBoundingClientRect();
           const cs = getComputedStyle(e);
           return r.width > 10 && r.height > 10 &&
             cs.borderTopStyle === 'dashed' && cs.borderRightStyle === 'dashed';
         })`
      : `[...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => {
           const r = e.getBoundingClientRect();
           return r.width > 0 && r.height > 0;
         })`;
    // ★ 轮询等 DropZone 挂载：向导切步 / 懒加载 chunk 都有延迟，立刻 drop 会拿到 0 个 zone
    const deadline = Date.now() + waitZonesMs;
    let found = 0;
    while (Date.now() < deadline) {
      found = await this.evalJs(`(${findExpr}).length`).catch(() => 0);
      const idx = nth < 0 ? found + nth : nth;
      if (found > 0 && idx >= 0 && idx < found) break;
      await sleep(200);
    }
    return this.evalJs(
      `(() => {
         const zones = ${findExpr};
         const idx = ${nth} < 0 ? zones.length + ${nth} : ${nth};
         const zone = zones[idx];
         if (!zone) return { ok: false, reason: 'dropzone-not-found', found: zones.length };
         const file = new File([${JSON.stringify(content)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} });
         const dt = new DataTransfer();
         dt.items.add(file);
         zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
         return { ok: true, fileCount: dt.files.length, found: zones.length, idx };
       })()`,
    );
  }

  /** 给隐藏的 <input type=file> 设本地文件（走 CDP DOM.setFileInputFiles，真实 change 事件） */
  async setFileInput(selector, absPath, { nth = 0 } = {}) {
    const { root } = await this.send('DOM.getDocument', { depth: -1 });
    const { nodeIds } = await this.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });
    if (!nodeIds || nodeIds.length <= nth) throw new Error(`找不到第 ${nth} 个 <input>：${selector}`);
    await this.send('DOM.setFileInputFiles', { files: [absPath], nodeId: nodeIds[nth] });
    await sleep(600);
    return true;
  }

  /** 让所有隐藏 file input 可以被 setFileInput 命中（部分组件 disabled 时需要） */
  async listFileInputs() {
    return this.evalJs(
      `[...document.querySelectorAll('input[type=file]')].map((el) => ({ accept: el.accept, multiple: el.multiple, hidden: el.hidden }))`,
    );
  }

  /* ------------------------------ 截图 / 下载 ------------------------------ */

  async screenshot(absPath) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(absPath, Buffer.from(r.data, 'base64'));
    return absPath;
  }

  /** 允许文件下载到指定目录（CDP 下载行为） */
  async allowDownloads(downloadPath) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(downloadPath, { recursive: true });
    await this.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath,
      eventsEnabled: true,
    }).catch(async () => {
      await this.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath });
    });
  }

  /** 读取 IndexedDB 某表全部记录（回库核对用，§8.2） */
  storeDump(dbName, storeName, mapper = '(r)=>r') {
    return this.evalJs(
      `(() => new Promise((resolve, reject) => {
         const req = indexedDB.open(${JSON.stringify(dbName)});
         req.onsuccess = () => {
           const db = req.result;
           if (![...db.objectStoreNames].includes(${JSON.stringify(storeName)})) {
             db.close(); resolve({ missing: true, stores: [...db.objectStoreNames] }); return;
           }
           const tx = db.transaction(${JSON.stringify(storeName)}).objectStore(${JSON.stringify(storeName)}).getAll();
           tx.onsuccess = () => { const rows = tx.result ?? []; db.close(); resolve({ count: rows.length, rows: rows.map(${mapper}) }); };
           tx.onerror = () => { db.close(); reject(new Error('读取 ${storeName} 失败')); };
         };
         req.onerror = () => reject(new Error('打开 ${dbName} 失败'));
       }))()`,
    );
  }

  /** 库表名清单 */
  dbStores(dbName) {
    return this.evalJs(
      `(() => new Promise((resolve, reject) => {
         const req = indexedDB.open(${JSON.stringify(dbName)});
         req.onsuccess = () => { const db = req.result; const s = [...db.objectStoreNames]; db.close(); resolve(s); };
         req.onerror = () => reject(new Error('打开 ' + ${JSON.stringify(dbName)} + ' 失败'));
       }))()`,
    );
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* 忽略 */
    }
  }
}
