import { strFromU8, strToU8, unzip as fflateUnzip, zipSync as fflateZipSync } from 'fflate';
import { AppError } from './errors';

/**
 * zip 封装（fflate，比 jszip 小 ~80%）。
 * 用于：一键导出（FN-03）、人设 zip、表情包 zip（FN-02）、Live2D zip（FN-53）、蒸馏产物导出（C3）。
 */

/** 待打包文件：string 会被当作 UTF-8 文本 */
export type ZipInput = Record<string, Uint8Array | string>;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

function toU8(value: Uint8Array | string): Uint8Array {
  return typeof value === 'string' ? strToU8(value) : value;
}

/** 打包：返回 zip 的字节 */
export function zipFiles(files: ZipInput, level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6): Uint8Array {
  const packed: Record<string, Uint8Array> = {};
  for (const [path, value] of Object.entries(files)) {
    packed[normalizePath(path)] = toU8(value);
  }
  try {
    // zipSync：全量已在内存里，同步打包即可（异步版会把结果交给回调，反而麻烦）
    return fflateZipSync(packed, { level });
  } catch (e) {
    throw new AppError('DB_FAILED', '打包 zip 失败', e);
  }
}

/** 打包并直接下载 */
export function zipAndDownload(files: ZipInput, filename: string): void {
  const bytes = zipFiles(files);
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 解包：返回 path → bytes */
export function unzipBytes(data: Uint8Array | ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  return new Promise((resolve, reject) => {
    fflateUnzip(u8, (err, unzipped) => {
      if (err) {
        reject(new AppError('PARSE_FAIL', '解包 zip 失败', err));
        return;
      }
      const map = new Map<string, Uint8Array>();
      for (const [path, value] of Object.entries(unzipped)) {
        map.set(path, value);
      }
      resolve(map);
    });
  });
}

/** 解包 File/Blob */
export async function unzipFile(file: Blob): Promise<Map<string, Uint8Array>> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return unzipBytes(buf);
}

/** 从解包结果里读文本 */
export function readZipText(files: Map<string, Uint8Array>, path: string): string | undefined {
  const hit = files.get(path) ?? findBySuffix(files, path);
  return hit ? strFromU8(hit) : undefined;
}

/** 忽略大小写 / 目录前缀地找文件（原应用导出的 zip 目录结构不固定） */
export function findBySuffix(files: Map<string, Uint8Array>, suffix: string): Uint8Array | undefined {
  const target = suffix.replace(/^\//, '').toLowerCase();
  for (const [path, value] of files) {
    const p = path.toLowerCase();
    if (p === target || p.endsWith(`/${target}`)) return value;
  }
  return undefined;
}

/** 列出所有匹配后缀的路径 */
export function listByExt(files: Map<string, Uint8Array>, ext: string): string[] {
  const lower = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return [...files.keys()].filter((p) => p.toLowerCase().endsWith(lower));
}

/** 统一路径分隔符，去掉前导 / */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

export { encoder as textEncoder, decoder as textDecoder, strFromU8, strToU8 };
