#!/usr/bin/env node
/**
 * 验证二维码渲染：内容 → 二维码 → **解回原内容**。
 *
 * ★ 为什么不满足于"画出来了"：
 *   本次要修的 bug 恰恰是「看着是图片、其实是 HTML」。要证明真修好，必须做到
 *   **双向**：把生成出来的二维码**解码**，断言解出的字符串 === 输入内容。
 *   只断言"`<img>` 有 src"是不够的 —— 一张纯色图也有 src。
 *
 * ★ 为什么用真实内容做输入：
 *   输入取自**实测**的 `get_bot_qrcode` 响应（不是编的字符串），
 *   长度与字符集与线上一致（长 URL + 查询参数），能暴露容量/纠错级别相关问题。
 *
 * 解码器：`jsqr` 是纯 JS 的二维码解码库（devDependency），避免引入原生依赖。
 * 若解码库缺失，脚本会明确报「无法解码」并**以非 0 退出**（不静默降级成"只验格式"）。
 *
 * 用法：node scripts/qa/check-qrcode.mjs
 */
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);

/** 实测样本：来自 `POST /ilink/bot/get_bot_qrcode?bot_type=3` 的真实响应 */
const REAL_SAMPLE =
  'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=81f78b83ec6dc1690a7972aa3434b851&bot_type=3';

const CASES = [
  { name: '实测样本（真实长度与字符集）', content: REAL_SAMPLE },
  { name: '另一个 qrcode 值（确认非特例）', content: REAL_SAMPLE.replace('81f78b83ec6dc1690a7972aa3434b851', 'bc9c61163852cb59957cb546eeac9d24') },
];

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/** 从 dataURL 解出 PNG 像素信息 */
function decodePng(dataUrl) {
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const png = PNG.sync.read(Buffer.from(b64, 'base64'));
  return png;
}

/** 用 jsQR 解码 RGBA 像素 */
function decodeQr(png) {
  let jsQR;
  try {
    jsQR = require('jsqr');
  } catch {
    return { error: 'jsqr 未安装（npm i -D jsqr）' };
  }
  const fn = typeof jsQR === 'function' ? jsQR : jsQR.default;
  if (typeof fn !== 'function') return { error: 'jsqr 导出形状异常' };
  const result = fn(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!result || typeof result.data !== 'string') return { error: '解码失败（图里没找到二维码）' };
  return { text: result.data };
}

console.log('\n═══ 二维码渲染验证（内容 → 二维码 → 解码回内容）═══\n');

// 动态 import 我们的实现 —— 走**产品代码本身**，不是重写一遍逻辑
// ★ 直接 import **产品源码**（本脚本用 tsx 执行，会即时编译 TS）。
//   不要在这里重写一遍逻辑 —— 那样验的是脚本自己，不是产品。
const mod = await import('../../src/ilink/qrcode.ts');
const renderQrDataUrl = mod.renderQrDataUrl ?? mod.default;
if (typeof renderQrDataUrl !== 'function') {
  console.error('无法从 src/ilink/qrcode.ts 取到 renderQrDataUrl');
  process.exit(1);
}
console.log('  （被测对象：src/ilink/qrcode.ts 的 renderQrDataUrl）\n');

for (const c of CASES) {
  console.log(`── ${c.name} ──`);
  console.log(`   内容长度 ${c.content.length} 字符`);
  let dataUrl;
  try {
    dataUrl = await renderQrDataUrl(c.content);
  } catch (e) {
    check('生成二维码', false, e.message);
    continue;
  }

  check('产出 data:image/png;base64', dataUrl.startsWith('data:image/png;base64,'), dataUrl.slice(0, 30));

  let png;
  try {
    png = decodePng(dataUrl);
  } catch (e) {
    check('是合法 PNG', false, e.message);
    continue;
  }
  check('是合法 PNG', true, `${png.width}×${png.height}`);

  // ★ 关键断言：解回原内容。这一步才真正证明「扫得出来」。
  const dec = decodeQr(png);
  if (dec.error) {
    check('解码回原内容', false, dec.error);
  } else {
    check('解码回原内容（逐字符相等）', dec.text === c.content, dec.text === c.content ? '一致' : `解出 ${dec.text.slice(0, 60)}…`);
  }

  // 顺带确认：**不是**把 HTML 当图片（原 bug 的形态）
  check('不是 HTML 文本（原 bug 形态）', !/^\s*<(!doctype|html)/i.test(dataUrl), '');
}

console.log(`\n═══ ${failed === 0 ? '全部通过' : `${failed} 项失败`} ═══\n`);
process.exit(failed === 0 ? 0 : 1);
