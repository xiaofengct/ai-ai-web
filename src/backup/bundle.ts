import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { EXPORT_ROOT } from '@/constants/limits';
import { TABLE } from '@/constants/storageKeys';
import { tryCatchAsync, type Result } from '@/lib/result';
import { AppError } from '@/lib/errors';
import type { AppBackupBundle, BackupMeta } from '@/types/backup';
import type { ISODate } from '@/types/common';
import { blv } from './backupCopy';

/**
 * ★ 备份包格式定义（架构文档 §2 `src/backup/bundle.ts`、决策 A4、FN-03 / FN-47 / SV-08）。
 *
 * ============ zip 内目录约定（**全部在 zip 根目录，不加前缀**）============
 *   bundle.json                     本文件描述的索引（版本 / 表清单 / 计数）
 *   settings.json                   AppSettings（默认剥离 apiKey）
 *   personas/{name}-{id8}.json      单张角色卡（chara_card_v2 + extensions.aiyu）
 *   sessions/{id}.json              { session, messages }
 *   memories.json                   MemoryEntry[]
 *   stickers/{packId}/…             custom_stickers.json + 图片
 *   exes/{slug}/…                   ★ 决策 A4：严格还原 ex-skill 目录
 *                                   （memories.md / persona.md / meta.json / SKILL.md / versions/vN/…）
 *   distill/{slug}/job.json         蒸馏作业行（Web 版专有，原 skill 工程忽略）
 *   blobs/{逻辑路径}                其余二进制资产（立绘 / 参考音 / Live2D zip / 原材料）
 *   logs.jsonl                      日志（可选）
 *
 * ============ 为什么不加目录前缀 ========================================
 * 决策 A4 要求 `exes/{slug}/…` 位于 zip 根目录，这样原 ex-skill 工程**解压后可直接读取**。
 * 若整体套一层 `ai-ai-backup/`，A4 的自检就会失败。
 * 因此 `EXPORT_ROOT`（= `ai-ai-backup`）只用作**文件名前缀**，不做目录前缀。
 *
 * ============ 版本与兼容 ==============================================
 * - `BUNDLE_VERSION` 是当前写出的版本；
 * - 读到更高版本 → 拒绝导入并给「降级提示」（用更新版本的原应用导出再导入）；
 * - 读到无 `bundleVersion` 的旧包（如 T09 版导出的 `meta.json`）→ 按 `'0.9.0'` 处理，
 *   走「尽力而为」的部分还原（settings / personas / sessions / memories）。
 */

/** 当前备份包格式版本（**改动目录结构时必须自增**） */
export const BUNDLE_VERSION = '1.0.0';

/** 能完整还原的最低版本（低于它只能部分还原） */
export const MIN_FULL_SUPPORT_VERSION = '1.0.0';

/** 无版本标记的旧包按这个版本处理 */
export const LEGACY_BUNDLE_VERSION = '0.9.0';

/* ------------------------------ 文件名常量 ------------------------------ */

export const BUNDLE_INDEX_FILE = 'bundle.json';
/** 旧版（T09 BackupSection 导出）用的索引名，导入时一并认 */
export const LEGACY_INDEX_FILE = 'meta.json';
export const SETTINGS_FILE = 'settings.json';
export const MEMORIES_FILE = 'memories.json';
export const TIMBRE_FILE = 'timbres.json';
export const LIVE2D_FILE = 'live2d.json';
export const LOGS_FILE = 'logs.jsonl';
export const PERSONA_DIR = 'personas';
export const SESSION_DIR = 'sessions';
export const STICKER_DIR = 'stickers';
/** ★ 决策 A4：ex-skill 产物目录，必须在 zip 根 */
export const EXES_DIR = 'exes';
/** Web 版蒸馏作业行（原 skill 工程不认识，单独放） */
export const DISTILL_DIR = 'distill';
/** 其余二进制资产（保持 blobs 表的逻辑路径） */
export const BLOB_DIR = 'blobs';

/**
 * ★ 备份覆盖的表清单（与 `constants/storageKeys.TABLE` 一一对应）。
 * 注：`backups` 表自身**不入包**——否则备份会套娃式膨胀。
 */
export const BUNDLE_TABLES: readonly string[] = [
  TABLE.sessions,
  TABLE.messages,
  TABLE.personas,
  TABLE.memories,
  TABLE.stickers,
  TABLE.timbres,
  TABLE.live2d,
  TABLE.distillJobs,
  TABLE.distillArtifacts,
  TABLE.blobs,
  TABLE.settings,
  TABLE.logs,
] as const;

/** 备份包计数（比 `BackupMeta.counts` 更全，索引里用） */
export interface BundleCounts {
  sessions: number;
  messages: number;
  personas: number;
  memories: number;
  stickers: number;
  distillJobs: number;
  blobs: number;
  logs: number;
}

export function emptyCounts(): BundleCounts {
  return {
    sessions: 0,
    messages: 0,
    personas: 0,
    memories: 0,
    stickers: 0,
    distillJobs: 0,
    blobs: 0,
    logs: 0,
  };
}

/** 备份索引（写入 `bundle.json`） */
export interface BundleIndex {
  /** 格式版本，用于兼容与降级提示 */
  bundleVersion: string;
  appVersion: string;
  createdAt: ISODate;
  kind: BackupMeta['kind'];
  /** 本包覆盖的表清单（导入前可据此判断还原范围） */
  tables: readonly string[];
  counts: BundleCounts;
  /** 是否剥离了密钥（apiKey / 搜索 Key） */
  secretsStripped: boolean;
  /** 字节数（含索引之外的全部内容） */
  sizeBytes: number;
}

/** 组装索引（sizeBytes 由 `buildBundle` 回填） */
export function buildIndex(input: {
  appVersion: string;
  kind: BackupMeta['kind'];
  counts: BundleCounts;
  secretsStripped: boolean;
  createdAt?: ISODate;
  sizeBytes?: number;
}): BundleIndex {
  return {
    bundleVersion: BUNDLE_VERSION,
    appVersion: input.appVersion,
    createdAt: input.createdAt ?? nowISO(),
    kind: input.kind,
    tables: BUNDLE_TABLES,
    counts: input.counts,
    secretsStripped: input.secretsStripped,
    sizeBytes: input.sizeBytes ?? 0,
  };
}

/* ------------------------------ 体积与命名 ------------------------------ */

/** 计算一组文件的总字节数（string 按 UTF-8 计） */
export function sizeOfFiles(files: Readonly<Record<string, string | Uint8Array>>): number {
  let total = 0;
  for (const value of Object.values(files)) {
    total += typeof value === 'string' ? new TextEncoder().encode(value).byteLength : value.byteLength;
  }
  return total;
}

/** 角色卡文件名：`personas/{安全名}-{id前8}.json` */
export function personaFileName(name: string, id: string): string {
  const safe = name.replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 32) || 'persona';
  return `${PERSONA_DIR}/${safe}-${id.slice(0, 8)}.json`;
}

/** 会话文件名：`sessions/{id}.json` */
export function sessionFileName(id: string): string {
  return `${SESSION_DIR}/${id}.json`;
}

/** 备份文件名：`ai-ai-backup-YYYYMMDD-HHmm.zip`（`EXPORT_ROOT` 只作前缀） */
export function backupFileName(kind: BackupMeta['kind'] = 'manual', at: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `${EXPORT_ROOT}-${kind}-${stamp}.zip`;
}

/* ------------------------------ 组装与解析 ------------------------------ */

/**
 * 把散文件组装成 `AppBackupBundle`：
 * 先算体积 → 再回填索引 → 索引本身也进 files（保证导入时能读到）。
 */
export function buildBundle(
  files: Record<string, string | Uint8Array>,
  input: {
    appVersion: string;
    kind: BackupMeta['kind'];
    counts: BundleCounts;
    secretsStripped: boolean;
    id?: string;
  },
): AppBackupBundle {
  const createdAt = nowISO();
  // 索引尚未写入，先按现有内容算体积（差一个索引文件的几十字节，可接受）
  const sizeBytes = sizeOfFiles(files);
  const index = buildIndex({
    appVersion: input.appVersion,
    kind: input.kind,
    counts: input.counts,
    secretsStripped: input.secretsStripped,
    createdAt,
    sizeBytes,
  });
  files[BUNDLE_INDEX_FILE] = JSON.stringify(index, null, 2);

  const meta: BackupMeta = {
    id: input.id ?? newId(),
    createdAt,
    appVersion: input.appVersion,
    counts: {
      sessions: input.counts.sessions,
      messages: input.counts.messages,
      personas: input.counts.personas,
      memories: input.counts.memories,
    },
    sizeBytes,
    kind: input.kind,
  };

  return { meta, files };
}

/** 版本比较结果 */
export interface VersionCheck {
  /** 能否继续（false = 版本太新，应提示降级/升级应用） */
  compatible: boolean;
  /** 读到的是否比当前版本新 */
  newer: boolean;
  /** 是否旧包（只能部分还原） */
  legacy: boolean;
  /**
   * 面向用户的版本说明（走 `blv()`，不是英文）。
   * ★ 曾经这里写的是英文 message，而所有检查脚本只扫「连续中文」→ 英文泄漏完全静默。
   *   英文只进日志与开发者页，UI 上一律是文案。
   */
  hint: string;
}

/**
 * 版本校验。
 * ★ 高版本包**不硬拒**：尽量还原已知部分，但 `compatible=false` 时 UI 要给出降级提示。
 */
export function checkBundleVersion(version: string | undefined): VersionCheck {
  // ★ hint 面向用户，走域内文案表；英文 message 只进日志与开发者页
  if (!version) {
    return {
      compatible: true,
      newer: false,
      legacy: true,
      hint: blv('bundle.hint.noVersion', { v: LEGACY_BUNDLE_VERSION }),
    };
  }
  const cmp = compareVersion(version, BUNDLE_VERSION);
  if (cmp > 0) {
    return {
      compatible: false,
      newer: true,
      legacy: false,
      hint: blv('bundle.hint.newer', { v: version }),
    };
  }
  if (cmp < 0) {
    return {
      compatible: true,
      newer: false,
      legacy: compareVersion(version, MIN_FULL_SUPPORT_VERSION) < 0,
      hint: blv('bundle.hint.older', { v: version }),
    };
  }
  return { compatible: true, newer: false, legacy: false, hint: blv('bundle.hint.match', { v: version }) };
}

/** 语义化版本比较（只比较前两段三段数字，忽略后缀） */
export function compareVersion(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((s) => Number.parseInt(s, 10) || 0);
  const pb = b.split(/[.-]/).map((s) => Number.parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * 从解包结果里读索引。
 * 兼容三种情况：① `bundle.json`（本版）② `meta.json`（T09 旧版）③ 完全没有索引（尽力还原）。
 */
export function readIndex(files: ReadonlyMap<string, Uint8Array>): Promise<Result<BundleIndex>> {
  return tryCatchAsync(async () => {
    const raw = readEntryText(files, BUNDLE_INDEX_FILE) ?? readEntryText(files, LEGACY_INDEX_FILE);
    if (!raw) {
      throw new AppError('IMPORT_INVALID', 'not an ai-ai backup: bundle.json is missing', undefined);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new AppError('PARSE_FAIL', 'bundle.json is not valid JSON', e);
    }
    return normalizeIndex(parsed);
  }, 'IMPORT_INVALID');
}

/** 把任意形状的索引收敛成 `BundleIndex`（缺字段一律填兜底） */
export function normalizeIndex(raw: unknown): BundleIndex {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const countsRaw = (typeof obj.counts === 'object' && obj.counts !== null ? obj.counts : {}) as Record<string, unknown>;
  const counts = emptyCounts();
  for (const key of Object.keys(counts) as (keyof BundleCounts)[]) {
    const value = countsRaw[key];
    if (typeof value === 'number' && Number.isFinite(value)) counts[key] = value;
  }
  const tables = Array.isArray(obj.tables)
    ? obj.tables.filter((t): t is string => typeof t === 'string')
    : [...BUNDLE_TABLES];
  const kind = obj.kind === 'auto' ? 'auto' : 'manual';

  return {
    bundleVersion: typeof obj.bundleVersion === 'string' ? obj.bundleVersion : LEGACY_BUNDLE_VERSION,
    appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : '0.0.0',
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : typeof obj.exportedAt === 'string' ? obj.exportedAt : nowISO(),
    kind,
    tables,
    counts,
    secretsStripped: obj.secretsStripped === true,
    sizeBytes: typeof obj.sizeBytes === 'number' ? obj.sizeBytes : 0,
  };
}

/* ------------------------------ 解包辅助 ------------------------------ */

/**
 * 按相对路径取字节。
 * 依次尝试：精确路径 → 忽略 `ai-ai-backup/` 前缀 → 忽略大小写与目录前缀的尾部匹配。
 */
export function readEntry(files: ReadonlyMap<string, Uint8Array>, relPath: string): Uint8Array | undefined {
  const direct = files.get(relPath);
  if (direct) return direct;
  const stripped = files.get(`${EXPORT_ROOT}/${relPath}`);
  if (stripped) return stripped;

  const target = relPath.replace(/^\/+/, '').toLowerCase();
  for (const [path, value] of files) {
    const p = path.replace(/^\/+/, '').toLowerCase();
    if (p === target) return value;
  }
  const tail = target.split('/').pop() ?? target;
  for (const [path, value] of files) {
    const p = path.replace(/^\/+/, '').toLowerCase();
    if (p === tail || p.endsWith(`/${tail}`)) return value;
  }
  return undefined;
}

/** 按相对路径读文本 */
export function readEntryText(files: ReadonlyMap<string, Uint8Array>, relPath: string): string | undefined {
  const hit = readEntry(files, relPath);
  return hit ? new TextDecoder('utf-8').decode(hit) : undefined;
}

/** 列出某目录下的直接子路径（用于 `personas/*.json` 这类通配） */
export function listDir(files: ReadonlyMap<string, Uint8Array>, dir: string): string[] {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  const out: string[] = [];
  for (const path of files.keys()) {
    const normalized = path.replace(/^\/+/, '');
    const withoutRoot = normalized.startsWith(`${EXPORT_ROOT}/`) ? normalized.slice(EXPORT_ROOT.length + 1) : normalized;
    if (!withoutRoot.startsWith(prefix)) continue;
    const rest = withoutRoot.slice(prefix.length);
    if (rest.length === 0 || rest.includes('/')) continue;
    out.push(withoutRoot);
  }
  return out.sort();
}

/**
 * 列出某目录下的**一级子目录名**（如 `stickers/{packId}`、`exes/{slug}`、`versions/v1`）。
 * ★ `listDir` 只返回「直接子文件」，而 stickers / exes / versions 都是「目录下还有目录」，
 *   这两个场景必须分开，否则 `stickers/{packId}/x.json` 会被 `listDir` 当成非直接子项漏掉。
 */
export function listSubDirs(files: ReadonlyMap<string, Uint8Array>, dir: string): string[] {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  const set = new Set<string>();
  for (const path of files.keys()) {
    const normalized = path.replace(/^\/+/, '');
    const withoutRoot = normalized.startsWith(`${EXPORT_ROOT}/`) ? normalized.slice(EXPORT_ROOT.length + 1) : normalized;
    if (!withoutRoot.startsWith(prefix)) continue;
    const rest = withoutRoot.slice(prefix.length);
    if (!rest.includes('/')) continue; // 直接子文件，不是目录
    const first = rest.split('/')[0] ?? '';
    if (first) set.add(first);
  }
  return [...set].sort();
}

/** 列出某目录（递归）下的全部路径 */
export function listDirDeep(files: ReadonlyMap<string, Uint8Array>, dir: string): string[] {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  const out: string[] = [];
  for (const path of files.keys()) {
    const normalized = path.replace(/^\/+/, '');
    const withoutRoot = normalized.startsWith(`${EXPORT_ROOT}/`) ? normalized.slice(EXPORT_ROOT.length + 1) : normalized;
    if (withoutRoot.startsWith(prefix)) out.push(withoutRoot);
  }
  return out.sort();
}

/**
 * ★ 错误码 → 文案 key（导入导出共用）。
 * 面向用户只给「承担责任」的欣然口吻，绝不把英文原始 message 直接弹给用户。
 */
export function copyKeyForError(code: string | undefined):
  | 'err.importInvalid'
  | 'err.parseFail'
  | 'err.parseUnsupported'
  | 'err.privacyBlock'
  | 'err.dbFailed'
  | 'err.storageFull'
  | 'err.unknown' {
  switch (code) {
    case 'IMPORT_INVALID':
      return 'err.importInvalid';
    case 'PARSE_FAIL':
      return 'err.parseFail';
    case 'PARSE_UNSUPPORTED':
      return 'err.parseUnsupported';
    case 'PRIVACY_BLOCK':
      return 'err.privacyBlock';
    case 'DB_FAILED':
      return 'err.dbFailed';
    case 'STORAGE_FULL':
      return 'err.storageFull';
    default:
      return 'err.unknown';
  }
}
