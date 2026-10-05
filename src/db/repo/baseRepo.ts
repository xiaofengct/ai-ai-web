import type { Table } from 'dexie';
import { AppError } from '@/lib/errors';
import { tryCatchAsync, type Result } from '@/lib/result';
import type { UUID } from '@/types/common';

/**
 * 通用 CRUD 基类（架构文档 §2 `db/repo/baseRepo.ts`）。
 *
 * ★ 约定：所有方法返回 `Result<T>`（不抛错），
 *   调用方需要抛错时用 `unwrap()`；写入失败统一归一化为 `DB_FAILED`。
 */
export abstract class BaseRepo<Row extends { id: string }, Domain = Row> {
  protected constructor(
    protected readonly table: Table<Row, string>,
    protected readonly scope: string,
  ) {}

  /** 行 → 领域对象（子类覆写） */
  protected abstract toDomain(row: Row): Domain;

  /** 领域对象 → 行（子类覆写；默认认为同构） */
  protected toRow(domain: Domain): Row {
    return domain as unknown as Row;
  }

  /** 写入（存在则覆盖） */
  async upsert(domain: Domain): Promise<Result<Domain>> {
    const row = this.toRow(domain);
    return tryCatchAsync(async () => {
      await this.table.put(row);
      return domain;
    }, 'DB_FAILED');
  }

  /** 批量写入（单事务，失败整体回滚） */
  async bulkUpsert(domains: readonly Domain[]): Promise<Result<number>> {
    if (domains.length === 0) return { ok: true, value: 0 };
    return tryCatchAsync(async () => {
      const rows = domains.map((d) => this.toRow(d));
      await this.table.bulkPut(rows);
      return rows.length;
    }, 'DB_FAILED');
  }

  /** 按主键读取 */
  async get(id: UUID): Promise<Result<Domain | undefined>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      return row ? this.toDomain(row) : undefined;
    }, 'DB_FAILED');
  }

  /** 全量列表（谨慎使用，大表请走分页） */
  async list(): Promise<Result<Domain[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.toArray();
      return rows.map((r) => this.toDomain(r));
    }, 'DB_FAILED');
  }

  /** 按主键删除 */
  async remove(id: UUID): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.delete(id);
    }, 'DB_FAILED');
  }

  /** 批量删除 */
  async removeMany(ids: readonly UUID[]): Promise<Result<number>> {
    if (ids.length === 0) return { ok: true, value: 0 };
    return tryCatchAsync(async () => {
      await this.table.bulkDelete(ids as string[]);
      return ids.length;
    }, 'DB_FAILED');
  }

  /** 总数 */
  async count(): Promise<Result<number>> {
    return tryCatchAsync(() => this.table.count(), 'DB_FAILED');
  }

  /** 条件更新（只更新给定字段，保留其它字段） */
  async patch(id: UUID, patch: Partial<Row>): Promise<Result<number>> {
    return tryCatchAsync(() => this.table.update(id, patch as never), 'DB_FAILED');
  }

  /** 清空表 */
  async clear(): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.clear();
    }, 'DB_FAILED');
  }

  /** 是否存在 */
  async exists(id: UUID): Promise<Result<boolean>> {
    return tryCatchAsync(async () => (await this.table.get(id)) !== undefined, 'DB_FAILED');
  }

  /** 构造一个本表的 AppError（子类抛业务错误时用） */
  protected fail(code: string, message: string, detail?: unknown): AppError {
    return new AppError(code, `[${this.scope}] ${message}`, detail);
  }
}
