import type { Table } from 'dexie';
import { db } from '@/db/db';
import type { DBLogRow } from '@/db/schema';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { tryCatchAsync, type Result } from '@/lib/result';
import { redact } from '@/lib/errors';
import { LOG_KEEP } from '@/constants/limits';
import type { LogEntry, LogLevel, LogScope } from '@/types/log';

/**
 * 日志仓储（架构文档 §6.3）：
 * - 统一入口其实是 `store/logStore.push()`，这里负责落库与滚动保留；
 * - ★ **脱敏强制**：写入前一律过 `redact()`（Key / Authorization / token → `***`）；
 * - 滚动保留 LOG_KEEP（2000）条，超出删最旧的。
 */

export class LogRepo {
  private readonly table: Table<DBLogRow, string>;

  constructor(table: Table<DBLogRow, string> = db.logs) {
    this.table = table;
  }

  /** 写一条日志（自动脱敏） */
  async push(input: {
    level: LogLevel;
    scope: LogScope;
    message: string;
    detail?: unknown;
    featureId?: string;
  }): Promise<Result<LogEntry>> {
    const entry: LogEntry = {
      id: newId(),
      at: nowISO(),
      level: input.level,
      scope: input.scope,
      featureId: input.featureId,
      message: input.message,
      // ★ 脱敏：任何 detail 都过一遍 redact
      detail: input.detail === undefined ? undefined : redact(input.detail),
    };
    return tryCatchAsync(async () => {
      await this.table.put(entry as unknown as DBLogRow);
      return entry;
    }, 'DB_FAILED');
  }

  /** 批量写（导入大量日志时用） */
  async pushMany(entries: readonly LogEntry[]): Promise<Result<number>> {
    if (entries.length === 0) return { ok: true, value: 0 };
    return tryCatchAsync(async () => {
      await this.table.bulkPut(entries as unknown as DBLogRow[]);
      return entries.length;
    }, 'DB_FAILED');
  }

  /** 最新 N 条（开发者页实时展示用，倒序返回） */
  async listRecent(limit = 200): Promise<Result<LogEntry[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.orderBy('at').reverse().limit(limit).toArray();
      return rows as unknown as LogEntry[];
    }, 'DB_FAILED');
  }

  /** 按级别过滤 */
  async listByLevel(level: LogLevel, limit = 200): Promise<Result<LogEntry[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('level').equals(level).reverse().limit(limit).toArray();
      return rows as unknown as LogEntry[];
    }, 'DB_FAILED');
  }

  /** 按作用域过滤 */
  async listByScope(scope: LogScope, limit = 200): Promise<Result<LogEntry[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('scope').equals(scope).reverse().limit(limit).toArray();
      return rows as unknown as LogEntry[];
    }, 'DB_FAILED');
  }

  /** 按功能 ID 过滤（排障用，如只看 FN-30） */
  async listByFeature(featureId: string, limit = 200): Promise<Result<LogEntry[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('featureId').equals(featureId).reverse().limit(limit).toArray();
      return rows as unknown as LogEntry[];
    }, 'DB_FAILED');
  }

  /** 时间范围查询 */
  async listByRange(from: string, to: string, limit = 2000): Promise<Result<LogEntry[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('at').between(from, to, true, true).limit(limit).toArray();
      return rows as unknown as LogEntry[];
    }, 'DB_FAILED');
  }

  /** 滚动保留：超出 LOG_KEEP 时删除最旧的，返回删除条数 */
  async prune(keep = LOG_KEEP): Promise<Result<number>> {
    return tryCatchAsync(async () => {
      const total = await this.table.count();
      if (total <= keep) return 0;
      const overflow = total - keep;
      const oldest = await this.table.orderBy('at').limit(overflow).primaryKeys();
      await this.table.bulkDelete(oldest as string[]);
      return oldest.length;
    }, 'DB_FAILED');
  }

  /** 清空 */
  async clear(): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.clear();
    }, 'DB_FAILED');
  }

  /** 导出为 .jsonl（FN-26，同样脱敏） */
  async exportJSONL(limit = LOG_KEEP): Promise<Result<string>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.orderBy('at').reverse().limit(limit).toArray();
      return rows.map((r) => JSON.stringify(redact(r))).join('\n');
    }, 'DB_FAILED');
  }
}

export const logRepo = new LogRepo();
