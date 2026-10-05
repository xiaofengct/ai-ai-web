import type { Table } from 'dexie';
import { db } from '@/db/db';
import type { DBTimbreRow } from '@/db/schema';
import { BaseRepo } from './baseRepo';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { tryCatchAsync, type Result } from '@/lib/result';
import type { VoiceTimbre } from '@/types/media';
import type { UUID } from '@/types/common';

function toDomain(row: DBTimbreRow): VoiceTimbre {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    refAssetId: row.refAssetId,
    externalVoiceId: row.externalVoiceId,
    sampleText: row.sampleText,
    speed: row.speed,
    pitch: row.pitch,
    createdAt: row.createdAt,
  };
}

function toRow(timbre: VoiceTimbre): DBTimbreRow {
  return {
    id: timbre.id,
    name: timbre.name,
    provider: timbre.provider,
    refAssetId: timbre.refAssetId,
    externalVoiceId: timbre.externalVoiceId,
    sampleText: timbre.sampleText,
    speed: timbre.speed,
    pitch: timbre.pitch,
    createdAt: timbre.createdAt,
  };
}

/** 音色仓储（FN-55；端侧语音克隆无法实现，见 PL-14 的降级说明） */
export class TimbreRepo extends BaseRepo<DBTimbreRow, VoiceTimbre> {
  constructor(table: Table<DBTimbreRow, string> = db.timbres) {
    super(table, 'timbreRepo');
  }

  protected override toDomain(row: DBTimbreRow): VoiceTimbre {
    return toDomain(row);
  }

  protected override toRow(domain: VoiceTimbre): DBTimbreRow {
    return toRow(domain);
  }

  /** 新增音色 */
  async create(input: {
    name: string;
    provider: VoiceTimbre['provider'];
    refAssetId?: UUID;
    externalVoiceId?: string;
    sampleText?: string;
    speed?: number;
    pitch?: number;
  }): Promise<Result<VoiceTimbre>> {
    const timbre: VoiceTimbre = {
      id: newId(),
      name: input.name,
      provider: input.provider,
      refAssetId: input.refAssetId,
      externalVoiceId: input.externalVoiceId,
      sampleText: input.sampleText ?? '今天过得怎么样，老婆',
      speed: input.speed ?? 1,
      pitch: input.pitch ?? 1,
      createdAt: nowISO(),
    };
    return this.upsert(timbre);
  }

  /** 按 Provider 列出 */
  async listByProvider(provider: VoiceTimbre['provider']): Promise<Result<VoiceTimbre[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('provider').equals(provider).toArray();
      return rows.map(toDomain);
    }, 'DB_FAILED');
  }

  /** 列出全部（按创建时间倒序） */
  async listAll(): Promise<Result<VoiceTimbre[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.orderBy('createdAt').reverse().toArray();
      return rows.map(toDomain);
    }, 'DB_FAILED');
  }
}

export const timbreRepo = new TimbreRepo();
export { toDomain as timbreRowToDomain, toRow as timbreDomainToRow };
