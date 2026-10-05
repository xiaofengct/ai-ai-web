import type { Table } from 'dexie';
import { db } from '@/db/db';
import type { DBMemoryRow } from '@/db/schema';
import { BaseRepo } from './baseRepo';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { jaccard } from '@/lib/text';
import { tryCatchAsync, type Result } from '@/lib/result';
import type { MemoryEntry, MemoryScope } from '@/types/memory';
import type { UUID } from '@/types/common';

function toDomain(row: DBMemoryRow): MemoryEntry {
  return {
    id: row.id,
    sessionId: row.sessionId,
    personaId: row.personaId,
    content: row.content,
    tags: row.tags ?? [],
    score: row.score ?? 0,
    weight: row.weight,
    sourceMessageIds: row.sourceMessageIds,
    timeRef: row.timeRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    correction: row.correction,
  };
}

function toRow(entry: MemoryEntry): DBMemoryRow {
  return {
    id: entry.id,
    sessionId: entry.sessionId,
    personaId: entry.personaId,
    content: entry.content,
    tags: entry.tags ?? [],
    score: entry.score ?? 0,
    weight: entry.weight,
    sourceMessageIds: entry.sourceMessageIds,
    timeRef: entry.timeRef,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    correction: entry.correction,
  };
}

/**
 * 记忆仓储：CRUD、按 tag / score 查询、去重合并（memory/dedupe.ts 的持久化部分）。
 */
export class MemoryRepo extends BaseRepo<DBMemoryRow, MemoryEntry> {
  constructor(table: Table<DBMemoryRow, string> = db.memories) {
    super(table, 'memoryRepo');
  }

  protected override toDomain(row: DBMemoryRow): MemoryEntry {
    return toDomain(row);
  }

  protected override toRow(domain: MemoryEntry): DBMemoryRow {
    return toRow(domain);
  }

  /** 新增记忆 */
  async create(input: {
    content: string;
    tags?: string[];
    sessionId?: UUID;
    personaId?: UUID;
    score?: number;
    weight?: number;
    sourceMessageIds?: UUID[];
    timeRef?: string;
  }): Promise<Result<MemoryEntry>> {
    const now = nowISO();
    const entry: MemoryEntry = {
      id: newId(),
      content: input.content,
      tags: input.tags ?? [],
      sessionId: input.sessionId,
      personaId: input.personaId,
      score: input.score ?? 0,
      weight: input.weight,
      sourceMessageIds: input.sourceMessageIds,
      timeRef: input.timeRef,
      createdAt: now,
      updatedAt: now,
    };
    return this.upsert(entry);
  }

  /** 按作用域列出（FN-29 提供范围记忆） */
  async listByScope(scope: MemoryScope, sessionId?: UUID, limit = 500): Promise<Result<MemoryEntry[]>> {
    return tryCatchAsync(async () => {
      const rows =
        scope === 'session' && sessionId
          ? await this.table.where('sessionId').equals(sessionId).toArray()
          : await this.table.orderBy('score').reverse().limit(limit).toArray();
      return rows.map(toDomain);
    }, 'DB_FAILED');
  }

  /** 按时间范围列出 */
  async listByRange(from: string, to: string, limit = 500): Promise<Result<MemoryEntry[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('timeRef').between(from, to, true, true).limit(limit).toArray();
      return rows.map(toDomain);
    }, 'DB_FAILED');
  }

  /** 得分 ≥ min 的记忆（FN-57 展示得分） */
  async listByScore(min: number, limit = 500): Promise<Result<MemoryEntry[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('score').aboveOrEqual(min).reverse().limit(limit).toArray();
      return rows.map(toDomain);
    }, 'DB_FAILED');
  }

  /** 按标签过滤（多值索引 *tags） */
  async listByTag(tag: string, limit = 500): Promise<Result<MemoryEntry[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('tags').equals(tag).limit(limit).toArray();
      return rows.map(toDomain);
    }, 'DB_FAILED');
  }

  /** 全部标签（记忆管理页的过滤器用） */
  async allTags(): Promise<Result<string[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.toArray();
      const set = new Set<string>();
      for (const r of rows) for (const t of r.tags ?? []) set.add(t);
      return [...set].sort();
    }, 'DB_FAILED');
  }

  /** 关键词搜索（BM25 之外的简单兜底） */
  async search(keyword: string, limit = 100): Promise<Result<MemoryEntry[]>> {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return { ok: true, value: [] };
    return tryCatchAsync(async () => {
      const rows = await this.table.toArray();
      return rows
        .filter(
          (r) =>
            r.content.toLowerCase().includes(kw) ||
            (r.tags ?? []).some((t) => t.toLowerCase().includes(kw)),
        )
        .slice(0, limit)
        .map(toDomain);
    }, 'DB_FAILED');
  }

  /** 更新得分（检索后回写） */
  async setScore(id: UUID, score: number): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.update(id, { score, updatedAt: nowISO() });
    }, 'DB_FAILED');
  }

  /** 追加 Correction 记录（EX-10） */
  async addCorrection(id: UUID, note: string): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      if (!row) return;
      await this.table.update(id, {
        correction: [...(row.correction ?? []), note],
        updatedAt: nowISO(),
      });
    }, 'DB_FAILED');
  }

  /**
   * 去重合并（FN-57 / memory/dedupe.ts）：
   * 相似度 ≥ threshold 时把新内容**合并进**已有条目（补标签、补来源、取较高得分），
   * 而不是新增一条；返回被合并的已有条目 id（未合并则返回 null）。
   */
  async mergeSimilar(
    candidate: MemoryEntry,
    threshold = 0.72,
  ): Promise<Result<{ mergedInto: UUID | null }>> {
    return tryCatchAsync(async () => {
      const rows = candidate.sessionId
        ? await this.table.where('sessionId').equals(candidate.sessionId).toArray()
        : await this.table.toArray();

      let best: { id: UUID; sim: number } | null = null;
      for (const row of rows) {
        if (row.id === candidate.id) continue;
        const sim = jaccard(row.content, candidate.content);
        if (sim >= threshold && (!best || sim > best.sim)) best = { id: row.id, sim };
      }
      if (!best) return { mergedInto: null };

      const target = await this.table.get(best.id);
      if (!target) return { mergedInto: null };

      await this.table.update(best.id, {
        content: candidate.content.length > target.content.length ? candidate.content : target.content,
        tags: [...new Set([...(target.tags ?? []), ...(candidate.tags ?? [])])],
        score: Math.max(target.score, candidate.score),
        weight: Math.max(target.weight ?? 0, candidate.weight ?? 0),
        sourceMessageIds: [
          ...new Set([...(target.sourceMessageIds ?? []), ...(candidate.sourceMessageIds ?? [])]),
        ],
        updatedAt: nowISO(),
      });
      return { mergedInto: best.id };
    }, 'DB_FAILED');
  }

  /** 按会话清空 */
  async removeBySession(sessionId: UUID): Promise<Result<number>> {
    return tryCatchAsync(() => this.table.where('sessionId').equals(sessionId).delete(), 'DB_FAILED');
  }

  /** 批量导入（自动去重） */
  async importEntries(entries: readonly MemoryEntry[], threshold = 0.72): Promise<Result<{ added: number; merged: number }>> {
    return tryCatchAsync(async () => {
      let added = 0;
      let merged = 0;
      for (const entry of entries) {
        const res = await this.mergeSimilar(entry, threshold);
        const into = res.ok ? res.value.mergedInto : null;
        if (into) {
          merged += 1;
        } else {
          await this.table.put(toRow(entry));
          added += 1;
        }
      }
      return { added, merged };
    }, 'DB_FAILED');
  }
}

export const memoryRepo = new MemoryRepo();
export { toDomain as memoryRowToDomain, toRow as memoryDomainToRow };
