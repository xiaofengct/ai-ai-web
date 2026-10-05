import type { Table } from 'dexie';
import { db } from '@/db/db';
import type { DBBlobRow } from '@/db/schema';
import { BaseRepo } from './baseRepo';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { tryCatchAsync, ok, type Result } from '@/lib/result';
import { AppError } from '@/lib/errors';
import type { BlobRecord } from '@/types/media';
import type { UUID } from '@/types/common';

function toDomain(row: DBBlobRow): BlobRecord {
  return {
    id: row.id,
    path: row.path,
    mime: row.mime,
    size: row.size,
    data: row.data,
    createdAt: row.createdAt,
  };
}

function toRow(record: BlobRecord): DBBlobRow {
  return {
    id: record.id,
    path: record.path,
    mime: record.mime,
    size: record.size,
    data: record.data,
    createdAt: record.createdAt,
  };
}

/**
 * ★ 二进制大对象仓储（图片 / 音频 / zip / 参考音 / 蒸馏原材料）。
 *
 * 逻辑路径约定（与原应用生态互通）：
 * - `stickers/{packId}/{fileName}`
 * - `live2d/{name}.zip`
 * - `timbres/{id}.mp3`
 * - `portraits/{personaId}/{assetId}.png`
 * - `distill/{slug}/knowledge/{fileName}`
 * - `distill/{slug}/export/{bundle}.zip`
 * - `backups/{id}.zip`
 */
export class BlobRepo extends BaseRepo<DBBlobRow, BlobRecord> {
  constructor(table: Table<DBBlobRow, string> = db.blobs) {
    super(table, 'blobRepo');
  }

  protected override toDomain(row: DBBlobRow): BlobRecord {
    return toDomain(row);
  }

  protected override toRow(domain: BlobRecord): DBBlobRow {
    return toRow(domain);
  }

  /** 写入（path 唯一；同 path 覆盖） */
  async put(path: string, data: Blob | Uint8Array, mime = 'application/octet-stream'): Promise<Result<UUID>> {
    const size = data instanceof Blob ? data.size : data.byteLength;
    const existing = await this.table.where('path').equals(path).first();
    const id = existing?.id ?? newId();
    const record: BlobRecord = {
      id,
      path,
      mime: data instanceof Blob ? data.type || mime : mime,
      size,
      data,
      createdAt: existing?.createdAt ?? nowISO(),
    };
    return tryCatchAsync(async () => {
      await this.table.put(toRow(record));
      return id;
    }, 'DB_FAILED');
  }

  /** 按 id 读取 */
  async getBytes(id: UUID): Promise<Result<Uint8Array | undefined>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      if (!row) return undefined;
      return row.data instanceof Blob ? new Uint8Array(await row.data.arrayBuffer()) : row.data;
    }, 'DB_FAILED');
  }

  /** 按 id 读成 Blob（图片预览 / 音频播放用） */
  async getBlob(id: UUID): Promise<Result<Blob | undefined>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      if (!row) return undefined;
      if (row.data instanceof Blob) return row.data;
      // 复制一份，避免把底层 buffer 转移走导致后续读取失败
      const copy = new Uint8Array(row.data.byteLength);
      copy.set(row.data);
      return new Blob([copy], { type: row.mime });
    }, 'DB_FAILED');
  }

  /** ObjectURL（记得用完后 revoke） */
  async getObjectURL(id: UUID): Promise<Result<string | undefined>> {
    const res = await this.getBlob(id);
    if (!res.ok) return res;
    return ok(res.value ? URL.createObjectURL(res.value) : undefined);
  }

  /** 按逻辑路径读取 */
  async getByPath(path: string): Promise<Result<BlobRecord | undefined>> {
    return tryCatchAsync(async () => {
      const row = await this.table.where('path').equals(path).first();
      return row ? toDomain(row) : undefined;
    }, 'DB_FAILED');
  }

  /** 按前缀列出（如 distill/{slug}/knowledge/） */
  async listByPrefix(prefix: string): Promise<Result<BlobRecord[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.toArray();
      return rows.filter((r) => r.path.startsWith(prefix)).map(toDomain);
    }, 'DB_FAILED');
  }

  /** 批量写入（导入 zip 时） */
  async putMany(
    entries: readonly { path: string; data: Blob | Uint8Array; mime?: string }[],
  ): Promise<Result<Map<string, UUID>>> {
    return tryCatchAsync(async () => {
      const map = new Map<string, UUID>();
      for (const e of entries) {
        const res = await this.put(e.path, e.data, e.mime);
        if (res.ok) map.set(e.path, res.value);
      }
      return map;
    }, 'DB_FAILED');
  }

  /** 按 id 删除（清理孤立资产用） */
  override async remove(id: UUID): Promise<Result<void>> {
    return super.remove(id);
  }

  /** 按前缀删除（删除蒸馏作业 / 表情包时连带清理） */
  async removeByPrefix(prefix: string): Promise<Result<number>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.toArray();
      const hits = rows.filter((r) => r.path.startsWith(prefix));
      await this.table.bulkDelete(hits.map((r) => r.id));
      return hits.length;
    }, 'DB_FAILED');
  }

  /** 总体积（诊断页 PG-20 / 存储配额用） */
  async totalSize(): Promise<Result<number>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.toArray();
      return rows.reduce((sum, r) => sum + (r.size ?? 0), 0);
    }, 'DB_FAILED');
  }

  /** 读文件并做存在性校验（缺失抛错，避免拿到空 Blob） */
  async requireBlob(id: UUID): Promise<Blob> {
    const res = await this.getBlob(id);
    if (!res.ok) throw res.error;
    if (!res.value) throw new AppError('DB_FAILED', '资产不存在或已被清理', { assetId: id });
    return res.value;
  }
}

export const blobRepo = new BlobRepo();
export { toDomain as blobRowToDomain, toRow as blobDomainToRow };
