#!/usr/bin/env node
/**
 * ★ 静态资源生成脚本（`node scripts/gen-assets.mjs`）——零依赖，只用 node: 内置模块。
 *
 * 做三件事：
 * 1. 把仓库根目录的 `THIRD_PARTY.md` 同步到 `public/THIRD_PARTY.md`
 *    （PG-26 第三方许可页运行时 fetch 的是 public 下这一份）；
 * 2. 把 `CHANGELOG.md` 同步到 `public/CHANGELOG.md`
 *    （FN-35 更新说明弹窗的数据源）；
 * 3. 生成 `public/sponsor-qr.png` 占位图（PG-21 打赏页）。
 *
 * ============ 关于收款码占位图 ============
 * 决策 A6：没有支付接口，也不做未知第三方跳转，链接位留空。
 * 因此这里**不生成任何可扫描的二维码**（那是假的、扫出来也可能是别人的）——
 * 只画一张中性的占位图：灰底 + 虚线框 + 三个 QR 定位角，
 * 让人一眼看出「这里该放你的收款码」。
 *
 * 要替换：把自己的收款码图片存成 `public/sponsor-qr.png` 覆盖即可，
 * 重新跑本脚本会再覆盖回去（不想被覆盖就把 `SKIP_QR_IF_EXISTS` 设为 1）。
 *
 * ★ 决策 A1/A2 同源：任何二进制素材都由脚本生成，禁止从外部拷贝来路不明的图。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

/** 已存在收款码时不覆盖（避免把用户自己的码冲掉） */
const SKIP_QR_IF_EXISTS = process.env['SKIP_QR_IF_EXISTS'] === '1';

/* ============================================================
   1/2. 同步 markdown 到 public/
   ============================================================ */

/** 把根目录的 md 复制到 public/（内容相同就跳过写入，避免无意义的 mtime 抖动） */
function syncDoc(filename) {
  const src = path.join(ROOT, filename);
  const dest = path.join(PUBLIC_DIR, filename);

  if (!fs.existsSync(src)) {
    console.warn(`[gen-assets] 跳过 ${filename}：根目录没有这个文件`);
    return false;
  }
  const text = fs.readFileSync(src, 'utf8');
  if (fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') === text) {
    console.log(`[gen-assets] ${filename} 已是最新，跳过`);
    return false;
  }
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(dest, text, 'utf8');
  console.log(`[gen-assets] 已同步 public/${filename}（${text.length} 字符）`);
  return true;
}

/* ============================================================
   3. 生成收款码占位图（零依赖 PNG 编码器）
   ============================================================ */

/** CRC32（PNG 每个 chunk 都要） */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

/** 组装一个 PNG chunk（长度 + 类型 + 数据 + CRC） */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * 把 RGB 像素数组编码成 PNG（bitDepth 8 / colorType 2）。
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgb 长度 = width * height * 3
 * @returns {Buffer}
 */
function encodePng(width, height, rgb) {
  // 每行前面加一个 filter 字节（0 = None），这是 PNG 的规定格式
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 画布：一个极简的 RGB 位图 + 两个绘图原语，够画占位图了 */
function createCanvas(width, height, bg) {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    rgb[i * 3] = bg[0];
    rgb[i * 3 + 1] = bg[1];
    rgb[i * 3 + 2] = bg[2];
  }

  const fillRect = (x, y, w, h, color) => {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(width, Math.round(x + w));
    const y1 = Math.min(height, Math.round(y + h));
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        const idx = (py * width + px) * 3;
        rgb[idx] = color[0];
        rgb[idx + 1] = color[1];
        rgb[idx + 2] = color[2];
      }
    }
  };

  return { rgb, width, height, fillRect };
}

/**
 * 画收款码占位图。
 * 构成：浅灰底 → 虚线外框 → 三个 QR 定位角 → 中间点阵，
 * 语义是「占位」，不是能扫的码。
 */
function renderSponsorPlaceholder(size = 360) {
  const BG = [245, 245, 245];
  const FRAME = [189, 189, 189];
  const EYE = [158, 158, 158];
  const DOT = [224, 224, 224];

  const canvas = createCanvas(size, size, BG);

  // —— 虚线外框 ——
  const inset = 10;
  const dash = 12;
  const gap = 8;
  for (let x = inset; x < size - inset; x += dash + gap) {
    const w = Math.min(dash, size - inset - x);
    canvas.fillRect(x, inset, w, 3, FRAME);
    canvas.fillRect(x, size - inset - 3, w, 3, FRAME);
  }
  for (let y = inset; y < size - inset; y += dash + gap) {
    const h = Math.min(dash, size - inset - y);
    canvas.fillRect(inset, y, 3, h, FRAME);
    canvas.fillRect(size - inset - 3, y, 3, h, FRAME);
  }

  // —— 三个 QR 定位角（左上 / 右上 / 左下）——
  const eye = Math.round(size * 0.23);
  const pad = Math.round(size * 0.075);
  const corners = [
    [pad, pad],
    [size - pad - eye, pad],
    [pad, size - pad - eye],
  ];
  for (const [cx, cy] of corners) {
    canvas.fillRect(cx, cy, eye, eye, EYE);
    canvas.fillRect(cx + eye * 0.15, cy + eye * 0.15, eye * 0.7, eye * 0.7, BG);
    canvas.fillRect(cx + eye * 0.3, cy + eye * 0.3, eye * 0.4, eye * 0.4, EYE);
  }

  // —— 中间点阵（暗示「码区」，明确不可扫）——
  const step = 12;
  const dot = 4;
  const areaFrom = pad + eye + 12;
  const areaTo = size - pad - eye - 12;
  for (let y = areaFrom; y < areaTo; y += step) {
    for (let x = areaFrom; x < areaTo; x += step) {
      canvas.fillRect(x, y, dot, dot, DOT);
    }
  }

  return encodePng(size, size, canvas.rgb);
}

function generateSponsorQr() {
  const dest = path.join(PUBLIC_DIR, 'sponsor-qr.png');
  if (SKIP_QR_IF_EXISTS && fs.existsSync(dest)) {
    console.log('[gen-assets] sponsor-qr.png 已存在，按 SKIP_QR_IF_EXISTS=1 跳过');
    return false;
  }
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  const png = renderSponsorPlaceholder(360);
  fs.writeFileSync(dest, png);
  console.log(`[gen-assets] 已生成 public/sponsor-qr.png（360×360 占位图，${png.length} 字节）`);
  return true;
}

/* ============================================================
   入口
   ============================================================ */

function main() {
  // ★ 开头这一行是有意的：本脚本由 predev / prebuild / verify 自动调用，
  //   没有输出的话，跑没跑过、有没有被跳过，控制台里完全看不出来。
  console.log('[gen-assets] 开始生成静态资源：public/THIRD_PARTY.md、public/CHANGELOG.md、public/sponsor-qr.png');
  const changed = [
    syncDoc('THIRD_PARTY.md'),
    syncDoc('CHANGELOG.md'),
    generateSponsorQr(),
  ].filter(Boolean).length;
  console.log(`[gen-assets] 完成，写入 ${changed} 个文件（0 = 全部已是最新，未重复写入）。`);
}

main();
