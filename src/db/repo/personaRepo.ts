import type { Table } from 'dexie';
import { db } from '@/db/db';
import type { DBPersonaRow } from '@/db/schema';
import { BaseRepo } from './baseRepo';
import { err, tryCatchAsync, type Result } from '@/lib/result';
import { AppError } from '@/lib/errors';
import { nowISO } from '@/lib/time';
import { DEFAULT_PERSONA_PRIVACY, XINRAN_PERSONA_ID } from '@/constants/defaults';
import type { PersonaCard, PersonaCardData } from '@/types/persona';
import type { PersonaOrigin } from '@/types/common';
import type { UUID } from '@/types/common';

function toDomain(row: DBPersonaRow): PersonaCard {
  return {
    id: row.id,
    spec: row.spec,
    specVersion: row.specVersion,
    data: row.data as unknown as PersonaCardData,
    origin: row.origin,
    modelId: row.modelId,
    timbreId: row.timbreId,
    portrait: row.portrait as PersonaCard['portrait'],
    imageGen: row.imageGen as PersonaCard['imageGen'],
    privacy: row.privacy,
    isBuiltin: row.isBuiltin === 1,
    distillJobId: row.distillJobId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRow(card: PersonaCard): DBPersonaRow {
  return {
    id: card.id,
    spec: card.spec,
    specVersion: card.specVersion,
    data: card.data as unknown as Record<string, unknown>,
    origin: card.origin,
    modelId: card.modelId,
    timbreId: card.timbreId,
    portrait: card.portrait as unknown[] | undefined,
    imageGen: card.imageGen as Record<string, unknown> | undefined,
    privacy: card.privacy,
    isBuiltin: card.isBuiltin ? 1 : undefined,
    // 欣然永远置顶
    pinned: card.origin === 'xinran' ? 1 : undefined,
    distillJobId: card.distillJobId,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  };
}

/**
 * 人设卡仓储：CRUD、欣然置顶（XR-08）、**禁止删除内置卡**。
 */
export class PersonaRepo extends BaseRepo<DBPersonaRow, PersonaCard> {
  constructor(table: Table<DBPersonaRow, string> = db.personas) {
    super(table, 'personaRepo');
  }

  protected override toDomain(row: DBPersonaRow): PersonaCard {
    return toDomain(row);
  }

  protected override toRow(domain: PersonaCard): DBPersonaRow {
    return toRow(domain);
  }

  /** 新建人物卡（外部角色默认 privacy.noImage = true，见 XR-06 的保守默认） */
  async create(input: {
    id?: UUID;
    name: string;
    data?: Partial<PersonaCardData>;
    origin?: PersonaOrigin;
    distillJobId?: UUID;
  }): Promise<Result<PersonaCard>> {
    const now = nowISO();
    const origin = input.origin ?? 'external';
    const card: PersonaCard = {
      id: input.id ?? crypto.randomUUID(),
      spec: 'chara_card_v2',
      specVersion: '2.0',
      data: { name: input.name, ...(input.data ?? {}) },
      origin,
      // ★ 外部角色（含蒸馏产物）默认也禁止生图，用户可自行放开；欣然不可放开
      // ★ 取单一真源 DEFAULT_PERSONA_PRIVACY，避免与导入/迁移/UI 各写一份默认值导致漂移。
      //   展开副本而不是直接引用，防止多张卡共享同一个可变对象。
      privacy: { ...DEFAULT_PERSONA_PRIVACY },
      distillJobId: input.distillJobId,
      createdAt: now,
      updatedAt: now,
    };
    return this.upsert(card);
  }

  /** 更新卡片数据（自动维护 updatedAt） */
  async updateData(id: UUID, data: Partial<PersonaCardData>): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      if (!row) throw this.fail('IMPORT_INVALID', '角色不存在');
      const merged: PersonaCardData = { ...(row.data as unknown as PersonaCardData), ...data };
      await this.table.update(id, {
        data: merged as unknown as Record<string, unknown>,
        updatedAt: nowISO(),
      });
    }, 'DB_FAILED');
  }

  /**
   * 列表：**欣然永远排第一**（XR-08），其余按更新时间倒序。
   */
  async listAll(): Promise<Result<PersonaCard[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.toArray();
      return rows
        .map(toDomain)
        .sort((a, b) => {
          if (a.origin === 'xinran' && b.origin !== 'xinran') return -1;
          if (b.origin === 'xinran' && a.origin !== 'xinran') return 1;
          return b.updatedAt.localeCompare(a.updatedAt);
        });
    }, 'DB_FAILED');
  }

  /** 按来源过滤 */
  async listByOrigin(origin: PersonaOrigin): Promise<Result<PersonaCard[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('origin').equals(origin).toArray();
      return rows.map(toDomain).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }, 'DB_FAILED');
  }

  /** 取内置欣然卡 */
  async getXinran(): Promise<Result<PersonaCard | undefined>> {
    return this.get(XINRAN_PERSONA_ID);
  }

  /** 按蒸馏作业取产物角色 */
  async getByDistillJob(jobId: UUID): Promise<Result<PersonaCard | undefined>> {
    return tryCatchAsync(async () => {
      const row = await this.table.where('distillJobId').equals(jobId).first();
      return row ? toDomain(row) : undefined;
    }, 'DB_FAILED');
  }

  /** ★ 删除：内置卡（欣然）禁止删除 */
  override async remove(id: UUID): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      if (!row) return;
      if (row.isBuiltin === 1) {
        throw this.fail('PRIVACY_BLOCK', '内置角色（欣然）不允许删除');
      }
      await this.table.delete(id);
    }, 'DB_FAILED');
  }

  /** ★ 隐私红线：欣然的 noImage 不允许被改成 false */
  async setPrivacy(id: UUID, noImage: boolean): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      if (!row) throw this.fail('IMPORT_INVALID', '角色不存在');
      if (row.isBuiltin === 1 && !noImage) {
        throw this.fail('PRIVACY_BLOCK', '欣然的隐私红线不可关闭');
      }
      await this.table.update(id, { privacy: { noImage }, updatedAt: nowISO() });
    }, 'DB_FAILED');
  }

  /** 导入：按 name 去重（同名覆盖），返回成功/失败明细 */
  async importCards(cards: readonly PersonaCard[]): Promise<Result<{ success: number; skipped: number }>> {
    if (cards.length === 0) {
      return err(this.fail('IMPORT_INVALID', '没有可导入的角色'));
    }
    return tryCatchAsync(async () => {
      let success = 0;
      let skipped = 0;
      for (const card of cards) {
        if (card.isBuiltin) {
          skipped += 1;
          continue;
        }
        await this.table.put(toRow({ ...card, updatedAt: nowISO() }));
        success += 1;
      }
      return { success, skipped };
    }, 'DB_FAILED');
  }

  /** 绑定立绘（FN-52） */
  async setPortrait(id: UUID, portrait: PersonaCard['portrait']): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.update(id, {
        portrait: portrait as unknown[] | undefined,
        updatedAt: nowISO(),
      });
    }, 'DB_FAILED');
  }

  /** 是否存在同名角色（导入冲突判断用） */
  async findByName(name: string): Promise<Result<PersonaCard | undefined>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.toArray();
      const hit = rows.find(
        (r) => ((r.data as unknown as PersonaCardData)?.name ?? '') === name,
      );
      return hit ? toDomain(hit) : undefined;
    }, 'DB_FAILED');
  }

  /** 校验：这张卡能否用于文生图（不能时抛 PRIVACY_BLOCK） */
  assertImageAllowed(card: PersonaCard): void {
    if (card.privacy?.noImage) {
      throw new AppError('PRIVACY_BLOCK', '该角色禁止图像生成（隐私红线）', { personaId: card.id });
    }
  }
}

export const personaRepo = new PersonaRepo();
export { toDomain as personaRowToDomain, toRow as personaDomainToRow };
