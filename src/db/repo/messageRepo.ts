import type { Table } from 'dexie';
import { db } from '@/db/db';
import type { DBMessageRow } from '@/db/schema';
import { BaseRepo } from './baseRepo';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { estimateTokens } from '@/lib/token';
import { tryCatchAsync, ok, type Result } from '@/lib/result';
import type { Message, MessageRole, MessageStatus } from '@/types/chat';
import type { UUID } from '@/types/common';

/** 行 → 领域（favorite / proactive 用 0/1 存储，因为 IndexedDB 不能索引 boolean） */
function toDomain(row: DBMessageRow): Message {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    status: row.status,
    tokenEstimate: row.tokenEstimate,
    attachments: row.attachments as Message['attachments'],
    favorite: row.favorite === 1,
    forwardedFrom: row.forwardedFrom,
    forwardedTo: row.forwardedTo,
    mergedFrom: row.mergedFrom,
    proactive: row.proactive === 1,
    summaryOf: row.summaryOf,
    errorInfo: row.errorInfo,
    nicknameWarnings: row.nicknameWarnings,
    props: row.props,
  };
}

function toRow(msg: Message): DBMessageRow {
  return {
    id: msg.id,
    sessionId: msg.sessionId,
    role: msg.role,
    content: msg.content,
    createdAt: msg.createdAt,
    status: msg.status,
    tokenEstimate: msg.tokenEstimate ?? estimateTokens(msg.content),
    attachments: msg.attachments,
    // favorite 为 false 时不写 0，而是写 undefined，避免无效索引键
    favorite: msg.favorite ? 1 : undefined,
    forwardedFrom: msg.forwardedFrom,
    forwardedTo: msg.forwardedTo,
    mergedFrom: msg.mergedFrom,
    proactive: msg.proactive ? 1 : undefined,
    summaryOf: msg.summaryOf,
    errorInfo: msg.errorInfo,
    nicknameWarnings: msg.nicknameWarnings,
    props: msg.props,
  } as DBMessageRow;
}

/**
 * 复合索引 `[sessionId+createdAt]` 的边界哨兵。
 * createdAt 是 ISO 字符串，空串排在任何日期之前，`\uFFFF` 排在其后——
 * 比 Dexie.minKey / maxKey 更可控（后者类型在跨版本时不稳定）。
 */
export const MIN_TIME_KEY = '';
export const MAX_TIME_KEY = '\uFFFF';

/**
 * 消息仓储：分页（FN-13 加载范围）、按会话、收藏（FN-32）、转发、全文搜索、批量。
 */
export class MessageRepo extends BaseRepo<DBMessageRow, Message> {
  constructor(table: Table<DBMessageRow, string> = db.messages) {
    super(table, 'messageRepo');
  }

  protected override toDomain(row: DBMessageRow): Message {
    return toDomain(row);
  }

  protected override toRow(domain: Message): DBMessageRow {
    return toRow(domain);
  }

  /** 追加一条消息（自动生成 id / 时间 / token 估算） */
  async append(input: {
    sessionId: UUID;
    role: MessageRole;
    content: string;
    status?: MessageStatus;
    attachments?: Message['attachments'];
    proactive?: boolean;
    props?: Record<string, unknown>;
  }): Promise<Result<Message>> {
    const msg: Message = {
      id: newId(),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      createdAt: nowISO(),
      status: input.status ?? 'done',
      tokenEstimate: estimateTokens(input.content),
      attachments: input.attachments,
      proactive: input.proactive,
      props: input.props,
    };
    return this.upsert(msg);
  }

  /**
   * 分页加载（FN-13 加载范围）：
   * 取 `before` 之前的 `limit` 条，返回**按时间正序**（便于消息流渲染）。
   */
  async page(
    sessionId: UUID,
    options: { limit?: number; before?: string } = {},
  ): Promise<Result<Message[]>> {
    const { limit = 30, before = MAX_TIME_KEY } = options;
    return tryCatchAsync(async () => {
      const rows = await this.table
        .where('[sessionId+createdAt]')
        .between([sessionId, MIN_TIME_KEY], [sessionId, before], true, false)
        .reverse()
        .limit(limit)
        .toArray();
      return rows.reverse().map(toDomain);
    }, 'DB_FAILED');
  }

  /** 取会话内最新的 N 条（正序） */
  async latest(sessionId: UUID, limit = 30): Promise<Result<Message[]>> {
    return this.page(sessionId, { limit });
  }

  /** 取 createdAt 在 [from, to] 区间内的消息（总结范围 mode='time' 用） */
  async range(sessionId: UUID, from: string, to: string, limit = 5000): Promise<Result<Message[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table
        .where('[sessionId+createdAt]')
        .between([sessionId, from], [sessionId, to], true, true)
        .limit(limit)
        .toArray();
      return rows.map(toDomain);
    }, 'DB_FAILED');
  }

  /** 批量写入（同事务，避免 UI 逐条 await） */
  async bulkPut(messages: readonly Message[]): Promise<Result<number>> {
    return this.bulkUpsert(messages);
  }

  /** 更新状态（流式：sending → streaming → done / failed） */
  async setStatus(id: UUID, status: MessageStatus, errorInfo?: Message['errorInfo']): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.update(id, errorInfo ? { status, errorInfo } : { status });
    }, 'DB_FAILED');
  }

  /** 更新内容（流式增量落库 / 编辑） */
  async setContent(id: UUID, content: string): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.update(id, { content, tokenEstimate: estimateTokens(content) });
    }, 'DB_FAILED');
  }

  /** ★ 只标注不改文本：写入 NicknameGuard 检测结果 */
  async setNicknameWarnings(id: UUID, warnings: readonly string[]): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.update(id, { nicknameWarnings: [...warnings] });
    }, 'DB_FAILED');
  }

  /** 收藏 / 取消收藏（FN-32） */
  async setFavorite(id: UUID, favorite: boolean): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.update(id, { favorite: favorite ? 1 : undefined } as Partial<DBMessageRow>);
    }, 'DB_FAILED');
  }

  /** 收藏列表（PG-08），按会话分组 */
  async listFavorites(options: { sessionId?: UUID; limit?: number } = {}): Promise<Result<Message[]>> {
    const { sessionId, limit = 500 } = options;
    return tryCatchAsync(async () => {
      const rows = sessionId
        ? await this.table.where('[sessionId+favorite]').equals([sessionId, 1]).limit(limit).toArray()
        : await this.table.where('favorite').equals(1).limit(limit).toArray();
      return rows.map(toDomain).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }, 'DB_FAILED');
  }

  /**
   * 全文搜索（PG-03）：子串匹配 + 可选会话过滤。
   * 数据量在万级以内时全表扫描足够快；更大规模可换倒排（当前不引入额外依赖）。
   */
  async search(
    keyword: string,
    options: { sessionId?: UUID; role?: MessageRole; limit?: number } = {},
  ): Promise<Result<Message[]>> {
    const { sessionId, role, limit = 100 } = options;
    const kw = keyword.trim().toLowerCase();
    if (!kw) return ok([]);
    return tryCatchAsync(async () => {
      let rows: DBMessageRow[];
      if (sessionId) {
        rows = await this.table.where('sessionId').equals(sessionId).toArray();
      } else {
        rows = await this.table.orderBy('createdAt').reverse().limit(20000).toArray();
      }
      return rows
        .filter((r) => (role ? r.role === role : true))
        .filter((r) => r.content.toLowerCase().includes(kw))
        .slice(0, limit)
        .map(toDomain);
    }, 'DB_FAILED');
  }

  /**
   * 转发（FN-63）：把一条消息复制到目标会话，并记录 forwardedFrom / forwardedTo。
   * 多目标时用事务保证一致性。
   */
  async forward(messageId: UUID, targetSessionIds: readonly UUID[]): Promise<Result<number>> {
    if (targetSessionIds.length === 0) return ok(0);
    return tryCatchAsync(async () => {
      const source = await this.table.get(messageId);
      if (!source) return 0;
      let count = 0;
      await db.transaction('rw', this.table, async () => {
        for (const targetId of targetSessionIds) {
          if (targetId === source.sessionId) continue;
          const copy: Message = {
            ...toDomain(source),
            id: newId(),
            sessionId: targetId,
            createdAt: nowISO(),
            status: 'done',
            favorite: undefined,
            forwardedFrom: { sessionId: source.sessionId, messageId: source.id },
          };
          await this.table.put(toRow(copy));
          count += 1;
        }
        await this.table.update(messageId, {
          forwardedTo: [...(source.forwardedTo ?? []), ...targetSessionIds],
        });
      });
      return count;
    }, 'DB_FAILED');
  }

  /** 删除消息（单条） */
  override async remove(id: UUID): Promise<Result<void>> {
    return super.remove(id);
  }

  /** 批量删除 */
  override async removeMany(ids: readonly UUID[]): Promise<Result<number>> {
    return super.removeMany(ids);
  }

  /** 删除某会话的全部消息 */
  async removeBySession(sessionId: UUID): Promise<Result<number>> {
    return tryCatchAsync(() => this.table.where('sessionId').equals(sessionId).delete(), 'DB_FAILED');
  }

  /**
   * 归档裁剪（FN-36 最大条数限制）：
   * 超过 keep 条时，把最旧的消息标记 status='merged' 并抽走正文（**不删除**，保留可追溯性）。
   */
  async archiveOverflow(sessionId: UUID, keep: number): Promise<Result<number>> {
    return tryCatchAsync(async () => {
      const total = await this.table.where('sessionId').equals(sessionId).count();
      if (total <= keep) return 0;
      const overflow = total - keep;
      const oldest = await this.table
        .where('[sessionId+createdAt]')
        .between([sessionId, MIN_TIME_KEY], [sessionId, MAX_TIME_KEY])
        .limit(overflow)
        .toArray();
      await this.table.bulkPut(
        oldest.map((r) => ({ ...r, status: 'merged' as MessageStatus, content: '' })),
      );
      return oldest.length;
    }, 'DB_FAILED');
  }

  /** 会话内消息总数 */
  async countBySession(sessionId: UUID): Promise<Result<number>> {
    return tryCatchAsync(() => this.table.where('sessionId').equals(sessionId).count(), 'DB_FAILED');
  }

  /** 按 id 批量取（转发展开用） */
  async getMany(ids: readonly UUID[]): Promise<Result<Message[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.bulkGet(ids as string[]);
      return rows.filter((r): r is DBMessageRow => Boolean(r)).map(toDomain);
    }, 'DB_FAILED');
  }
}

export const messageRepo = new MessageRepo();
export { toDomain as messageRowToDomain, toRow as messageDomainToRow };
