#!/usr/bin/env node
/**
 * 检查 CDP 注入块里的反引号冲突（2026-10-04）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这个坑在一天之内踩了 4 次，所以做成检查
 * ═══════════════════════════════════════════════════════════════════════════
 * 在 `cdp.evalJs(TICK ... TICK)` 的模板字符串里，**注入的 JS 代码内不能再出现反引号** ——
 * 包括**注释里的**（注释也是字符串内容，一样会提前闭合模板串）。
 *
 * 症状：`SyntaxError: missing ) after argument list`，错误**指向 evalJs( 那一行**，
 * 而真正的原因在下面几十行的某个注释里 —— 报错位置与原因位置相距很远，
 * 每次都要重新找一遍。
 *
 * ★ 本脚本自身用 `String.fromCharCode(96)` 表示反引号，避免"检查工具自己中招"。
 *
 * 用法：
 *   node scripts/qa/check-inject-backticks.mjs          检查（退出码 1 = 有冲突）
 *   node scripts/qa/check-inject-backticks.mjs --fix    就地修复
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TICK = String.fromCharCode(96); // 反引号，不用字面量以免自指
const REPLACEMENT = '\u2018'; // 中文左引号，视觉上仍是引用
const DIR = path.resolve('scripts/qa');
const FIX = process.argv.includes('--fix');

/** 找 `cdp.evalJs(` 到独占一行的 `);` 之间的块 */
function findBlocks(lines) {
  const blocks = [];
  // ★ 不用正则 —— 这里要匹配的内容本身含反引号，多层转义极易出错
  //   （第一版用 new RegExp 拼字符串，结果正则自己在转义上出了错）。
  //   `includes` + `endsWith` 足够表达这个模式，且一眼能看懂。
  const openMarker = 'cdp.evalJs(';
  const closeLine = TICK + ');';
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (start === -1) {
      // 形如 `const x = await cdp.evalJs(` 且以反引号结尾（模板串开始）
      if (trimmed.includes(openMarker) && trimmed.endsWith(TICK)) start = i;
      continue;
    }
    if (trimmed === closeLine) {
      blocks.push([start, i]);
      start = -1;
    }
  }
  return blocks;
}

let total = 0;
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.mjs')) continue;
  const full = path.join(DIR, f);
  const lines = readFileSync(full, 'utf8').split('\n');
  let fixed = 0;
  for (const [s, e] of findBlocks(lines)) {
    for (let i = s + 1; i < e; i += 1) {
      if (lines[i].includes(TICK)) {
        lines[i] = lines[i].split(TICK).join(REPLACEMENT);
        fixed += 1;
      }
    }
  }
  if (fixed > 0) {
    total += fixed;
    if (FIX) {
      writeFileSync(full, lines.join('\n'), 'utf8');
      console.log(`  ${FIX ? '已修' : '发现'} ${f}：${fixed} 行`);
    } else {
      console.log(`  ${f}：${fixed} 行有冲突（用 --fix 修）`);
    }
  }
}

if (total === 0) {
  console.log('✓ 没有反引号冲突');
  process.exit(0);
}
console.log(FIX ? `✓ 已修复 ${total} 处` : `✗ 发现 ${total} 处反引号冲突`);
process.exit(FIX ? 0 : 1);
