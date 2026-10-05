import type { RawSourceKind } from '@/types/distill';
import { AppError } from '@/lib/errors';
import { toAppError } from '@/lib/errors';
import type { ParseInput, ParseOptions, ParseReport, RawParser, UnavailableMode } from './types';
import { wechatParser } from './wechat';
import { imessageParser } from './imessage';
import { smsParser } from './sms';
import { photoParser } from './photo';
import { socialParser } from './social';
import { fileParser } from './file';
import { pasteParser } from './paste';

/**
 * 解析器注册表（7 个，对应 ex-skill 的 A~F 六种原材料 + 直接粘贴）。
 *
 * ★ 数量自检：T11 验收要点②「7 个 parser 全部实现」。
 */

export const PARSERS: readonly RawParser[] = [
  wechatParser,
  imessageParser,
  smsParser,
  photoParser,
  socialParser,
  fileParser,
  pasteParser,
];

/** 预期数量（验收自检用） */
export const EXPECTED_PARSER_COUNT = 7;

const BY_KIND: Record<RawSourceKind, RawParser> = PARSERS.reduce((acc, p) => {
  acc[p.kind] = p;
  return acc;
}, {} as Record<RawSourceKind, RawParser>);

/** 按 kind 取解析器 */
export function getParser(kind: RawSourceKind): RawParser {
  const parser = BY_KIND[kind];
  if (!parser) throw new AppError('PARSE_UNSUPPORTED', `没有对应的解析器：${kind}`);
  return parser;
}

/** 全部不可实现模式（UI 逐条置灰 + 原因，禁止静默缺失） */
export function listUnavailableModes(): UnavailableMode[] {
  return PARSERS.flatMap((p) => p.unavailableModes ?? []);
}

/**
 * 统一下游解析入口：包一层错误归一（PARSE_FAIL / PARSE_UNSUPPORTED / ABORTED）。
 * 返回 ParseReport，UI 需要展示「原始 N 条 / 跳过 M 条 / 是否降级」。
 */
export async function runParser(
  kind: RawSourceKind,
  input: ParseInput,
  opts: ParseOptions = {},
): Promise<ParseReport> {
  const parser = getParser(kind);
  try {
    const chunks = await parser.parse(input, opts);
    const fileName = input.file?.name ?? (input.files && input.files.length > 0 ? `${input.files.length} 个文件` : undefined);
    const degraded = chunks.find((c) => typeof c.meta?.degraded === 'string')?.meta?.degraded as string | undefined;
    return {
      kind,
      ...(fileName ? { fileName } : {}),
      chunks,
      rawCount: chunks.length,
      skippedCount: 0,
      ...(degraded ? { degraded } : {}),
    };
  } catch (e) {
    const err = toAppError(e, 'PARSE_FAIL');
    if (err.code !== 'PARSE_FAIL' && err.code !== 'PARSE_UNSUPPORTED' && err.code !== 'ABORTED') {
      throw new AppError('PARSE_FAIL', err.message, err.detail);
    }
    throw err;
  }
}

export * from './types';
export { wechatParser, imessageParser, smsParser, photoParser, socialParser, fileParser, pasteParser };
export {
  chunkToLine,
  classifyChunks,
  formatKnowledge,
  makeChunk,
  normalizeTime,
  shouldSkip,
  SKIP_PATTERNS,
} from './common';
export { PHOTO_EXTS } from './photo';
export { FILE_IMAGE_EXTS, FILE_TEXT_EXTS } from './file';
export { SOCIAL_PLATFORM_LABEL } from './social';
