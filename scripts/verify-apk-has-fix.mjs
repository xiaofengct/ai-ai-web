#!/usr/bin/env node
/**
 * 证明「APK 里的产物确实包含某次源码改动」—— 用**能穿透混淆**的字面量核对。
 *
 * ★ 为什么需要这个脚本（本轮教训，队规 O 的落地）：
 *   本轮 APK 反复"打早"了三次（13:13 → 13:39 → 14:02），每次都是
 *   「我以为改完了，其实最后一个改动者在我之后」。而**看文件时间戳不足以下结论** ——
 *   时间戳只能说明"重新构建过"，不能说明"改动进去了"。
 *
 * ★ 为什么不能靠函数名或变量名：minify 会把它们全改掉
 *   （`pickCurrentId` → `t`、局部变量 → `k/v/p`），grep 函数名必然 0 命中，
 *   会把"已修复"误判成"没修复"。**必须挑在混淆后仍然原样保留的东西**：
 *   日志文案、用户可见字符串、以及**保留字**（如 `.finally(`）。
 *
 * ★ 本脚本把「期望/不期望」写成可复核的判据，而不是让我凭印象看 grep 结果。
 */
import { closeSync, openSync, readFileSync, readSync, fstatSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

function openZip(fp) {
  const fd = openSync(fp, 'r');
  const size = fstatSync(fd).size;
  const tailLen = Math.min(size, 65557);
  const tail = Buffer.alloc(tailLen);
  readSync(fd, tail, 0, tailLen, size - tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOff = tail.readUInt32LE(eocd + 16);
  const cd = Buffer.alloc(cdSize);
  readSync(fd, cd, 0, cdSize, cdOff);
  const entries = [];
  let p = 0;
  for (let i = 0; i < count; i += 1) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    entries.push({
      name: cd.toString('utf8', p + 46, p + 46 + nameLen),
      method: cd.readUInt16LE(p + 10),
      compSize: cd.readUInt32LE(p + 20),
      localOffset: cd.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { fd, entries };
}

function readEntry(zip, e) {
  const lh = Buffer.alloc(30);
  readSync(zip.fd, lh, 0, 30, e.localOffset);
  const start = e.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  const raw = Buffer.alloc(e.compSize);
  if (e.compSize) readSync(zip.fd, raw, 0, e.compSize, start);
  return e.method === 8 ? inflateRawSync(raw) : raw;
}

/** 判据表：每项 { name, files, must, mustNot, note } */
const CHECKS = [
  {
    name: '蒸馏 slug 修复（QA 加的 log 文案）',
    files: /\.js$/,
    must: ['基础信息提交失败'],
    note: 'log.warn 的文案，混淆后原样保留',
  },
  {
    name: '种子失败路径修复（App.tsx 改 .finally）',
    files: /^assets\/public\/assets\/index-.*\.js$/,
    must: ['.finally('],
    note: '`finally` 是 JS 保留字，minify 不会改',
  },
  {
    name: '不内置版引导（我加的文案）',
    files: /\.js$/,
    must: ['这里还没有人', '导入人设'],
    note: '用户可见文案',
  },
];

for (const apk of process.argv.slice(2)) {
  console.log(`\n═══ ${apk} ═══`);
  const zip = openZip(apk);
  try {
    const js = zip.entries.filter(
      (e) => e.name.startsWith('assets/public/assets/') && e.name.endsWith('.js'),
    );
    /** 逐文件读出来缓存，避免重复解压 */
    const cache = new Map();
    const bodyOf = (e) => {
      if (!cache.has(e.name)) {
        try { cache.set(e.name, readEntry(zip, e).toString('utf8')); } catch { cache.set(e.name, ''); }
      }
      return cache.get(e.name);
    };

    for (const c of CHECKS) {
      const pool = js.filter((e) => c.files.test(e.name.replace(/^assets\/public\//, 'assets/public/')));
      const hits = new Map();
      for (const e of pool) {
        const b = bodyOf(e);
        for (const needle of c.must) {
          if (b.includes(needle)) hits.set(needle, (hits.get(needle) ?? 0) + 1);
        }
      }
      const missing = c.must.filter((m) => !hits.has(m));
      const ok = missing.length === 0;
      console.log(
        `  ${ok ? '✓' : '✗'} ${c.name}${ok ? '' : ` — 缺 [${missing.join(', ')}]`}` +
          `${c.note ? `  （${c.note}）` : ''}`,
      );
    }

    // 额外：HomePage 的整页引导判据不应再带「会话 loading」那道门闩。
    //
    // ★ minify 后观察到的**真实形态**（拿两种产物各跑一次得出的，别再凭猜写正则）：
    //     修复前：`return !k && v && p.length === 0`   ← 3 个条件，首项带取反
    //     修复后：`return v && p.length === 0`          ← 2 个条件，无取反
    //   （`k` = 会话 loading、`v` = personasHydrated、`p` = personas；字母会变，但**项数与取反**不变）
    //
    // ★ 第一版这里写错过：我用 `/[!&|()\w$]{0,24}length===0/` 取上下文，
    //   而 `.` 不在字符类里 ⇒ 匹配从 `length` 才开始，前面的 `!k&&v&&p.` 全被丢掉
    //   ⇒ 在**旧产物上也会报 ✓**，是空转的假绿。改成显式取 34 字符上下文（`.` 匹配任意字符）。
    const home = js.find((e) => /HomePage-.*\.js$/.test(e.name));
    if (home) {
      const b = bodyOf(home);
      // 所有 `.length===0` 处的前 34 字符上下文
      const ctx = [...b.matchAll(/.{34}length===0/g)].map((x) => x[0]);
      // 引导判据的形态：`return <w>&&<w>.length===0`
      const gate = ctx.find((f) => /return\s*\w+&&\w+\.length===0$/.test(f));
      // 旧形态：`return !<w>&&<w>&&<w>.length===0`（首项带取反）
      const legacy = ctx.find((f) => /return\s*!\w+&&\w+&&\w+\.length===0$/.test(f));
      const ok = Boolean(gate) && !legacy;
      console.log(
        `  ${ok ? '✓' : '✗'} HomePage 引导判据已去掉「会话 loading」门闩`,
      );
      console.log(`      实际形态：${gate ? JSON.stringify(gate) : '（未匹配到引导判据，判据可能已改写，需人工复核）'}`);
      if (legacy) console.log(`      ✗ 发现旧形态（3 条件带取反）：${JSON.stringify(legacy)}`);
    } else {
      console.log('  – 未找到 HomePage chunk（跳过）');
    }
  } finally {
    closeSync(zip.fd);
  }
}
