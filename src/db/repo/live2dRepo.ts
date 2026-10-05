import type { Table } from 'dexie';
import { db } from '@/db/db';
import type { DBLive2DRow } from '@/db/schema';
import { BaseRepo } from './baseRepo';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { tryCatchAsync, type Result } from '@/lib/result';
import type { Live2DModel } from '@/types/media';
import type { UUID } from '@/types/common';

function toDomain(row: DBLive2DRow): Live2DModel {
  return {
    id: row.id,
    name: row.name,
    zipAssetId: row.zipAssetId,
    modelJsonPath: row.modelJsonPath,
    motions: row.motions,
    scale: row.scale,
    offset: row.offset,
    createdAt: row.createdAt,
  };
}

function toRow(model: Live2DModel): DBLive2DRow {
  return {
    id: model.id,
    name: model.name,
    zipAssetId: model.zipAssetId,
    modelJsonPath: model.modelJsonPath,
    motions: model.motions,
    scale: model.scale,
    offset: model.offset,
    createdAt: model.createdAt,
  };
}

/** Live2D 模型元数据仓储（FN-53；zip 本体在 blobs，运行时懒加载 pixi-live2d-display） */
export class Live2DRepo extends BaseRepo<DBLive2DRow, Live2DModel> {
  constructor(table: Table<DBLive2DRow, string> = db.live2d) {
    super(table, 'live2dRepo');
  }

  protected override toDomain(row: DBLive2DRow): Live2DModel {
    return toDomain(row);
  }

  protected override toRow(domain: Live2DModel): DBLive2DRow {
    return toRow(domain);
  }

  /** 新增模型 */
  async create(input: {
    name: string;
    zipAssetId: UUID;
    modelJsonPath: string;
    motions?: string[];
    scale?: number;
    offset?: { x: number; y: number };
  }): Promise<Result<Live2DModel>> {
    const model: Live2DModel = {
      id: newId(),
      name: input.name,
      zipAssetId: input.zipAssetId,
      modelJsonPath: input.modelJsonPath,
      motions: input.motions,
      scale: input.scale ?? 1,
      offset: input.offset ?? { x: 0, y: 0 },
      createdAt: nowISO(),
    };
    return this.upsert(model);
  }

  /** 按 zip 资产反查（导入去重） */
  async findByZipAsset(zipAssetId: UUID): Promise<Result<Live2DModel | undefined>> {
    return tryCatchAsync(async () => {
      const row = await this.table.where('zipAssetId').equals(zipAssetId).first();
      return row ? toDomain(row) : undefined;
    }, 'DB_FAILED');
  }
}

export const live2dRepo = new Live2DRepo();
export { toDomain as live2dRowToDomain, toRow as live2dDomainToRow };
