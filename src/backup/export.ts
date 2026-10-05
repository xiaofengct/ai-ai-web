import { db } from '@/db/db';
import { blobRepo } from '@/db/repo/blobRepo';
import { personaRepo } from '@/db/repo/personaRepo';
import { memoryRepo } from '@/db/repo/memoryRepo';
import { stickerRepo } from '@/db/repo/stickerRepo';
import { logRepo } from '@/db/repo/logRepo';
import { toWebBackup, safeFileName } from '@/persona/exporter';
import { zipFiles } from '@/lib/zip';
import { downloadBytes } from '@/lib/download';
import { nowISO } from '@/lib/time';
import { tryCatchAsync, type Result } from '@/lib/result';
import { log } from '@/store/logStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { AppSettings } from '@/types/settings';
import type { AppBackupBundle } from '@/types/backup';
import type { BundleCounts } from './bundle';
import {
  BLOB_DIR,
  DISTILL_DIR,
  EXES_DIR,
  LIVE2D_FILE,
  LOGS_FILE,
  MEMORIES_FILE,
  SETTINGS_FILE,
  STICKER_DIR,
  TIMBRE_FILE,
  backupFileName,
  buildBundle,
  emptyCounts,
  personaFileName,
  sessionFileName,
} from './bundle';

/**
 * ★ 一键导出（FN-03 / SV-08 / 决策 A4）。
 *
 * 产物是**本地 zip**，全程不碰网络（`docs/03-决策记录.md` A7：默认零外发）。
 *
 * 两个关键取舍：
 * 1. **默认剥离密钥**（`stripSecrets=true`）：apiKey 只存在本机（A5），
 *    备份文件一旦被分享出去就会泄露，因此不写进 zip，并在索引里标记 `secretsStripped`；
 * 2. **会话/消息/蒸馏用原始行导出**：这几张表用了 0/1 编码 boolean、内嵌 versions 数组，
 *    走领域对象往返会丢字段，直接用 Dexie 原始行 `bulkPut` 才能做到「导出 → 再导入」无损。
 */

/** 单包允许写入的二进制资产总量（超出后跳过并记录告警，避免打爆内存） */
const MAX_BLOB_BYTES = 200 * 1024 * 1024;

export interface ExportOptions {
  kind?: AppBackupBundle['meta']['kind'];
  /** 是否带日志（默认跟随 `settings.dev.exportLogs`） */
  includeLogs?: boolean;
  /** 是否剥离 apiKey（默认 true，见文件头说明） */
  stripSecrets?: boolean;
  /** 覆盖 appVersion（默认取 `import.meta.env.VITE_APP_VERSION`） */
  appVersion?: string;
}

function currentAppVersion(): string {
  try {
    return import.meta.env?.VITE_APP_VERSION ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}

/** 剥离密钥：Provider 的 apiKey 与联网搜索的 Key 一律不进备份 */
function stripSecrets(settings: AppSettings): AppSettings {
  return {
    ...settings,
    providers: (settings.providers ?? []).map((p) => ({ ...p, apiKey: undefined })),
    chat: {
      ...settings.chat,
      webSearch: { ...settings.chat.webSearch, apiKey: '' },
    },
  };
}

/** 收集全部待打包文件 + 计数 */
export async function collectBundleFiles(
  options: ExportOptions = {},
): Promise<Result<{ files: Record<string, string | Uint8Array>; counts: BundleCounts }>> {
  return tryCatchAsync(async () => {
    const files: Record<string, string | Uint8Array> = {};
    const counts = emptyCounts();

    /* —— settings.json —— */
    const settings = useSettingsStore.getState().settings;
    const strip = options.stripSecrets ?? true;
    files[SETTINGS_FILE] = JSON.stringify(strip ? stripSecrets(settings) : settings, null, 2);

    /* —— personas/*.json（chara_card_v2 + extensions.aiyu）—— */
    const personaRes = await personaRepo.listAll();
    const personas = personaRes.ok ? personaRes.value : [];
    if (!personaRes.ok) log.warn('backup', '读取角色列表失败', personaRes.error, 'FN-03');
    for (const card of personas) {
      files[personaFileName(safeFileName(card.data.name), card.id)] = JSON.stringify(toWebBackup(card), null, 2);
      counts.personas += 1;
    }

    /* —— sessions/{id}.json（原始行 + 原始消息行，保证无损）—— */
    const sessionRows = await db.sessions.toArray();
    counts.sessions = sessionRows.length;
    for (const row of sessionRows) {
      const messages = await db.messages.where('sessionId').equals(row.id).toArray();
      counts.messages += messages.length;
      files[sessionFileName(row.id)] = JSON.stringify({ session: row, messages }, null, 2);
    }

    /* —— memories.json —— */
    const memoryRes = await memoryRepo.listByScope('global', undefined, 100_000);
    const memories = memoryRes.ok ? memoryRes.value : [];
    if (!memoryRes.ok) log.warn('backup', '读取记忆失败', memoryRes.error, 'FN-03');
    counts.memories = memories.length;
    files[MEMORIES_FILE] = JSON.stringify(memories, null, 2);

    /* —— stickers/{packId}/（语义标签 json + 图片字节）—— */
    const packRes = await stickerRepo.list();
    const packs = packRes.ok ? packRes.value : [];
    for (const pack of packs) {
      counts.stickers += 1;
      files[`${STICKER_DIR}/${pack.id}/custom_stickers.json`] = JSON.stringify(
        pack.items.map((it) => ({ description: it.description, fileName: it.fileName })),
        null,
        2,
      );
      for (const item of pack.items) {
        if (!item.assetId) continue;
        const bytesRes = await blobRepo.getBytes(item.assetId);
        if (!bytesRes.ok || !bytesRes.value) continue;
        files[`${STICKER_DIR}/${pack.id}/${item.fileName}`] = bytesRes.value;
      }
    }

    /* —— exes/{slug}/…（★ 决策 A4：zip 根目录严格还原 ex-skill 结构）—— */
    const artifactRows = await db.distillArtifacts.toArray();
    for (const art of artifactRows) {
      const base = `${EXES_DIR}/${art.slug}`;
      files[`${base}/memories.md`] = art.memoriesMd ?? '';
      files[`${base}/persona.md`] = art.personaMd ?? '';
      files[`${base}/meta.json`] = art.metaJson ?? '{}';
      files[`${base}/SKILL.md`] = art.skillMd ?? '';
      const versions = (art.versions ?? []) as Array<{
        version?: string;
        snapshot?: { memoriesMd?: string; personaMd?: string };
        note?: string;
      }>;
      for (const v of versions) {
        const dir = `${base}/versions/${v.version ?? 'v?'}`;
        files[`${dir}/memories.md`] = v.snapshot?.memoriesMd ?? '';
        files[`${dir}/persona.md`] = v.snapshot?.personaMd ?? '';
        if (v.note) files[`${dir}/note.txt`] = v.note;
      }
    }

    /* —— distill/{slug}/job.json（作业行，Web 专有）—— */
    const jobRows = await db.distillJobs.toArray();
    counts.distillJobs = jobRows.length;
    for (const job of jobRows) {
      files[`${DISTILL_DIR}/${job.slug}/job.json`] = JSON.stringify(job, null, 2);
    }

    /* —— timbres.json / live2d.json（元数据行，本体在 blobs）—— */
    const timbreRows = await db.timbres.toArray();
    if (timbreRows.length > 0) files[TIMBRE_FILE] = JSON.stringify(timbreRows, null, 2);
    const live2dRows = await db.live2d.toArray();
    if (live2dRows.length > 0) files[LIVE2D_FILE] = JSON.stringify(live2dRows, null, 2);

    /* —— blobs/{逻辑路径}（立绘 / 参考音 / Live2D / 蒸馏原材料；排除备份自身）—— */
    const blobRes = await blobRepo.list();
    const blobs = blobRes.ok ? blobRes.value : [];
    let blobBytes = 0;
    for (const record of blobs) {
      // ★ 备份里不再套备份：`backups/` 前缀的资产跳过，否则每次备份都会翻倍
      if (record.path.startsWith('backups/')) continue;
      if (blobBytes + record.size > MAX_BLOB_BYTES) {
        log.warn('backup', '二进制资产超出上限，已跳过剩余部分', { path: record.path }, 'FN-03');
        break;
      }
      const bytesRes = await blobRepo.getBytes(record.id);
      if (!bytesRes.ok || !bytesRes.value) continue;
      files[`${BLOB_DIR}/${record.path}`] = bytesRes.value;
      blobBytes += bytesRes.value.byteLength;
      counts.blobs += 1;
    }

    /* —— logs.jsonl（可选）—— */
    const includeLogs = options.includeLogs ?? useSettingsStore.getState().settings.dev.exportLogs === true;
    if (includeLogs) {
      // 日志导出失败不影响主流程：写空文件而不是让整个备份失败
      const logsRes = await logRepo.exportJSONL();
      const text = logsRes.ok ? logsRes.value : '';
      counts.logs = text ? text.split('\n').filter(Boolean).length : 0;
      files[LOGS_FILE] = text;
    }

    return { files, counts };
  }, 'DB_FAILED');
}

/** 组装 `AppBackupBundle`（不落盘、不下载） */
export async function exportBundle(options: ExportOptions = {}): Promise<Result<AppBackupBundle>> {
  return tryCatchAsync(async () => {
    const collected = await collectBundleFiles(options);
    if (!collected.ok) throw collected.error;
    const kind = options.kind ?? 'manual';
    const bundle = buildBundle(collected.value.files, {
      appVersion: options.appVersion ?? currentAppVersion(),
      kind,
      counts: collected.value.counts,
      secretsStripped: options.stripSecrets ?? true,
    });
    log.info(
      'backup',
      'bundle assembled',
      { kind, counts: collected.value.counts, sizeBytes: bundle.meta.sizeBytes },
      'FN-03',
    );
    return bundle;
  }, 'DB_FAILED');
}

/** bundle → zip 字节 */
export function bundleToZip(bundle: AppBackupBundle): Uint8Array {
  return zipFiles(bundle.files);
}

/** 打包并触发下载（FN-03 主入口，给 UI 调用） */
export async function downloadBackup(options: ExportOptions = {}): Promise<Result<AppBackupBundle>> {
  const res = await exportBundle(options);
  if (!res.ok) return res;
  const kind = res.value.meta.kind;
  downloadBytes(bundleToZip(res.value), backupFileName(kind), 'application/zip');
  log.info('backup', 'backup downloaded', { id: res.value.meta.id, kind }, 'FN-03');
  return res;
}

/** 只打包不下载（自动备份用，字节交给 `blobRepo`） */
export async function exportBackupBytes(options: ExportOptions = {}): Promise<Result<{ bundle: AppBackupBundle; bytes: Uint8Array }>> {
  const res = await exportBundle(options);
  if (!res.ok) return res;
  return { ok: true, value: { bundle: res.value, bytes: bundleToZip(res.value) } };
}

/** 导出的时间戳（供快照命名） */
export function exportStamp(): string {
  return nowISO();
}
