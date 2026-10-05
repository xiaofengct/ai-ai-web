import type { Table } from 'dexie';
import { db } from '@/db/db';
import type { DBBackupRow } from '@/db/schema';
import { BaseRepo } from './baseRepo';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { tryCatchAsync, type Result } from '@/lib/result';
import type { BackupMeta } from '@/types/backup';
import type { UUID } from '@/types/common';

/** 备份快照仓储（SV-08 / FN-47：定时快照 + 保留 N 份） */

export class BackupRepo extends BaseRepo<DBBackupRow, BackupMeta> {
  constructor(table: Table<DBBackupRow, string> = db.backups) {
    super(table, 'backupRepo');
  }

  protected override toDomain(row: DBBackupRow): BackupMeta {
    return {
      id: row.id,
      createdAt: row.createdAt,
      appVersion: row.appVersion,
      counts: row.counts,
      sizeBytes: row.sizeBytes,
      kind: row.kind,
    };
  }

  protected override toRow(domain: BackupMeta): DBBackupRow {
    return {
      id: domain.id,
      createdAt: domain.createdAt,
      appVersion: domain.appVersion,
      counts: domain.counts,
      sizeBytes: domain.sizeBytes,
      kind: domain.kind,
    };
  }

  /** 记录一份快照（bundle 本体存 blobs，路径 backups/{id}.zip） */
  async snapshot(input: {
    appVersion: string;
    kind: BackupMeta['kind'];
    counts: BackupMeta['counts'];
    sizeBytes: number;
    blobPath?: string;
    inline?: Record<string, string>;
  }): Promise<Result<BackupMeta>> {
    const meta: BackupMeta = {
      id: newId(),
      createdAt: nowISO(),
      appVersion: input.appVersion,
      counts: input.counts,
      sizeBytes: input.sizeBytes,
      kind: input.kind,
    };
    return tryCatchAsync(async () => {
      await this.table.put({
        ...this.toRow(meta),
        blobPath: input.blobPath,
        inline: input.inline,
      } as DBBackupRow);
      return meta;
    }, 'DB_FAILED');
  }

  /** 按时间倒序列出 */
  async listRecent(limit = 50): Promise<Result<BackupMeta[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.orderBy('createdAt').reverse().limit(limit).toArray();
      return rows.map((r) => this.toDomain(r));
    }, 'DB_FAILED');
  }

  /** 按类型列出（自动备份保留 N 份时用） */
  async listByKind(kind: BackupMeta['kind']): Promise<Result<BackupMeta[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('kind').equals(kind).reverse().sortBy('createdAt');
      return rows.map((r) => this.toDomain(r));
    }, 'DB_FAILED');
  }

  /**
   * 滚动清理：只保留最近的 keep 份（**手动备份永不自动删除**）。
   * 返回被删除的 id 列表（调用方据此清理对应 blobs）。
   */
  async prune(keep: number, kind: BackupMeta['kind'] = 'auto'): Promise<Result<UUID[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('kind').equals(kind).reverse().sortBy('createdAt');
      if (rows.length <= keep) return [];
      const doomed = rows.slice(keep);
      await this.table.bulkDelete(doomed.map((r) => r.id));
      return doomed.map((r) => r.id);
    }, 'DB_FAILED');
  }

  /** 取快照（含本体引用） */
  async getRaw(id: UUID): Promise<Result<DBBackupRow | undefined>> {
    return tryCatchAsync(() => this.table.get(id), 'DB_FAILED');
  }

  /** 删除快照 */
  override async remove(id: UUID): Promise<Result<void>> {
    return super.remove(id);
  }
}

export const backupRepo = new BackupRepo();
