import type { Table } from 'dexie';
import { db } from '@/db/db';
import type { DBMomentRow } from '@/db/schema';
import { BaseRepo } from './baseRepo';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { tryCatchAsync, type Result } from '@/lib/result';
import { MOMENT_SELF_ID, type Moment, type MomentAuthorKind } from '@/types/moment';
import type { UUID } from '@/types/common';

/**
 * 朋友圈动态仓储。
 *
 * ★ `DBMomentRow` 与 `Moment` **同构**，所以这里的 `toDomain` 只做一件事：
 *   **补默认值**（`images` / `likedBy` 在历史记录里可能缺失）。
 *   不是为了"转换形状"——形状本来就一样（理由见 `db/schema.ts` 的注释）。
 *   这层不能省：`likedBy.includes(...)` 在 `undefined` 上会抛，
 *   而"数组字段缺失"是 IndexedDB 记录最常见的历史形态。
 */
function toDomain(row: DBMomentRow): Moment {
  return {
    ...row,
    images: row.images ?? [],
    likedBy: row.likedBy ?? [],
  };
}

export interface CreateMomentInput {
  content: string;
  images?: readonly string[];
  mood?: string;
  /** 不传 = 本人发布 */
  authorId?: string;
  authorKind?: MomentAuthorKind;
  authorName?: string;
}

export class MomentRepo extends BaseRepo<DBMomentRow, Moment> {
  constructor(table: Table<DBMomentRow, string> = db.moments) {
    super(table, 'moment');
  }

  protected override toDomain(row: DBMomentRow): Moment {
    return toDomain(row);
  }

  /**
   * 发布一条动态。
   *
   * ★ 正文为空直接拒绝（不写入）。判据是 `trim()` 之后为空 ——
   *   只输入空格/换行也算空，否则会出现"按钮点得动、发出去是空白卡片"。
   *   界面那边也会禁用按钮，但**仓储也要拦**：UI 禁用是体验，仓储拦截是正确性，
   *   两者不能互相替代（将来多一个发布入口就绕过去了）。
   */
  async create(input: CreateMomentInput): Promise<Result<Moment>> {
    const content = input.content.trim();
    if (content === '') {
      return { ok: false, error: this.fail('IMPORT_INVALID', '动态内容不能为空') };
    }
    const mood = input.mood?.trim();
    const now = nowISO();
    const moment: Moment = {
      id: newId(),
      authorId: input.authorId ?? MOMENT_SELF_ID,
      authorKind: input.authorKind ?? 'user',
      authorName: input.authorName ?? '',
      content,
      images: [...(input.images ?? [])],
      ...(mood ? { mood } : {}),
      likedBy: [],
      createdAt: now,
      updatedAt: now,
    };
    return this.upsert(moment);
  }

  /**
   * 时间线：**按发布时间倒序**。
   *
   * ★ 用 `orderBy('createdAt').reverse()` 走索引，不在内存里 `sort` ——
   *   `createdAt` 就是为这条查询建的索引（见 `db/db.ts` 的 v2 声明）。
   *   内存排序在记录少时"看不出问题"，等动态攒到几千条才变成卡顿，
   *   而那时已经很难联想到是这里。
   */
  async listRecent(limit = 100): Promise<Result<Moment[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.orderBy('createdAt').reverse().limit(limit).toArray();
      return rows.map(toDomain);
    }, 'DB_FAILED');
  }

  /** 某个作者的动态（倒序） */
  async listByAuthor(authorId: string): Promise<Result<Moment[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('authorId').equals(authorId).toArray();
      // ★ 按作者过滤后再内存排序：单个作者的动态是**少量**记录，
      //   不值得为它多维护一个 `[authorId+createdAt]` 复合索引
      //   （理由同 `db/db.ts` 的 v2 注释）。
      return rows.map(toDomain).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }, 'DB_FAILED');
  }

  /**
   * 点赞 / 取消点赞（**幂等切换**）。
   *
   * ★ 用 `likedBy` 数组的**增删**而不是"计数 +1/-1"：
   *   计数方案下连点两次就是 2，而实际只有一个人赞过；
   *   数组方案天然幂等 —— 已在里面就只删一次，不在就只加一次。
   *   这也让"我点过没有"与"总共几个赞"由**同一个字段**回答，不可能不一致。
   *
   * 返回值：切换**之后**的状态（`true` = 现在已赞）。
   */
  async toggleLike(id: UUID, liker: string = MOMENT_SELF_ID): Promise<Result<boolean>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      if (!row) throw this.fail('DB_FAILED', '动态不存在');
      const liked = row.likedBy ?? [];
      const has = liked.includes(liker);
      const next = has ? liked.filter((x) => x !== liker) : [...liked, liker];
      await this.table.update(id, { likedBy: next, updatedAt: nowISO() });
      return !has;
    }, 'DB_FAILED');
  }
}

export const momentRepo = new MomentRepo();
