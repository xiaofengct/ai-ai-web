import type { Table } from 'dexie';
import { db } from '@/db/db';
import { MAX_TIME_KEY, MIN_TIME_KEY } from './messageRepo';
import type { DBSessionRow } from '@/db/schema';
import { BaseRepo } from './baseRepo';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { makePreview } from '@/lib/text';
import { err, tryCatchAsync, type Result } from '@/lib/result';
import { AppError } from '@/lib/errors';
import type { ChatSession, Message, ProactiveState } from '@/types/chat';
import type { ChatSettings } from '@/types/settings';
import type { UUID } from '@/types/common';

/** 行 → 领域（IndexedDB 无法索引 boolean，archived 用 0/1 存储） */
function toDomain(row: DBSessionRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    personaId: row.personaId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessagePreview: row.lastMessagePreview,
    settingsOverride: row.settingsOverride as Partial<ChatSettings> | undefined,
    proactive: row.proactive as ProactiveState | undefined,
    stats: row.stats,
    archived: row.archived === 1,
  };
}

function toRow(session: ChatSession): DBSessionRow {
  return {
    id: session.id,
    title: session.title,
    personaId: session.personaId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastMessagePreview: session.lastMessagePreview,
    settingsOverride: session.settingsOverride as Record<string, unknown> | undefined,
    proactive: session.proactive as unknown as Record<string, unknown> | undefined,
    stats: session.stats,
    archived: session.archived ? 1 : 0,
  };
}

/**
 * 会话仓储：分页列表、归档、合并（FN-44）、统计更新。
 */
export class SessionRepo extends BaseRepo<DBSessionRow, ChatSession> {
  constructor(table: Table<DBSessionRow, string> = db.sessions) {
    super(table, 'sessionRepo');
  }

  protected override toDomain(row: DBSessionRow): ChatSession {
    return toDomain(row);
  }

  protected override toRow(domain: ChatSession): DBSessionRow {
    return toRow(domain);
  }

  /** 新建会话 */
  async create(input: {
    id?: UUID;
    title: string;
    personaId: UUID;
    settingsOverride?: Partial<ChatSettings>;
    proactive?: ProactiveState;
  }): Promise<Result<ChatSession>> {
    const now = nowISO();
    const session: ChatSession = {
      id: input.id ?? newId(),
      title: input.title,
      personaId: input.personaId,
      createdAt: now,
      updatedAt: now,
      settingsOverride: input.settingsOverride,
      proactive: input.proactive,
      stats: { messageCount: 0, charCount: 0, tokenEstimate: 0 },
      archived: false,
    };
    return this.upsert(session);
  }

  /** 列表（默认未归档，按最近活跃倒序） */
  async listRecent(options: { includeArchived?: boolean; limit?: number } = {}): Promise<Result<ChatSession[]>> {
    const { includeArchived = false, limit = 200 } = options;
    return tryCatchAsync(async () => {
      const rows = await this.table.orderBy('updatedAt').reverse().limit(limit).toArray();
      return rows.filter((r) => includeArchived || r.archived !== 1).map(toDomain);
    }, 'DB_FAILED');
  }

  /** 按角色列出会话 */
  async listByPersona(personaId: UUID): Promise<Result<ChatSession[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('personaId').equals(personaId).toArray();
      return rows.map(toDomain).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }, 'DB_FAILED');
  }

  /** 归档 / 取消归档 */
  async setArchived(id: UUID, archived: boolean): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.update(id, { archived: archived ? 1 : 0, updatedAt: nowISO() });
    }, 'DB_FAILED');
  }

  /** 重命名 */
  async rename(id: UUID, title: string): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.update(id, { title, updatedAt: nowISO() });
    }, 'DB_FAILED');
  }

  /** 更新会话级设置覆盖（深合并的**输入**，合并发生在 settingsStore） */
  async setOverride(id: UUID, override: Partial<ChatSettings>): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.update(id, {
        settingsOverride: override as Record<string, unknown>,
        updatedAt: nowISO(),
      });
    }, 'DB_FAILED');
  }

  /** 更新主动消息状态（FN-07 继承 / FN-06 开关） */
  async setProactive(id: UUID, proactive: ProactiveState): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.update(id, {
        proactive: proactive as unknown as Record<string, unknown>,
        updatedAt: nowISO(),
      });
    }, 'DB_FAILED');
  }

  /**
   * 统计更新（PG-01）：增量累加，避免每次全量扫表。
   * 传入 delta 即可；传 recount=true 时按实际消息重算。
   */
  async updateStats(
    id: UUID,
    delta: { messageCount?: number; charCount?: number; tokenEstimate?: number } = {},
  ): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      if (!row) return;
      const stats = row.stats ?? { messageCount: 0, charCount: 0, tokenEstimate: 0 };
      await this.table.update(id, {
        stats: {
          messageCount: Math.max(0, stats.messageCount + (delta.messageCount ?? 0)),
          charCount: Math.max(0, stats.charCount + (delta.charCount ?? 0)),
          tokenEstimate: Math.max(0, stats.tokenEstimate + (delta.tokenEstimate ?? 0)),
        },
      });
    }, 'DB_FAILED');
  }

  /** 按实际消息重算统计（导入/合并后使用） */
  async recountStats(id: UUID): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      const messages = await db.messages.where('sessionId').equals(id).toArray();
      const stats = messages.reduce(
        (acc, m) => ({
          messageCount: acc.messageCount + 1,
          charCount: acc.charCount + Array.from(m.content).length,
          tokenEstimate: acc.tokenEstimate + (m.tokenEstimate ?? 0),
        }),
        { messageCount: 0, charCount: 0, tokenEstimate: 0 },
      );
      await this.table.update(id, { stats });
    }, 'DB_FAILED');
  }

  /** 刷新预览（最后一条消息） */
  async refreshPreview(id: UUID, message?: Message): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      const last = message ?? (await this.lastMessage(id));
      if (!last) return;
      await this.table.update(id, {
        lastMessagePreview: makePreview(last.content, 60),
        updatedAt: last.createdAt,
      });
    }, 'DB_FAILED');
  }

  /** 会话内最后一条消息 */
  async lastMessage(id: UUID): Promise<Message | undefined> {
    const rows = await db.messages
      .where('[sessionId+createdAt]')
      .between([id, MIN_TIME_KEY], [id, MAX_TIME_KEY])
      .reverse()
      .limit(1)
      .toArray();
    return rows[0] as unknown as Message | undefined;
  }

  /**
   * ★ 聊天记录合并（FN-44）：把多个会话合并为一个新会话。
   * 原会话标记 archived（**不删除**），消息全部迁到新会话并按时间重排，
   * 每条消息记录 `mergedFrom`（原会话 id）。
   */
  async mergeSessions(
    sourceIds: readonly UUID[],
    options: { title: string; personaId: UUID; deleteSource?: boolean } ,
  ): Promise<Result<ChatSession>> {
    if (sourceIds.length < 1) {
      return err<ChatSession>(new AppError('IMPORT_INVALID', '至少选择一个会话'));
    }
    return tryCatchAsync(async () => {
      const now = nowISO();
      const newSession: ChatSession = {
        id: newId(),
        title: options.title,
        personaId: options.personaId,
        createdAt: now,
        updatedAt: now,
        stats: { messageCount: 0, charCount: 0, tokenEstimate: 0 },
        archived: false,
      };

      await db.transaction('rw', db.sessions, db.messages, async () => {
        await this.table.put(toRow(newSession));
        for (const sid of sourceIds) {
          const rows = await db.messages.where('sessionId').equals(sid).toArray();
          const migrated = rows
            .map((r) => ({
              ...r,
              sessionId: newSession.id,
              mergedFrom: [...(r.mergedFrom ?? []), sid],
            }))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          if (migrated.length > 0) await db.messages.bulkPut(migrated);

          if (options.deleteSource) {
            await this.table.delete(sid);
          } else {
            await this.table.update(sid, { archived: 1, updatedAt: now });
          }
        }
      });

      await this.recountStats(newSession.id);
      const refreshed = await this.table.get(newSession.id);
      return refreshed ? toDomain(refreshed) : newSession;
    }, 'DB_FAILED');
  }

  /** 删除会话（连带删除其消息） */
  async removeWithMessages(id: UUID): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await db.transaction('rw', db.sessions, db.messages, async () => {
        await db.messages.where('sessionId').equals(id).delete();
        await this.table.delete(id);
      });
    }, 'DB_FAILED');
  }

  /** 是否存在未归档会话（引导页判断首屏用） */
  async hasAny(): Promise<Result<boolean>> {
    return tryCatchAsync(async () => (await this.table.count()) > 0, 'DB_FAILED');
  }
}

export const sessionRepo = new SessionRepo();
export { toDomain as sessionRowToDomain, toRow as sessionDomainToRow };
