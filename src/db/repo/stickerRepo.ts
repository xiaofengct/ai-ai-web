import type { Table } from 'dexie';
import { db } from '@/db/db';
import type { DBStickerPackRow } from '@/db/schema';
import { BaseRepo } from './baseRepo';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { tryCatchAsync, type Result } from '@/lib/result';
import type { StickerItem, StickerPack } from '@/types/media';
import type { UUID } from '@/types/common';

function toDomain(row: DBStickerPackRow): StickerPack {
  return {
    id: row.id,
    name: row.name,
    items: row.items ?? [],
    createdAt: row.createdAt,
    enabled: row.enabled === 1,
  };
}

function toRow(pack: StickerPack, builtin = false): DBStickerPackRow {
  return {
    id: pack.id,
    name: pack.name,
    items: pack.items,
    createdAt: pack.createdAt,
    enabled: pack.enabled ? 1 : 0,
    builtin: builtin ? 1 : undefined,
  };
}

/**
 * 表情包仓储（包 + 条目）。
 * ★ `StickerItem.description` 是**语义标签**：角色回复里出现对应情绪/关键词时自动配图，
 *   这是原应用表情包的核心玩法（见 docs/00-逆向取证.md §5.3），不是静态贴图面板。
 */
export class StickerRepo extends BaseRepo<DBStickerPackRow, StickerPack> {
  constructor(table: Table<DBStickerPackRow, string> = db.stickers) {
    super(table, 'stickerRepo');
  }

  protected override toDomain(row: DBStickerPackRow): StickerPack {
    return toDomain(row);
  }

  protected override toRow(domain: StickerPack): DBStickerPackRow {
    return toRow(domain);
  }

  /** 新建包 */
  async createPack(name: string, items: readonly StickerItem[], options: { id?: UUID; builtin?: boolean } = {}): Promise<Result<StickerPack>> {
    const pack: StickerPack = {
      id: options.id ?? newId(),
      name,
      items: [...items],
      createdAt: nowISO(),
      enabled: true,
    };
    return tryCatchAsync(async () => {
      await this.table.put(toRow(pack, options.builtin ?? false));
      return pack;
    }, 'DB_FAILED');
  }

  /** 启用的包（供语义检索使用） */
  async listEnabled(): Promise<Result<StickerPack[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('enabled').equals(1).toArray();
      return rows.map(toDomain);
    }, 'DB_FAILED');
  }

  /** 启用 / 停用 */
  async setEnabled(id: UUID, enabled: boolean): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.update(id, { enabled: enabled ? 1 : 0 });
    }, 'DB_FAILED');
  }

  /** 追加条目（导入 zip 时逐条补 assetId） */
  async addItems(id: UUID, items: readonly StickerItem[]): Promise<Result<number>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      if (!row) return 0;
      const merged = [...(row.items ?? []), ...items];
      await this.table.update(id, { items: merged });
      return items.length;
    }, 'DB_FAILED');
  }

  /** 回写某条目的 assetId（图片存进 blobs 之后） */
  async attachAsset(id: UUID, fileName: string, assetId: UUID): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      if (!row) return;
      const items = (row.items ?? []).map((it) => (it.fileName === fileName ? { ...it, assetId } : it));
      await this.table.update(id, { items });
    }, 'DB_FAILED');
  }

  /**
   * 语义匹配：在启用的包里按 description 关键词找最贴切的表情。
   * 命中规则：完全相等 > 包含 > 单字重叠（用 Jaccard 之外的简单包含关系，够用且零依赖）。
   */
  async matchByDescription(text: string): Promise<Result<{ item: StickerItem; packId: UUID } | undefined>> {
    const kw = text.trim();
    if (!kw) return { ok: true, value: undefined };
    return tryCatchAsync(async () => {
      const packs = await this.table.where('enabled').equals(1).toArray();
      let exact: { item: StickerItem; packId: UUID } | undefined;
      let partial: { item: StickerItem; packId: UUID } | undefined;
      for (const pack of packs) {
        for (const item of pack.items ?? []) {
          if (!item.description) continue;
          if (item.description === kw) {
            exact ??= { item, packId: pack.id };
          } else if (!partial && (kw.includes(item.description) || item.description.includes(kw))) {
            partial = { item, packId: pack.id };
          }
        }
      }
      return exact ?? partial;
    }, 'DB_FAILED');
  }

  /** 全部条目（扁平，开发者页/管理用） */
  async allItems(): Promise<Result<StickerItem[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.toArray();
      return rows.flatMap((r) => r.items ?? []);
    }, 'DB_FAILED');
  }
}

export const stickerRepo = new StickerRepo();
export { toDomain as stickerRowToDomain, toRow as stickerDomainToRow };
