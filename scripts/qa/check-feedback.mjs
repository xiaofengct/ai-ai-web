#!/usr/bin/env node
/**
 * 用户反馈入口 · 端到端验证（2026-10-04）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这个脚本存在的理由
 * ═══════════════════════════════════════════════════════════════════════════
 * 反馈功能里有两件事**光看代码推不出来**，必须真跑一遍：
 *
 * ① **两步提交流程真的成立吗**。
 *    本功能的核心设计是"存下来"和"交出去"分两步（应用没有服务端）：
 *    点「交上去」**不能**自动关闭对话框，要原地给出「发出去 / 复制这一条」
 *    和那段边界说明。这是**最容易在重构里被顺手改掉**的一处 ——
 *    "提交完就关掉"是绝大多数对话框的默认写法，谁顺手改回去都不会报错。
 *    ⇒ 必须有一条断言钉住它。
 *
 * ② **写进 IndexedDB 的东西对不对**。
 *    环境快照（版本/构建类型/平台/UA/视口）是**自动采集**的，
 *    界面上看见的只是它渲染出来的样子；真实落库的字段是否齐全、
 *    `status` 是不是初始的 `'new'`，只有查库才知道。
 *
 * ── 这个脚本**不测**什么（如实说明，别把它当全量验收）────────────────────
 * - **不测 `navigator.share`**：它在 headless 环境里不存在，
 *   代码里那条 `typeof nav.share === 'function'` 分支必然走不到。
 *   这里只能验到"分享按钮存在且可点"，真正的系统分享面板**只能真机验**。
 * - **不测导出文件的内容**：下载触发的落盘路径在无头环境里不可靠。
 *   这里验的是按钮存在、且在列表非空时**未被禁用**。
 * - 剪贴板读取若被环境拒绝，会打印一条 `跳过`，**不计入失败**
 *   （那是无头环境的限制，不是产品缺陷）—— 但会显式说出来，不静默略过。
 *
 * 用法：node scripts/qa/check-feedback.mjs [--dir=dist]
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Cdp, sleep } from './lib/cdp.mjs';
import { PROJECT_ROOT, killTree, startBrowser } from './lib/harness.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const DIR = path.resolve(arg('dir', path.join(PROJECT_ROOT, 'dist')));
const PORT = Number(arg('port', 4253));
const DEBUG_PORT = Number(arg('debugPort', 9513));
const OUT = path.resolve(arg('out', path.join(PROJECT_ROOT, '.qa-tmp', 'feedback')));

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
const profile = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp', `fb-${Date.now()}`);
const browser = await startBrowser({ port: DEBUG_PORT, profileDir: profile, freshProfile: true });
const cdp = await Cdp.attach(DEBUG_PORT);
await cdp.enableDomains();
// 剪贴板权限：能授予就授予，读不到时按"跳过"处理（见文件头）
const BASE = `http://127.0.0.1:${PORT}`;
await cdp
  .send('Browser.grantPermissions', {
    origin: BASE,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  })
  .catch(() => undefined);

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
    /* 非 JSON 帧 */
  }
});

let failed = 0;
let skipped = 0;
const ok = (name, cond, detail) => {
  if (!cond) failed += 1;
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? `  ${detail}` : ''}`);
};
const skip = (name, why) => {
  skipped += 1;
  console.log(`  \x1b[33m∼ 跳过\x1b[0m ${name}  ${why}`);
};

await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await cdp.send('Network.setBypassServiceWorker', { bypass: true });

console.log('\n═══ 用户反馈入口 · 端到端 ═══\n');
console.log(`  产物：${DIR}\n`);

/* 预置引导标记：不预置的话所有路由都会被 RequireGuide 拦回 /guide（本项目已踩过两次） */
await cdp.goto(BASE);
await sleep(1200);
await cdp.evalJs(`(() => { try { localStorage.setItem('ai-ai.guide.v1','1'); } catch(_){} return true; })()`);

/* ═══════════ ① 设置页有反馈分区，且入口在里面 ═══════════ */
console.log('① 设置页的「反馈与建议」分区');
await cdp.goto(`${BASE}/settings`);
await sleep(3500);

const feedbackProbe = () =>
  cdp.evalJs(`
    (() => {
      const box = document.querySelector('[data-section-id="feedback"]');
      if (!box) return { found: false, text: '' };
      return { found: true, text: (box.innerText || '').trim() };
    })()
  `);
let section = await feedbackProbe();
ok('反馈分区存在（data-section-id="feedback"）', section.found === true);
// 分组默认收起 ⇒ 文本很短时先展开（判据同 camera 脚本：不猜 class 名，看文本长度）
if (section.found && section.text.length < 40) {
  await cdp.evalJs(
    `(() => { const b = document.querySelector('[data-section-id="feedback"] button'); if (b) b.click(); return true; })()`,
  );
  await sleep(1500);
  section = await feedbackProbe();
}
ok('分区里有「我要反馈」入口', String(section.text).includes('我要反馈'));
ok(
  '★ 分区里**明说了反馈不会自己上传**（边界说明固定可见，不折叠）',
  String(section.text).includes('不会自己上传'),
  `摘录：${JSON.stringify(String(section.text).slice(0, 90))}`,
);

const shot0 = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(path.join(OUT, '01-settings-section.png'), Buffer.from(shot0.data, 'base64'));

/* ═══════════ ② 提交对话框：字段齐、有字数、能看到会被带上的环境 ═══════════ */
console.log('\n② 提交对话框（类型 / 正文 / 联系方式 / 环境快照可见）');
await cdp.clickText('我要反馈');
await sleep(1200);

const dlgProbe = () =>
  cdp.evalJs(`
    (() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return { open: false, text: '', textareas: 0, inputs: 0, toggles: 0 };
      return {
        open: true,
        text: (dlg.innerText || '').trim(),
        textareas: dlg.querySelectorAll('textarea').length,
        inputs: dlg.querySelectorAll('input').length,
        toggles: dlg.querySelectorAll('.MuiToggleButton-root').length,
      };
    })()
  `);
let dlg = await dlgProbe();
ok('点「我要反馈」弹出了对话框', dlg.open === true);
ok('四种反馈类型都能选（ToggleButton × 4）', dlg.toggles === 4, `实际 ${dlg.toggles}`);
ok('有正文输入框（textarea）', dlg.textareas >= 1, `实际 ${dlg.textareas}`);
ok('有联系方式输入框（input）', dlg.inputs >= 1, `实际 ${dlg.inputs}`);
ok('★ 提交前**把要带上的环境原样显示给用户看**', dlg.text.includes('版本号') && dlg.text.includes('平台'));
ok('★ 明说"不采集任何身份信息"', dlg.text.includes('不采集任何身份信息'));
ok('边界说明在提交前就已可见（不是事后才说）', dlg.text.includes('不会自己上传'));
/* 未填内容时提交按钮应当禁用 —— 否则会出现"点了没反应" */
const submitDisabled = await cdp.evalJs(`
  (() => {
    const dlg = document.querySelector('[role="dialog"]');
    const btns = [...(dlg?.querySelectorAll('button') ?? [])];
    const b = btns.find((x) => (x.textContent || '').trim().includes('交上去'));
    return b ? !!b.disabled : null;
  })()
`);
ok('空内容时「交上去」是禁用的（不给"点了没反应"）', submitDisabled === true, `实际 ${submitDisabled}`);

/* ═══════════ ③ 填内容 → 提交 → **不自动关闭**，进入第二步 ═══════════ */
console.log('\n③ 提交 → 两步流程（存下来 ≠ 交出去）');
const CONTENT = 'QA 自动提交：点进设置页时，反馈分区的说明文字有时候会换行错位。';
await cdp.typeIntoSelector('[role="dialog"] textarea', CONTENT);
await sleep(400);

const counterShown = await cdp.evalJs(`
  (() => {
    const dlg = document.querySelector('[role="dialog"]');
    return (dlg?.innerText || '').includes('还能写');
  })()
`);
ok('有剩余字数提示（不静默截断的前置条件）', counterShown === true);

await cdp.clickText('交上去', '[role="dialog"] button');
await sleep(1600);

const step2 = await cdp.evalJs(`
  (() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return { stillOpen: false, text: '' };
    return {
      stillOpen: true,
      text: (dlg.innerText || '').trim(),
      buttons: [...dlg.querySelectorAll('button')].map((b) => (b.textContent || '').trim()),
      textareas: dlg.querySelectorAll('textarea').length,
    };
  })()
`);
ok('★ **提交后对话框没有自动关闭**（"存下来"和"交出去"是两步）', step2.stillOpen === true);
ok('★ 原地给出「发出去」按钮', step2.buttons.some((b) => b.includes('发出去')), `按钮：${JSON.stringify(step2.buttons)}`);
ok('★ 原地给出「复制这一条」按钮（分享不可用时的兜底路）', step2.buttons.some((b) => b.includes('复制这一条')));
ok('第二步里输入框已收起（不让人以为还要再点一次）', step2.textareas === 0, `还剩 ${step2.textareas} 个`);
ok('★ 再次说明"不会自己上传"（这是本功能唯一诚实的做法）', step2.text.includes('不会自己上传'));

const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(path.join(OUT, '02-dialog-step2.png'), Buffer.from(shot1.data, 'base64'));

/* ═══════════ ④ 库里真的写进去了，且字段齐全 ═══════════ */
console.log('\n④ 落库校验（IndexedDB `feedback` 表）');
/**
 * ★ `storeDump` 返回的是 `{ count, rows }`，**不是数组**。
 *   第一版按数组写（`rows.length` / `rows[0]`）⇒ 全部报假失败 ——
 *   明明取到了记录，断言却读到 `undefined`。这类"测试脚本自己读错"的假红
 *   本项目已经踩过好几轮（`providers.presets`、`localStorage.state` 那两次同源）。
 *   ⇒ 判据：**先确认工具的返回形状，再写断言**。
 */
const dump = await cdp.storeDump(
  'ai-ai-web',
  'feedback',
  `(r)=>({kind:r.kind,content:r.content,status:r.status,env:r.env,hasContact:!!r.contact,createdAt:r.createdAt})`,
);
const rows = Array.isArray(dump?.rows) ? dump.rows : [];
ok('库里有一条反馈', dump?.count === 1, `实际 ${dump?.count ?? 'null'} 条`);
const row = rows[0] ?? {};
ok('正文与输入一致', row.content === CONTENT, `实际 ${JSON.stringify(String(row.content ?? '').slice(0, 40))}`);
ok('★ 初始状态是 `new`（没看过）', row.status === 'new', `实际 ${row.status}`);
ok('类型是合法枚举', ['bug', 'idea', 'content', 'other'].includes(row.kind), `实际 ${row.kind}`);
const env = row.env ?? {};
ok(
  '★ 环境快照六个字段都落了库',
  ['appVersion', 'buildFlavor', 'platform', 'userAgent', 'locale', 'viewport'].every((k) => env[k] !== undefined),
  `keys=${JSON.stringify(Object.keys(env))}`,
);
ok('环境快照里有构建类型（排查时第一个要看的）', ['builtin-xinran', 'standalone'].includes(env.buildFlavor), `实际 ${env.buildFlavor}`);
ok('视口尺寸形如 宽x高', /^\d+x\d+$/.test(String(env.viewport ?? '')), `实际 ${env.viewport}`);

/* 关掉对话框 */
await cdp.clickText('关掉', '[role="dialog"] button');
await sleep(900);
const dlgAfterClose = await cdp.evalJs(`document.querySelectorAll('[role="dialog"]').length`);
ok('关掉后对话框消失', dlgAfterClose === 0, `还剩 ${dlgAfterClose} 个`);

/* ═══════════ ⑤ 反馈信箱：查看 / 筛选 / 改状态 / 备注 / 导出 ═══════════ */
console.log('\n⑤ 反馈信箱（/settings/feedback）');
await cdp.goto(`${BASE}/settings/feedback`);
await sleep(2500);

const inbox = await cdp.evalJs(`
  (() => {
    return {
      path: location.pathname,
      text: (document.body.innerText || '').trim(),
      toggles: document.querySelectorAll('.MuiToggleButton-root').length,
    };
  })()
`);
ok('路由可达 /settings/feedback', inbox.path === '/settings/feedback', `实际 ${inbox.path}`);
ok('标题是「反馈信箱」', inbox.text.includes('反馈信箱'));
ok('列出了一条反馈，正文可见', inbox.text.includes('QA 自动提交'));
ok('有按状态筛选的控件（全部 + 4 档）', inbox.toggles >= 5, `实际 ${inbox.toggles}`);
ok('显示按类型的统计行', inbox.text.includes('毛病') && inbox.text.includes('其它'));
ok('有导出按钮（文本）', inbox.text.includes('导出全部（文本）'));
ok('有导出按钮（JSON）', inbox.text.includes('导出全部（JSON）'));
ok('★ 明说这个信箱只覆盖**这台设备**', inbox.text.includes('这台设备上'), '不说这句会被当成"所有用户的反馈汇总"');

const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(path.join(OUT, '03-inbox.png'), Buffer.from(shot2.data, 'base64'));

/**
 * ★ 导出文本的**内容**验证走**真实落盘**，不走剪贴板。
 *
 * 踩过的坑（两次，记下来，因为它们是"测试脚本自己的错"而不是产品缺陷）：
 *   ① 第一版在信箱页按**文字**找「复制这一条」⇒ 恒找不到。
 *      那里是 `aria-label` 的 IconButton —— 它**没有 textContent**。
 *   ② 第二版搬到对话框第二屏（按钮确实有文字、也确实点到了），
 *      但 `navigator.clipboard.readText()` 在无头环境里**读回空串** ——
 *      写没写进去无从判断，三个断言全红，看起来像产品坏了。
 *
 * ⇒ 换成**导出落盘**：点「导出全部（文本）」→ 读真实文件 → 断言内容。
 *   这本来就是用户交付反馈的真实路径之一，而且顺带验证了
 *   `downloadText` 的文件名格式与 BOM（`src/lib/download.ts` 会加 `\uFEFF`）。
 *   ★ `\uFEFF` 必须剥掉再断言：否则 `includes('【ai爱 · 反馈】')` 会在
 *     **第一个字符**上失配 —— 又一个"差一个不可见字符"的假失败。
 */
const DL = path.join(OUT, 'downloads');
await cdp.allowDownloads(DL);
await cdp.clickText('导出全部（文本）');
await sleep(2000);

const downloaded = existsSync(DL) ? readdirSync(DL).filter((f) => f.endsWith('.txt')) : [];
ok('★ 导出真的落了一个 .txt 文件', downloaded.length >= 1, `目录里：${JSON.stringify(downloaded)}`);
if (downloaded.length >= 1) {
  const raw = readFileSync(path.join(DL, downloaded[0]), 'utf8');
  const text = raw.replace(/^\uFEFF/, '');
  ok(
    '★ 文件名可辨识（ai-ai-feedback-日期-时间.txt）',
    /^ai-ai-feedback-\d{8}-\d{4}\.txt$/.test(downloaded[0]),
    `实际 ${downloaded[0]}`,
  );
  ok(
    '★ 导出文本含抬头与正文',
    text.includes('【ai爱 · 反馈】') && text.includes('QA 自动提交'),
    `长度 ${text.length}`,
  );
  ok('★ 导出文本含环境段落（排查信息随反馈一起走）', text.includes('构建类型') && text.includes('内置欣然版'));
  ok(
    '★ 环境段落排在正文**之后**（用户想删就整段删，不用在正文里找）',
    text.indexOf('构建类型') > text.indexOf('QA 自动提交'),
  );
} else {
  skip('导出文本内容断言', '无头环境没落到文件；导出按钮存在且可点这点已在上面验过');
}

/* 改状态：标记看过 */
await cdp.clickText('标记看过');
await sleep(1200);
const afterRead = await cdp.storeDump('ai-ai-web', 'feedback', `(r)=>({status:r.status})`);
ok(
  '★ 改状态真的写回了库（`标记看过` → read）',
  afterRead?.rows?.[0]?.status === 'read',
  `实际 ${JSON.stringify(afterRead?.rows?.[0])}`,
);
const inboxAfterRead = await cdp.evalJs(`(document.body.innerText||'').includes('看过了')`);
ok('列表上的状态标签同步更新', inboxAfterRead === true);

/* 写备注 */
await cdp.clickText('写备注');
await sleep(700);
const NOTE = '下版顺手改一下。';
await cdp.typeIntoSelector('textarea', NOTE);
await sleep(300);
await cdp.clickText('存备注');
await sleep(1200);
const afterNote = await cdp.storeDump('ai-ai-web', 'feedback', `(r)=>({adminNote:r.adminNote})`);
ok(
  '★ 备注写回了库（管理侧的"我自己的备忘"通道）',
  afterNote?.rows?.[0]?.adminNote === NOTE,
  `实际 ${JSON.stringify(afterNote?.rows?.[0])}`,
);

/* ═══════════ ⑥ 删除走二次确认，且真的删掉 ═══════════ */
console.log('\n⑥ 删除（二次确认 → 真的删掉）');
await cdp.evalJs(`
  (() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === '删掉这一条');
    if (btn) btn.click();
    return !!btn;
  })()
`);
await sleep(900);
const confirmText = await cdp.evalJs(`(() => { const d = document.querySelector('[role="dialog"]'); return d ? (d.innerText||'').trim() : ''; })()`);
ok('删除弹了二次确认', confirmText.includes('删掉'), `实际：${JSON.stringify(confirmText.slice(0, 60))}`);

/**
 * ★ 确认按钮的文案是 `common.delete` = **「删掉」**，取消是 `common.cancel` = **「算了」**。
 *   第一版按「删除」找 ⇒ 恒找不到（`clickText` 直接抛错，整个脚本中断）。
 *   ⇒ 教训：**别猜文案表的值，先去 `src/copy/xinran.ts` 确认**。
 *     本项目在 `common.close`（实际是「关掉」）上已经栽过一次，这是第二次。
 */
await cdp.clickText('删掉', '[role="dialog"] button');
await sleep(1400);
const afterDelete = await cdp.storeDump('ai-ai-web', 'feedback', `(r)=>({id:r.id})`);
ok(
  '★ 确认后记录真的被删掉',
  afterDelete?.count === 0,
  `实际剩 ${afterDelete?.count ?? 'null'} 条`,
);
const emptyText = await cdp.evalJs(`(document.body.innerText||'').includes('还没有反馈')`);
ok('删空后回到空态文案', emptyText === true);

/* ═══════════ ⑦ 清空全部：也要二次确认 ═══════════ */
console.log('\n⑦ 清空全部（列表为空时不该出现这个按钮）');
const clearBtnGone = await cdp.evalJs(
  `(() => [...document.querySelectorAll('button')].some((b) => (b.textContent||'').trim().includes('清空所有反馈')))()`,
);
ok('列表为空时「清空所有反馈」不渲染（没有可删的就不给这个按钮）', clearBtnGone === false);

/* ═══════════ ⑧ 运行时告警 ═══════════ */
console.log(`\n  运行时告警 ${problems.length} 条`);
for (const p of problems.slice(0, 6)) console.log(`    · ${p}`);
ok('全程无未捕获异常 / console.error', problems.length === 0);

console.log(`\n  （跳过 ${skipped} 项，原因见上）`);
console.log('\n═══════════════════════════════════════════');
console.log(failed === 0 ? '\x1b[32m全部通过\x1b[0m' : `\x1b[31m失败 ${failed} 项\x1b[0m`);
console.log('═══════════════════════════════════════════\n');

killTree(browser.child);
server.close();
process.exit(failed === 0 ? 0 : 1);
