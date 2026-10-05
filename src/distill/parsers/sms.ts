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
 * 短信解析器（TS 重写 `tools/sms_parser.py`，EX-03）。
 *
 * ★★ 同样不支持任何「直读本机数据库」的模式（见 `SMS_UNAVAILABLE_MODES`）。
 *
 * 支持格式（全部是**用户导出**的文件）：
 * 1. XML：Android「SMS Backup & Restore」导出的 `<sms address body date type contact_name>`（type=1 收到）
 * 2. CSV：表头宽松匹配 address/sender/number + body/content/text + date/time
 * 3. txt：通用消息行
 */

export const SMS_UNAVAILABLE_MODES: readonly UnavailableMode[] = [
  {
    id: 'sms-db-direct',
    label: '直接读取本机短信数据库',
    reason: dt('distill.sources.reason.smsDbDirect'),
    altKey: 'alt.manualExportSms',
    featureId: 'EX-03',
  },
];

export const smsParser: RawParser = {
  kind: 'sms',
  label: '短信',
  accept: ['xml', 'csv', 'txt'],
  featureId: 'EX-03',
  unavailableModes: SMS_UNAVAILABLE_MODES,

  available: () => true,

  parse: async (input: ParseInput, opts: ParseOptions = {}): Promise<RawChunk[]> => {
    const file = input.file;
    if (!file) throw new AppError('PARSE_FAIL', '短信解析器需要文件输入');

    const ext = extOfName(file.name);
    const text = await readText(file);
    tick(opts.onProgress, 0.1);

    if (ext === 'xml') return parseSmsXml(text, opts);
    if (ext === 'csv') return parseSmsCsv(text, opts);

    const { chunks } = parseMessageLines(text, { target: opts.target, kind: 'sms', onProgress: opts.onProgress });
    tick(opts.onProgress, 1);
    return chunks;
  },
};

/* ---------------------------------- XML ---------------------------------- */

/**
 * Android SMS Backup & Restore 格式：
 *   <sms address="+86138..." body="..." date="1700000000000" type="1" contact_name="小美" />
 * type: 1=收到 / 2=发出；原 Python 只保留 type=1（她发来的）。
 * ★ 容错：没有 type 属性时**不丢弃**（很多导出工具不写 type）。
 */
function parseSmsXml(text: string, opts: ParseOptions): RawChunk[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const errNode = doc.querySelector('parsererror');
  if (errNode) throw new AppError('PARSE_FAIL', 'XML 解析失败', errNode.textContent ?? '');

  const nodes = Array.from(doc.getElementsByTagName('sms'));
  const pool = nodes.length > 0 ? nodes : Array.from(doc.getElementsByTagName('*')).filter((el) =>
    el.tagName.toLowerCase().includes('sms') || el.tagName.toLowerCase().includes('message'),
  );

  const chunks: RawChunk[] = [];
  pool.forEach((el, i) => {
    if (i % 200 === 0) tick(opts.onProgress, i / Math.max(1, pool.length));

    const type = el.getAttribute('type') ?? '';
    // type 存在且明确为 2（我发出的）→ 跳过；其它一律保留
    if (type === '2') return;

    const address = el.getAttribute('address') ?? '';
    const contact = el.getAttribute('contact_name') ?? '';
    const body = el.getAttribute('body') ?? el.textContent?.trim() ?? '';
    const dateMs = el.getAttribute('date') ?? '';

    if (!body.trim() || shouldSkip(body)) return;
    const sender = contact || address;
    if (!matchTarget(sender, opts.target) && !matchTarget(address, opts.target)) return;

    const time = normalizeTime(dateMs);
    chunks.push(
      makeChunk('sms', {
        ...(time ? { time } : {}),
        speaker: sender || undefined,
        text: body.trim(),
        meta: { address: address || undefined },
      }),
    );
  });

  tick(opts.onProgress, 1);
  return chunks;
}

/* ---------------------------------- CSV ---------------------------------- */

function parseSmsCsv(text: string, opts: ParseOptions): RawChunk[] {
  const records = csvToRecords(text);
  const chunks: RawChunk[] = [];

  records.forEach((row, i) => {
    if (i % 200 === 0) tick(opts.onProgress, i / Math.max(1, records.length));
    const sender = pickField(row, ['sender', 'from', 'address', 'number', 'contact', 'name']);
    const content = pickField(row, ['content', 'body', 'text', 'message']);
    const timeRaw = pickField(row, ['timestamp', 'date', 'time', 'datetime']);

    if (!content || shouldSkip(content)) return;
    if (!matchTarget(sender, opts.target)) return;

    const time = normalizeTime(timeRaw);
    chunks.push(makeChunk('sms', { ...(time ? { time } : {}), speaker: sender || undefined, text: content }));
  });

  tick(opts.onProgress, 1);
  return chunks;
}

export default smsParser;
