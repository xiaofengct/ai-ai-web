import type { Table } from 'dexie';
import { db } from '@/db/db';
import type { DBFeedbackRow } from '@/db/schema';
import { BaseRepo } from './baseRepo';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { tryCatchAsync, type Result } from '@/lib/result';
import {
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  MAX_FEEDBACK_CONTACT_LENGTH,
  MAX_FEEDBACK_LENGTH,
  MAX_FEEDBACK_NOTE_LENGTH,
  type FeedbackEnv,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackStatus,
} from '@/types/feedback';
import type { UUID } from '@/types/common';

/**
 * ★ 用户反馈仓储（2026-10-04）。
 *
 * `DBFeedbackRow` 与 `FeedbackItem` **同构**，所以 `toDomain` 只做两件事：
 *   ① 补默认值（`status` / `env` 在历史记录里可能缺失）；
 *   ② **收敛脏枚举**（`kind` / `status` 存的是 string，读出来要夹到合法值域）。
 *
 * ★ 为什么要"收敛"而不是"信任"：
 *   这两个字段是**索引列**，它们的取值直接决定筛选器能不能查到那条记录。
 *   一条 `status: 'ok'`（早期手写数据 / 从备份导入的数据）会让它在任何筛选
 *   下都不出现 —— 用户会以为"我的反馈丢了"。夹到合法值域后它至少还看得见。
 *   ⇒ 读侧**永远**对枚举做一次夹取，代价是一次 `includes`，收益是"不会静默消失"。
 */

/** 把任意字符串夹到合法类型（不认识的一律归 `other`） */
function normKind(v: unknown): FeedbackKind {
  return FEEDBACK_KINDS.includes(v as FeedbackKind) ? (v as FeedbackKind) : 'other';
}

/** 把任意字符串夹到合法状态（不认识的一律归 `new`——**没看过**是更安全的默认） */
function normStatus(v: unknown): FeedbackStatus {
  return FEEDBACK_STATUSES.includes(v as FeedbackStatus) ? (v as FeedbackStatus) : 'new';
}

/** 环境快照补默认值（历史记录可能整个 `env` 缺失） */
function normEnv(v: unknown): FeedbackEnv {
  const raw = (v ?? {}) as Partial<FeedbackEnv>;
  return {
    appVersion: String(raw.appVersion ?? ''),
    buildFlavor: String(raw.buildFlavor ?? ''),
    platform: String(raw.platform ?? ''),
    userAgent: String(raw.userAgent ?? ''),
    locale: String(raw.locale ?? ''),
    viewport: String(raw.viewport ?? ''),
  };
}

function toDomain(row: DBFeedbackRow): FeedbackItem {
  return {
    id: row.id,
    kind: normKind(row.kind),
    content: row.content ?? '',
    ...(row.contact ? { contact: row.contact } : {}),
    env: normEnv(row.env),
    status: normStatus(row.status),
    ...(row.adminNote ? { adminNote: row.adminNote } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? row.createdAt,
  };
}

export interface CreateFeedbackInput {
  kind: FeedbackKind;
  content: string;
  contact?: string;
  env: FeedbackEnv;
}

export class FeedbackRepo extends BaseRepo<DBFeedbackRow, FeedbackItem> {
  constructor(table: Table<DBFeedbackRow, string> = db.feedback) {
    super(table, 'feedback');
  }

  protected override toDomain(row: DBFeedbackRow): FeedbackItem {
    return toDomain(row);
  }

  protected override toRow(domain: FeedbackItem): DBFeedbackRow {
    return {
      id: domain.id,
      kind: domain.kind,
      content: domain.content,
      ...(domain.contact ? { contact: domain.contact } : {}),
      env: { ...domain.env },
      status: domain.status,
      ...(domain.adminNote ? { adminNote: domain.adminNote } : {}),
      createdAt: domain.createdAt,
      updatedAt: domain.updatedAt,
    };
  }

  /**
   * 提交一条反馈。
   *
   * ★ 正文为空 / 超长直接拒绝（**不写入**），而不是"截断了存进去"：
   *   截断会让用户以为他想说的都写上了，而实际后半段被丢了 ——
   *   这种"看起来成功了"的失败最伤信任。
   *   界面那边也会禁用按钮并显示字数，但**仓储也要拦**：
   *   UI 限制是体验，仓储拦截是正确性，两者不能互相替代
   *   （将来多一个提交入口就绕过去了，理由同 `momentRepo.create`）。
   */
  async create(input: CreateFeedbackInput): Promise<Result<FeedbackItem>> {
    const content = input.content.trim();
    if (content === '') {
      return { ok: false, error: this.fail('IMPORT_INVALID', '反馈内容不能为空') };
    }
    if (content.length > MAX_FEEDBACK_LENGTH) {
      return { ok: false, error: this.fail('IMPORT_INVALID', '反馈内容超出长度上限') };
    }
    const contact = input.contact?.trim().slice(0, MAX_FEEDBACK_CONTACT_LENGTH);
    const now = nowISO();
    const item: FeedbackItem = {
      id: newId(),
      kind: normKind(input.kind),
      content,
      ...(contact ? { contact } : {}),
      env: normEnv(input.env),
      status: 'new',
      createdAt: now,
      updatedAt: now,
    };
    return this.upsert(item);
  }

  /**
   * 全部反馈，**按时间倒序**（最新的在最上面）。
   *
   * ★ 走 `orderBy('createdAt').reverse()` 用索引，不在内存里 `sort`
   *   （同 `momentRepo.listRecent` 的理由：内存排序在记录少时看不出问题）。
   */
  async listRecent(limit = 500): Promise<Result<FeedbackItem[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.orderBy('createdAt').reverse().limit(limit).toArray();
      return rows.map(toDomain);
    }, 'DB_FAILED');
  }

  /** 按状态过滤（走 `status` 索引），结果仍按时间倒序 */
  async listByStatus(status: FeedbackStatus): Promise<Result<FeedbackItem[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('status').equals(status).toArray();
      return rows.map(toDomain).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }, 'DB_FAILED');
  }

  /** 改状态（`adminNote` 不动） */
  async setStatus(id: UUID, status: FeedbackStatus): Promise<Result<number>> {
    return this.patch(id, { status: normStatus(status), updatedAt: nowISO() });
  }

  /** 写处理备注；传空串 = 清掉备注 */
  async setNote(id: UUID, note: string): Promise<Result<number>> {
    const trimmed = note.trim().slice(0, MAX_FEEDBACK_NOTE_LENGTH);
    return this.patch(id, {
      adminNote: trimmed,
      updatedAt: nowISO(),
    } as Partial<DBFeedbackRow>);
  }

  /** 未读（`new`）条数 —— 设置页那个角标用它 */
  async countNew(): Promise<Result<number>> {
    return tryCatchAsync(() => this.table.where('status').equals('new').count(), 'DB_FAILED');
  }

  /** 按类型计数（管理页的统计行用它） */
  async countByKind(): Promise<Result<Record<FeedbackKind, number>>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.toArray();
      const out: Record<FeedbackKind, number> = { bug: 0, idea: 0, content: 0, other: 0 };
      for (const row of rows) out[normKind(row.kind)] += 1;
      return out;
    }, 'DB_FAILED');
  }
}

export const feedbackRepo = new FeedbackRepo();
