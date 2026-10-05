import { blobRepo } from '@/db/repo/blobRepo';
import { backupRepo } from '@/db/repo/backupRepo';
import { DEFAULT_BACKUP_KEEP } from '@/constants/limits';
import { nowISO } from '@/lib/time';
import { err, tryCatchAsync, unwrapOr, type Result } from '@/lib/result';
import { AppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { useSettingsStore } from '@/store/settingsStore';
import { exportBackupBytes } from './export';
import type { BackupMeta } from '@/types/backup';
import type { UUID } from '@/types/common';

/**
 * ★ 自动备份（FN-47 / SV-08）。
 *
 * 行为：
 * - 每 `CHECK_INTERVAL_MS` 醒一次，看「距上次自动备份」是否超过 `chat.autoBackup.intervalHour`；
 * - 到期就打一个包 → 存进 blobs（`backups/{id}.zip`）→ `backupRepo.snapshot()` 记元信息；
 * - 然后按 `chat.autoBackup.keep` 滚动清理**只清 auto**（手动备份永不自动删除，见 backupRepo.prune）；
 * - 被删掉的快照，其 blobs 一并清理，避免快照表干净了、二进制还堆着。
 *
 * ★ 为什么不用 setInterval(intervalHour)：
 *   用户可能在设置里改间隔，也可能让页面睡很久；用「短周期检查 + 到期判定」更稳，
 *   页面睡醒后下一次 tick 立刻就能补上（而不是等满一个旧周期）。
 */

const CHECK_INTERVAL_MS = 60_000;
const HOUR_MS = 60 * 60 * 1000;

export interface AutoBackupStatus {
  enabled: boolean;
  intervalHour: number;
  keep: number;
  /** 上次自动备份时间（没有则 undefined） */
  lastRunAt?: string;
  /** 距离下次触发的毫秒数（已到期为 0） */
  dueInMs: number;
}

export class AutoBackupService {
  private timer: ReturnType<typeof setInterval> | undefined = undefined;
  private running = false;
  private lastRunAt: string | undefined = undefined;
  private initialized = false;

  /**
   * 启动定时检查。
   * `lastRunAt` 首次从库里最近一份 auto 快照推导，避免刷新页面就立刻再备一份。
   */
  start(): void {
    if (this.timer !== undefined) return;
    void this.primeLastRun();
    this.timer = setInterval(() => {
      void this.tick();
    }, CHECK_INTERVAL_MS);
    // 启动后先立刻判一次（异步，不阻塞调用方）
    void this.tick();
    log.info('backup', 'auto backup scheduler started', undefined, 'FN-47');
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    log.info('backup', 'auto backup scheduler stopped', undefined, 'FN-47');
  }

  /** 是否正在跑（UI 展示用） */
  isRunning(): boolean {
    return this.running;
  }

  /** 当前状态（UI 展示用） */
  status(): AutoBackupStatus {
    const cfg = useSettingsStore.getState().settings.chat.autoBackup;
    const intervalHour = Math.max(1, cfg.intervalHour || 24);
    const keep = Math.max(1, cfg.keep || DEFAULT_BACKUP_KEEP);
    const last = this.lastRunAt;
    const elapsed = last ? Date.now() - new Date(last).getTime() : Number.POSITIVE_INFINITY;
    const dueInMs = Number.isFinite(elapsed) ? Math.max(0, intervalHour * HOUR_MS - elapsed) : 0;
    return { enabled: cfg.enabled === true, intervalHour, keep, lastRunAt: last, dueInMs };
  }

  /**
   * 立即备份一次（FN-47「现在存一份」与自动触发共用）。
   * ★ 并发保护：已在跑就直接返回失败，避免两个定时器叠加把存储打爆。
   */
  async runNow(kind: BackupMeta['kind'] = 'auto'): Promise<Result<BackupMeta>> {
    if (this.running) {
      return err<BackupMeta>(new AppError('DB_FAILED', 'a backup is already running'));
    }
    this.running = true;
    try {
      return await this.snapshot(kind);
    } finally {
      this.running = false;
    }
  }

  /* ------------------------------ 内部 ------------------------------ */

  /** 一次心跳：到期就备份 */
  private async tick(): Promise<void> {
    const cfg = useSettingsStore.getState().settings.chat.autoBackup;
    if (cfg.enabled !== true) return;
    if (!this.initialized) await this.primeLastRun();

    const intervalMs = Math.max(1, cfg.intervalHour || 24) * HOUR_MS;
    if (this.lastRunAt) {
      const elapsed = Date.now() - new Date(this.lastRunAt).getTime();
      if (elapsed < intervalMs) return;
    }
    const res = await this.runNow('auto');
    if (!res.ok) {
      log.warn('backup', 'auto backup snapshot failed', String(res.error), 'FN-47');
    }
  }

  /** 用库里最近一份 auto 快照初始化 lastRunAt */
  private async primeLastRun(): Promise<void> {
    if (this.initialized) return;
    const res = await backupRepo.listByKind('auto');
    const list = res.ok ? res.value : [];
    // listByKind 用 reverse().sortBy() → 顺序不保证，这里显式取最新的
    const latest = list
      .map((m) => m.createdAt)
      .sort()
      .pop();
    this.lastRunAt = latest;
    this.initialized = true;
  }

  /** 打包 → 存 blobs → 记快照 → 滚动清理 */
  private async snapshot(kind: BackupMeta['kind']): Promise<Result<BackupMeta>> {
    return tryCatchAsync(async () => {
      const packed = await exportBackupBytes({ kind, includeLogs: false });
      if (!packed.ok) throw packed.error;

      const { bundle, bytes } = packed.value;
      const id = bundle.meta.id;
      const blobPath = `backups/${id}.zip`;

      const put = await blobRepo.put(blobPath, bytes, 'application/zip');
      if (!put.ok) throw put.error;

      const meta: BackupMeta = { ...bundle.meta, sizeBytes: bytes.byteLength };
      const saved = await backupRepo.snapshot({
        appVersion: meta.appVersion,
        kind,
        counts: meta.counts,
        sizeBytes: meta.sizeBytes,
        blobPath,
      });
      if (!saved.ok) throw saved.error;

      this.lastRunAt = nowISO();

      // ★ 只滚动清理自动备份；手动备份用户自己删
      if (kind === 'auto') {
        await this.prune(meta.id);
      }

      log.info('backup', 'snapshot created', { id, kind, sizeBytes: meta.sizeBytes }, 'FN-47');
      return saved.value;
    }, 'DB_FAILED');
  }

  /** 保留最近 keep 份，并清掉被删快照对应的 zip */
  private async prune(currentId: UUID): Promise<void> {
    const keep = Math.max(1, useSettingsStore.getState().settings.chat.autoBackup.keep || DEFAULT_BACKUP_KEEP);
    const removed = await backupRepo.prune(keep, 'auto');
    const ids = removed.ok ? removed.value : [];
    if (ids.length === 0) return;
    for (const id of ids) {
      if (id === currentId) continue;
      const cleared = await blobRepo.removeByPrefix(`backups/${id}`);
      if (!cleared.ok) {
        log.warn('backup', '清理旧快照资产失败', cleared.error, 'FN-47');
      }
    }
    log.info('backup', 'old snapshots pruned', { count: ids.length, keep }, 'FN-47');
  }
}

/** 全局单例 */
export const autoBackupService = new AutoBackupService();

/** 便捷启动（供 App / T12 集成调用） */
export function startAutoBackup(): void {
  autoBackupService.start();
}

/** 便捷停止 */
export function stopAutoBackup(): void {
  autoBackupService.stop();
}

/** 立即存一份（UI「现在存一份」按钮用，kind='manual'） */
export async function backupNow(kind: BackupMeta['kind'] = 'manual'): Promise<Result<BackupMeta>> {
  return autoBackupService.runNow(kind);
}

/** 取一份快照的 zip 字节（还原 / 下载用） */
export async function readBackupBytes(id: UUID): Promise<Result<Uint8Array | undefined>> {
  const row = await backupRepo.getRaw(id);
  const path = row.ok ? row.value?.blobPath : undefined;
  if (!path) return { ok: true, value: undefined };
  const record = await blobRepo.getByPath(path);
  const assetId = record.ok ? record.value?.id : undefined;
  if (!assetId) return { ok: true, value: undefined };
  return blobRepo.getBytes(assetId);
}

/** 删除一份快照（连带二进制） */
export async function removeBackup(id: UUID): Promise<Result<void>> {
  const cleared = unwrapOr(await blobRepo.removeByPrefix(`backups/${id}`), 0);
  if (cleared > 0) {
    log.info('backup', 'backup blob removed', { id, cleared }, 'FN-47');
  }
  return backupRepo.remove(id);
}
