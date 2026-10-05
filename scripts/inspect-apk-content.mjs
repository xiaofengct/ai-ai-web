/** 静态检查两个 APK 的 JS 产物里是否包含关键功能字符串。
 *
 * ★ 为什么不 grep「欣然」：文案表在**两个版本里都存在**（我们只条件化"种子分支"，
 *   没有条件化文案表），所以 grep 欣然 两版都命中，区分不了版本。
 *   详见 src/constants/buildMode.ts 头部注释。
 *
 * 这里查的是**功能可用性**，不是版本隔离：
 *   - 「无角色引导」文案在不在 → 不内置版首启有没有出路
 *   - 「导入人设」动作在不在   → 用户唯一能自救的按钮
 * 两版都该有（内置版也有，只是走不到那条分支）。
 */
import { readFileSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

function openZip(fp) {
  const fd = openSync(fp, 'r');
  const size = fstatSync(fd).size;
  const tailLen = Math.min(size, 65557);
  const tail = Buffer.alloc(tailLen);
  readSync(fd, tail, 0, tailLen, size - tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
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
    const method = cd.readUInt16LE(p + 10);
    const compSize = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localOffset = cd.readUInt32LE(p + 42);
    entries.push({ name: cd.toString('utf8', p + 46, p + 46 + nameLen), method, compSize, localOffset });
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

const CHECKS = [
  ['无角色引导文案', '这里还没有人'],
  ['空态引导·导入人设', '导入人设'],
  ['空态 rail 文案', '还没有角色'],
  ['无角色聊天拦截', '先导一个进来'],
  ['向导·第2步(solo)', '放一个角色进来'],
  // ★ 用「能穿透压缩的字面量」验证代码真的进了包：
  //   函数名会被 minify 掉，但日志/文案字符串会原样保留。
  //   `基础信息提交失败` 是 QA 修 slug 唯一性时新增的 log.warn 文案（StepIntake.tsx）。
  ['[修复] 蒸馏提交失败提示', '基础信息提交失败'],
];

for (const apk of process.argv.slice(2)) {
  console.log(`\n═══ ${apk} ═══`);
  const z = openZip(apk);
  try {
    const js = z.entries.filter(
      (e) => e.name.startsWith('assets/public/assets/') && e.name.endsWith('.js'),
    );
    let all = '';
    for (const e of js) {
      try { all += readEntry(z, e).toString('utf8'); } catch { /* 跳过坏条目 */ }
    }
    console.log(`  合并 ${js.length} 个 chunk，共 ${(all.length / 1024).toFixed(0)} KB`);
    for (const [label, needle] of CHECKS) {
      console.log(`  ${all.includes(needle) ? '✓' : '✗'} ${label}：${JSON.stringify(needle)}`);
    }
    // 入口完整性
    const hasIndex = z.entries.some((e) => e.name === 'assets/public/index.html');
    const cfgE = z.entries.find((e) => e.name === 'assets/capacitor.config.json');
    const cfg = cfgE ? readEntry(z, cfgE).toString('utf8').replace(/\s+/g, ' ') : '(缺失)';
    console.log(`  ${hasIndex ? '✓' : '✗'} assets/public/index.html`);
    console.log(`  capacitor.config.json → ${cfg}`);
    // 入口引用的 chunk 是否真的存在于包内（漏打 chunk = 白屏，且静态分析看不出来）
    const idxE = z.entries.find((e) => e.name === 'assets/public/index.html');
    if (idxE) {
      const html = readEntry(z, idxE).toString('utf8');
      const refs = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => `assets/public/${m[1]}`);
      const missing = refs.filter((r) => !z.entries.some((e) => e.name === r));
      console.log(`  index.html 引用 ${refs.length} 个资源，缺失 ${missing.length} 个${missing.length ? '：' + missing.join(', ') : ' ✓'}`);
    }
  } finally {
    closeSync(z.fd);
  }
}
