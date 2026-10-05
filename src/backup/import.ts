import { db } from '@/db/db';
import { blobRepo } from '@/db/repo/blobRepo';
import { personaRepo } from '@/db/repo/personaRepo';
import { memoryRepo } from '@/db/repo/memoryRepo';
import { stickerRepo } from '@/db/repo/stickerRepo';
import { importJsonText } from '@/persona/importer';
import { migrateSettings } from '@/constants/defaults';
import { newId } from '@/lib/id';
import { unzipFile } from '@/lib/zip';
import { tryCatchAsync, unwrapOr, type Result } from '@/lib/result';
import { AppError, toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { useSettingsStore } from '@/store/settingsStore';
import { t } from '@/copy';
import { bl, blv } from './backupCopy';
import type { ImportReport } from '@/types/backup';
import type { PersonaCard } from '@/types/persona';
import type { MemoryEntry } from '@/types/memory';
import type { StickerItem } from '@/types/media';
import type { UUID } from '@/types/common';
import {
  BLOB_DIR,
  DISTILL_DIR,
  EXES_DIR,
  LIVE2D_FILE,
  LOGS_FILE,
  MEMORIES_FILE,
  PERSONA_DIR,
  SESSION_DIR,
  SETTINGS_FILE,
  STICKER_DIR,
  TIMBRE_FILE,
  type BundleIndex,
  checkBundleVersion,
  copyKeyForError,
  listDir,
  listDirDeep,
  listSubDirs,
  readEntry,
  readEntryText,
  readIndex,
  type VersionCheck,
} from './bundle';

/**
 * ★ 一键导入（FN-02 / FN-03 回环 / 决策 A4）。
 *
 * 原则：
 * 1. **单文件失败不影响其它文件**——每一项都进 `ImportReport`，UI 逐条给出失败原因；
 * 2. **只有「一个都没解析出来」才整体失败**（抛 `IMPORT_INVALID`）；
 * 3. 高版本包不硬拒：尽量还原已知部分，但 `version.compatible=false` 时 UI 必须给降级提示；
 * 4. 会话 / 消息 / 蒸馏走 **Dexie 原始行**（与 `export.ts` 对称，保证无损往返）。
 *
 * 注：`lib/zip` 的读取函数签名是 `Map<string, Uint8Array>`，这里统一用 `asMap()` 适配
 * `ReadonlyMap`（`src/lib/` 属工程师 A 的地盘，不改动它的签名）。
 */

/** 同名 / 同 id 冲突时的处理策略 */
export type ConflictStrategy = 'overwrite' | 'skip' | 'rename';

export interface ImportOptions {
  strategy?: ConflictStrategy;
}

/** 备份包体检结果（导入前给 UI 展示，决定是否继续） */
export interface BackupInspection {
  index: BundleIndex;
  version: VersionCheck;
  files: Map<string, Uint8Array>;
}

/* ------------------------------ 小工具 ------------------------------ */

function asMap(files: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
  return files as Map<string, Uint8Array>;
}

function text(files: ReadonlyMap<string, Uint8Array>, relPath: string): string | undefined {
  return readEntryText(asMap(files), relPath);
}

function bytesOf(files: ReadonlyMap<string, Uint8Array>, relPath: string): Uint8Array | undefined {
  return readEntry(asMap(files), relPath);
}

function dir(files: ReadonlyMap<string, Uint8Array>, relDir: string): string[] {
  return listDir(asMap(files), relDir);
}

function dirDeep(files: ReadonlyMap<string, Uint8Array>, relDir: string): string[] {
  return listDirDeep(asMap(files), relDir);
}

/** 一级子目录名（stickers/{packId}、exes/{slug}、versions/{vN}） */
function subDirs(files: ReadonlyMap<string, Uint8Array>, relDir: string): string[] {
  return listSubDirs(asMap(files), relDir);
}

function emptyReport(): ImportReport {
  return { total: 0, success: 0, failed: 0, items: [] };
}

function pushItem(report: ImportReport, name: string, ok: boolean, reason?: string): void {
  report.total += 1;
  report.items.push(ok ? { name, ok } : { name, ok, reason });
  if (ok) report.success += 1;
  else report.failed += 1;
}

/** `toAppError` 的兜底码联合（避免手写字面量写错） */
type FailCode = Parameters<typeof toAppError>[1];

/**
 * ★ 失败原因**必须转文案**，不能把 `AppError.message` 直接给用户看。
 *
 * 背景：`ImportReport.items[].reason` 在 UI 上是「原因：{reason}」原样渲染的，
 * 而 `AppError.message` 按约定是**英文、只进日志与开发者页**。
 * 以前这里直接传 `.message`，用户会看到一句没头没尾的英文；
 * 而所有检查脚本只扫「连续中文」，对英文完全静默，所以一直没被发现。
 *
 * 现在的分工：英文 message 进 `log`（开发者页可查），返回给用户的是 `t(copyKeyForError(code))`。
 */
function failReason(e: unknown, code: FailCode): string {
  const appErr = toAppError(e, code);
  log.warn('backup', 'import item failed', { code: appErr.code, message: appErr.message }, 'FN-02');
  return t(copyKeyForError(appErr.code));
}

function guessMime(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

/* ------------------------------ 入口 ------------------------------ */

/** 解包并做版本校验（不写库） */
export async function inspectBackupFile(file: Blob): Promise<Result<BackupInspection>> {
  return tryCatchAsync(async () => {
    const files = await unzipFile(file);
    const indexRes = await readIndex(files);
    const index: BundleIndex = indexRes.ok
      ? indexRes.value
      : {
          bundleVersion: '0.9.0',
          appVersion: '0.0.0',
          createdAt: new Date().toISOString(),
          kind: 'manual',
          tables: [],
          counts: {
            sessions: 0,
            messages: 0,
            personas: 0,
            memories: 0,
            stickers: 0,
            distillJobs: 0,
            blobs: 0,
            logs: 0,
          },
          secretsStripped: false,
          sizeBytes: 0,
        };
    const version = checkBundleVersion(indexRes.ok ? index.bundleVersion : undefined);
    if (!version.compatible) {
      log.warn('backup', 'bundle version too new', { version: index.bundleVersion }, 'FN-02');
    }
    return { index, version, files };
  }, 'IMPORT_INVALID');
}

/** 直接导入一个 zip（体检 + 还原一步到位） */
export async function importBackupFile(file: Blob, options: ImportOptions = {}): Promise<Result<ImportReport>> {
  const inspection = await inspectBackupFile(file);
  if (!inspection.ok) return inspection;
  return importBackupFiles(inspection.value.files, inspection.value.index, options);
}

/** 还原已解包的内容（主入口） */
export async function importBackupFiles(
  files: ReadonlyMap<string, Uint8Array>,
  index: BundleIndex,
  options: ImportOptions = {},
): Promise<Result<ImportReport>> {
  return tryCatchAsync(async () => {
    const strategy = options.strategy ?? 'overwrite';
    const report = emptyReport();

    await restoreSettings(files, report);
    await restorePersonas(files, report, strategy);
    await restoreSessions(files, report, strategy);
    await restoreMemories(files, report);
    await restoreStickers(files, report);
    await restoreDistill(files, report);
    await restoreTimbres(files, report);
    await restoreBlobs(files, report);
    await restoreLogs(files, report);

    if (report.total === 0 || report.success === 0) {
      throw new AppError('IMPORT_INVALID', 'no restorable entry found in bundle', {
        bundleVersion: index.bundleVersion,
      });
    }
    log.info('backup', 'bundle restored', { total: report.total, failed: report.failed }, 'FN-02');
    return report;
  }, 'IMPORT_INVALID');
}

/* ------------------------------ 各表还原 ------------------------------ */

/** settings.json → 深合并进当前设置（缺字段用默认值补齐，绝不把新字段冲成 undefined） */
async function restoreSettings(files: ReadonlyMap<string, Uint8Array>, report: ImportReport): Promise<void> {
  const raw = text(files, SETTINGS_FILE);
  if (!raw) return;
  try {
    useSettingsStore.getState().patch(migrateSettings(JSON.parse(raw) as unknown));
    pushItem(report, SETTINGS_FILE, true);
  } catch (e) {
    pushItem(report, SETTINGS_FILE, false, failReason(e, 'PARSE_FAIL'));
  }
}

/**
 * 解析单张角色卡：
 * 优先按 **完整 PersonaCard**（Web 备份格式，`toWebBackup` 的产物）还原，保留 id / origin / 隐私；
 * 否则退回 `importer.importJsonText`（原应用变体 A/B、单卡裸 JSON）。
 */
export function parsePersonaCards(raw: string, fileName: string): PersonaCard[] {
  const parsed: unknown = JSON.parse(raw);
  if (isFullCard(parsed)) return [parsed as PersonaCard];
  if (Array.isArray(parsed)) return parsed.filter(isFullCard).map((c) => c as PersonaCard);
  return importJsonText(raw, fileName);
}

function isFullCard(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const card = value as Partial<PersonaCard>;
  return card.spec === 'chara_card_v2' && typeof card.id === 'string' && typeof card.data === 'object';
}

async function restorePersonas(
  files: ReadonlyMap<string, Uint8Array>,
  report: ImportReport,
  strategy: ConflictStrategy,
): Promise<void> {
  const paths = dirDeep(files, PERSONA_DIR).filter((p) => p.toLowerCase().endsWith('.json'));
  for (const path of paths) {
    const raw = text(files, path);
    if (!raw) continue;
    try {
      const cards = parsePersonaCards(raw, path);
      const accepted: PersonaCard[] = [];
      for (const card of cards) {
        const exists = unwrapOr(await personaRepo.exists(card.id), false);
        if (exists && strategy === 'skip') continue;
        accepted.push(exists && strategy === 'rename' ? { ...card, id: newId() } : card);
      }
      if (accepted.length > 0) {
        const res = await personaRepo.importCards(accepted);
        if (!res.ok) throw res.error;
      }
      pushItem(report, path, true);
    } catch (e) {
      pushItem(report, path, false, failReason(e, 'IMPORT_INVALID'));
    }
  }
}

interface SessionBundleFile {
  session: Record<string, unknown> & { id: UUID };
  messages: Record<string, unknown>[];
}

async function restoreSessions(
  files: ReadonlyMap<string, Uint8Array>,
  report: ImportReport,
  strategy: ConflictStrategy,
): Promise<void> {
  const paths = dir(files, SESSION_DIR).filter((p) => p.toLowerCase().endsWith('.json'));
  for (const path of paths) {
    const raw = text(files, path);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as SessionBundleFile;
      if (!parsed.session || typeof parsed.session.id !== 'string') {
        throw new AppError('IMPORT_INVALID', `${path} missing session.id`, undefined);
      }
      const exists = (await db.sessions.get(parsed.session.id)) !== undefined;
      if (exists && strategy === 'skip') {
        pushItem(report, path, true);
        continue;
      }
      const sessionId = exists && strategy === 'rename' ? newId() : parsed.session.id;
      const sessionRow = { ...parsed.session, id: sessionId };
      const messageRows = (Array.isArray(parsed.messages) ? parsed.messages : []).map((m) => ({
        ...m,
        sessionId,
      }));
      await db.transaction('rw', db.sessions, db.messages, async () => {
        await db.sessions.put(sessionRow as never);
        if (messageRows.length > 0) await db.messages.bulkPut(messageRows as never[]);
      });
      pushItem(report, path, true);
    } catch (e) {
      pushItem(report, path, false, failReason(e, 'IMPORT_INVALID'));
    }
  }
}

async function restoreMemories(files: ReadonlyMap<string, Uint8Array>, report: ImportReport): Promise<void> {
  const raw = text(files, MEMORIES_FILE);
  if (!raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    const entries = (Array.isArray(parsed) ? parsed : []) as MemoryEntry[];
    const valid = entries.filter((e) => typeof e?.id === 'string' && typeof e?.content === 'string');
    if (valid.length === 0) {
      pushItem(report, MEMORIES_FILE, true);
      return;
    }
    // ★ 走 repo 的 importEntries：按相似度去重合并，避免导入一次记忆翻倍
    const res = await memoryRepo.importEntries(valid);
    if (!res.ok) throw res.error;
    pushItem(report, MEMORIES_FILE, true);
  } catch (e) {
    pushItem(report, MEMORIES_FILE, false, failReason(e, 'IMPORT_INVALID'));
  }
}

async function restoreStickers(files: ReadonlyMap<string, Uint8Array>, report: ImportReport): Promise<void> {
  // ★ 表情包是「stickers/{packId}/…」两级目录，用 listSubDirs 取包 id
  const packIds = subDirs(files, STICKER_DIR);
  for (const packId of packIds) {
    if (!packId) continue;
    const raw = text(files, `${STICKER_DIR}/${packId}/custom_stickers.json`);
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const rawItems = (Array.isArray(parsed) ? parsed : []) as Array<{ description?: string; fileName?: string }>;
      const items: StickerItem[] = [];
      for (const entry of rawItems) {
        const fileName = entry.fileName?.trim();
        if (!fileName) continue;
        const bytes = bytesOf(files, `${STICKER_DIR}/${packId}/${fileName}`);
        let assetId: UUID | undefined;
        if (bytes) {
          const put = await blobRepo.put(`stickers/${packId}/${fileName}`, bytes, guessMime(fileName));
          if (put.ok) assetId = put.value;
        }
        items.push({ description: entry.description?.trim() || fileName, fileName, assetId });
      }
      if (items.length === 0) {
        pushItem(report, `${STICKER_DIR}/${packId}`, false, bl('import.reason.stickerEmpty'));
        continue;
      }
      const res = await stickerRepo.upsert({
        id: packId,
        name: packId,
        items,
        createdAt: new Date().toISOString(),
        enabled: true,
      });
      if (!res.ok) throw res.error;
      pushItem(report, `${STICKER_DIR}/${packId}`, true);
    } catch (e) {
      pushItem(report, `${STICKER_DIR}/${packId}`, false, failReason(e, 'IMPORT_INVALID'));
    }
  }
}

/**
 * 蒸馏还原（★ 决策 A4）：
 * `exes/{slug}/…` 是产物正文，`distill/{slug}/job.json` 是作业行。
 * 产物以 jobId 为主键，所以**必须先建作业**（按 slug 查不到就跳过该产物）。
 */
async function restoreDistill(files: ReadonlyMap<string, Uint8Array>, report: ImportReport): Promise<void> {
  const jobPaths = dirDeep(files, DISTILL_DIR).filter((p) => p.toLowerCase().endsWith('/job.json'));
  for (const path of jobPaths) {
    const raw = text(files, path);
    if (!raw) continue;
    try {
      await db.distillJobs.put(JSON.parse(raw) as never);
      pushItem(report, path, true);
    } catch (e) {
      pushItem(report, path, false, failReason(e, 'IMPORT_INVALID'));
    }
  }

  // ★ 产物是「exes/{slug}/…」，同样两级目录
  const slugs = subDirs(files, EXES_DIR);
  for (const slug of slugs) {
    if (!slug) continue;
    try {
      const job = await db.distillJobs.where('slug').equals(slug).first();
      if (!job) {
        pushItem(report, `${EXES_DIR}/${slug}`, false, bl('import.reason.noDistillJob'));
        continue;
      }
      const versionNames = subDirs(files, `${EXES_DIR}/${slug}/versions`);
      const versions = versionNames.map((name) => ({
        version: name,
        createdAt: new Date().toISOString(),
        snapshot: {
          memoriesMd: text(files, `${EXES_DIR}/${slug}/versions/${name}/memories.md`) ?? '',
          personaMd: text(files, `${EXES_DIR}/${slug}/versions/${name}/persona.md`) ?? '',
        },
        note: text(files, `${EXES_DIR}/${slug}/versions/${name}/note.txt`),
      }));

      await db.distillArtifacts.put({
        jobId: job.id,
        slug,
        memoriesMd: text(files, `${EXES_DIR}/${slug}/memories.md`) ?? '',
        personaMd: text(files, `${EXES_DIR}/${slug}/persona.md`) ?? '',
        metaJson: text(files, `${EXES_DIR}/${slug}/meta.json`) ?? '{}',
        skillMd: text(files, `${EXES_DIR}/${slug}/SKILL.md`) ?? '',
        versions,
        updatedAt: new Date().toISOString(),
      } as never);
      pushItem(report, `${EXES_DIR}/${slug}`, true);
    } catch (e) {
      pushItem(report, `${EXES_DIR}/${slug}`, false, failReason(e, 'IMPORT_INVALID'));
    }
  }
}

/** timbres.json / live2d.json（元数据行，二进制本体在 blobs） */
async function restoreTimbres(files: ReadonlyMap<string, Uint8Array>, report: ImportReport): Promise<void> {
  const pairs: Array<[string, 'db.timbres' | 'db.live2d']> = [];
  const timbreRaw = text(files, TIMBRE_FILE);
  if (timbreRaw) pairs.push([timbreRaw, 'db.timbres']);
  const live2dRaw = text(files, LIVE2D_FILE);
  if (live2dRaw) pairs.push([live2dRaw, 'db.live2d']);

  for (const [raw, target] of pairs) {
    const name = target === 'db.timbres' ? TIMBRE_FILE : LIVE2D_FILE;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) continue;
      if (target === 'db.timbres') await db.timbres.bulkPut(parsed as never[]);
      else await db.live2d.bulkPut(parsed as never[]);
      pushItem(report, name, true);
    } catch (e) {
      pushItem(report, name, false, failReason(e, 'IMPORT_INVALID'));
    }
  }
}

/** 其余二进制资产：按 blobs 的逻辑路径原样写回 */
async function restoreBlobs(files: ReadonlyMap<string, Uint8Array>, report: ImportReport): Promise<void> {
  const paths = dirDeep(files, BLOB_DIR);
  let ok = 0;
  let failed = 0;
  for (const path of paths) {
    const bytes = bytesOf(files, path);
    if (!bytes) continue;
    const logical = path.slice(BLOB_DIR.length + 1);
    if (!logical) continue;
    const res = await blobRepo.put(logical, bytes, guessMime(logical));
    if (res.ok) ok += 1;
    else failed += 1;
  }
  if (ok + failed === 0) return;
  pushItem(
    report,
    `${BLOB_DIR}/ (${ok})`,
    failed === 0,
    failed > 0 ? blv('import.reason.blobFailed', { n: failed }) : undefined,
  );
}

async function restoreLogs(files: ReadonlyMap<string, Uint8Array>, report: ImportReport): Promise<void> {
  const raw = text(files, LOGS_FILE);
  if (!raw) return;
  try {
    const rows = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    if (rows.length === 0) return;
    await db.logs.bulkPut(rows as never[]);
    pushItem(report, LOGS_FILE, true);
  } catch (e) {
    pushItem(report, LOGS_FILE, false, failReason(e, 'IMPORT_INVALID'));
  }
}
