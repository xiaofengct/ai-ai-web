import { AppError } from '@/lib/errors';
import { readText } from '@/lib/file';
import type { RawChunk } from '@/types/distill';
import {
  csvToRecords,
  extOfName,
  makeChunk,
  matchTarget,
  normalizeTime,
  parseMessageLines,
  pickField,
  shouldSkip,
  stripHtml,
  tick,
  decodeEntities,
} from './common';
import type { ParseInput, ParseOptions, RawParser } from './types';

/**
 * 微信聊天记录解析器（TS 重写 `tools/wechat_parser.py`，EX-02）。
 *
 * 支持格式：
 * 1. WechatExporter 导出的 txt（`{时间} {发送人}: {内容}`）—— 含多行消息续行
 * 2. WechatExporter 导出的 html（按 class 含 sender / content / time 提取）
 * 3. 其他备份工具导出的 csv（表头宽松匹配 sender/content/timestamp 等）
 * 4. 兜底：通用 txt（交给 common.parseMessageLines）
 */

/** WechatExporter html 里常见的内容 / 发送人 / 时间 class 关键词 */
const SENDER_CLASS = ['sender', 'nickname', 'from', 'name'];
const CONTENT_CLASS = ['content', 'message-text', 'msg-text', 'text', 'message'];
const TIME_CLASS = ['time', 'timestamp', 'date'];

export const wechatParser: RawParser = {
  kind: 'wechat',
  label: '微信聊天记录',
  accept: ['txt', 'html', 'htm', 'csv'],
  featureId: 'EX-02',

  available: () => true,

  parse: async (input: ParseInput, opts: ParseOptions = {}): Promise<RawChunk[]> => {
    const file = input.file;
    if (!file) throw new AppError('PARSE_FAIL', '微信解析器需要文件输入');

    const ext = extOfName(file.name);
    tick(opts.onProgress, 0.1);

    if (ext === 'html' || ext === 'htm') {
      const html = await readText(file);
      return parseWechatHtml(html, opts);
    }
    if (ext === 'csv') {
      const text = await readText(file);
      return parseWechatCsv(text, opts);
    }
    // txt / 其它：统一按消息行解析
    const text = await readText(file);
    const { chunks } = parseMessageLines(text, { target: opts.target, kind: 'wechat', onProgress: opts.onProgress });
    if (chunks.length === 0 && text.trim().length > 0) {
      // 完全没匹配到时间行 → 整体当一段文本，别让用户白传一次
      return [
        makeChunk('wechat', {
          text: text.trim().slice(0, 20000),
          meta: { fallback: 'plain-text', fileName: file.name },
        }),
      ];
    }
    tick(opts.onProgress, 1);
    return chunks;
  },
};

/* --------------------------------- HTML --------------------------------- */

/**
 * 用 DOMParser 解析 WechatExporter 的 html。
 * 容错点：class 名各家工具不一致 → 用关键词包含匹配；
 * 找不到结构化节点时降级为「去标签后的纯文本 + 消息行解析」。
 */
function parseWechatHtml(html: string, opts: ParseOptions): RawChunk[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const nodes = Array.from(doc.querySelectorAll('[class]'));
  const chunks: RawChunk[] = [];

  let pendingSender = '';
  let pendingTime: string | undefined;

  for (const node of nodes) {
    const cls = (node.getAttribute('class') ?? '').toLowerCase();
    const text = decodeEntities((node.textContent ?? '').trim());

    if (!text) continue;

    if (SENDER_CLASS.some((k) => cls.includes(k))) {
      pendingSender = text;
      continue;
    }
    if (TIME_CLASS.some((k) => cls.includes(k))) {
      pendingTime = normalizeTime(text);
      continue;
    }
    if (CONTENT_CLASS.some((k) => cls.includes(k))) {
      if (shouldSkip(text)) continue;
      if (!matchTarget(pendingSender, opts.target)) continue;
      chunks.push(
        makeChunk('wechat', {
          ...(pendingTime ? { time: pendingTime } : {}),
          speaker: pendingSender || undefined,
          text,
        }),
      );
    }
  }

  if (chunks.length > 0) {
    tick(opts.onProgress, 1);
    return chunks;
  }

  // ★ 降级：html 结构不认识 → 去标签后按纯文本解析
  const plain = stripHtml(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, ''));
  const { chunks: fallback } = parseMessageLines(plain, {
    target: opts.target,
    kind: 'wechat',
    onProgress: opts.onProgress,
  });
  if (fallback.length > 0) return fallback;

  return plain.trim()
    ? [
        makeChunk('wechat', {
          text: plain.trim().slice(0, 20000),
          meta: { fallback: 'html-plaintext' },
        }),
      ]
    : [];
}

/* --------------------------------- CSV --------------------------------- */

/** CSV：表头宽松匹配（sender / 发送人 / from / NickName ...） */
function parseWechatCsv(text: string, opts: ParseOptions): RawChunk[] {
  const records = csvToRecords(text);
  const chunks: RawChunk[] = [];

  records.forEach((row, i) => {
    if (i % 200 === 0) tick(opts.onProgress, i / Math.max(1, records.length));
    const sender = pickField(row, ['sender', '发送人', 'from', 'nickname', 'NickName', 'talker', '说话人']);
    const content = pickField(row, ['content', '内容', 'message', 'Message', 'msg', '消息']);
    const timeRaw = pickField(row, ['timestamp', '时间', 'time', 'StrTime', 'date', '日期']);

    if (!content || shouldSkip(content)) return;
    if (!matchTarget(sender, opts.target)) return;

    const time = normalizeTime(timeRaw);
    chunks.push(makeChunk('wechat', { ...(time ? { time } : {}), speaker: sender || undefined, text: content }));
  });

  tick(opts.onProgress, 1);
  return chunks;
}

export default wechatParser;
