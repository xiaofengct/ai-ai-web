import { blobRepo } from '@/db/repo/blobRepo';
import { AppError } from '@/lib/errors';
import type { UUID } from '@/types/common';

/**
 * ★ OCR（架构文档 §2 `src/features/media/ocr.ts`、验收要点⑧ / FN-25）。
 *
 * ★ 为什么用动态 import：
 *   tesseract.js 本体 + 语言包（chi_sim 约 15MB）是**很重的按需资源**，
 *   把它打进首屏 bundle 会让首屏体积翻好几倍。这里只在用户真的点「读图」时才加载，
 *   并且**加载失败必须有降级提示**——不能让按钮点了没反应。
 *
 * ★ 隐私提醒：OCR 在本地 WASM 里跑，图片不上传；但 tesseract.js 默认会从 CDN 拉
 *   worker / 语言包，**离线或 CSP 受限时会失败**，这正是降级路径要覆盖的场景。
 */

/** 默认识别语言：简体中文 + 英文 */
export const OCR_LANG = 'chi_sim+eng';

/** 退化语言：中文包拉不到时至少还能读英文 */
export const OCR_LANG_LITE = 'eng';

/** 单次识别的保守超时（ms），超时即降级提示，不让按钮一直转圈 */
export const OCR_TIMEOUT_MS = 60_000;

export interface OcrResult {
  text: string;
  /** 平均置信度 0~100（tesseract 给的是 0~100） */
  confidence: number;
  lang: string;
}

/** 只声明我们用到的那部分能力，避免把整个库的类型拖进编译图的公共面 */
interface TesseractLike {
  recognize: (
    image: unknown,
    lang?: string,
    options?: unknown,
  ) => Promise<{ data?: { text?: string; confidence?: number } }>;
}

/** 动态加载 tesseract.js；失败统一成 AppError，方便 UI 直接给降级文案 */
async function loadTesseract(): Promise<TesseractLike> {
  try {
    const mod = (await import('tesseract.js')) as unknown as Partial<TesseractLike>;
    if (typeof mod?.recognize !== 'function') {
      throw new AppError('CAPABILITY_UNAVAILABLE', 'tesseract.js 未导出 recognize', { mod });
    }
    return mod as TesseractLike;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('CAPABILITY_UNAVAILABLE', 'tesseract.js load failed', { reason: String(e) });
  }
}

/** 带超时地跑一个 Promise（超时后原 Promise 仍在跑，但结果已无人接收） */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new AppError('CAPABILITY_UNAVAILABLE', 'OCR 超时', { ms })),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 收拢 OCR 输出的空白（tesseract 会吐出大量孤立换行与空格） */
export function cleanOcrText(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    // 去掉纯符号噪声行（只有一两个标点，多半是误识别）
    .filter((line) => line.replace(/[^一-龥A-Za-z0-9]/g, '').length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 识别一张图片。
 * @param source Blob 或可访问的图片 URL / dataURL
 * @param lang 语言包，默认中文 + 英文
 */
export async function recognizeImage(source: Blob | string, lang = OCR_LANG): Promise<OcrResult> {
  const tesseract = await loadTesseract();
  const run = async (useLang: string): Promise<OcrResult> => {
    const out = await tesseract.recognize(source, useLang);
    const text = cleanOcrText(out?.data?.text ?? '');
    return { text, confidence: Math.round(out?.data?.confidence ?? 0), lang: useLang };
  };

  try {
    return await withTimeout(run(lang), OCR_TIMEOUT_MS);
  } catch (e) {
    // ★ 中文包拉不到（离线 / CDN 被墙）时自动退到英文包，而不是直接判死
    if (lang !== OCR_LANG_LITE) {
      try {
        return await withTimeout(run(OCR_LANG_LITE), OCR_TIMEOUT_MS);
      } catch {
        /* 落到下面的统一抛错 */
      }
    }
    throw e instanceof AppError
      ? e
      : new AppError('CAPABILITY_UNAVAILABLE', 'OCR recognize failed', { reason: String(e) });
  }
}

/** 直接按资产 id 识别（图片预览页用；资产不存在时抛 DB_FAILED） */
export async function ocrAsset(assetId: UUID, lang = OCR_LANG): Promise<OcrResult> {
  const blobRes = await blobRepo.getBlob(assetId);
  if (!blobRes.ok) throw blobRes.error;
  if (!blobRes.value) {
    throw new AppError('DB_FAILED', 'image asset missing', { assetId });
  }
  return recognizeImage(blobRes.value, lang);
}

/** 粗略判断是否值得尝试 OCR（没有任何 Worker/WASM 能力时直接提示降级） */
export function ocrSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
}

export default recognizeImage;
