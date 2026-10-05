import { AppError } from '@/lib/errors';
import { extOfName, readText } from '@/lib/file';
import type { RawChunk } from '@/types/distill';
import { makeChunk, shouldSkip, tick } from './common';
import type { ParseInput, ParseOptions, RawParser, UnavailableMode } from './types';
import { dt } from '../copy';

/**
 * 通用文件解析器（EX-06）—— 对应 ex-skill 里 Claude Code 的 `Read` 工具。
 *
 * 网页版的能力边界（能力降级见 EX-06）：
 * - **PDF**：`pdfjs-dist` 动态 import 抽文本；依赖没装 / 抽不出文本 → 提示「请另存为 txt」
 * - **图片**：没有原生「看懂图片」能力。顺序是
 *      ① 调用方提供 `opts.describe`（用户手写描述 / 多模态模型结果）
 *      → ② 退化成占位 chunk，`meta.needsDescription = true`（UI 会提示用户补一句描述）
 * - **md / txt / json / csv / log**：直读
 *
 * ★ 原则：任何格式都不允许「静默丢弃」，读不出文本也要留一条占位，让用户知道发生了什么。
 */

export const FILE_TEXT_EXTS: readonly string[] = [
  'md', 'markdown', 'txt', 'text', 'json', 'csv', 'log', 'yml', 'yaml', 'html', 'htm',
];
export const FILE_IMAGE_EXTS: readonly string[] = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif'];
/** 单文件最多保留的字符数（防止整本小说灌爆上下文） */
const MAX_TEXT_CHARS = 200_000;

export const FILE_UNAVAILABLE_MODES: readonly UnavailableMode[] = [
  {
    id: 'native-read-tool',
    label: '原生 Read 工具（直接读 PDF / 图片）',
    reason: dt('distill.sources.reason.nativeReadTool'),
    altKey: 'alt.ocrOrDescribe',
    featureId: 'EX-06',
  },
];

export const fileParser: RawParser = {
  kind: 'file',
  label: '上传文件',
  accept: [...FILE_TEXT_EXTS, ...FILE_IMAGE_EXTS, 'pdf'],
  multi: true,
  featureId: 'EX-06',
  unavailableModes: FILE_UNAVAILABLE_MODES,

  available: () => true,

  parse: async (input: ParseInput, opts: ParseOptions = {}): Promise<RawChunk[]> => {
    const files = input.files ?? (input.file ? [input.file] : []);
    if (files.length === 0) throw new AppError('PARSE_FAIL', '文件解析器需要至少一个文件');

    const chunks: RawChunk[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i];
      tick(opts.onProgress, i / Math.max(1, files.length));
      chunks.push(...(await parseOneFile(f, opts)));
    }
    tick(opts.onProgress, 1);
    return chunks;
  },
};

async function parseOneFile(file: File, opts: ParseOptions): Promise<RawChunk[]> {
  const ext = extOfName(file.name);

  if (ext === 'pdf') return [await parsePdf(file, opts)];
  if (FILE_IMAGE_EXTS.includes(ext)) return [await parseImage(file, opts)];

  // 文本类：直读（PDF 与图片之外一律尝试按 UTF-8 读）
  const text = await readText(file);
  if (!text.trim()) {
    return [
      makeChunk('file', {
        text: `（文件 ${file.name} 没有可读文本）`,
        meta: { fileName: file.name, empty: true },
      }),
    ];
  }
  return splitTextIntoChunks(file.name, text.slice(0, MAX_TEXT_CHARS));
}

/** 长文本按段落分块，避免单条 chunk 过大（后面分批时更均匀） */
function splitTextIntoChunks(fileName: string, text: string): RawChunk[] {
  const parts = text.split(/\n{2,}/).map((s) => s.trim()).filter((s) => !shouldSkip(s));
  if (parts.length <= 1) {
    return [makeChunk('file', { text, meta: { fileName } })];
  }
  // 每段不超过 4000 字，超过再切
  const out: RawChunk[] = [];
  let buf = '';
  for (const p of parts) {
    if (buf && buf.length + p.length > 4000) {
      out.push(makeChunk('file', { text: buf, meta: { fileName } }));
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) out.push(makeChunk('file', { text: buf, meta: { fileName } }));
  return out.length > 0 ? out : [makeChunk('file', { text, meta: { fileName } })];
}

/* ---------------------------------- PDF ---------------------------------- */

/** pdfjs 模块缓存（null = 加载失败，undefined = 还没试过） */
let pdfjsModule: PdfJsLike | null | undefined;

/**
 * ★ 懒加载 pdfjs-dist（字面量动态 import → 独立 chunk）。
 * worker 用 Vite 的 `?url` 把 `pdf.worker.min.mjs` 当静态资源产出，
 * 避免运行时解析裸模块名失败（浏览器不认 bare specifier）。
 */
async function loadPdfjs(): Promise<PdfJsLike | null> {
  if (pdfjsModule !== undefined) return pdfjsModule;
  try {
    const mod = (await import('pdfjs-dist')) as unknown as PdfJsModuleLike;
    try {
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')) as { default?: string };
      if (mod.GlobalWorkerOptions && worker.default) {
        mod.GlobalWorkerOptions.workerSrc = worker.default;
      }
    } catch {
      // worker 资源拿不到 → 让 pdfjs 走自己的兜底（主线程解析），不影响抽文本
    }
    pdfjsModule = typeof mod.getDocument === 'function' ? (mod as PdfJsLike) : null;
  } catch {
    pdfjsModule = null;
  }
  return pdfjsModule;
}

/**
 * PDF 抽文本：`pdfjs-dist` 动态 import（懒加载）。
 * 失败分支：
 *   ① 依赖加载失败 → PARSE_UNSUPPORTED（UI 提示「请另存为 txt」）
 *   ② 依赖在但抽不出文本（扫描件）→ 给占位 + `meta.needsDescription`
 */
async function parsePdf(file: File, opts: ParseOptions): Promise<RawChunk> {
  const pdfjs = await loadPdfjs();

  if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
    throw new AppError(
      'PARSE_UNSUPPORTED',
      'PDF 解析依赖未加载。请把 PDF 另存为 txt 或 md 再给我（EX-06）。',
      { fileName: file.name },
    );
  }

  let text = '';
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const maxPages = Math.min(doc.numPages, 200);
    for (let p = 1; p <= maxPages; p += 1) {
      tick(opts.onProgress, p / maxPages);
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = (content.items ?? []) as { str?: string }[];
      text += `${items.map((it) => it.str ?? '').join('')}\n`;
    }
    await doc.destroy?.();
  } catch (e) {
    throw new AppError('PARSE_FAIL', 'PDF 解析失败，请另存为 txt 再试', e);
  }

  if (!text.trim()) {
    return makeChunk('file', {
      text: `（PDF ${file.name} 没有可提取的文本，可能是扫描件。可以 OCR，或者你手写一句描述给我。）`,
      meta: { fileName: file.name, needsDescription: true, scanned: true },
    });
  }

  return makeChunk('file', { text: text.trim().slice(0, MAX_TEXT_CHARS), meta: { fileName: file.name } });
}

interface PdfJsModuleLike {
  GlobalWorkerOptions?: { workerSrc: string };
  getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDocLike> };
}
interface PdfJsLike {
  getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDocLike> };
}
interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items?: unknown[] }> }>;
  destroy?(): Promise<void>;
}

/* --------------------------------- 图片 --------------------------------- */

/**
 * 图片：网页没有「看懂图片」的原生能力。
 * 优先用调用方给的 `describe`（用户在 UI 上手写的一句描述），
 * 否则留占位并由 UI 提示补描述（EX-06 的三段式降级）。
 */
async function parseImage(file: File, opts: ParseOptions): Promise<RawChunk> {
  let desc = '';
  if (opts.describe) {
    try {
      desc = (await opts.describe(file)) ?? '';
    } catch {
      desc = '';
    }
  }
  if (desc.trim()) {
    return makeChunk('file', { text: desc.trim(), meta: { fileName: file.name, fromDescription: true } });
  }
  return makeChunk('file', {
    text: `（图片 ${file.name}：网页版看不懂图片内容，需要你补一句描述，或者先用 OCR。）`,
    meta: { fileName: file.name, needsDescription: true },
  });
}

export default fileParser;
