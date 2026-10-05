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
  tick,
} from './common';
import type { ParseInput, ParseOptions, RawParser, UnavailableMode } from './types';
import { dt } from '../copy';

/**
 * iMessage 解析器（TS 重写 `tools/imessage_parser.py`，EX-03）。
 *
 * ★★ 不可实现项：`--direct` 直读 macOS `~/Library/Messages/chat.db`
 *    —— 网页拿不到磁盘全权限（C1 / EX-03），在 `unavailableModes` 里显式声明，
 *    UI 用 `<CapabilityGate featureId="EX-03">` 置灰并给原因，绝不静默缺失。
 *
 * 支持格式（全部是**用户导出**的文件）：
 * 1. XML：iMazing / PhoneView 导出的 `<message>` / `<sms>` / `<imessage>` 节点
 * 2. CSV：表头宽松匹配 sender/from/content/text/timestamp/date
 * 3. txt：通用消息行
 */

/** Apple 时间戳基准（2001-01-01）与 Unix 基准之差（秒），用于 ns / s 戳换算 */
const APPLE_EPOCH_OFFSET_SEC = 978307200;

export const IMESSAGE_UNAVAILABLE_MODES: readonly UnavailableMode[] = [
  {
    id: 'chat-db-direct',
    label: '直接读取本机 chat.db（--direct）',
    reason: dt('distill.sources.reason.chatDbDirect'),
    altKey: 'alt.exportOnly',
    featureId: 'EX-03',
  },
];

export const imessageParser: RawParser = {
  kind: 'imessage',
  label: 'iMessage',
  accept: ['xml', 'txt', 'csv', 'json'],
  featureId: 'EX-03',
  unavailableModes: IMESSAGE_UNAVAILABLE_MODES,

  available: () => true,

  parse: async (input: ParseInput, opts: ParseOptions = {}): Promise<RawChunk[]> => {
    const file = input.file;
    if (!file) throw new AppError('PARSE_FAIL', 'iMessage 解析器需要文件输入');

    const ext = extOfName(file.name);
    const text = await readText(file);
    tick(opts.onProgress, 0.1);

    if (ext === 'xml') return parseImessageXml(text, opts);
    if (ext === 'csv') return parseImessageCsv(text, opts);
    if (ext === 'json') return parseImessageJson(text, opts);

    const { chunks } = parseMessageLines(text, {
      target: opts.target,
      kind: 'imessage',
      onProgress: opts.onProgress,
    });
    tick(opts.onProgress, 1);
    return chunks;
  },
};

/* ---------------------------------- XML ---------------------------------- */

/**
 * XML 容错解析：遍历所有元素，取名字含 message / sms / imessage 的节点。
 * 属性名各家不一样（sender / from / handle / contact_name / address），统一宽松取值。
 */
function parseImessageXml(text: string, opts: ParseOptions): RawChunk[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const errNode = doc.querySelector('parsererror');
  if (errNode) throw new AppError('PARSE_FAIL', 'XML 解析失败', errNode.textContent ?? '');

  const all = Array.from(doc.getElementsByTagName('*'));
  const chunks: RawChunk[] = [];

  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (!tag.includes('message') && !tag.includes('sms') && !tag.includes('imessage')) continue;

    const sender =
      attr(el, ['sender', 'from', 'handle', 'contact_name', 'contactname', 'address', 'name']) ||
      childText(el, ['sender', 'from', 'handle']);
    const content =
      attr(el, ['text', 'body', 'content', 'message']) || childText(el, ['text', 'body', 'content', 'message']);
    const timeRaw = attr(el, ['date', 'time', 'timestamp', 'date_read', 'created']) || childText(el, ['date', 'time']);

    if (!content || shouldSkip(content)) continue;
    if (!matchTarget(sender, opts.target)) continue;

    chunks.push(
      makeChunk('imessage', {
        ...(normalizeTime(appleTime(timeRaw)) ? { time: normalizeTime(appleTime(timeRaw)) } : {}),
        speaker: sender || undefined,
        text: content.trim(),
      }),
    );
  }

  tick(opts.onProgress, 1);
  return chunks;
}

/**
 * Apple 时间戳可能是「2001-01-01 起的纳秒 / 秒」，
 * 而 normalizeTime 只认 Unix 毫秒，这里先做一次换算。
 */
function appleTime(raw: string): string {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return s;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return s;
  // 纳秒（>1e15）→ 秒 + Apple 基准；秒（1e8~1e12）→ 直接加基准
  const sec = n > 1e15 ? n / 1e9 + APPLE_EPOCH_OFFSET_SEC : n + APPLE_EPOCH_OFFSET_SEC;
  return String(Math.floor(sec * 1000));
}

function attr(el: Element, names: readonly string[]): string {
  for (const n of names) {
    const v = el.getAttribute(n);
    if (v && v.trim()) return v.trim();
    // 大小写不敏感兜底
    for (const a of Array.from(el.attributes)) {
      if (a.name.toLowerCase() === n.toLowerCase() && a.value.trim()) return a.value.trim();
    }
  }
  return '';
}

function childText(el: Element, names: readonly string[]): string {
  for (const n of names) {
    const child = Array.from(el.children).find((c) => c.tagName.toLowerCase() === n.toLowerCase());
    const t = child?.textContent?.trim();
    if (t) return t;
  }
  return '';
}

/* ---------------------------------- CSV ---------------------------------- */

function parseImessageCsv(text: string, opts: ParseOptions): RawChunk[] {
  const records = csvToRecords(text);
  const chunks: RawChunk[] = [];

  records.forEach((row, i) => {
    if (i % 200 === 0) tick(opts.onProgress, i / Math.max(1, records.length));
    const sender = pickField(row, ['sender', 'from', 'Sender', 'From', 'handle', 'contact', 'name']);
    const content = pickField(row, ['content', 'text', 'Content', 'Text', 'message', 'Message', 'body']);
    const timeRaw = pickField(row, ['timestamp', 'time', 'Date', 'date', 'datetime']);

    if (!content || shouldSkip(content)) return;
    if (!matchTarget(sender, opts.target)) return;

    const time = normalizeTime(appleTime(timeRaw));
    chunks.push(makeChunk('imessage', { ...(time ? { time } : {}), speaker: sender || undefined, text: content }));
  });

  tick(opts.onProgress, 1);
  return chunks;
}

/* ---------------------------------- JSON ---------------------------------- */

/** JSON 导出（部分第三方工具）：数组 或 {messages/data/items:[...]} */
function parseImessageJson(text: string, opts: ParseOptions): RawChunk[] {
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch (e) {
    throw new AppError('PARSE_FAIL', 'JSON 解析失败', e);
  }
  const list = Array.isArray(data)
    ? data
    : (data as { messages?: unknown[]; data?: unknown[]; items?: unknown[] }).messages ??
      (data as { data?: unknown[] }).data ??
      (data as { items?: unknown[] }).items ??
      [];

  const chunks: RawChunk[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const rec = raw as Record<string, unknown>;
    const sender = str(rec.sender ?? rec.from ?? rec.handle ?? rec.contact_name ?? rec.name);
    const content = str(rec.text ?? rec.content ?? rec.body ?? rec.message);
    const timeRaw = str(rec.date ?? rec.time ?? rec.timestamp ?? rec.created_at);
    if (!content || shouldSkip(content)) continue;
    if (!matchTarget(sender, opts.target)) continue;
    const time = normalizeTime(appleTime(timeRaw));
    chunks.push(makeChunk('imessage', { ...(time ? { time } : {}), speaker: sender || undefined, text: content }));
  }
  tick(opts.onProgress, 1);
  return chunks;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}

export default imessageParser;
