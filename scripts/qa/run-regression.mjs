/**
 * ai爱 Web 全量回归（可复跑）。
 *
 * 用法：
 *   node scripts/qa/run-regression.mjs                # 跑全部
 *   node scripts/qa/run-regression.mjs --only=routes  # 只跑路由可达
 *   node scripts/qa/run-regression.mjs --base=http://127.0.0.1:5173 --no-server  # 复用已有 server
 *
 * 产出：
 *   scripts/qa/out/<时间戳>/report.json   —— 机器可读
 *   scripts/qa/out/<时间戳>/report.md     —— 人读
 *   scripts/qa/out/<时间戳>/shots/*.png   —— 截图证据
 *
 * ★ 为什么一个脚本里起 server + 浏览器：见 `lib/harness.mjs` 顶部（§8.6 坑 5、6）。
 * ★ 方法遵循 `docs/07-交付说明.md` §8（真验队规）。
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Cdp, sleep } from './lib/cdp.mjs';
import {
  PROJECT_ROOT,
  startDevServer,
  startBrowser,
  serveDistSnapshot,
  killTree,
} from './lib/harness.mjs';

const TS = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(PROJECT_ROOT, 'scripts', 'qa', 'out', TS);
const SHOTS = path.join(OUT, 'shots');
// ★ 临时目录放在**项目内**，不放 os.tmpdir()：
//   本沙箱对 Temp 目录的写/读出现过 `EIO, Access is denied`（快照服务起不来），
//   项目内目录（gitignore 掉）稳定得多。
const TMP = path.join(PROJECT_ROOT, '.qa-tmp', TS);
const PROFILE = path.join(TMP, 'profile');
const DOWNLOADS = path.join(TMP, 'downloads');

const DB = 'ai-ai-web'; // ★ 真库名（§8.6：不是 ai-ai）
const GUIDE_KEY = 'ai-ai.guide.v1';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const report = {
  startedAt: new Date().toISOString(),
  project: PROJECT_ROOT,
  base: null,
  routes: [],
  flows: [],
  issues: [],
  coverage: {},
  env: {
    dev: null, // 'ok' | 错误信息
    prodSnapshot: null,
  },
  extra: {},
};

let cdp;
let dev; // dev server 句柄（含 healthy/restart），供 ensureServer 使用
let shotSeq = 0;

/* ================================ 工具 ================================ */

async function shot(name) {
  shotSeq += 1;
  const file = path.join(SHOTS, `${String(shotSeq).padStart(2, '0')}-${name}.png`);
  try {
    await cdp.screenshot(file);
  } catch {
    /* 截图失败不致命 */
  }
  return path.relative(PROJECT_ROOT, file).replace(/\\/g, '/');
}

/** 记录一个流程结果 */
function record(entry) {
  report.flows.push(entry);
  const icon = entry.ok ? 'PASS' : 'FAIL';
  console.log(`  [${icon}] ${entry.name}${entry.note ? ` — ${entry.note}` : ''}`);
  return entry;
}

/** 记录一个问题（供人读） */
function issue(level, title, detail, evidence) {
  report.issues.push({ level, title, detail, evidence: evidence ?? null });
  console.log(`  !! [${level}] ${title}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/**
 * ★ 每一步之前先探活 dev server（§8.6 坑 5）。
 * 被回收就重启——否则后续导航全部落到错误页，症状是
 * `IDBFactory denied` / `Failed to fetch` / 按钮找不到，会把「环境死了」误报成「产品崩了」。
 */
async function ensureServer() {
  if (!dev || report.env.dev !== 'ok') return;
  if (await dev.healthy()) return;
  console.log('  [harness] dev server 已被回收，重启中…');
  await dev.restart();
  report.env.restarts = (report.env.restarts ?? 0) + 1;
}

/** 运行一个流程；异常 → 记为 FAIL 并截图 */
async function flow(name, fn) {
  await ensureServer();
  const t0 = Date.now();
  cdp.setPhase(name);
  const before = cdp.events.length;
  try {
    const res = (await fn()) ?? {};
    const events = cdp.events.slice(before);
    const uncaught = events.filter((e) => e.kind === 'uncaught');
    if (uncaught.length > 0 && res.ok !== false) {
      res.ok = false;
      res.note = `uncaught: ${uncaught[0].text.slice(0, 160)}`;
    }
    return record({ name, ok: res.ok !== false, note: res.note, ms: Date.now() - t0, detail: res.detail });
  } catch (e) {
    const s = await shot(name.replace(/[^\w.-]+/g, '_'));
    return record({ name, ok: false, note: String(e.message ?? e), ms: Date.now() - t0, shot: s });
  }
}

async function gotoAndWait(url, { timeoutMs = 15000, retries = 1 } = {}) {
  const expectedOrigin = new URL(url).origin;
  for (let attempt = 0; ; attempt += 1) {
    await cdp.goto(url, { timeoutMs });
    await sleep(600); // 让 lazy chunk + 数据加载落定
    // ★ 校验真的落在应用 origin 上：server 死了会停在 about:blank / chrome-error（不透明源），
    //   此时 IDB / fetch 全部 denied —— 必须重启 server 再试，不能把它当产品缺陷。
    const origin = await cdp.evalJs(`location.origin`).catch(() => '');
    if (origin === expectedOrigin) return true;
    if (attempt >= retries) return false;
    console.log(`  [harness] 导航未落在 ${expectedOrigin}（当前 ${origin}），重启 server 后重试…`);
    await ensureServer();
  }
}

/** 某页面是否「正常渲染」：不是崩溃页、root 有内容 */
async function pageHealthy() {
  const crashed = await cdp.isCrashed();
  const rootLen = await cdp.evalJs(`document.getElementById('root')?.childElementCount ?? 0`);
  const txt = await cdp.bodyText();
  return { crashed, rootLen, txt };
}

/* ============================ 路由清单 ============================ */
/* 与 src/router/paths.ts 的具名路由 + 1 条兜底一致。
   ★ 条数**不写死**：写死过一次就错一次（原先这里写着 28，
     而加了 /moments 之后没人回来改，于是它变成了一句错话）。
     现在直接用数组长度报数，至少不会说谎。 */

const SID = 'session-default-xinran';
const ROUTES = [
  { path: '/', expect: '/', name: 'home' },
  { path: '/guide', expect: '/guide', name: 'guide' },
  { path: `/chat/${SID}`, expect: `/chat/${SID}`, name: 'chat' },
  { path: `/chat/${SID}/stats`, expect: `/chat/${SID}/stats`, name: 'chatStats' },
  { path: `/chat/${SID}/search`, expect: `/chat/${SID}/search`, name: 'chatSearch' },
  { path: `/chat/${SID}/settings`, expect: `/chat/${SID}/settings`, name: 'chatSettings' },
  { path: `/chat/${SID}/context`, expect: `/chat/${SID}/context`, name: 'chatContext' },
  { path: `/forward/${SID}`, expect: `/forward/${SID}`, name: 'forward' },
  { path: `/text/${SID}`, expect: `/text/${SID}`, name: 'text' },
  { path: '/memories', expect: '/memories', name: 'memories' },
  { path: '/memories/no-such-memory/edit', expect: '/memories/no-such-memory/edit', name: 'memoryEdit' },
  { path: '/distill', expect: '/distill', name: 'distill' },
  { path: '/distill/no-such-job', expect: '/distill/no-such-job', name: 'distillJob' },
  { path: '/preview/no-such-asset', expect: '/preview/no-such-asset', name: 'preview' },
  { path: '/favorites', expect: '/favorites', name: 'favorites' },
  // ★ 朋友圈（2026-10-04 加）。此前这张清单漏了它 —— 漏一条不会报错，
  //   只会让"路由可达"这一节少覆盖一个页面（假绿）。
  { path: '/moments', expect: '/moments', name: 'moments' },
  // ★ 反馈信箱（2026-10-04 加）
  { path: '/settings/feedback', expect: '/settings/feedback', name: 'settingsFeedback' },
  { path: '/voice/test', expect: '/voice/test', name: 'voiceTest' },
  { path: '/voice/call', expect: '/voice/call', name: 'voiceCall' },
  { path: '/settings', expect: '/settings', name: 'settings' },
  { path: '/settings/connection', expect: '/settings/connection', name: 'settingsConnection' },
  { path: '/settings/developer', expect: '/settings/developer', name: 'settingsDeveloper' },
  { path: '/settings/diagnosis', expect: '/settings/diagnosis', name: 'settingsDiagnosis' },
  { path: '/settings/sponsor', expect: '/settings/sponsor', name: 'settingsSponsor' },
  { path: '/settings/sdk', expect: '/settings/sdk', name: 'settingsSdk' },
  { path: '/settings/bridge', expect: '/settings/bridge', name: 'settingsBridge' },
  { path: '/module/demo', expect: '/module/demo', name: 'module' },
  { path: '/module/demo/permission', expect: '/module/demo/permission', name: 'modulePermission' },
  { path: '/capabilities', expect: '/capabilities', name: 'capabilities' },
  { path: '/definitely-not-a-route-xyz', expect: '/definitely-not-a-route-xyz', name: 'notFound' },
];

/* =========================== Flow 0：引导 =========================== */

async function flowGuide() {
  // —— A1：走 4 步 → 「算了」→ 回首页（finishWithoutSession 分支）——
  await flow('引导 · 首访被拦到 /guide', async () => {
    await gotoAndWait(`${report.base}/`);
    const p = await cdp.pathname();
    assert(p === '/guide', `首访未落到 /guide，而是 ${p}`);
    const txt = await cdp.bodyText();
    assert(txt.includes('1 / 4'), '引导页未显示步骤 1 / 4');
    return { ok: true, detail: { path: p } };
  });

  await flow('引导 · 逐步走到第 4 步', async () => {
    for (const n of ['2 / 4', '3 / 4', '4 / 4']) {
      await cdp.clickText('下一步');
      const ok = await cdp.waitFor(`document.body.innerText.includes(${JSON.stringify(n)})`, { timeoutMs: 4000 });
      assert(ok, `未进入 ${n}`);
    }
    return { ok: true };
  });

  await flow('引导 · 「算了」→ 回首页并渲染会话列表', async () => {
    await cdp.clickText('算了');
    await cdp.waitFor(`location.pathname === '/'`, { timeoutMs: 5000 });
    const p = await cdp.pathname();
    assert(p === '/', `未回到首页，当前 ${p}`);
    const ok = await cdp.waitFor(`document.body.innerText.includes('和欣然')`, { timeoutMs: 8000 });
    assert(ok, '首页未渲染内置会话「和欣然」');
    const guideDone = await cdp.evalJs(`localStorage.getItem(${JSON.stringify(GUIDE_KEY)})`);
    assert(guideDone === '1', `引导完成标记未写入（= ${guideDone}）`);
    return { ok: true, detail: { guideDone } };
  });

  // —— A2：重置引导 → 走第 4 步的「好了」（开始聊天分支）——
  await flow('引导 · 第 4 步「好了」→ 建会话并进聊天页', async () => {
    await cdp.evalJs(`localStorage.removeItem(${JSON.stringify(GUIDE_KEY)})`);
    await gotoAndWait(`${report.base}/`);
    await cdp.waitFor(`location.pathname === '/guide'`, { timeoutMs: 6000 });
    for (let i = 0; i < 3; i += 1) {
      await cdp.clickText('下一步');
      await sleep(300);
    }
    const onLast = await cdp.waitFor(`document.body.innerText.includes('4 / 4')`, { timeoutMs: 4000 });
    assert(onLast, '未到第 4 步');
    await cdp.clickText('好了');
    const ok = await cdp.waitFor(`/^\\/chat\\/.+/.test(location.pathname)`, { timeoutMs: 8000 });
    const p = await cdp.pathname();
    assert(ok, `点「好了」后未进入聊天页，当前 ${p}`);
    // 建会话意味着新 session 落库
    const dump = await cdp.storeDump(DB, 'sessions', '(r)=>({id:r.id,title:r.title})');
    return { ok: true, detail: { path: p, sessionCount: dump.count } };
  });
}

/* =========================== Flow 1：首页 =========================== */

async function flowHome() {
  await flow('首页 · 会话列表 + 欢迎语 + 新建入口', async () => {
    await gotoAndWait(`${report.base}/`);
    const txt = await cdp.bodyText();
    assert(txt.includes('和欣然'), '缺少内置会话「和欣然」');
    assert(txt.includes('我们说过的话'), '缺少会话区标题');
    const newBtn = await cdp.countVisible('button');
    assert(newBtn > 0, '首页没有任何可见按钮');
    // 内置会话应带一条助理欢迎语
    const msgs = await cdp.storeDump(DB, 'messages', '(r)=>({role:r.role,status:r.status,content:(r.content||"").slice(0,20)})');
    const hasAssistant = (msgs.rows ?? []).some((m) => m.role === 'assistant' && m.status === 'done');
    assert(hasAssistant, '没有落库的欢迎语（assistant/done）');
    return { ok: true, detail: { messageCount: msgs.count } };
  });

  await flow('首页 · 新建会话对话框可打开', async () => {
    await cdp.clickText('新建会话');
    const open = await cdp.waitFor(`document.querySelector('[role="dialog"]') !== null`, { timeoutMs: 4000 });
    assert(open, '新建会话对话框未出现');
    const txt = await cdp.bodyText();
    // 关掉对话框，避免影响后续
    await cdp.evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(400);
    return { ok: true, detail: { dialogText: txt.slice(0, 120) } };
  });
}

/* =========================== Flow 2：聊天 =========================== */

async function flowChat() {
  await flow('聊天 · 无 API Key 发消息 → 中文提示而非崩溃', async () => {
    await gotoAndWait(`${report.base}/chat/${SID}`);
    // 默认 DeepSeek 预设 baseUrl+model 有值、apiKey 为空 → 守卫放行，进入聊天页
    const inChat = await cdp.waitFor(`document.querySelector('textarea, input') !== null`, { timeoutMs: 8000 });
    assert(inChat, '聊天页没有输入框（可能被 RequireProvider 拦截）');
    const typed = await cdp.typeIntoSelector('textarea', '在吗，测试一下');
    assert((typed.value ?? '').includes('在吗'), `输入未生效：${JSON.stringify(typed.value)}`);
    // 点发送按钮（aria-label='发送'）——比模拟回车更稳（回车要依赖焦点在 textarea 上）
    await cdp.clickSelector('button[aria-label="发送"]');
    // 等崩溃页 / snackbar / 消息渲染任一到场
    await sleep(4000);
    const { crashed, txt } = await pageHealthy();
    assert(!crashed, '发送后出现崩溃页');
    const snack = await cdp.evalJs(
      `[...document.querySelectorAll('.MuiSnackbar-root, [role="alert"], .MuiAlert-root')].map((e) => e.innerText).join(' | ')`,
    );
    const msgs = await cdp.storeDump(DB, 'messages', '(r)=>({role:r.role,status:r.status,sessionId:r.sessionId,content:(r.content||"").slice(0,30)})');
    const userMsg = (msgs.rows ?? []).some((m) => m.role === 'user' && m.content.includes('在吗'));
    return {
      ok: true,
      detail: { snack, userMessagePersisted: userMsg, bodyHasErrorText: /还没接模型|这个 Key|网断了|出了点/.test(txt) },
      note: snack ? `snack=${snack.slice(0, 60)}` : '未见 snackbar',
    };
  });

  await flow('聊天 · 工具条（统计/上下文/设置/搜索）点击可达', async () => {
    // 用 MUI 图标自带的 data-testid 定位工具条 IconButton（比按顺序数 button 稳）
    //   chat 工具条图标：BarChartIcon / TuneIcon / SettingsIcon / SearchIcon
    //   SideNav 的设置项用的是 SettingsOutlinedIcon，不同 testid，不会误命中。
    const out = [];
    for (const [testid, expect] of [
      ['BarChartIcon', `/chat/${SID}/stats`],
      ['TuneIcon', `/chat/${SID}/context`],
      ['SettingsIcon', `/chat/${SID}/settings`],
      ['SearchIcon', `/chat/${SID}/search`],
    ]) {
      await gotoAndWait(`${report.base}/chat/${SID}`);
      const rect = await cdp.evalJs(
        `(() => {
           const svg = document.querySelector('button svg[data-testid="' + ${JSON.stringify(testid)} + '"]');
           const b = svg && svg.closest('button');
           if (!b) return null;
           b.scrollIntoView({ block: 'center' });
           const r = b.getBoundingClientRect();
           return { w: r.width, h: r.height, x: r.x + r.width / 2, y: r.y + r.height / 2 };
         })()`,
      );
      if (!rect) return { ok: false, note: `工具条按钮 data-testid=${testid} 未找到` };
      await cdp.clickAt(rect.x, rect.y);
      const ok = await cdp.waitFor(`location.pathname === ${JSON.stringify(expect)}`, { timeoutMs: 5000 });
      out.push({ testid, reached: ok, path: await cdp.pathname() });
      assert(ok, `点工具条 ${testid} 未到 ${expect}`);
    }
    return { ok: true, detail: out };
  });
}

/* ======================= Flow 3：能力总览 ======================= */

async function flowCapabilities() {
  // ★ 分档数字于 2026-10-04 更新：PG-23 / SV-02 / SV-03 由 `unavailable` 上调为 `partial`
  //   （微信 ClawBot 官方 iLink 通道落地，原判「微信无开放接口」已不成立）。
  //   ⇒ partial 37→40、unavailable 15→12，合计仍 141（full / alternative 不变）。
  await flow('能力总览 · 141 条 + 四档分布 82/40/7/12', async () => {
    await gotoAndWait(`${report.base}/capabilities`);
    const ok = await cdp.waitFor(`document.querySelectorAll('[data-capability-id]').length > 0`, { timeoutMs: 8000 });
    assert(ok, '能力总览未渲染任何条目');
    const counts = await cdp.evalJs(
      `(() => {
         const rows = [...document.querySelectorAll('[data-capability-id]')];
         const by = { full: 0, partial: 0, alternative: 0, unavailable: 0 };
         for (const r of rows) { const l = r.getAttribute('data-capability-level'); if (l in by) by[l] += 1; }
         return { total: rows.length, by };
       })()`,
    );
    report.extra.capabilities = counts;
    assert(counts.total === 141, `条目总数 ${counts.total} ≠ 141`);
    assert(counts.by.full === 82, `full=${counts.by.full} ≠ 82`);
    assert(counts.by.partial === 40, `partial=${counts.by.partial} ≠ 40`);
    assert(counts.by.alternative === 7, `alternative=${counts.by.alternative} ≠ 7`);
    assert(counts.by.unavailable === 12, `unavailable=${counts.by.unavailable} ≠ 12`);
    return { ok: true, detail: counts };
  });

  await flow('能力总览 · 五档筛选（全部/能做/做一半/换条路/做不了）', async () => {
    await gotoAndWait(`${report.base}/capabilities`);
    const out = [];
    for (const [label, level, expect] of [
      ['能做', 'full', 82],
      ['做一半', 'partial', 40],
      ['换条路', 'alternative', 7],
      ['做不了', 'unavailable', 12],
      ['全部', 'all', 141],
    ]) {
      await cdp.clickText(label, '.MuiToggleButton-root');
      await sleep(500);
      const n = await cdp.countVisible('[data-capability-id]');
      out.push({ label, level, visible: n, expect });
      assert(n === expect, `筛选「${label}」显示 ${n} ≠ ${expect}`);
    }
    return { ok: true, detail: out };
  });

  await flow('能力总览 · 搜「悬浮窗」命中 PG-20 + SV-01', async () => {
    await gotoAndWait(`${report.base}/capabilities`);
    await cdp.typeIntoSelector('input[aria-label="搜一下"]', '悬浮窗');
    await sleep(700);
    const ids = await cdp.evalJs(
      `[...document.querySelectorAll('[data-capability-id]')].map((e) => e.getAttribute('data-capability-id'))`,
    );
    const set = new Set(ids);
    assert(set.has('PG-20'), `未命中 PG-20（命中：${ids.join(',')}）`);
    assert(set.has('SV-01'), `未命中 SV-01（命中：${ids.join(',')}）`);
    return { ok: true, detail: { hits: ids } };
  });
}

/* ======================= Flow 4：蒸馏 ======================= */

const SKELETON = '写好了，但你没给我原材料，所以这只是个空架子';
const FORBIDDEN = '她说话的样子我大概记住了';

/**
 * 进入蒸馏向导第 1 步并填好称呼。
 * ★ 用「Stepper 的激活步骤」判定，**不能**用 body 文本判定——
 *   MUI Stepper 会同时渲染全部 5 个步骤标题，搜 '把原材料给我' 在任何一步都为真。
 */
/** 断言用的表达式：当前向导激活步骤 === n */
function atStepExpr(n) {
  return `(() => {
    const labels = [...document.querySelectorAll('.MuiStepLabel-root')];
    const i = labels.findIndex((l) => l.querySelector('.Mui-active'));
    return i >= 0 && (i + 1) === ${n};
  })()`;
}

async function distillOpenWizard(name) {
  await gotoAndWait(`${report.base}/distill`);
  const opened = await cdp.clickTextUntil('新建蒸馏', atStepExpr(1), { timeoutMs: 6000 });
  assert(opened.ok, '点「新建蒸馏」后向导未打开');
  const typed = await cdp.typeIntoSelector('input', name);
  assert((typed.value ?? '').includes(name), `称呼未真正输入：${JSON.stringify(typed.value)}`);
  // 等 React state 落定（信息汇总区显示她）
  await sleep(500);
}

async function distillGoStep(text, expectStep, { timeoutMs = 10000 } = {}) {
  const r = await cdp.clickTextUntil(text, atStepExpr(expectStep), { timeoutMs });
  const step = await cdp.activeStep();
  if (r.ok && step === expectStep) return { step, attempts: r.attempts, viaDomClick: !!r.viaDomClick };
  // 失败时把现场留下来（截图 + 当前可见按钮 + 页面报错），便于判定是环境还是产品
  const diag = await cdp.evalJs(
    `(() => {
       const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
       return {
         activeStep: (() => { const l = [...document.querySelectorAll('.MuiStepLabel-root')]; const i = l.findIndex((x) => x.querySelector('.Mui-active')); return i < 0 ? 0 : i + 1; })(),
         buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => ({ t: (b.innerText || '').trim().slice(0, 18), disabled: b.disabled })),
         alerts: [...document.querySelectorAll('.MuiAlert-root, .MuiSnackbar-root')].map((e) => e.innerText).join(' | '),
       };
     })()`,
  );
  const s = await shot(`distill-stuck-${expectStep}`);
  assert(false, `点「${text}」后未到第 ${expectStep} 步（当前 ${step}，attempts=${r.attempts}，viaDomClick=${!!r.viaDomClick}）诊断=${JSON.stringify(diag)} 截图=${s}`);
}

async function flowDistillZeroMaterial() {
  await flow('蒸馏 · 零原材料走完 5 步并写入', async () => {
    await distillOpenWizard('小圆');
    await sleep(500);
    await distillGoStep('下一步', 2);
    await distillGoStep('先跳过', 3);
    await distillGoStep('开始分析', 4, { timeoutMs: 15000 });
    await distillGoStep('就这样，写进去', 5);
    await cdp.clickText('开始写入');
    await sleep(3500);
    const txt = await cdp.bodyText();
    const legacy = await pageHealthy();
    assert(!legacy.crashed, '写入过程崩溃');
    const hasSkeleton = txt.includes(SKELETON);
    const hasForbidden = txt.includes(FORBIDDEN);
    const jobs = await cdp.storeDump(DB, 'distillJobs', '(r)=>({id:r.id,name:r.name,status:r.status})');
    assert(hasSkeleton, `未出现骨架降级文案（当前尾部：${txt.slice(-160)}）`);
    assert(!hasForbidden, '出现了不该有的「她说话的样子我大概记住了」（编造共同回忆）');
    assert(jobs.count >= 1, '蒸馏作业未落库');
    report.extra.distill = { jobs: jobs.rows };
    return { ok: true, detail: { hasSkeleton, hasForbidden, jobCount: jobs.count }, note: `jobs=${jobs.count}` };
  });
}

/**
 * ★ P1 回归：同名二次新建不卡死（slug 撞 unique 索引）。
 * 背景：`distillJobs` 的 slug 是 unique 索引，同名 → 同 slug → ConstraintError →
 *   Step1「下一步」静默失效。修复见 `distillJobRepo.resolveUniqueSlug()`。
 * 这条测试**必须能独立复现原缺陷**，否则它就没有守护价值。
 */
async function flowDistillDuplicateName() {
  await flow('蒸馏 · 同名新建第二个作业（slug 唯一性，原 P1）', async () => {
    await distillOpenWizard('同名者');
    await distillGoStep('下一步', 2);
    // 退出向导 → 回到列表（此时库里已有一个「同名者」）
    await cdp.clickText('先退出');
    await cdp.waitFor(`(() => { const l = [...document.querySelectorAll('.MuiStepLabel-root')]; return l.length === 0; })()`, { timeoutMs: 6000 });
    // 第二次用完全相同的称呼
    await distillOpenWizard('同名者');
    const r = await cdp.clickTextUntil('下一步', atStepExpr(2), { timeoutMs: 8000 });
    const step = await cdp.activeStep();
    const slugs = await cdp.storeDump(DB, 'distillJobs', '(r)=>({name:r.name,slug:r.slug})');
    const sameName = (slugs.rows ?? []).filter((j) => j.name === '同名者');
    const distinct = new Set(sameName.map((j) => j.slug)).size === sameName.length;
    assert(r.ok && step === 2, `同名二次新建卡在第 ${step} 步（应到第 2 步）`);
    assert(sameName.length >= 2, `同名作业未建成两个（实得 ${sameName.length}）`);
    assert(distinct, `slug 未去重：${JSON.stringify(sameName.map((j) => j.slug))}`);
    return { ok: true, detail: { slugs: sameName.map((j) => j.slug) }, note: `slugs=${sameName.map((j) => j.slug).join(',')}` };
  });
}

async function flowDistillWechatImport() {
  await flow('蒸馏 · 微信聊天记录导入（.txt 解析落库）', async () => {
    const fixture = readFileSync(path.join(PROJECT_ROOT, 'scripts', 'qa', 'fixtures', 'wechat-sample.txt'), 'utf8');
    await distillOpenWizard('小圆');
    await distillGoStep('下一步', 2);
    // 微信是第 1 个 parser → 第 1 个 dropzone（@dropzone 用虚线边框启发式定位）
    const before = await cdp.storeDump(DB, 'distillRaw', '(r)=>({id:r.id})').catch(() => ({ count: 0 }));
    const drop = await cdp.dropFile({ nth: 0, name: 'wechat-sample.txt', content: fixture, mime: 'text/plain' });
    assert(drop.ok, `drop 未命中：${drop.reason}`);
    // 等「已经加进来了」清单出现
    const imported = await cdp.waitFor(`document.body.innerText.includes('已经加进来了')`, { timeoutMs: 8000 });
    const txt = await cdp.bodyText();
    const snackText = await cdp.evalJs(
      `[...document.querySelectorAll('.MuiSnackbar-root, .MuiAlert-root')].map((e) => e.innerText).join(' | ')`,
    );
    const after = await cdp.storeDump(DB, 'distillRaw', '(r)=>({id:r.id,kind:r.kind,chunkCount:r.chunkCount})').catch(() => ({ count: 0, rows: [] }));
    assert(imported, `导入后未见「已经加进来了」：snack=${snackText} tail=${txt.slice(-200)}`);
    return {
      ok: true,
      detail: { snackText, rawBefore: before.count, rawAfter: after.count, sample: after.rows?.slice(0, 2) },
      note: `raw ${before.count}→${after.count}`,
    };
  });
}

/* ======================= Flow 5：设置域 + 开发者 ======================= */

async function flowSettings() {
  await flow('设置 · 首页设置项渲染 + 连接测试页无 key 行为', async () => {
    await gotoAndWait(`${report.base}/settings`);
    const t1 = await cdp.bodyText();
    assert(!(await cdp.isCrashed()), '设置页崩溃');
    await gotoAndWait(`${report.base}/settings/connection`);
    const t2 = await cdp.bodyText();
    assert(!(await cdp.isCrashed()), '连接测试页崩溃');
    assert(/连接|模型|Key|测试/.test(t2), '连接测试页无相关文案');
    return { ok: true, detail: { settingsHasSections: t1.length > 100, connectionLen: t2.length } };
  });

  await flow('开发者页 · 能力表自检 / 日志流 / 清空日志 不崩', async () => {
    await gotoAndWait(`${report.base}/settings/developer`);
    const txt = await cdp.bodyText();
    assert(txt.includes('日志流') || txt.includes('能力表自检') || txt.includes('开发者'), '开发者页无预期内容');
    // 切换「只看错」
    await cdp.clickText('只看错', '.MuiToggleButton-root').catch(() => undefined);
    await sleep(300);
    // 清空日志（安全动作）
    await cdp.clickText('清空日志').catch(() => undefined);
    await sleep(400);
    // 可能弹出确认框
    const hasDialog = await cdp.evalJs(`document.querySelector('[role="dialog"]') !== null`);
    if (hasDialog) {
      await cdp.clickText('删掉').catch(() => cdp.clickText('算了').catch(() => undefined));
      await sleep(400);
    }
    assert(!(await cdp.isCrashed()), '开发者页操作后崩溃');
    return { ok: true, detail: { hasDialog } };
  });

  await flow('诊断页 · 能力探针渲染 + 再查一遍', async () => {
    await gotoAndWait(`${report.base}/settings/diagnosis`);
    const ok = await cdp.waitFor(`document.body.innerText.includes('能力探针')`, { timeoutMs: 8000 });
    assert(ok, '诊断页未渲染能力探针');
    await cdp.clickText('再查一遍').catch(() => undefined);
    await sleep(1200);
    const txt = await cdp.bodyText();
    assert(!(await cdp.isCrashed()), '诊断页崩溃');
    return { ok: true, detail: { len: txt.length } };
  });
}

/* ======================= Flow 6：导入导出 ======================= */

async function flowImportExport() {
  await flow('备份 · 一键导出 zip（真实下载到磁盘）', async () => {
    await gotoAndWait(`${report.base}/settings`);
    await cdp.allowDownloads(DOWNLOADS);
    await cdp.clickText('导出');
    await sleep(3500);
    const { readdirSync } = await import('node:fs');
    const files = existsSync(DOWNLOADS) ? readdirSync(DOWNLOADS).filter((f) => !f.endsWith('.crdownload')) : [];
    const zip = files.find((f) => f.endsWith('.zip'));
    assert(zip, `未产生 zip 下载（目录内容：${files.join(',') || '空'}）`);
    const { statSync } = await import('node:fs');
    const size = statSync(path.join(DOWNLOADS, zip)).size;
    assert(size > 100, `zip 体积异常：${size} 字节`);
    return { ok: true, detail: { file: zip, size, all: files } };
  });

  await flow('备份 · 导入 settings.json（隐藏 input + 真实 change）', async () => {
    await gotoAndWait(`${report.base}/settings`);
    const fixturePath = path.join(PROJECT_ROOT, 'scripts', 'qa', 'fixtures', 'settings-sample.json');
    // ★ zustand persist 的存储形状是 { state: { settings: AppSettings }, version }，
    //   不是裸 AppSettings —— 探针必须先剥 .state 再读（这是本轮踩过的坑，写下来免得复发）。
    const readGrayscale = `(() => {
      try {
        const raw = JSON.parse(localStorage.getItem('ai-ai.settings.v1'));
        const s = raw && raw.state ? raw.state.settings : raw;
        return s && s.appearance ? s.appearance.grayscale : null;
      } catch { return null; }
    })()`;
    const before = await cdp.evalJs(readGrayscale);
    // 备份导入的隐藏 input accept=".zip,.json,..."
    await cdp.setFileInput('input[type=file][accept*=".zip"]', fixturePath);
    await sleep(2500);
    const after = await cdp.evalJs(readGrayscale);
    const snackText = await cdp.evalJs(
      `[...document.querySelectorAll('.MuiSnackbar-root, .MuiAlert-root')].map((e) => e.innerText).join(' | ')`,
    );
    assert(before === false, `导入前 grayscale 期望 false，实际 ${before}`);
    assert(after === true, `导入后 grayscale 未变为 true（snack=${snackText}）`);
    return { ok: true, detail: { before, after, snackText } };
  });

  await flow('人设 · 导入 JSON 角色卡（FileDropZone drop → 落库）', async () => {
    const fixture = readFileSync(path.join(PROJECT_ROOT, 'scripts', 'qa', 'fixtures', 'persona-sample.json'), 'utf8');
    await gotoAndWait(`${report.base}/`);
    const before = await cdp.storeDump(DB, 'personas', '(r)=>({id:r.id,name:r.data&&r.data.name})');
    // 打开角色管理：工具栏图标按钮的 aria-label = pl('page.persona.title') = '角色'
    const openedPersona = await cdp.evalJs(
      `(() => {
         const b = [...document.querySelectorAll('button')].find((x) => {
           const r = x.getBoundingClientRect();
           return r.width > 0 && r.height > 0 && ((x.getAttribute('aria-label') || '').includes('角色') || (x.getAttribute('aria-label') || '').includes('人设'));
         });
         if (!b) return false;
         b.click();
         return true;
       })()`,
    );
    assert(openedPersona, '找不到「角色」入口按钮');
    await cdp.waitFor(`document.querySelectorAll('[role="dialog"]').length >= 1`, { timeoutMs: 6000 });
    // 点「导入」→ 打开 PersonaImportDialog（第二个 Dialog）
    const openedImport = await cdp.evalJs(
      `(() => {
         const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === '导入' && x.getBoundingClientRect().width > 0 && !x.disabled);
         if (!b) return false;
         b.click();
         return true;
       })()`,
    );
    assert(openedImport, '找不到角色页里的「导入」按钮');
    const dialogCount = await cdp
      .waitFor(`document.querySelectorAll('[role="dialog"]').length >= 2`, { timeoutMs: 6000 })
      .then((ok) => ok);
    assert(dialogCount, `人设导入对话框未打开（dialog 数未达 2）`);
    // drop 到最上层弹窗里的 dropzone（nth=-1 = 最后一个虚线边框容器）
    const drop = await cdp.dropFile({ nth: -1, name: 'persona-sample.json', content: fixture, mime: 'application/json' });
    assert(drop.ok, `drop 未命中：${drop.reason}（found=${drop.found}）`);
    // 等预览解析出「成了 N 个」
    await cdp.waitFor(`document.body.innerText.includes('成了')`, { timeoutMs: 6000 }).catch(() => false);
    await sleep(600);
    // 点对话框里的「导入」确认（MUI Dialog 有 4 层嵌套，取最后一个 dialog 的最右下按钮）
    const confirmed = await cdp.evalJs(
      `(() => {
         const dlgs = [...document.querySelectorAll('[role="dialog"]')];
         const dlg = dlgs[dlgs.length - 1];
         const btn = [...dlg.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '导入');
         if (!btn || btn.disabled) return false;
         btn.click();
         return true;
       })()`,
    );
    assert(confirmed, '人设导入确认按钮不可用（可能预览未解析出卡片）');
    await sleep(2500);
    const after = await cdp.storeDump(DB, 'personas', '(r)=>({id:r.id,name:r.data&&r.data.name,origin:r.origin})');
    const added = (after.rows ?? []).filter((r) => r.name === 'QA测试卡');
    assert(added.length >= 1, `角色卡未落库（before=${before.count}, after=${after.count}）`);
    return { ok: true, detail: { before: before.count, after: after.count, added: added.length } };
  });
}

/* ======================= Flow 7：PWA ======================= */

async function flowPwa() {
  await flow('PWA · manifest + sw.js 可访问', async () => {
    await gotoAndWait(`${report.base}/`);
    const res = await cdp.evalJs(
      `(async () => {
         const m = await fetch('/manifest.webmanifest');
         const manifest = m.ok ? await m.json() : null;
         const s = await fetch('/sw.js');
         return { manifestStatus: m.status, manifestName: manifest && manifest.name, swStatus: s.status, swLen: s.ok ? (await s.text()).length : 0 };
       })()`,
    );
    assert(res.manifestStatus === 200 && res.manifestName, `manifest 不可用：${JSON.stringify(res)}`);
    assert(res.swStatus === 200 && res.swLen > 100, `sw.js 不可用：${JSON.stringify(res)}`);
    report.extra.pwa = res;
    return { ok: true, detail: res };
  });
}

async function flowPwaProd() {
  // 生产构建快照才算数：dev 环境按设计不注册 SW
  const snap = report.env.prodSnapshot;
  if (!snap || snap.error) {
    return record({ name: 'PWA · 生产构建 Service Worker 注册', ok: false, note: `跳过：${snap?.error ?? '无 dist 快照'}` , skipped: true});
  }
  await flow('PWA · 生产构建 Service Worker 注册', async () => {
    await gotoAndWait(`${snap.base}/`);
    await sleep(2500);
    const reg = await cdp.evalJs(
      `(async () => {
         if (!('serviceWorker' in navigator)) return { supported: false };
         const r = await navigator.serviceWorker.getRegistration();
         return { supported: true, scope: r && r.scope, active: !!(r && r.active) };
       })()`,
    );
    assert(reg.supported, '浏览器不支持 serviceWorker');
    assert(reg.scope, `生产构建下 SW 未注册：${JSON.stringify(reg)}`);
    return { ok: true, detail: reg };
  });
}

/* ================================ 主流程 ================================ */

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(TMP, { recursive: true });
  console.log(`\n=== ai爱 Web 回归 @ ${TS} ===`);
  console.log(`输出目录：${OUT}\n`);

  let browser;
  let snapServer;

  try {
    // —— 起 dev server（失败则回落到 dist 静态快照）——
    if (args.base) {
      report.base = String(args.base);
      console.log(`使用已有 server：${report.base}`);
      report.env.dev = 'external';
    } else {
      try {
        dev = await startDevServer({ port: 5173 });
        report.base = dev.base;
        report.env.dev = 'ok';
        console.log(`dev server 就绪：${report.base}`);
      } catch (e) {
        console.warn(`[警告] dev server 起不来，回落到 dist 静态快照：${e.message.slice(0, 200)}`);
        const snapDir2 = path.join(TMP, 'dist-snapshot-primary');
        snapServer = await serveDistSnapshot({ port: 4177, snapshotDir: snapDir2 });
        if (!snapServer) throw e;
        report.base = snapServer.base;
        report.env.dev = `fallback-static: ${e.message.slice(0, 300)}`;
        report.env.prodSnapshot = { base: snapServer.base };
        console.log(`改用 dist 快照：${report.base}`);
      }
    }

    // —— 起浏览器（全新 profile，保证首访走引导）——
    browser = await startBrowser({ port: 9222, profileDir: PROFILE, freshProfile: true, downloadDir: DOWNLOADS });
    cdp = await Cdp.attach(9222);
    await cdp.enableDomains();

    // —— Flow 0：引导（必须在清 profile 后第一时间跑）——
    console.log('\n— 引导 —');
    if (!args.only || args.only === 'guide') await flowGuide();
    // 兜底：确保引导标记就位，后续路由才不被拦。
    // ★ 必须先落到应用 origin —— 跳过引导流程时页面还停在 about:blank（不透明源），
    //   在那里读 localStorage 会 SecurityError。
    await gotoAndWait(`${report.base}/`);
    await cdp.evalJs(`localStorage.setItem(${JSON.stringify(GUIDE_KEY)}, '1')`);

    if (!args.only || args.only === 'routes') {
      console.log(`\n— 路由可达（${ROUTES.length} 条）—`);
      for (const r of ROUTES) {
        await flow(`路由 ${r.name} ${r.path}`, async () => {
          const t0 = Date.now();
          cdp.setPhase(`route:${r.name}`);
          const before = cdp.events.length;
          await gotoAndWait(`${report.base}${r.path}`);
          const p = await cdp.pathname();
          const { crashed, rootLen, txt } = await pageHealthy();
          const events = cdp.events.slice(before);
          const uncaught = events.filter((e) => e.kind === 'uncaught');
          const res = { path: p, expected: r.expect, crashed, rootLen, uncaught: uncaught.length, textLen: txt.length, ms: Date.now() - t0 };
          report.routes.push({ name: r.name, ok: !crashed && rootLen > 0 && p === r.expect && uncaught.length === 0, ...res });
          if (crashed) await shot(`crash-${r.name}`);
          assert(!crashed, `渲染崩溃页`);
          assert(rootLen > 0, `#root 为空（白屏）`);
          assert(p === r.expect, `被重定向到 ${p}（期望 ${r.expect}）`);
          if (uncaught.length > 0) {
            issue('P2', `路由 ${r.name} 有未捕获异常`, uncaught[0].text.slice(0, 300), r.path);
          }
          return { ok: true, detail: res };
        });
      }
    }

    console.log('\n— 主流程 —');
    if (!args.only || args.only === 'flows') {
      await flowHome();
      await flowChat();
      await flowCapabilities();
      await flowDistillZeroMaterial();
      await flowDistillDuplicateName();
      await flowDistillWechatImport();
      await flowSettings();
      await flowImportExport();
      await flowPwa();
    }

    // —— 生产快照（PWA/SW）——
    console.log('\n— 生产构建快照（Service Worker）—');
    // ★ 快照目录放在 scripts/qa/out/<TS>/ 下（gitignore 掉的输出区），不放 .qa-tmp：
    //   本沙箱对某些临时路径的 cpSync/rmSync 会抛 `EIO, Access is denied`（已实测两次）。
    //   失败只降级为 SKIP，不影响其它断言。
    const snapDir = path.join(OUT, 'dist-snapshot');
    let snapErr = null;
    for (let attempt = 0; attempt < 3 && !snapServer; attempt += 1) {
      try {
        snapServer = await serveDistSnapshot({ port: 4178, snapshotDir: snapDir });
        if (!snapServer) snapErr = 'dist/index.html 不存在（未构建）';
      } catch (e) {
        snapErr = String(e.message ?? e);
        await sleep(800);
      }
    }
    if (snapServer) {
      report.env.prodSnapshot = { base: snapServer.base };
      await flowPwaProd();
    } else {
      report.env.prodSnapshot = { error: snapErr };
      record({ name: 'PWA · 生产构建 Service Worker 注册', ok: false, skipped: true, note: `跳过：${snapErr}` });
    }
  } catch (e) {
    console.error('\n[致命] ', e);
    report.fatal = String(e.stack ?? e);
  } finally {
    cdp?.close();
    killTree(browser?.child);
    if (snapServer?.server) snapServer.server.close();
    killTree(dev?.child);
  }

  /* ============================ 汇总 ============================ */
  const routeOk = report.routes.filter((r) => r.ok).length;
  const flowOk = report.flows.filter((f) => f.ok).length;
  const flowTotal = report.flows.filter((f) => !f.skipped).length;
  const failed = report.flows.filter((f) => !f.ok && !f.skipped);
  const p0p1 = report.issues.filter((i) => i.level === 'P0' || i.level === 'P1');

  report.summary = {
    routes: `${routeOk}/${report.routes.length}`,
    flows: `${flowOk}/${flowTotal}`,
    issues: report.issues.length,
    p0p1: p0p1.length,
    finishedAt: new Date().toISOString(),
  };
  report.coverage = {
    routeCount: report.routes.length,
    routeOk,
    flowCount: flowTotal,
    flowOk,
  };

  writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(path.join(OUT, 'report.md'), renderMarkdown(report));

  console.log('\n===== 汇总 =====');
  console.log(`路由可达：${routeOk}/${report.routes.length}`);
  console.log(`流程通过：${flowOk}/${flowTotal}`);
  console.log(`失败项：${failed.length}`);
  for (const f of failed) console.log(`  - ${f.name} → ${f.note}`);
  console.log(`报告：${path.join(OUT, 'report.json')}`);

  // 退出码：有失败流程 / 致命错误 / 一条路由都没跑到 → 1（否则「脚本挂了」会被误读成「全绿」）
  const fatal = Boolean(report.fatal) || report.routes.length === 0;
  if (report.fatal) console.error(`\n[致命] ${report.fatal}`);
  process.exitCode = failed.length > 0 || fatal ? 1 : 0;
}

function renderMarkdown(r) {
  const L = [];
  L.push(`# ai爱 Web 回归报告`, '');
  L.push(`- 时间：${r.startedAt} → ${r.summary.finishedAt}`);
  L.push(`- base：${r.base}`);
  L.push(`- 路由：${r.summary.routes} ｜ 流程：${r.summary.flows} ｜ 问题：${r.summary.issues}`);
  L.push('');
  L.push('## 路由可达');
  L.push('| 路由 | 路径 | 结果 | 期望 | 实际 | 未捕获异常 |');
  L.push('|---|---|---|---|---|---|');
  for (const x of r.routes) L.push(`| ${x.name} | ${x.expected} | ${x.ok ? '✅' : '❌'} | ${x.expected} | ${x.path} | ${x.uncaught} |`);
  L.push('');
  L.push('## 流程');
  L.push('| 流程 | 结果 | 备注 |');
  L.push('|---|---|---|');
  for (const f of r.flows) L.push(`| ${f.name} | ${f.skipped ? '⏭' : f.ok ? '✅' : '❌'} | ${(f.note ?? '').replace(/\n/g, ' ')} |`);
  L.push('');
  if (r.issues.length) {
    L.push('## 问题清单');
    for (const i of r.issues) L.push(`- **[${i.level}] ${i.title}** — ${i.detail}（证据：${i.evidence ?? '-'}）`);
    L.push('');
  }
  L.push('## 原始数据');
  L.push('```json');
  L.push(JSON.stringify({ extra: r.extra, env: r.env }, null, 2));
  L.push('```');
  return L.join('\n');
}

main().catch((e) => {
  console.error('[回归脚本异常]', e);
  process.exitCode = 2;
});
