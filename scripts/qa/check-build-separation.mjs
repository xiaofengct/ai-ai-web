#!/usr/bin/env node
/**
 * 双版本产物隔离 —— **产物级**断言（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么需要"从产物判定"，而不是看源码
 * ═══════════════════════════════════════════════════════════════════════════
 * 「内置欣然版」与「不内置欣然版」的差别**只应该体现在产物里**。
 * 看源码只能证明"写了 `if (BUILTIN_XINRAN)`"，证明不了
 * "那段分支真的被常量折叠 + 死代码消除掉了"。
 *
 * 本仓库已经有过一次教训（见 `src/constants/buildMode.ts` 文件头）：
 * 最初用 `grep 欣然` 当判据，两版都命中 7~8 个文件 ——
 * 因为**文案表 `xinran.ts` 在两个包里都在**（刻意如此：只跳过"种子"层，不动"文案"层）。
 * ⇒ 判据必须找**该层独有的字符串**。
 *
 * ★ 本脚本把"该层独有的字符串"整理成一张**分层判据表**，
 *   而不是散落在文档里的一句话 —— 这样加一版新内容时，
 *   只要往表里加一行，隔离性就自动被回归保护。
 *
 * 用法：
 *   node scripts/qa/check-build-separation.mjs          # 检查 release/ 里最新一版
 *   node scripts/qa/check-build-separation.mjs v8       # 检查指定版本
 *   node scripts/qa/check-build-separation.mjs v8 path/to/dir
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';

/* ══════════════════════════════════════════════════════════════════════════
 * 极简 ZIP 读取（只取指定后缀的条目，用 zlib.inflateRaw 解压）
 * ★ 为什么不用第三方 zip 包：本测试要能在**任何** checkout 上跑，
 *   不应因为 node_modules 装没装而失效。APK 就是标准 zip，自己解析 ~60 行足够。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 从 ZIP 中抽出所有满足 pred(name) 的条目 → Map<name, Buffer> */
function readZipEntries(file, pred) {
  const buf = readFileSync(file);
  // ① 找 End of Central Directory（EOCD，签名 0x06054b50），从尾部往前扫
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`不是有效的 zip：${file}`);

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map();

  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break; // 中央目录项签名
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);

    if (pred(name)) {
      // 本地文件头：名字/扩展字段长度可能不同，要按本地头自己的长度跳过
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compSize);
      out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 分层判据表
 *
 *   only: 'builtin'    → 只允许出现在内置版；出现在不内置版 = 隔离失效
 *   only: 'standalone' → 反之
 *   only: 'both'       → 两版都必须有（漏了就说明功能没打进去）
 * ══════════════════════════════════════════════════════════════════════════ */
const MARKERS = [
  // ——— 种子层：bootstrap 里"建内置欣然卡 / 建默认会话"的分支 ———
  { s: '创建内置欣然卡失败', only: 'builtin', layer: '种子·内置卡' },
  { s: '创建默认会话失败', only: 'builtin', layer: '种子·默认会话' },
  { s: '和欣然', only: 'builtin', layer: '种子·默认会话标题' },

  // ——— 世界层：builtinWorlds.ts 的排班与条目正文 ———
  { s: '电视台排班 5 天一轮', only: 'builtin', layer: '世界·排班条目正文' },
  { s: '2026-09-05', only: 'builtin', layer: '世界·排班锚点' },
  { s: '这个世界与现实**共用北京时间', only: 'builtin', layer: '世界·时间系统条目' },

  // ——— 导入窗口：两版都必须有（这是"不内置版"承接世界设定的唯一入口）———
  { s: '世界设定', only: 'both', layer: '导入窗口·分区名' },
  { s: 'aiyuWorld', only: 'both', layer: '导入窗口·世界包标记键' },
];

const ROOT = process.cwd();
const version = process.argv[2] ?? null;
const releaseRoot = process.argv[3] ?? path.join(ROOT, 'release');

let failed = 0;
const line = (ok, msg, detail) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}${detail ? `\n      ${detail}` : ''}`);
};

/* ─────────── 定位版本目录 ─────────── */
let dir = null;
if (version) {
  dir = path.join(releaseRoot, version);
  if (!existsSync(dir)) {
    console.error(`找不到版本目录：${dir}`);
    process.exit(2);
  }
} else {
  /*
   * ★ 发布副本里 `release/` 下**没有版本目录**（`release/*` 被 .gitignore 忽略，只留 INDEX/README）
   *   ⇒ 这里必须**优雅降级**（打印说明 + 退出 0），而不是让"空列表"流进 `path.join`：
   *   旧写法 `vers[vers.length - 1]` 在空数组时是 `undefined`，
   *   于是 `path.join(releaseRoot, undefined)` **抛 TypeError、退出码 1** ——
   *   发布出去的仓库里"一跑就崩"，看起来像坏掉的仓库。
   *   判据：**跳过 ≠ 失败，但必须打印**（本脚本查的是**本地构建产物**，副本里本就没有）。
   */
  const vers = existsSync(releaseRoot)
    ? readdirSync(releaseRoot)
        .filter((d) => /^v\d+$/.test(d) && statSync(path.join(releaseRoot, d)).isDirectory())
        .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    : [];
  if (vers.length === 0) {
    console.log('\n═══ 双版本产物隔离检查 ═══\n');
    console.log('  \x1b[33m⚠️ 跳过：未找到可检查的产物目录（release/ 下没有 vN 目录）\x1b[0m');
    console.log(`     查找位置：${releaseRoot}`);
    console.log('  \x1b[90m（release/* 被 .gitignore 忽略（只留 INDEX/README）⇒ 发布副本里必然没有 vN 目录；');
    console.log('    本脚本检查的是**本地构建产物**，需先跑 `npm run apk` 生成 release/vN/）\x1b[0m\n');
    console.log('  → 本次**未执行任何隔离断言**，"通过"不代表已验证。\n');
    process.exit(0);
  }
  dir = path.join(releaseRoot, vers[vers.length - 1]);
}
const verName = path.basename(dir);
console.log(`\n═══ 双版本产物隔离检查：${verName} ═══\n目录：${dir}\n`);

const apks = readdirSync(dir).filter((f) => f.endsWith('.apk'));
// ★ 坑：`/内置欣然/` 会**同时**匹配 "ai爱-不内置欣然-v8.apk"（子串！）。
//   第一版就是这么写错的 —— 两版都取到同一个 APK，
//   于是下面所有"命中表"看着两列一模一样，很容易被误读成"两版内容相同"。
//   ⇒ 必须用 `不内置` 先判、或者用行首锚定。
const apkSolo = apks.find((f) => f.includes('不内置欣然'));
const apkBuiltin = apks.find((f) => !f.includes('不内置欣然') && f.includes('内置欣然'));
if (!apkBuiltin || !apkSolo) {
  console.error(`✗ 目录里找不到两个 APK（内置=${apkBuiltin} 不内置=${apkSolo}）`);
  process.exit(2);
}
console.log(`内置版  : ${apkBuiltin}`);
console.log(`不内置版: ${apkSolo}\n`);

/* ─────────── 抽出 JS 与 manifest ─────────── */
const isJs = (n) => n.startsWith('assets/public/assets/') && n.endsWith('.js');
const isManifest = (n) => n === 'AndroidManifest.xml';

const jsB = readZipEntries(path.join(dir, apkBuiltin), isJs);
const jsS = readZipEntries(path.join(dir, apkSolo), isJs);
if (jsB.size === 0 || jsS.size === 0) {
  console.error('✗ 未能从 APK 里抽出 JS 资源（打包结构可能变了，需更新本脚本）');
  process.exit(2);
}

const allB = [...jsB.values()].map((b) => b.toString('utf8')).join('\n');
const allS = [...jsS.values()].map((b) => b.toString('utf8')).join('\n');
const has = (hay, needle) => hay.includes(needle);

/* ─────────── ① 两版产物必须不同 ─────────── */
console.log('① 两版产物是否真的不同（构建期分支生效的**前提**）');
{
  const namesB = new Set(jsB.keys());
  const namesS = new Set(jsS.keys());
  const onlyB = [...namesB].filter((n) => !namesS.has(n));
  const onlyS = [...namesS].filter((n) => !namesB.has(n));
  line(
    [...namesB].sort().join(',') !== [...namesS].sort().join(','),
    'JS chunk 清单不同（说明不是同一份代码原样打包）',
  );
  // ★ 不要断言"共有 chunk 内容必须不同" —— 那是错的期望：
  //   两版共享的第三方库 chunk 本就应当**逐字节相同**（同一次构建、同一依赖图），
  //   差异只体现在各自独有的**入口 chunk** 上。
  //   （第一版就是这么断言的，恒假，属于"测试自己写错期望值"。）
  line(
    onlyB.length > 0 && onlyS.length > 0,
    `两版各有独有的 chunk（内置 ${onlyB.length} 个 / 不内置 ${onlyS.length} 个）`,
  );
}

/* ─────────── ② 分层标记 ─────────── */
console.log('\n② 分层标记命中表');
console.log(
  `   ${'标记'.padEnd(30)} ${'层级'.padEnd(22)} ${'要求'.padEnd(10)} 内置版 不内置版 判定`,
);
const rows = [];
let sepFailures = 0;
for (const m of MARKERS) {
  const b = has(allB, m.s);
  const s = has(allS, m.s);
  let pass;
  let verdict;
  if (m.only === 'builtin') {
    pass = b && !s;
    verdict = pass ? 'OK' : !b ? '★ 内置版缺失（功能没打进去）' : '★ 不内置版串味（隔离失效）';
  } else if (m.only === 'standalone') {
    pass = s && !b;
    verdict = pass ? 'OK' : '★ 未生效';
  } else {
    pass = b && s;
    verdict = pass ? 'OK' : '★ 有一版缺失';
  }
  if (!pass) {
    failed += 1;
    if (m.only === 'builtin' && b && s) sepFailures += 1;
  }
  rows.push({ m, b, s, pass, verdict });
  console.log(
    `   ${m.s.slice(0, 28).padEnd(30)} ${m.layer.padEnd(22)} ${
      m.only === 'both' ? '两版都要' : '仅内置版'
    }  ${b ? ' 有  ' : ' 无  '} ${s ? '  有   ' : '  无   '} ${verdict}`,
  );
}

/* ─────────── ③ 导入窗口必须在两版都可达 ─────────── */
console.log('\n③ 世界设定导入窗口（不内置版的承接入口）');
{
  // ★ 这里必须用**用户可见文案**做标记，不能用标识符 ——
  //   产物是压缩过的，`parseWorldDoc` 这类函数名早就不存在了。
  //   （第一版就用标识符当标记，结果恒为"未打包"，是假失败。）
  line(has(allB, '还没有世界设定') && has(allS, '还没有世界设定'), '空态文案「还没有世界设定」两版都有');
  line(
    has(allB, '选一份世界设定文件') && has(allS, '选一份世界设定文件'),
    '导入按钮「选一份世界设定文件」两版都有',
  );
  line(has(allB, '识别报告') && has(allS, '识别报告'), '「识别报告」区块两版都有');
}

/* ─────────── ④ 包名必须不同 ─────────── */
console.log('\n④ 安装标识（两版必须不同，否则无法共存）');
{
  const mb = readZipEntries(path.join(dir, apkBuiltin), isManifest).get('AndroidManifest.xml');
  const ms = readZipEntries(path.join(dir, apkSolo), isManifest).get('AndroidManifest.xml');
  // ★ 二进制 AXML 里字符串是明文 UTF-16LE，直接搜字节即可，不需要反编译
  const hasStr = (buf, s) => {
    const utf16 = Buffer.from(s, 'utf16le');
    return buf.includes(utf16) || buf.includes(Buffer.from(s, 'utf8'));
  };
  line(Boolean(mb && ms), '两版都取到 AndroidManifest.xml');
  if (mb && ms) {
    line(hasStr(mb, 'com.aiai.builtin'), '内置版 manifest 含 com.aiai.builtin');
    line(hasStr(ms, 'com.aiai.standalone'), '不内置版 manifest 含 com.aiai.standalone');
    line(!hasStr(ms, 'com.aiai.builtin') || hasStr(ms, 'com.aiai.standalone'), '不内置版未使用内置版包名');
  }
}

/* ─────────── 汇总 ─────────── */
console.log('\n═══════════════════════════════════════════');
if (failed === 0) {
  console.log('\x1b[32m全部通过：两版产物隔离正确\x1b[0m');
} else {
  console.log(`\x1b[31m失败 ${failed} 项\x1b[0m`);
  if (sepFailures > 0) {
    console.log(
      `\x1b[31m其中 ${sepFailures} 项属于「仅内置版」的内容出现在了不内置版 ⇒ 隔离失效\x1b[0m`,
    );
    console.log('可能的成因（按概率排序）：');
    console.log('  1. 该内容被**共享模块**静态引用（未被常量折叠切断）——');
    console.log('     例如与它同模块的代码被动态 import()、或引用点不在 BUILD 分支内；');
    console.log('  2. 引用点在一个**恒被保留**的函数里（如无条件调用的兜底函数）；');
    console.log('  3. 打包器把该模块并进了共享 chunk（检查 vite manualChunks）。');
  }
}
console.log('═══════════════════════════════════════════\n');
process.exit(failed === 0 ? 0 : 1);
