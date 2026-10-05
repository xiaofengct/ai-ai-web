import type { Transaction } from 'dexie';
import { getDB } from './db';
import { DEFAULT_PERSONA_PRIVACY } from '@/constants/defaults';

/**
 * 版本迁移钩子（架构文档 §2 `db/migrations.ts`）。
 *
 * 当前版本 1（初始建表）。这里把 v1→v2 的升级函数**预留**在 `MIGRATIONS` 里，
 * 后续加字段时只需：
 *   1. 在 `db/db.ts` 里 `this.version(2).stores({...}).upgrade(MIGRATIONS['1->2'])`；
 *   2. 在本文件补一个纯函数（不依赖 Dexie 实例，便于单元测试）。
 *
 * ★ 迁移原则：只做「加字段 / 补默认值」，不做删除；删除字段留在记录里不影响读取。
 */

export type MigrationFn = (tx: Transaction) => Promise<void> | void;

/** 迁移键格式：`'<from>-><to>'` */
export const MIGRATIONS: Record<string, MigrationFn> = {
  /**
   * ★ v1 → v2（2026-10-04，随「朋友圈」上线）：**不需要迁移函数**。
   *
   * `db.ts` 的 `this.version(2).stores({ moments: ... })` 是**纯新增一张表**，
   * Dexie 自己会建表 —— 没有已存在的记录需要改写，也就没有要跑的逻辑。
   *
   * ★ 这里留一段说明而不是留空，是因为「v2 怎么没有迁移函数」是个会被反复问到的问题。
   *   判断标准很简单：**要不要动已有数据**。
   *   加表 = 不动 → 不用写；加字段/改默认值 = 要动 → 必须写（下面 `1->2` 那种形态）。
   *   ⇒ 写一个什么都不做的 `'1->2'` 反而有害：后人会以为这里"本来就该有东西"，
   *     于是往里面塞逻辑，而那些逻辑会在**每一次** v1→v2 升级时都跑一遍。
   */

  /**
   * v1 → v2（**预留示例，尚未启用**）：
   * - 给历史会话补 `stats`（此前版本没有统计字段，UI 会显示 0）；
   * - 给历史人设补 `privacy.noImage`（外部角色默认 true，与 XR-06 的隐私红线一致）。
   */
  '1->2': (tx) => {
    const sessions = tx.table('sessions');
    const personas = tx.table('personas');
    void sessions.toCollection().modify((row: Record<string, unknown>) => {
      if (!row.stats) {
        row.stats = { messageCount: 0, charCount: 0, tokenEstimate: 0 };
      }
    });
    void personas.toCollection().modify((row: Record<string, unknown>) => {
      if (!row.privacy) {
        // ★ 修正：原写法是 `{ noImage: row.origin !== 'xinran' }`，
        //   给欣然（origin === 'xinran'）算出 **false**，直接违反 XR-06「欣然恒为 true」的红线。
        //   保守默认对内置卡与外部卡都是 true，统一取单一真源。
        row.privacy = { ...DEFAULT_PERSONA_PRIVACY };
      }
    });
  },

  /**
   * ★ v2 → v3（2026-10-04，随「用户反馈」上线）：**同样不需要迁移函数**。
   *
   * `db.ts` 的 `this.version(3).stores({ feedback: ... })` 也是**纯新增一张表**，
   * Dexie 自己建 —— 没有已存在的记录要改写。
   *
   * ★ 判断标准仍然是那一条（见上面 v1→v2 的说明）：**要不要动已有数据**。
   *   加表 = 不动 → 不用写。**别再写一个空的 `'2->3'`**：空函数会被后人当成
   *   "这里本来就该有东西"的模板，往里塞逻辑，然后那些逻辑会在每次升级时重跑。
   */
};

/** 当前 schema 版本（与 db.ts 的 version(n) 保持一致） */
export const DB_VERSION = 3;

/** 打开数据库并等待就绪（失败抛 DB_FAILED，由调用方转成 AppError） */
export async function openDB(): Promise<void> {
  const db = getDB();
  if (db.isOpen()) return;
  await db.open();
}

/** 关闭数据库（一般不需要；清空存储 / 单元测试用） */
export async function closeDB(): Promise<void> {
  const db = getDB();
  if (db.isOpen()) db.close();
}
