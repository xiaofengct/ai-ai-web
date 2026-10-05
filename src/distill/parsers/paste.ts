import { AppError } from '@/lib/errors';
import type { RawChunk } from '@/types/distill';
import { makeChunk, shouldSkip, tick } from './common';
import type { ParseInput, ParseOptions, RawParser } from './types';

/**
 * 直接粘贴（EX-07，P0，完全可实现）。
 * ex-skill 里这条路径不调用任何工具，粘贴内容直接作为原材料。
 *
 * 处理策略：
 * - 空行分段；单段超过 4000 字再按句子切，避免单条 chunk 过大；
 * - 系统消息 / 媒体占位照样过滤。
 */

/** 单段最大字符数 */
const MAX_SEGMENT_CHARS = 4000;
/** 一次粘贴的总字符上限（超出截断，防止误粘贴整本书） */
const MAX_TOTAL_CHARS = 300_000;

export const pasteParser: RawParser = {
  kind: 'paste',
  label: '直接粘贴',
  accept: [],
  acceptsText: true,
  featureId: 'EX-07',

  available: () => true,

  parse: async (input: ParseInput, opts: ParseOptions = {}): Promise<RawChunk[]> => {
    const text = (input.text ?? '').trim();
    if (!text) throw new AppError('PARSE_FAIL', '粘贴内容为空');

    tick(opts.onProgress, 0.2);
    const body = text.slice(0, MAX_TOTAL_CHARS);
    const segments = splitPaste(body);
    tick(opts.onProgress, 1);

    const chunks = segments.map((s) => makeChunk('paste', { text: s }));
    return chunks.length > 0 ? chunks : [makeChunk('paste', { text: body })];
  },
};

/** 空行分段 → 超长段按句子再切 */
function splitPaste(text: string): string[] {
  const parts = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s && !shouldSkip(s));

  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= MAX_SEGMENT_CHARS) {
      out.push(p);
      continue;
    }
    // 按句子切（保留标点），再装箱
    const sentences = p.split(/(?<=[。！？!?…\n])/).filter(Boolean);
    let buf = '';
    for (const s of sentences) {
      if (buf && buf.length + s.length > MAX_SEGMENT_CHARS) {
        out.push(buf.trim());
        buf = s;
      } else {
        buf += s;
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

export default pasteParser;
