#!/usr/bin/env node
/**
 * 生成内置表情包的**图片资源**（2026-10-04）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么需要它（问题到底出在哪）
 * ═══════════════════════════════════════════════════════════════════════════
 * 「AI 发不出表情包」的**首要原因**不是模型、也不是 API，而是：
 *
 *   `public/stickers/placeholder/` 里**只有 `custom_stickers.json`，一个 PNG 都没有**。
 *
 * 于是 `PLACEHOLDER_STICKERS` 的 12 条全是 `{description, fileName}`、
 * **没有 `assetId`** ⇒ `stickerRepo.matchByDescription()` 能找到匹配项，
 * 但 `pickStickerForText()` 发现 `item.assetId` 为空 ⇒ 返回 `undefined` ⇒ 不配图。
 * 这就是为什么"表情匹配逻辑写着，实际一张都发不出来"。
 *
 * ── 生成的图长什么样、为什么这样做 ─────────────────────────────────────
 * 用**彩色圆角底 + 大号 emoji** 渲染成 240×240 的 PNG。
 *
 * ★ 为什么不用"更漂亮"的方案（真去画 12 只猫）：
 *   本脚本要能**在 CI 里重现**，不能依赖设计稿或手工素材。
 *   用系统 emoji 字体 + canvas 渲染 = 完全可复现、零外部依赖、零版权问题。
 *   （自己画的卡通形象反而会引入字体/素材授权问题。）
 *
 * ★ 定位要诚实：这 12 张是**占位素材**，作用是"让功能开箱可用、链路可验证"。
 *   它会显示在用户的第一屏，所以得看得过去（彩色底 + 大 emoji 已达到这个标准），
 *   但**不假装**它是精心设计的表情包 —— 用户随时可以导入自己的（设置 → 表情包）。
 *
 * ── 怎么渲染的 ──────────────────────────────────────────────────────────
 * 走项目既有的 CDP 通路（`scripts/qa/lib/harness.mjs`）：起 Edge → 在页面里
 * 用 `<canvas>` 画 emoji → `toDataURL()` → Node 侧解码写成 PNG。
 * ★ 不引入 `canvas` / `sharp` 这类需要原生编译的依赖：
 *   它们会让"生成静态资源"这一步在换机器后装不上，而资源生成本该是**零门槛**的。
 *
 * 用法：node scripts/gen-sticker-assets.mjs
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, startBrowser, killTree } from './qa/lib/harness.mjs';
import { Cdp, sleep } from './qa/lib/cdp.mjs';

/** 12 条与 `db/bootstrap.ts` 的 `PLACEHOLDER_STICKERS` **必须一一对应** */
const STICKERS = [
  { fileName: 'sticker_01.png', description: '喵', emoji: '🐱', bg: '#FFD6E0' },
  { fileName: 'sticker_02.png', description: '惊', emoji: '😱', bg: '#FFE9B0' },
  { fileName: 'sticker_03.png', description: '咬你', emoji: '😾', bg: '#FFC9C9' },
  { fileName: 'sticker_04.png', description: '嘤嘤嘤', emoji: '🥺', bg: '#CDE4FF' },
  { fileName: 'sticker_05.png', description: '抱着', emoji: '🤗', bg: '#FFD9C0' },
  { fileName: 'sticker_06.png', description: '贴', emoji: '😽', bg: '#FFCFE3' },
  { fileName: 'sticker_07.png', description: '噗', emoji: '😝', bg: '#FFF3BF' },
  { fileName: 'sticker_08.png', description: '生无可恋', emoji: '😑', bg: '#D8DEE9' },
  { fileName: 'sticker_09.png', description: '躲在被子后', emoji: '🛌', bg: '#C9E4DE' },
  { fileName: 'sticker_10.png', description: '晚安', emoji: '😴', bg: '#D0C9F5' },
  { fileName: 'sticker_11.png', description: '垂头丧气', emoji: '😞', bg: '#CFD8DC' },
  { fileName: 'sticker_12.png', description: '开心', emoji: '😊', bg: '#FFF0A5' },
];

const SIZE = 240;
const OUT_DIR = path.join(PROJECT_ROOT, 'public', 'stickers', 'placeholder');

mkdirSync(OUT_DIR, { recursive: true });

const DEBUG_PORT = 9481;
const profileDir = path.join(PROJECT_ROOT, 'scripts', 'qa', 'tmp', 'sticker-gen-profile');
const browser = await startBrowser({ port: DEBUG_PORT, profileDir, freshProfile: true });
const cdp = await Cdp.attach(DEBUG_PORT);
await cdp.enableDomains();

console.log('\n═══ 生成内置表情图 ═══\n');
console.log(`  输出目录：${OUT_DIR}`);
console.log(`  尺寸：${SIZE}×${SIZE}｜数量：${STICKERS.length}\n`);

let ok = 0;
for (const s of STICKERS) {
  /**
   * ★ 用 `Runtime.evaluate` 在页面里画。
   *   `returnByValue: true` 让它把 dataURL 字符串直接带回来。
   *
   * ★ emoji 绘制用 `font = '150px "Segoe UI Emoji", "Apple Color Emoji", sans-serif'`：
   *   显式列出 emoji 字体族。只写 `sans-serif` 在某些系统上会退化成
   *   **黑白字形或豆腐块**（emoji 不在默认字体族里）。
   */
  const dataUrl = await cdp.evalJs(`
    (() => {
      const size = ${SIZE};
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      // 圆角底
      const r = size * 0.22;
      ctx.fillStyle = ${JSON.stringify(s.bg)};
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(size - r, 0);
      ctx.quadraticCurveTo(size, 0, size, r);
      ctx.lineTo(size, size - r);
      ctx.quadraticCurveTo(size, size, size - r, size);
      ctx.lineTo(r, size);
      ctx.quadraticCurveTo(0, size, 0, size - r);
      ctx.lineTo(0, r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.closePath();
      ctx.fill();

      // emoji 居中
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '150px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
      ctx.fillText(${JSON.stringify(s.emoji)}, size / 2, size / 2 + size * 0.04);

      return canvas.toDataURL('image/png');
    })()
  `);

  const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
  const file = path.join(OUT_DIR, s.fileName);
  writeFileSync(file, Buffer.from(base64, 'base64'));
  const existed = existsSync(file);
  ok += existed ? 1 : 0;
  console.log(`  ${existed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${s.fileName}  ${s.emoji}  ${s.description}`);
  await sleep(60);
}

killTree(browser.child);

console.log('\n═══════════════════════════════════════════');
console.log(ok === STICKERS.length ? `\x1b[32m已生成 ${ok}/${STICKERS.length} 张\x1b[0m` : `\x1b[31m只成功 ${ok}/${STICKERS.length}\x1b[0m`);
console.log('═══════════════════════════════════════════\n');
process.exit(ok === STICKERS.length ? 0 : 1);
