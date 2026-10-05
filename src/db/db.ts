import Dexie, { type Table } from 'dexie';
import { DB_NAME, TABLE } from '@/constants/storageKeys';
import type { AiAiDBSchema } from './schema';

/**
 * ★ Dexie 实例与建表（架构文档 §5 T03 验收要点①）：15 张表 + 索引。
 *
 * 索引理由见 `db/schema.ts` 的注释，这里只写建表语句（注意顺序与 schema 一致）。
 * 版本从 1 起，后续迁移写在 `db/migrations.ts`。
 */
export class AiAiDB extends Dexie {
  sessions!: Table<AiAiDBSchema['sessions'], string>;
  messages!: Table<AiAiDBSchema['messages'], string>;
  personas!: Table<AiAiDBSchema['personas'], string>;
  memories!: Table<AiAiDBSchema['memories'], string>;
  stickers!: Table<AiAiDBSchema['stickers'], string>;
  timbres!: Table<AiAiDBSchema['timbres'], string>;
  live2d!: Table<AiAiDBSchema['live2d'], string>;
  blobs!: Table<AiAiDBSchema['blobs'], string>;
  distillJobs!: Table<AiAiDBSchema['distillJobs'], string>;
  distillArtifacts!: Table<AiAiDBSchema['distillArtifacts'], string>;
  distillRaw!: Table<AiAiDBSchema['distillRaw'], string>;
  logs!: Table<AiAiDBSchema['logs'], string>;
  backups!: Table<AiAiDBSchema['backups'], string>;
  settings!: Table<AiAiDBSchema['settings'], string>;
  moments!: Table<AiAiDBSchema['moments'], string>;
  feedback!: Table<AiAiDBSchema['feedback'], string>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({
      // 会话列表按最近活跃排序；归档过滤用 archived
      sessions: '&id, updatedAt, createdAt, personaId, archived',
      // ★ 最热查询：会话内按时间分页；收藏页按会话分组；全局时间线用 createdAt
      messages: '&id, [sessionId+createdAt], [sessionId+favorite], createdAt, status, role',
      // 人设：内置卡置顶（pinned）、按来源过滤、按更新时间排序
      personas: '&id, updatedAt, origin, isBuiltin, pinned, distillJobId',
      // ★ 范围记忆 sessionId、得分排序 score、标签多值索引 *tags
      memories: '&id, sessionId, personaId, score, *tags, updatedAt, timeRef',
      stickers: '&id, createdAt, enabled, builtin',
      timbres: '&id, createdAt, provider',
      live2d: '&id, createdAt, zipAssetId',
      // ★ 逻辑路径唯一：导入去重与按目录前缀查询
      blobs: '&id, &path, createdAt, mime',
      distillJobs: '&id, &slug, status, updatedAt, createdAt',
      distillArtifacts: '&jobId, slug, updatedAt, personaCardId',
      distillRaw: '&id, jobId, slug, kind, createdAt',
      // 滚动保留时按时间删最旧
      logs: '&id, at, level, scope, featureId',
      backups: '&id, createdAt, kind',
      settings: '&key, updatedAt',
    });

    /**
     * ★★ v2：新增 `moments`（朋友圈动态，2026-10-04）。
     *
     * ★ 为什么只声明**新增的那张表**、不重抄 v1 的 15 张：
     *   Dexie 的版本是**增量叠加**的 —— 每个 `version(n).stores()` 只需列出
     *   "相对上一版有变化"的表，未提到的表沿用上一版的声明。
     *   重抄一遍看着"完整"，实际是**第二份真相**：将来改 v1 的某个索引，
     *   忘了同步 v2 这份副本，两边就会不一致，而且不会有任何报错。
     *
     * ★ 索引说明：
     *   - `&id` 主键；
     *   - `createdAt` —— 时间线**只按时间倒序**取，这是唯一的排序键；
     *   - `authorId` —— 「只看某个人的动态」用（`作者 + 时间` 复合索引没必要：
     *     动态是**少数量**记录（不同于消息可能上万条），
     *     按作者过滤后内存排序完全够用，不值得为它多维护一个复合索引）。
     */
    this.version(2).stores({
      moments: '&id, createdAt, authorId',
    });

    /**
     * ★★ v3：新增 `feedback`（用户反馈，2026-10-04）。
     *
     * 同 v2 的理由，**只声明新增的那张表**，不重抄前面两张
     * （重抄 = 第二份真相，改一处忘一处且不报错）。
     *
     * ★ 索引说明：
     *   - `&id` 主键；
     *   - `createdAt` —— 反馈列表只按时间倒序取，这是唯一排序键；
     *   - `status` —— 筛选器按状态过滤（"还有几条没看"是最常用的查询）；
     *   - `kind` —— 按类型过滤（"有几条 bug"）。
     *   反馈是**极少量**记录（一个用户不会提交几百条），
     *   所以没必要建 `[status+createdAt]` 这类复合索引 —— 过滤后内存排序足够。
     */
    this.version(3).stores({
      feedback: '&id, createdAt, status, kind',
    });
  }
}

/** 全局数据库实例（懒创建，避免 SSR / 测试环境下直接打开 IndexedDB） */
let instance: AiAiDB | null = null;

export function getDB(): AiAiDB {
  if (!instance) instance = new AiAiDB();
  return instance;
}

export const db: AiAiDB = getDB();

/** IndexedDB 是否可用（诊断页 PG-20 用） */
export function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/** 估算存储配额（诊断页 PG-20 用；不支持时返回 null） */
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}

/** 全库清空（开发者页「清空存储」用，需二次确认） */
export async function wipeDatabase(): Promise<void> {
  await db.delete();
  instance = null;
  await getDB().open();
}

export { TABLE };
export type { AiAiDBSchema };
