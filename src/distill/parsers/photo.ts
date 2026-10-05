import { AppError } from '@/lib/errors';
import { filterByExt, formatBytes } from '@/lib/file';
import type { RawChunk } from '@/types/distill';
import { makeChunk, tick } from './common';
import type { ParseInput, ParseOptions, RawParser, UnavailableMode } from './types';
import { dt } from '../copy';

/**
 * 照片 EXIF 时间线解析器（TS 重写 `tools/photo_analyzer.py`，EX-04）。
 *
 * 与 Python 版的差异（能力降级，见 EX-04 / PL-11）：
 * - Python 直接 `rglob` 遍历磁盘目录 → 网页**没有相册目录权限**，
 *   改为用户手动多选文件（或 Chromium 下用 File System Access 选目录，由 FileDropZone 处理）；
 * - Python 手写 JPEG APP1 段解析 → 这里优先用 `exifr`（**动态 import 懒加载**），
 *   加载失败降级为 `file.lastModified`，并在 `degraded` 里说明原因。
 *
 * 输出：一天一个 RawChunk（时间线），meta 带照片清单，避免几千张照片炸掉上下文。
 */

export const PHOTO_EXTS: readonly string[] = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'tiff', 'bmp'];

/** 每天最多列出的照片数（ex-skill 里是 10） */
const MAX_PHOTOS_PER_DAY = 10;

export const PHOTO_UNAVAILABLE_MODES: readonly UnavailableMode[] = [
  {
    id: 'album-dir-scan',
    label: '直接扫描本机相册目录',
    reason: dt('distill.sources.reason.albumDirScan'),
    altKey: 'alt.manualPickFolder',
    featureId: 'EX-04',
  },
  {
    id: 'photo-content-vision',
    label: '自动看懂照片内容',
    reason: dt('distill.sources.reason.photoContentVision'),
    altKey: 'alt.ocrOrDescribe',
    featureId: 'EX-06',
  },
];

interface PhotoEntry {
  fileName: string;
  /** YYYY-MM-DD */
  day: string;
  sizeKb: number;
  /** EXIF 原始时间（ISO），没有则为 undefined */
  takenAt?: string;
  lat?: number;
  lon?: number;
}

/** exifr 的最小类型（避免为了一个函数装 @types） */
interface ExifrLike {
  parse(input: Blob | File, options?: unknown): Promise<Record<string, unknown> | undefined>;
}

let exifrModule: ExifrLike | null | undefined;

/**
 * ★ 懒加载 exifr（**字面量**动态 import → Vite 切成独立 chunk，用到才下载）。
 *
 * 用完整版（exifr 7.x 的 `dist/full.esm.mjs`）而不是 lite 版，因为要读 HEIC / TIFF 的 EXIF。
 * 万一加载失败（离线、chunk 拉取失败）仍然被 catch → 降级到 `file.lastModified`，不阻断解析。
 */
async function loadExifr(): Promise<ExifrLike | null> {
  if (exifrModule !== undefined) return exifrModule;
  try {
    const mod = (await import('exifr')) as unknown as { default?: ExifrLike } & ExifrLike;
    const impl = (mod.default ?? mod) as ExifrLike;
    exifrModule = typeof impl.parse === 'function' ? impl : null;
  } catch {
    exifrModule = null;
  }
  return exifrModule;
}

export const photoParser: RawParser = {
  kind: 'photo',
  label: '照片（EXIF 时间线）',
  accept: PHOTO_EXTS,
  multi: true,
  featureId: 'EX-04',
  unavailableModes: PHOTO_UNAVAILABLE_MODES,

  available: () => true,

  parse: async (input: ParseInput, opts: ParseOptions = {}): Promise<RawChunk[]> => {
    const files = input.files ?? (input.file ? [input.file] : []);
    if (files.length === 0) throw new AppError('PARSE_FAIL', '照片解析器需要至少一个图片文件');

    const photos = filterByExt(files, PHOTO_EXTS);
    if (photos.length === 0) throw new AppError('PARSE_UNSUPPORTED', '没有匹配到的图片文件');

    const exifr = await loadExifr();
    const entries: PhotoEntry[] = [];
    let degraded: string | undefined;

    for (let i = 0; i < photos.length; i += 1) {
      const f = photos[i];
      tick(opts.onProgress, i / Math.max(1, photos.length));
      const taken = await readExifDate(f, exifr);
      if (!taken) {
        // ★ 降级：无 EXIF 或 exifr 不可用 → 用文件修改时间
        degraded = exifr
          ? '部分照片没有 EXIF，已用文件修改时间代替'
          : 'exifr 不可用（依赖未加载），全部用文件修改时间代替';
      }
      const d = taken ? new Date(taken) : new Date(f.lastModified);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      entries.push({
        fileName: f.name,
        day,
        sizeKb: Math.round(f.size / 1024),
        ...(taken ? { takenAt: taken } : {}),
      });
    }

    // 按天分组 → 一天一个 chunk（时间线）
    const byDay = new Map<string, PhotoEntry[]>();
    for (const e of entries) {
      const list = byDay.get(e.day) ?? [];
      list.push(e);
      byDay.set(e.day, list);
    }

    const days = [...byDay.keys()].sort();
    const chunks: RawChunk[] = days.map((day) => {
      const list = byDay.get(day) ?? [];
      const lines = list.slice(0, MAX_PHOTOS_PER_DAY).map((p) => `  - ${p.fileName}（${p.sizeKb} KB）`);
      if (list.length > MAX_PHOTOS_PER_DAY) {
        lines.push(`  - ... 还有 ${list.length - MAX_PHOTOS_PER_DAY} 张`);
      }
      return makeChunk('photo', {
        time: new Date(`${day}T12:00:00`).toISOString(),
        text: [`## ${day}（${list.length} 张）`, ...lines].join('\n'),
        meta: {
          day,
          count: list.length,
          files: list.map((p) => p.fileName),
          totalSizeKb: list.reduce((s, p) => s + p.sizeKb, 0),
          ...(degraded ? { degraded } : {}),
        },
      });
    });

    tick(opts.onProgress, 1);
    return chunks;
  },
};

/**
 * 读 EXIF 拍摄时间。
 * 容错分支（★ 关键）：
 * 1. exifr 不可用 → undefined
 * 2. exifr 抛错（损坏的图）→ undefined
 * 3. 字段是 Date 对象 / 字符串 / 数组 都尝试归一化
 */
async function readExifDate(file: File, exifr: ExifrLike | null): Promise<string | undefined> {
  if (!exifr) return undefined;
  try {
    const data = await exifr.parse(file, { tiff: true, exif: true, ifd0: false });
    if (!data) return undefined;
    const raw =
      (data.DateTimeOriginal as unknown) ??
      (data.CreateDate as unknown) ??
      (data.ModifyDate as unknown) ??
      (data.date as unknown);
    return toIsoString(raw);
  } catch {
    return undefined;
  }
}

function toIsoString(raw: unknown): string | undefined {
  if (!raw) return undefined;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? undefined : raw.toISOString();
  if (typeof raw === 'number') {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof raw === 'string') {
    // EXIF 原生格式 "YYYY:MM:DD HH:MM:SS"
    const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

/** 供 UI 展示：把照片体积格式化（复用 lib/file 的实现） */
export function formatPhotoSize(bytes: number): string {
  return formatBytes(bytes);
}

export default photoParser;
