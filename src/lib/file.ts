import { AppError } from './errors';
import { decodeTextBytes, stripBom } from './encoding';
import { MAX_FILE_SIZE } from '@/constants/limits';

/**
 * 文件读取（架构文档 §2 `lib/file.ts`）：
 * readText / readBytes + File System Access 兜底（PL-11）。
 *
 * PL-11 降级说明：`showOpenFilePicker` / `showDirectoryPicker` 只有 Chromium 系支持，
 * Safari / Firefox 一律退化为传统 `<input type="file">`。
 */

/** File System Access 的最小类型声明（TS lib.dom 里没有） */
interface FileSystemFileHandleLike {
  getFile(): Promise<File>;
}
interface DirectoryHandleLike {
  values(): AsyncIterableIterator<FileSystemFileHandleLike | DirectoryHandleLike>;
  kind?: string;
  name?: string;
}
interface FsAccessWindow {
  showOpenFilePicker?: (opts?: {
    multiple?: boolean;
    types?: { description: string; accept: Record<string, string[]> }[];
    excludeAcceptAllOption?: boolean;
  }) => Promise<FileSystemFileHandleLike[]>;
  showDirectoryPicker?: () => Promise<DirectoryHandleLike>;
}

function fsAccess(): FsAccessWindow | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as FsAccessWindow);
}

/** 是否支持 File System Access（Chromium 系） */
export function supportsFsAccess(): boolean {
  const w = fsAccess();
  return Boolean(w && (w.showOpenFilePicker || w.showDirectoryPicker));
}

export interface AcceptSpec {
  description: string;
  accept: Record<string, string[]>;
}

/**
 * 读文本。**自动探测编码**（UTF-8 优先，乱码多则试 GBK），并去掉 BOM。
 *
 * ★★ 2026-10-04 修正（原来只走 `Blob.text()` ⇒ 硬编码 UTF-8，是一处真 bug）：
 *
 *   微信聊天记录的导出**不保证是 UTF-8** —— 老版本微信与部分第三方导出工具产出 **GBK**。
 *   原实现会把 GBK 字节解成一片 `\uFFFD`，下游解析器因此**一条都认不出来**，
 *   用户看到的是「导入成功但 0 条」或满屏乱码，且无法从现象判断原因。
 *
 *   实测（同一段「你好」的 GBK 字节）：
 *     UTF-8 硬解 → `"\uFFFD\uFFFD\uFFFD"`；GBK 解 → `"你好"`。
 *
 *   ⇒ 改为读字节后交给 `lib/encoding.ts` 的 `decodeTextBytes()` 判断。
 *     它是本函数的**唯一编码决策点**，也是全部解析器（微信 / iMessage / SMS / social / 纯文本）
 *     的公共入口 —— 所以修这一处即覆盖全部导入路径。
 *     探测判据的取舍（为什么用"替换字符更少"而不是猜）见该模块头部注释。
 *
 * ★ 保持返回 `Promise<string>` 不变：调用方共 5 处，改签名会波及无收益。
 *   编码信息（实际用了哪个）只在需要排查时通过 `decodeTextDetailed()` 取。
 */
export async function readText(file: Blob): Promise<string> {
  return (await decodeTextDetailed(file)).text;
}

/**
 * 同 `readText`，但额外返回**实际使用的编码**与剩余乱码数。
 *
 * 用途：导入失败时给出可排查的原因（"按 GBK 读了但仍有 N 处无法解码"），
 * 而不是只告诉用户"解析出 0 条"。
 */
export async function decodeTextDetailed(
  file: Blob,
): Promise<{ text: string; encoding: string; replacements: number; switched: boolean }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return decodeTextBytes(bytes);
}

/** 读字节 */
export async function readBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

// `stripBom` 由 `lib/encoding.ts` 在解码后统一调用；此处 re-export 便于同域调用方复用
export { stripBom };

/** 读 JSON（失败抛 PARSE_FAIL） */
export async function readJSON<T>(file: Blob): Promise<T> {
  try {
    const text = await readText(file);
    return JSON.parse(text) as T;
  } catch (e) {
    throw new AppError('PARSE_FAIL', 'JSON 解析失败', e);
  }
}

/** 体积校验（防误选超大文件打爆 IndexedDB） */
export function assertFileSize(file: File, max = MAX_FILE_SIZE): void {
  if (file.size > max) {
    throw new AppError(
      'IMPORT_INVALID',
      `文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB，上限 ${(max / 1024 / 1024).toFixed(0)}MB）`,
    );
  }
}

/** 取扩展名（小写，不含点） */
export function extOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx + 1).toLowerCase();
}

/**
 * `extOf` 的同义别名。
 * ★ T11 的 `src/distill/parsers/*` 用的是 `extOfName`，为避免两处各写一份取扩展名的逻辑，
 *   这里统一导出别名指向同一实现（不是重复实现）。
 */
export const extOfName = extOf;

/** 按扩展名过滤文件 */
export function filterByExt(files: readonly File[], exts: readonly string[]): File[] {
  const set = new Set(exts.map((e) => e.replace(/^\./, '').toLowerCase()));
  return files.filter((f) => set.has(extOf(f.name)));
}

/**
 * 选择文件：优先 File System Access，退化到 `<input type="file">`。
 * 注意：必须在用户手势（click）的调用栈里触发，否则会被浏览器拒绝。
 */
export async function pickFiles(options: {
  multiple?: boolean;
  accept?: AcceptSpec;
  /** 目录兜底时是否允许 webkitdirectory */
  allowDirectory?: boolean;
} = {}): Promise<File[]> {
  const { multiple = false, accept, allowDirectory = false } = options;
  const w = fsAccess();

  if (w?.showOpenFilePicker) {
    try {
      const handles = await w.showOpenFilePicker({
        multiple,
        ...(accept ? { types: [accept], excludeAcceptAllOption: false } : {}),
      });
      const files = await Promise.all(handles.map((h) => h.getFile()));
      return files;
    } catch (e) {
      // 用户取消会抛 AbortError，向上传递即可
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      // 其它失败（如不支持 types）→ 走 input 兜底
    }
  }

  return pickFilesViaInput({ multiple, accept, allowDirectory });
}

/** 传统 input 选文件（返回 Promise） */
export function pickFilesViaInput(options: {
  multiple?: boolean;
  accept?: AcceptSpec;
  allowDirectory?: boolean;
} = {}): Promise<File[]> {
  const { multiple = false, accept, allowDirectory = false } = options;
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.style.display = 'none';
    if (accept) {
      input.accept = Object.keys(accept.accept)
        .flatMap((mime) => accept.accept[mime].map((ext) => (ext.startsWith('.') ? ext : `.${ext}`)))
        .join(',');
    }
    if (allowDirectory) {
      // 非标准属性，Chromium 支持
      input.setAttribute('webkitdirectory', '');
    }
    let settled = false;
    input.onchange = () => {
      settled = true;
      resolve(input.files ? Array.from(input.files) : []);
      input.remove();
    };
    // 用户取消没有可靠事件，用 window focus 兜底
    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve([]);
            input.remove();
          }
        }, 300);
      },
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  });
}

/** 递归读取目录（Chromium only；失败返回空数组） */
export async function readDirectoryRecursive(
  dir: DirectoryHandleLike,
  depth = 3,
): Promise<File[]> {
  const out: File[] = [];
  if (depth <= 0) return out;
  try {
    for await (const handle of dir.values()) {
      const h = handle as FileSystemFileHandleLike & DirectoryHandleLike;
      if (typeof h.getFile === 'function') {
        out.push(await h.getFile());
      } else if (typeof h.values === 'function') {
        out.push(...(await readDirectoryRecursive(h, depth - 1)));
      }
    }
  } catch {
    /* 目录遍历失败返回已收集的部分 */
  }
  return out;
}

/** 选择目录（Chromium only；不支持时返回 null 由调用方提示降级） */
export async function pickDirectory(): Promise<File[] | null> {
  const w = fsAccess();
  if (!w?.showDirectoryPicker) return null;
  try {
    const dir = await w.showDirectoryPicker();
    return await readDirectoryRecursive(dir);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return [];
    return null;
  }
}

/** 人类可读的文件体积 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
