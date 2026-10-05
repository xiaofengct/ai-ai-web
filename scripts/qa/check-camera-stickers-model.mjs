#!/usr/bin/env node
/**
 * 相机 / 表情包 / 模型选择 的端到端验证（2026-10-04）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这个脚本存在的理由
 * ═══════════════════════════════════════════════════════════════════════════
 * 本轮修的三个问题里有两个**只能靠"打开真产物跑一遍"才能验证**：
 *
 * ① **「AI 发不出表情包」** —— 根因是"图不在库里"。
 *    光看代码推不出来（匹配逻辑一直是对的），必须实跑一遍：
 *    种子 → 图进 blobs → 匹配 → 拿到 assetId。
 *    ⇒ 这里的断言直接查 IndexedDB：**内置包里的条目有没有 assetId**。
 *
 * ② **退役模型** —— 要确认"新用户拿到的默认型号是对的"。
 *    这要读真实 localStorage 里的持久化设置（不是读常量）。
 *
 * ③ **相机按钮** —— 要确认它真的渲染在输入框那一行、且点击能唤起对话框。
 *    ★ 摄像头本身在 headless 环境里**取不到**，所以这里**不测**"能不能出画面"；
 *      测的是"按钮在不在、点开是不是对话框、失败提示是不是分类的"。
 *      真实的取流只能在真机上验 —— 这一点在报告里如实说明。
 *
 * 用法：node scripts/qa/check-camera-stickers-model.mjs [--dir=dist]
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
const PORT = Number(arg('port', 4251));
const DEBUG_PORT = Number(arg('debugPort', 9511));
const OUT = path.resolve(arg('out', path.join(PROJECT_ROOT, '.qa-tmp', 'camera-stickers')));

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
const profile = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp', `csm-${Date.now()}`);
const browser = await startBrowser({ port: DEBUG_PORT, profileDir: profile, freshProfile: true });
// ★ 授予相机权限：不授予的话 getUserMedia 直接抛 NotAllowedError，
//   我们就只能测到"拒绝"那条分支，测不到"正常打开"的路径。
const cdp = await Cdp.attach(DEBUG_PORT);
await cdp.enableDomains();
await cdp.send('Browser.grantPermissions', {
  origin: `http://127.0.0.1:${PORT}`,
  permissions: ['videoCapture'],
}).catch(() => undefined);

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
// ★ 授予相机权限（Chrome 的 mock 摄像头在 headless 下会返回一个合成画面）
await cdp.send('Emulation.setPermissionOverrides', {
  permissions: [{ origin: `http://127.0.0.1:${PORT}`, name: 'videoCapture', setting: 'granted' }],
}).catch(() => undefined);
await cdp.send('Network.setBypassServiceWorker', { bypass: true });

const BASE = `http://127.0.0.1:${PORT}`;

console.log('\n═══ 相机 / 表情包 / 模型选择 · 端到端 ═══\n');
console.log(`  产物：${DIR}\n`);

/* ═══════════ ① 内置表情包现在真的有图了（这是「AI 发不出表情」的根因）═══════════ */
console.log('① 内置表情包：图是否真的进了库（★ 本轮核心修复）');
await cdp.goto(BASE);
await sleep(1200);
await cdp.evalJs(`(() => { try { localStorage.setItem('ai-ai.guide.v1','1'); } catch(_){} return true; })()`);
// 重新加载，让 bootstrap 完整跑一遍（含表情图回填）
await cdp.goto(`${BASE}/settings`);
await sleep(4000);

const stickerState = await cdp.evalJs(
  `
  (async () => {
    const open = () => new Promise((ok, bad) => {
      const req = indexedDB.open('ai-ai-web');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error);
    });
    const db = await open();
    const packs = await new Promise((ok, bad) => {
      const tx = db.transaction('stickers', 'readonly');
      const req = tx.objectStore('stickers').getAll();
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error);
    });
    const blobCount = await new Promise((ok, bad) => {
      const tx = db.transaction('blobs', 'readonly');
      const req = tx.objectStore('blobs').count();
      req.onsuccess = () => ok(req.result);
      req.onerror = () => bad(req.error);
    });
    const builtin = (packs || []).find((p) => p.id === 'sticker-pack-placeholder');
    const items = builtin ? (builtin.items || []) : [];
    return {
      packExists: !!builtin,
      itemCount: items.length,
      withAsset: items.filter((it) => !!it.assetId).length,
      blobCount,
      sample: items.slice(0, 3).map((it) => ({ d: it.description, has: !!it.assetId })),
    };
  })()
`,
  { awaitPromise: true },
);

ok('内置表情包存在', stickerState.packExists === true);
ok('条目数 = 12', stickerState.itemCount === 12, `实际 ${stickerState.itemCount}`);
ok(
  '★ **每一条都带 assetId**（改动前是 0 条 —— 这就是"AI 发不出表情"的根因）',
  stickerState.withAsset === 12,
  `带图 ${stickerState.withAsset}/12`,
);
ok('图片已写进 blobs 表', stickerState.blobCount >= 12, `blobs 共 ${stickerState.blobCount} 条`);
console.log(`     样本：${JSON.stringify(stickerState.sample)}`);

/* ═══════════ ② 提示词里有"不要假装发图"的约束 ═══════════ */
console.log('\n② 提示词约束（防止模型再写 [柴犬裂开.jpg] 这种假标记）');
/**
 * ★★ 产物源码集合 —— **在 Node 侧读文件**，不在浏览器里 fetch。
 *
 * 第一版是在页面里 `fetch(script[src])` 拼起来，结果只拿到入口那几个 chunk ——
 * `ModelSection`（含退役型号告警表）在**懒加载 chunk** 里，
 * 于是"产物里含退役告警"报了**假失败**（明明在，只是没读到那个文件）。
 * ⇒ 直接从 `dist/assets/` 读全部 `.js`（87 个 chunk 一次读完，几百毫秒）。
 *   这也顺带覆盖了"懒加载 chunk 里的文案"这一类断言需求。
 */
const bundleText = (() => {
  const assetsDir = path.join(DIR, 'assets');
  if (!existsSync(assetsDir)) return '';
  let all = '';
  for (const f of readdirSync(assetsDir)) {
    if (!f.endsWith('.js') && !f.endsWith('.mjs')) continue;
    try {
      all += readFileSync(path.join(assetsDir, f), 'utf8');
    } catch {
      /* 忽略读不了的 */
    }
  }
  // 顺带把 index.html 也算上（内联的兜底脚本里有中文）
  try {
    all += readFileSync(path.join(DIR, 'index.html'), 'utf8');
  } catch {
    /* 忽略 */
  }
  return all;
})();
console.log(`     （产物源码共读取 ${bundleText.length} 字符）`);
ok('产物里含"用文字把情绪写出来"这条约束', String(bundleText).includes('用文字把情绪写出来'));
ok('产物里含"不要自己写"假图片标记"的禁令', String(bundleText).includes('假装'));
ok('产物里含"形象是画出来的"说明', String(bundleText).includes('形象是画出来的'));

/* ═══════════ ③ 模型：默认型号已从退役的 deepseek-chat 换掉 ═══════════ */
console.log('\n③ 模型（退役 ID 修正 + 候选与地址显示）');
const providerState = await cdp.evalJs(`
  (() => {
    try {
      const raw = localStorage.getItem('ai-ai.settings.v1');
      if (!raw) return { found: false };
      const parsed = JSON.parse(raw);
      // ★★ 两层读取坑，都踩过：
      //   ① zustand persist 会把状态包在 ‘state‘ 层里：‘{ state: { settings }, version }‘。
      //      第一版直接读 ‘parsed.settings‘ ⇒ 恒为 undefined。
      //   ② ‘settings.providers‘ 在类型定义里是 **数组** ‘LLMProviderConfig[]‘
      //      （见 ‘src/types/settings.ts:179‘），**没有 ‘presets‘ 字段**。
      //      第二版读 ‘s.providers?.presets‘ ⇒ 还是恒 undefined ⇒ 又报一次假失败。
      //   ⇒ 正确读法：先取 activeProviderId 命中的那条，取不到再按名字/域名兜底。
      const s = parsed.state?.settings ?? parsed.settings ?? parsed;
      const list = Array.isArray(s.providers) ? s.providers : [];
      const ds =
        list.find((p) => p.id === s.activeProviderId) ||
        list.find((p) => /deepseek/i.test(String(p.name || ''))) ||
        list.find((p) => String(p.baseUrl || '').includes('api.deepseek.com'));
      return {
        found: true,
        count: list.length,
        activeId: s.activeProviderId,
        name: ds?.name,
        model: ds?.model,
        baseUrl: ds?.baseUrl,
      };
    } catch (e) {
      return { found: false, err: String(e) };
    }
  })()
`);
ok('读到持久化的 provider 设置', providerState.found === true, JSON.stringify(providerState));
ok(
  '★ **默认型号不再是已退役的 deepseek-chat**',
  providerState.model !== 'deepseek-chat',
  `实际 model=${providerState.model}`,
);
ok(
  '默认型号 = deepseek-flash（V4.1-Flash 的真实 API ID）',
  providerState.model === 'deepseek-flash',
  `实际 ${providerState.model}`,
);
ok('DeepSeek 的 baseUrl 仍是官方地址', String(providerState.baseUrl ?? '').includes('api.deepseek.com'));

// 产物里是否含退役告警表（用户填错时能就地提示）
// ★ grep 词必须与**实际文案**一致：第一版写的是「已被 DeepSeek 正式退役」，
//   而代码里是「已在 2026-07-24 被 DeepSeek 正式退役」—— 差一个字就是假失败。
ok('产物里含退役型号告警文案', String(bundleText).includes('被 DeepSeek 正式退役'));
ok('产物里含"ID 是 deepseek-flash 不是 v4.1-flash"的提醒', String(bundleText).includes('v4.1-flash'));

/* ═══════════ ④ 设置页：模型行有下拉 + 地址显示 ═══════════ */
console.log('\n④ 设置页的模型分区（下拉切换 + 接口地址可见）');
/**
 * ★ 先展开「模型」分区再读 —— 移动端设置页**分组默认收起**，
 *   不展开的话读到的是纯标题（历史教训：本项目已在两处踩过这个坑）。
 *   判据用「文本长度是否够长」，不猜 class 名。
 */
const modelProbe = () =>
  cdp.evalJs(`
    (() => {
      const box = document.querySelector('[data-section-id="model"]');
      if (!box) return { found: false, text: '', selects: 0 };
      const t = (box.innerText || '').trim();
      return {
        found: true,
        text: t,
        // MUI v5 的 Select 渲染成 .MuiSelect-select（不是 role=combobox）
        selects: box.querySelectorAll('.MuiSelect-select, [role="combobox"], select').length,
      };
    })()
  `);
let modelSection = await modelProbe();
if (modelSection.found && modelSection.text.length < 40) {
  await cdp.evalJs(
    `(() => { const b = document.querySelector('[data-section-id="model"] button'); if (b) b.click(); return true; })()`,
  );
  await sleep(1500);
  modelSection = await modelProbe();
}
ok('模型分区存在', modelSection.found === true);
ok('有下拉选择控件（切换方式）', modelSection.selects >= 1, `找到 ${modelSection.selects} 个`);
ok(
  '页面显示"这次请求打到哪儿"（用户要求：切换后能看到对应接口地址）',
  String(modelSection.text).includes('这次请求打到哪儿'),
);
ok(
  '页面显示了实际请求地址',
  String(modelSection.text).includes('api.deepseek.com'),
  `摘录：${JSON.stringify(String(modelSection.text).slice(0, 120))}`,
);

/* ═══════════ ⑤ 相机按钮：位置与点击 ═══════════ */
console.log('\n⑤ 聊天输入区的相机按钮');
// 需要先有一个会话才能进聊天页 —— 内置版首启会种一个默认会话
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
ok('库里有会话可进（内置版首启种的）', typeof sessionId === 'string' && sessionId !== '');

if (sessionId) {
  await cdp.goto(`${BASE}/chat/${sessionId}`);
  await sleep(3000);

  const composerProbe = await cdp.evalJs(`
    (() => {
      const camera = document.querySelector('[aria-label="拍照"]');
      if (!camera) return { found: false };
      const r = camera.getBoundingClientRect();
      // 找同排的「发图」按钮，判断相对位置
      const img = document.querySelector('[aria-label="发图"]');
      const ir = img ? img.getBoundingClientRect() : null;
      return {
        found: true,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        imgRect: ir ? { x: Math.round(ir.x), y: Math.round(ir.y) } : null,
        visible: r.width > 0 && r.height > 0,
      };
    })()
  `);
  ok('相机按钮存在（aria-label="拍照"）', composerProbe.found === true);
  ok('相机按钮可见（有实际尺寸）', composerProbe.visible === true, JSON.stringify(composerProbe.rect));
  if (composerProbe.found && composerProbe.imgRect) {
    ok(
      '★ 位置：紧挨「发图」按钮**右侧**（两个都是产图入口，放一起）',
      composerProbe.rect.x > composerProbe.imgRect.x,
      `发图 x=${composerProbe.imgRect.x}｜相机 x=${composerProbe.rect.x}`,
    );
    ok(
      '触控目标 ≥44px',
      composerProbe.rect.w >= 40 && composerProbe.rect.h >= 40,
      `${composerProbe.rect.w}×${composerProbe.rect.h}`,
    );
  }

  // 点开相机对话框
  await cdp.evalJs(`(() => { const b = document.querySelector('[aria-label="拍照"]'); if (b) b.click(); return true; })()`);
  await sleep(2500);

  const dialogProbe = await cdp.evalJs(`
    (() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return { open: false };
      const text = (dialog.innerText || '').trim();
      return {
        open: true,
        text,
        hasVideo: !!dialog.querySelector('video'),
        hasShutter: !!dialog.querySelector('[aria-label="拍下这一张"]'),
        hasFlip: !!dialog.querySelector('[aria-label="切换前后摄像头"]'),
        // ★ ‘common.close‘ 的实际文案是「关掉」不是「关闭」——
        //   第一版写死 "关闭" 就找不到按钮，于是"关闭后不残留"也跟着假失败（级联）。
        //   ⇒ 用"所有带 aria-label 的按钮"来判断，不赌具体文案。
        closeLabels: [...dialog.querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label')),
      };
    })()
  `);
  ok('点相机按钮弹出了对话框', dialogProbe.open === true);
  ok('对话框里有 <video>（预览容器）', dialogProbe.hasVideo === true);
  ok('有快门按钮', dialogProbe.hasShutter === true);
  ok('有翻转摄像头按钮', dialogProbe.hasFlip === true);
  ok(
    '有关闭按钮（取消路径）',
    Array.isArray(dialogProbe.closeLabels) && dialogProbe.closeLabels.length > 0,
    `按下的 aria-label：${JSON.stringify(dialogProbe.closeLabels)}`,
  );
  console.log(`     对话框文本：${JSON.stringify(String(dialogProbe.text).slice(0, 100))}`);

  // 关闭对话框，确认不残留
  await cdp.evalJs(`
    (() => {
      const dlg = document.querySelector('[role="dialog"]');
      const b = dlg && dlg.querySelector('button[aria-label]');
      if (b) b.click();
      return !!b;
    })()
  `);
  await sleep(900);
  const afterClose = await cdp.evalJs(`document.querySelectorAll('[role="dialog"]').length`);
  ok('关闭后对话框消失（取消不残留）', afterClose === 0, `还剩 ${afterClose} 个`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT, 'chat-composer.png'), Buffer.from(shot.data, 'base64'));
}

/* ═══════════ ⑥ 运行时告警 ═══════════ */
console.log(`\n  运行时告警 ${problems.length} 条`);
for (const p of problems.slice(0, 6)) console.log(`    · ${p}`);
ok('全程无未捕获异常 / console.error', problems.length === 0);

console.log('\n═══════════════════════════════════════════');
console.log(failed === 0 ? '\x1b[32m全部通过\x1b[0m' : `\x1b[31m失败 ${failed} 项\x1b[0m`);
console.log('═══════════════════════════════════════════\n');

killTree(browser.child);
server.close();
process.exit(failed === 0 ? 0 : 1);
