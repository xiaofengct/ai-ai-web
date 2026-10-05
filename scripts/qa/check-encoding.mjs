#!/usr/bin/env node
/**
 * 验证文本编码探测：UTF-8 不被误判、GBK 能被正确识别。
 *
 * ★ 为什么必须双侧断言（只测一侧就是自欺）：
 *   - 只测"GBK 能读" ⇒ 可能把 UTF-8 也强行当 GBK 解（过度修正，把好文件读坏）；
 *   - 只测"UTF-8 能读" ⇒ 就是修之前的状态。
 *   所以样本里**必须同时有** UTF-8 与 GBK，且断言各自解出**完全正确**的内容。
 *
 * ★ 为什么断言"逐字符相等"而不是"不含乱码"：
 *   "不含乱码"太弱（空字符串也满足）。要的是解出的内容与原文**一模一样**。
 *
 * ★ 样本取自真实导出格式（微信记录的形状），不是 `"你好"` 这种玩具串 ——
 *   真实记录里有中英混排、标点、时间戳，才能暴露编码边界问题。
 *
 * 用法：npx tsx scripts/qa/check-encoding.mjs
 */
const CASES_UTF8 = [
  {
    name: '微信记录（UTF-8，含中英混排与时间戳）',
    text: '小美 2026-10-01 12:33\n今天好累啊…\n我: 那就早点睡\n小美: OK 晚安 🌙\n',
  },
  { name: '纯中文', text: '你好，世界' },
  { name: '带 BOM 的 UTF-8', text: '\uFEFF你好，世界' },
  { name: 'ASCII（最常见，不能触发误判）', text: 'hello world 12345' },
  { name: 'emoji（4 字节 UTF-8，最容易被 GBK 误判）', text: '🌙🦊🎉 晚安' },
];

/** 真实 GBK 字节：用 Node 的 iconv 能力造不出来，手写关键样本的字节 */
const CASES_GBK = [
  {
    name: 'GBK 中文（你好）',
    // '你好' 的 GBK
    bytes: [0xc4, 0xe3, 0xba, 0xc3],
    expect: '你好',
  },
  {
    name: 'GBK 微信记录一行（"小美: 晚安"）',
    // 小=D0A1 美=C3C0 : =3A 空格 20 晚=CDED 安=B0B2
    bytes: [0xd0, 0xa1, 0xc3, 0xc0, 0x3a, 0x20, 0xcd, 0xed, 0xb0, 0xb2],
    expect: '小美: 晚安',
  },
  {
    name: 'GBK 混 ASCII（时间戳 + 中文）',
    // "2026-10-01 " + 你(C4E3)好(BAC3)
    bytes: [0x32, 0x30, 0x32, 0x36, 0x2d, 0x31, 0x30, 0x2d, 0x30, 0x31, 0x20, 0xc4, 0xe3, 0xba, 0xc3],
    expect: '2026-10-01 你好',
  },
];

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const { decodeTextBytes } = await import('../../src/lib/encoding.ts');
if (typeof decodeTextBytes !== 'function') {
  console.error('无法从 src/lib/encoding.ts 取到 decodeTextBytes');
  process.exit(1);
}
console.log('\n═══ 文本编码探测验证 ═══');
console.log('  （被测对象：src/lib/encoding.ts 的 decodeTextBytes）\n');

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

console.log('── 甲组：UTF-8 必须被正确识别（不得误判成 GBK）──');
for (const c of CASES_UTF8) {
  const bytes = enc.encode(c.text);
  const r = decodeTextBytes(bytes);
  // 带 BOM 的那条，期望值本身就是"去了 BOM 之后"的文本
  const expect = c.text.charCodeAt(0) === 0xfeff ? c.text.slice(1) : c.text;
  check(`${c.name}｜内容逐字符相等`, r.text === expect, r.text === expect ? `encoding=${r.encoding}` : `解出 ${JSON.stringify(r.text.slice(0, 30))}`);
  check(`${c.name}｜未误判为 GBK`, r.switched === false, r.switched ? '被误判成 GBK' : '');
  check(`${c.name}｜无残留乱码`, r.replacements === 0, `replacements=${r.replacements}`);
}

console.log('\n── 乙组：GBK 必须被正确识别（修之前这里是乱码）──');
for (const c of CASES_GBK) {
  const bytes = Uint8Array.from(c.bytes);
  // 先证明"修之前会坏"：UTF-8 硬解确实出乱码（否则这组样本没有说服力）
  const naive = dec.decode(bytes);
  const naiveBad = naive.includes('\uFFFD');
  const r = decodeTextBytes(bytes);
  check(`${c.name}｜UTF-8 硬解确实会坏（证明样本有效）`, naiveBad, `UTF-8 硬解 → ${JSON.stringify(naive)}`);
  check(`${c.name}｜探测后内容正确`, r.text === c.expect, `解出 ${JSON.stringify(r.text)}（期望 ${JSON.stringify(c.expect)}）`);
  check(`${c.name}｜已切换到 GBK`, r.switched === true, `encoding=${r.encoding}`);
  check(`${c.name}｜无残留乱码`, r.replacements === 0, `replacements=${r.replacements}`);
}

console.log('\n── 丙组：边界 ──');
{
  const r = decodeTextBytes(new Uint8Array(0));
  check('空文件不抛错', r.text === '', `解出 ${JSON.stringify(r.text)}`);
}
{
  // 混入非法字节：UTF-8 与 GBK 都解不干净 ⇒ 应取更优者且如实报告剩余乱码
  const bytes = Uint8Array.from([0xc4, 0xe3, 0xba, 0xc3, 0xff, 0xfe, 0xfd]);
  const r = decodeTextBytes(bytes);
  check('部分非法字节时仍返回结果（不抛）', typeof r.text === 'string' && r.text.length > 0, `encoding=${r.encoding} replacements=${r.replacements}`);
  check('部分非法字节时保留了正确的中文', r.text.includes('你好'), `解出 ${JSON.stringify(r.text)}`);
}

console.log(`\n═══ ${failed === 0 ? '全部通过' : `${failed} 项失败`} ═══\n`);
process.exit(failed === 0 ? 0 : 1);
