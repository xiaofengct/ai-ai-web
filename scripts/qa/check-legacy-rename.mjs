#!/usr/bin/env node
/**
 * ★★ 库名 / 存储键改名迁移的端到端验证（2026-10-05）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么必须做这个测试（而不是"代码看起来很对"）
 * ═══════════════════════════════════════════════════════════════════════════
 * 本次全项目改名把 `DB_NAME` 从 `aiyu-web` 改成 `ai-ai-web`、11 个 localStorage
 * 键从 `aiyu.*` 改成 `ai-ai.*` —— 而**用户数据全在这两者里**：
 * 聊天记录、记忆库、人设卡、表情包、日志。
 *
 * 迁移写错了的后果是**静默的**：
 *   · 少搬一张表 → 那个页签进去是空的（看起来像"数据没了"，其实是没搬）
 *   · 键名映射错 → 用户得重填 API Key（不报错，只是回到默认值）
 *   · 旧库没删 → 占空间，且用户不知道哪个才是真的
 * ⇒ 断言必须是"**模拟老用户升级后，数据真的在新库里**"，而不是"迁移代码被执行过"。
 *
 * ── 造"老用户状态"用**往返法**（第一版栽过的坑，别改回去）──────────────
 * 第一版手写假 payload：`{state:{settings:{baseUrl:'...'}}}`。但真实 settings 结构里
 * 基址在 `providers[]` 内、**没有顶层 `baseUrl`** ⇒ 应用启动时按自己的 schema 归一化，
 * 丢掉不认识的字段、补上缺失字段 ⇒ 断言"新旧值逐字节相同"**必然失败**，
 * 可那是**假数据不对**，不是迁移错了。
 *
 * ⇒ 往返法：先让应用在全新状态跑一次，取它**自己写出的** `ai-ai.*` 值，
 *   改成旧键名 `aiyu.*`，再重载看迁移能否还原。payload 天然符合 schema，断言才有意义。
 *
 * ★ 并且**故意改一个可观测字段**（`darkMode` → `'dark'`，默认为 `'system'`），
 *   这样"迁移成功"与"应用写了默认值"能被区分开 —— 否则可能因为两边都是默认值而假绿。
 *
 * 用法：node scripts/qa/check-legacy-rename.mjs [--dir=dist]
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Cdp, sleep } from './lib/cdp.mjs';
import { PROJECT_ROOT, killTree, startBrowser } from './lib/harness.mjs';

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const DIR = path.resolve(arg('dir', path.join(PROJECT_ROOT, 'dist')));
const PORT = Number(arg('port', 4281));
const DEBUG_PORT = Number(arg('debugPort', 9541));

const OLD_DB = 'aiyu-web';
const NEW_DB = 'ai-ai-web';

/** 旧索引库里的样本行（两张有代表性的表：会话 + 记忆） */
const SAMPLE = {
  sessions: { id: 'legacy-session-1', title: '改名前就有的会话', createdAt: 1, updatedAt: 1, archived: 0 },
  memories: { id: 'legacy-memory-1', sessionId: 'legacy-session-1', content: '改名前就有的记忆', score: 1 },
};

/** 故意改掉、用于区分"迁移成功 vs 默认值"的可观测字段值 */
const MARKER_DARK_MODE = 'dark';

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

const profile = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp', `legacy-rename-${Date.now()}`);
const browser = await startBrowser({ port: DEBUG_PORT, profileDir: profile, freshProfile: true });
const cdp = await Cdp.attach(DEBUG_PORT);
await cdp.enableDomains();
await cdp.send('Network.setBypassServiceWorker', { bypass: true });
const BASE = `http://127.0.0.1:${PORT}`;

const fails = [];
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) fails.push(label);
};

console.log('\n═══ 改名迁移端到端验证 ═══\n');
console.log(`  产物：${DIR}\n`);

/* ── ① 取应用真实写入值 → 改成旧键名 ──────────────────────────────── */
console.log('① 造老用户状态（往返法：取应用真实写入值 → 改成旧键名）');
await cdp.goto(BASE);
await sleep(3400); // 等应用 boot 完成、把默认值写进 ai-ai.*

const seeded = await cdp.evalJs(
  `
  (async () => {
    // 1) 取应用自己写出的新键值（保证 payload 符合真实 schema）
    const written = {};
    for (const k of Object.keys(localStorage)) {
      if (k.indexOf('ai-ai') === 0) written[k] = localStorage.getItem(k);
    }
    if (!written['ai-ai.settings.v1']) return { ok: false, reason: '应用没有写出 ai-ai.settings.v1' };

    // 2) 故意改一个可观测字段：darkMode → 'dark'（默认是 'system'）
    let settings;
    try { settings = JSON.parse(written['ai-ai.settings.v1']); } catch (e) { return { ok: false, reason: 'settings 不是 JSON' }; }
    const s = settings && settings.state && settings.state.settings;
    if (!s || !s.appearance) return { ok: false, reason: 'settings.appearance 结构不符预期' };
    // ★ 真实字段路径是 settings.appearance.darkMode（见 types/settings.ts 的
    //   AppearanceSettings，以及 settingsStore.ts 的 writeThemeSnapshot(settings.appearance)）
    s.appearance.darkMode = ${JSON.stringify(MARKER_DARK_MODE)};

    // 3) 以旧键名写回，并清掉新键（模拟"改名前就存在的数据"）
    const legacy = {};
    for (const [k, v] of Object.entries(written)) legacy['aiyu' + k.slice(5)] = v;
    legacy['aiyu.settings.v1'] = JSON.stringify(settings);
    legacy['aiyu.theme.v1'] = JSON.stringify({ darkMode: ${JSON.stringify(MARKER_DARK_MODE)}, grayscale: false });
    for (const k of Object.keys(written)) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(legacy)) localStorage.setItem(k, v);

    // 4) IndexedDB：建旧库并写样本行
    const openDb = (name, version, upgrade) =>
      new Promise((ok, bad) => {
        const req = indexedDB.open(name, version);
        req.onupgradeneeded = () => upgrade(req.result);
        req.onsuccess = () => ok(req.result);
        req.onerror = () => bad(req.error);
      });
    const db = await openDb(${JSON.stringify(OLD_DB)}, 1, (d) => {
      if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('memories')) d.createObjectStore('memories', { keyPath: 'id' });
    });
    const sample = ${JSON.stringify(SAMPLE)};
    await new Promise((ok, bad) => {
      const tx = db.transaction(['sessions', 'memories'], 'readwrite');
      tx.objectStore('sessions').put(sample.sessions);
      tx.objectStore('memories').put(sample.memories);
      tx.oncomplete = () => ok();
      tx.onerror = () => bad(tx.error);
    });
    db.close();
    return { ok: true, legacyKeys: Object.keys(legacy) };
  })()
`,
  { awaitPromise: true },
);

if (!seeded?.ok) {
  console.log(`\x1b[31m  前置失败：${seeded?.reason ?? '未知'}\x1b[0m\n`);
  killTree(browser.child);
  server.close();
  process.exit(1);
}
console.log(`    以旧键名写入 ${seeded.legacyKeys.length} 个键：${seeded.legacyKeys.join(', ')}`);

/* ── ② 自检：老状态真的造出来了（防"造不出来 ⇒ 迁移没做事 ⇒ 假绿"）── */
const legacyState = await cdp.evalJs(
  `
  (async () => {
    const keys = Object.keys(localStorage).filter((k) => k.indexOf('aiyu') === 0);
    const newLeft = Object.keys(localStorage).filter((k) => k.indexOf('ai-ai') === 0);
    const dbs = (await indexedDB.databases().catch(() => [])).map((d) => d.name);
    return { legacyKeys: keys, newLeft, dbs };
  })()
`,
  { awaitPromise: true },
);
check((legacyState.legacyKeys ?? []).length >= 3, '老 localStorage 键已就位', `${legacyState.legacyKeys?.length ?? 0} 个`);
check((legacyState.newLeft ?? []).length === 0, '新键已清空（确保后面看到的是迁移结果，不是残留）');
check(legacyState.dbs?.includes(OLD_DB), `老索引库 ${OLD_DB} 已就位`, (legacyState.dbs ?? []).join(', '));
if (fails.length > 0) {
  console.log('\n\x1b[31m前置条件没造出来，测试不可信，已中止\x1b[0m\n');
  killTree(browser.child);
  server.close();
  process.exit(1);
}

/* ── ③ 重新加载 ⇒ 触发迁移 ─────────────────────────────────────────── */
console.log('\n② 重新加载页面（触发迁移）');
await cdp.goto(`${BASE}/`);
await sleep(3600); // 等 index.html 内联迁移 + main.tsx 里的 IndexedDB 迁移跑完

/* ── ④ 断言 ─────────────────────────────────────────────────────────── */
console.log('\n③ 断言迁移结果');

const after = await cdp.evalJs(
  `
  (async () => {
    const legacyKeys = Object.keys(localStorage).filter((k) => k.indexOf('aiyu') === 0);

    // ★ 断言"语义保留"而非"逐字节相同"：应用启动后会按自己的 schema 重写 settings
    //   （补默认字段、可能重排键序）—— 那是**正常的持久化行为**，不是迁移失败。
    //   所以判据取"我们故意改过的那个字段值还在不在"。
    let darkMode = null;
    try {
      const s = JSON.parse(localStorage.getItem('ai-ai.settings.v1') || 'null');
      darkMode = s?.state?.settings?.appearance?.darkMode ?? null;
    } catch (e) { /* ignore */ }
    // 主题快照：**必须比较它的值**，不能拿整串 includes('dark') 判 ——
    // 键名就叫 darkMode，整串匹配会**恒真**（第一版就栽在这，是假通过）。
    // ★ 本块是注入进浏览器的模板字符串，**注释里不许出现反引号**，否则会
    //   提前闭合模板串（项目里 check-inject-backticks.mjs 专治这个坑）。
    let themeDarkMode = null;
    try {
      const t = JSON.parse(localStorage.getItem('ai-ai.theme.v1') || 'null');
      themeDarkMode = t?.darkMode ?? null;
    } catch (e) { /* ignore */ }

    const dbs = (await indexedDB.databases().catch(() => [])).map((d) => d.name);

    let rows = null;
    try {
      const db = await new Promise((ok, bad) => {
        const r = indexedDB.open(${JSON.stringify(NEW_DB)});
        r.onsuccess = () => ok(r.result);
        r.onerror = () => bad(r.error);
      });
      const get = (store, key) =>
        new Promise((ok) => {
          if (!db.objectStoreNames.contains(store)) return ok(null);
          const rq = db.transaction(store, 'readonly').objectStore(store).get(key);
          rq.onsuccess = () => ok(rq.result ?? null);
          rq.onerror = () => ok(null);
        });
      rows = {
        session: await get('sessions', ${JSON.stringify(SAMPLE.sessions.id)}),
        memory: await get('memories', ${JSON.stringify(SAMPLE.memories.id)}),
      };
      db.close();
    } catch (e) { rows = { err: String(e) }; }

    return { legacyKeys, darkMode, themeDarkMode, dbs, rows };
  })()
`,
  { awaitPromise: true },
);

check((after.legacyKeys ?? []).length === 0, '旧 localStorage 键已清空', `剩 ${after.legacyKeys?.length ?? '?'} 个`);
check(
  after.darkMode === MARKER_DARK_MODE,
  '★ 迁移的设置被应用接住（darkMode 仍为 dark ⇒ 不是默认值）',
  `darkMode=${JSON.stringify(after.darkMode)}`,
);
check(
  after.themeDarkMode === MARKER_DARK_MODE,
  '主题快照的值已迁移（比的是 darkMode 的值，不是键名）',
  `theme.darkMode=${JSON.stringify(after.themeDarkMode)}`,
);
check(!after.dbs?.includes(OLD_DB), `旧索引库 ${OLD_DB} 已删除`, (after.dbs ?? []).join(', '));
check(after.dbs?.includes(NEW_DB), `新索引库 ${NEW_DB} 已建立`);
check(
  after.rows?.session?.title === SAMPLE.sessions.title,
  '会话数据已迁入新库',
  after.rows?.session ? `title=${JSON.stringify(after.rows.session.title)}` : '未找到',
);
check(
  after.rows?.memory?.content === SAMPLE.memories.content,
  '记忆数据已迁入新库',
  after.rows?.memory ? `content=${JSON.stringify(after.rows.memory.content)}` : '未找到',
);

/* ── ⑤ 幂等：再刷一次不应出错、数据仍在 ─────────────────────────────── */
console.log('\n④ 幂等性（再加载一次）');
await cdp.goto(`${BASE}/`);
await sleep(3200);
const again = await cdp.evalJs(
  `
  (async () => {
    const dbs = (await indexedDB.databases().catch(() => [])).map((d) => d.name);
    let title = null;
    try {
      const db = await new Promise((ok) => {
        const r = indexedDB.open(${JSON.stringify(NEW_DB)});
        r.onsuccess = () => ok(r.result);
      });
      if (db.objectStoreNames.contains('sessions')) {
        title = await new Promise((ok) => {
          const rq = db.transaction('sessions', 'readonly').objectStore('sessions').get(${JSON.stringify(SAMPLE.sessions.id)});
          rq.onsuccess = () => ok(rq.result ? rq.result.title : null);
          rq.onerror = () => ok(null);
        });
      }
      db.close();
    } catch (e) { /* ignore */ }
    return { dbs, title, legacyKeys: Object.keys(localStorage).filter((k) => k.indexOf('aiyu') === 0) };
  })()
`,
  { awaitPromise: true },
);
check(!again.dbs?.includes(OLD_DB), '第二次加载后旧库仍不存在（未被回滚重建）');
check(again.title === SAMPLE.sessions.title, '第二次加载后数据仍在（未被重复迁移破坏）');
check((again.legacyKeys ?? []).length === 0, '第二次加载后仍无旧键（迁移幂等）');

console.log('\n' + '─'.repeat(47));
if (fails.length === 0) {
  console.log('\x1b[32m全部通过：老用户数据无损迁移 ✓\x1b[0m');
} else {
  console.log(`\x1b[31m${fails.length} 项失败：\x1b[0m`);
  for (const f of fails) console.log(`  · ${f}`);
}
console.log('─'.repeat(47) + '\n');

killTree(browser.child);
server.close();
process.exit(fails.length === 0 ? 0 : 1);
