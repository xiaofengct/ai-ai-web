import type { Table } from 'dexie';
import { db } from '@/db/db';
import type { DBDistillArtifactRow, DBDistillJobRow, DBDistillRawRow } from '@/db/schema';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { tryCatchAsync, type Result } from '@/lib/result';
import { AppError } from '@/lib/errors';
import { MAX_VERSIONS } from '@/constants/limits';
import type {
  ArtifactVersion,
  DistillJob,
  DistillStatus,
  ExSkillArtifact,
  RawChunk,
  RawSourceKind,
} from '@/types/distill';
import type { UUID } from '@/types/common';

/**
 * 蒸馏仓储：作业 / 产物 / 原材料原文。
 *
 * ★ 「文件系统」语义映射（架构文档 D4）：
 *   ex-skill 的 `exes/{slug}/` + `versions/` 目录 → IndexedDB 表 + 逻辑路径 `distill/{slug}/{...}`
 *   版本快照内嵌于 `ExSkillArtifact.versions[]`（上限 MAX_VERSIONS=10）；
 *   导出 zip 时按原目录结构还原，保证与 ex-skill 生态互通。
 */

/* ------------------------------ 作业 ------------------------------ */

function jobToDomain(row: DBDistillJobRow): DistillJob {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    profile: row.profile as DistillJob['profile'],
    tags: row.tags,
    impression: row.impression,
    status: row.status,
    sources: row.sources as DistillJob['sources'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
    correctionsCount: row.correctionsCount,
    errorInfo: row.errorInfo,
  };
}

function jobToRow(job: DistillJob): DBDistillJobRow {
  return {
    id: job.id,
    slug: job.slug,
    name: job.name,
    profile: job.profile as Record<string, string | undefined>,
    tags: job.tags,
    impression: job.impression,
    status: job.status,
    sources: job.sources as unknown[],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    version: job.version,
    correctionsCount: job.correctionsCount,
    errorInfo: job.errorInfo,
  };
}

export class DistillJobRepo {
  private readonly table: Table<DBDistillJobRow, string>;

  constructor(table: Table<DBDistillJobRow, string> = db.distillJobs) {
    this.table = table;
  }

  /**
   * ★ 保证 slug 唯一（`distillJobs` 的 slug 是 **unique 索引**：`&slug`）。
   *
   * 为什么必须有这一步（真 bug，2026-10-04 QA 回归发现）：
   *   slug 由用户输入的称呼经 `slugifyName()` 得到，**同名就会同 slug**。
   *   于是「先蒸馏一个『小圆』，再新建一个也叫『小圆』」时，
   *   `put()` 撞 unique 索引 → `ConstraintError` → `submitIntake()` reject →
   *   Step1 的「下一步」**点了没反应、也不报错**，用户彻底卡死在这一步。
   *
   * 规则：base 可用就用 base；被占用则依次试 `base-2` / `base-3` …；
   * 极端情况下（连试 999 个都被占）退回随机后缀，保证**永不因为 slug 而创建失败**。
   *
   * @param excludeId 更新场景传入自身 id，避免「自己跟自己撞」而误加后缀。
   */
  private async resolveUniqueSlug(base: string, excludeId?: UUID): Promise<string> {
    const root = base.trim() !== '' ? base.trim() : 'ex';
    for (let n = 1; n <= 999; n += 1) {
      const candidate = n === 1 ? root : `${root}-${n}`;
      const hit = await this.table.where('slug').equals(candidate).first();
      if (!hit || hit.id === excludeId) return candidate;
    }
    return `${root}-${newId().slice(0, 6)}`;
  }

  /** 新建作业（Step1 三问后调用，status='intake'） */
  async create(input: {
    name: string;
    slug?: string;
    profile?: DistillJob['profile'];
    tags?: DistillJob['tags'];
    impression?: string;
  }): Promise<Result<DistillJob>> {
    return tryCatchAsync(async () => {
      const now = nowISO();
      // ★ slug 去重必须在 tryCatchAsync **内部**：查库同样可能失败，
      //   放在外面会让 create() 抛异常而不是返回 `Result.error`，破坏仓储层的统一契约。
      const slug = await this.resolveUniqueSlug(input.slug ?? `ex-${newId().slice(0, 8)}`);
      const job: DistillJob = {
        id: newId(),
        slug,
        name: input.name,
        profile: input.profile ?? {},
        tags: input.tags ?? { personality: [] },
        impression: input.impression,
        status: 'intake',
        sources: [],
        createdAt: now,
        updatedAt: now,
        version: 'v1',
        correctionsCount: 0,
      };
      await this.table.put(jobToRow(job));
      return job;
    }, 'DB_FAILED');
  }

  async get(id: UUID): Promise<Result<DistillJob | undefined>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      return row ? jobToDomain(row) : undefined;
    }, 'DB_FAILED');
  }

  async getBySlug(slug: string): Promise<Result<DistillJob | undefined>> {
    return tryCatchAsync(async () => {
      const row = await this.table.where('slug').equals(slug).first();
      return row ? jobToDomain(row) : undefined;
    }, 'DB_FAILED');
  }

  async listAll(): Promise<Result<DistillJob[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.orderBy('updatedAt').reverse().toArray();
      return rows.map(jobToDomain);
    }, 'DB_FAILED');
  }

  async listByStatus(status: DistillStatus): Promise<Result<DistillJob[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('status').equals(status).toArray();
      return rows.map(jobToDomain);
    }, 'DB_FAILED');
  }

  /** 推进状态机（EX-01：intake → importing → analyzing → preview → writing → done / failed） */
  async setStatus(id: UUID, status: DistillStatus, errorInfo?: DistillJob['errorInfo']): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.update(id, {
        status,
        updatedAt: nowISO(),
        ...(errorInfo ? { errorInfo } : {}),
      });
    }, 'DB_FAILED');
  }

  async update(id: UUID, patch: Partial<DistillJob>): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      if (!row) throw new AppError('DB_FAILED', '蒸馏作业不存在', { id });
      const merged: DistillJob = { ...jobToDomain(row), ...patch, updatedAt: nowISO() };
      // ★ 改 slug 时同样要避让 unique 索引：否则「改名撞上别人的 slug」也会 ConstraintError
      //   （与 create 同一个根因，见 resolveUniqueSlug 注释）。
      if (patch.slug !== undefined && patch.slug !== row.slug) {
        merged.slug = await this.resolveUniqueSlug(patch.slug, id);
      }
      await this.table.put(jobToRow(merged));
    }, 'DB_FAILED');
  }

  /** 追加原材料来源（Step2） */
  async addSource(id: UUID, source: DistillJob['sources'][number]): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      if (!row) throw new AppError('DB_FAILED', '蒸馏作业不存在', { id });
      await this.table.update(id, { sources: [...(row.sources ?? []), source], updatedAt: nowISO() });
    }, 'DB_FAILED');
  }

  /** Correction 计数 +1（EX-10） */
  async bumpCorrections(id: UUID): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      if (!row) return;
      await this.table.update(id, {
        correctionsCount: (row.correctionsCount ?? 0) + 1,
        updatedAt: nowISO(),
      });
    }, 'DB_FAILED');
  }

  /** 删除作业（连带产物、原材料、blobs） */
  async removeWithChildren(id: UUID): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(id);
      await db.transaction('rw', db.distillJobs, db.distillArtifacts, db.distillRaw, db.blobs, async () => {
        await db.distillArtifacts.delete(id);
        await db.distillRaw.where('jobId').equals(id).delete();
        if (row) await db.blobs.where('path').startsWith(`distill/${row.slug}/`).delete();
        await this.table.delete(id);
      });
    }, 'DB_FAILED');
  }
}

/* ------------------------------ 产物 ------------------------------ */

function artifactToDomain(row: DBDistillArtifactRow): ExSkillArtifact {
  return {
    jobId: row.jobId,
    slug: row.slug,
    memoriesMd: row.memoriesMd,
    personaMd: row.personaMd,
    metaJson: row.metaJson,
    skillMd: row.skillMd,
    versions: (row.versions ?? []) as ArtifactVersion[],
    personaCardId: row.personaCardId,
    updatedAt: row.updatedAt,
  };
}

function artifactToRow(a: ExSkillArtifact): DBDistillArtifactRow {
  return {
    jobId: a.jobId,
    slug: a.slug,
    memoriesMd: a.memoriesMd,
    personaMd: a.personaMd,
    metaJson: a.metaJson,
    skillMd: a.skillMd,
    versions: a.versions as unknown[],
    personaCardId: a.personaCardId,
    updatedAt: a.updatedAt,
  };
}

export class DistillArtifactRepo {
  private readonly table: Table<DBDistillArtifactRow, string>;

  constructor(table: Table<DBDistillArtifactRow, string> = db.distillArtifacts) {
    this.table = table;
  }

  async get(jobId: UUID): Promise<Result<ExSkillArtifact | undefined>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(jobId);
      return row ? artifactToDomain(row) : undefined;
    }, 'DB_FAILED');
  }

  /** 写入产物（EX-09）：同时压入 versions/v1 快照 */
  async write(input: {
    jobId: UUID;
    slug: string;
    memoriesMd: string;
    personaMd: string;
    metaJson: string;
    skillMd: string;
  }): Promise<Result<ExSkillArtifact>> {
    const now = nowISO();
    const artifact: ExSkillArtifact = {
      jobId: input.jobId,
      slug: input.slug,
      memoriesMd: input.memoriesMd,
      personaMd: input.personaMd,
      metaJson: input.metaJson,
      skillMd: input.skillMd,
      versions: [
        {
          version: 'v1',
          createdAt: now,
          snapshot: { memoriesMd: input.memoriesMd, personaMd: input.personaMd },
          note: '初始写入',
        },
      ],
      updatedAt: now,
    };
    return tryCatchAsync(async () => {
      await this.table.put(artifactToRow(artifact));
      return artifact;
    }, 'DB_FAILED');
  }

  /**
   * 版本快照（EX-09）：写入前先存档当前内容。
   * 超出 MAX_VERSIONS 时清理最旧的（v1 永远保留，便于溯源）。
   */
  async backup(jobId: UUID, note?: string): Promise<Result<ArtifactVersion>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(jobId);
      if (!row) throw new AppError('DB_FAILED', '产物不存在', { jobId });
      const current = artifactToDomain(row);
      const nextIndex = current.versions.length + 1;
      const version: ArtifactVersion = {
        version: `v${nextIndex}`,
        createdAt: nowISO(),
        snapshot: { memoriesMd: current.memoriesMd, personaMd: current.personaMd },
        note,
      };
      const versions = [...current.versions, version];
      const trimmed = versions.length > MAX_VERSIONS ? trimVersions(versions) : versions;
      await this.table.update(jobId, { versions: trimmed as unknown[] });
      return version;
    }, 'DB_FAILED');
  }

  /**
   * 回滚（EX-09）：回滚前**自动存档**当前内容为 `xxx_before_rollback`，
   * 保证任何一次回滚都可逆。
   */
  async rollback(jobId: UUID, version: string): Promise<Result<ExSkillArtifact>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(jobId);
      if (!row) throw new AppError('DB_FAILED', '产物不存在', { jobId });
      const current = artifactToDomain(row);
      const target = current.versions.find((v) => v.version === version);
      if (!target) throw new AppError('IMPORT_INVALID', `版本不存在：${version}`, { jobId, version });

      const safety: ArtifactVersion = {
        version: `${version}_before_rollback`,
        createdAt: nowISO(),
        snapshot: { memoriesMd: current.memoriesMd, personaMd: current.personaMd },
        note: '回滚前自动存档',
      };
      const restored: ExSkillArtifact = {
        ...current,
        memoriesMd: target.snapshot.memoriesMd,
        personaMd: target.snapshot.personaMd,
        versions: trimVersions([...current.versions, safety]),
        updatedAt: nowISO(),
      };
      await this.table.put(artifactToRow(restored));
      return restored;
    }, 'DB_FAILED');
  }

  /** 更新正文（合并增量 / Correction 重生成） */
  /**
   * 局部更新产物。
   * ★ `versions` 也在允许列表里：删除某个历史版本（EX-09）需要整体写回 versions[]，
   *   走这里就不用绕过仓储层直接碰表。
   */
  async updateContent(
    jobId: UUID,
    patch: Partial<
      Pick<
        ExSkillArtifact,
        'memoriesMd' | 'personaMd' | 'metaJson' | 'skillMd' | 'personaCardId' | 'versions'
      >
    >,
  ): Promise<Result<ExSkillArtifact>> {
    return tryCatchAsync(async () => {
      const row = await this.table.get(jobId);
      if (!row) throw new AppError('DB_FAILED', '产物不存在', { jobId });
      const merged: ExSkillArtifact = { ...artifactToDomain(row), ...patch, updatedAt: nowISO() };
      await this.table.put(artifactToRow(merged));
      return merged;
    }, 'DB_FAILED');
  }

  async remove(jobId: UUID): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      await this.table.delete(jobId);
    }, 'DB_FAILED');
  }
}

/** 保留 v1 与最新的 MAX_VERSIONS-1 个版本 */
function trimVersions(versions: readonly ArtifactVersion[]): ArtifactVersion[] {
  const keepFirst = versions.filter((v) => v.version === 'v1');
  const rest = versions.filter((v) => v.version !== 'v1');
  const tail = rest.slice(Math.max(0, rest.length - (MAX_VERSIONS - keepFirst.length)));
  return [...keepFirst, ...tail];
}

/* ---------------------------- 原材料原文 ---------------------------- */

export class DistillRawRepo {
  private readonly table: Table<DBDistillRawRow, string>;

  constructor(table: Table<DBDistillRawRow, string> = db.distillRaw) {
    this.table = table;
  }

  /** 归档一批 RawChunk（Step2 → distillRaw） */
  async putChunks(input: {
    jobId: UUID;
    slug: string;
    kind: RawSourceKind;
    fileName?: string;
    chunks: readonly RawChunk[];
  }): Promise<Result<UUID>> {
    const id = newId();
    const row: DBDistillRawRow = {
      id,
      jobId: input.jobId,
      slug: input.slug,
      kind: input.kind,
      fileName: input.fileName,
      chunks: input.chunks as unknown[],
      createdAt: nowISO(),
    };
    return tryCatchAsync(async () => {
      await this.table.put(row);
      return id;
    }, 'DB_FAILED');
  }

  /** 取某作业的全部 chunks（按 id 分档，避免单条记录过大） */
  async listChunks(jobId: UUID): Promise<Result<RawChunk[]>> {
    return tryCatchAsync(async () => {
      const rows = await this.table.where('jobId').equals(jobId).toArray();
      return rows.flatMap((r) => r.chunks as RawChunk[]);
    }, 'DB_FAILED');
  }

  async listByJob(jobId: UUID): Promise<Result<DBDistillRawRow[]>> {
    return tryCatchAsync(() => this.table.where('jobId').equals(jobId).toArray(), 'DB_FAILED');
  }

  async removeByJob(jobId: UUID): Promise<Result<number>> {
    return tryCatchAsync(() => this.table.where('jobId').equals(jobId).delete(), 'DB_FAILED');
  }
}

export const distillJobRepo = new DistillJobRepo();
export const distillArtifactRepo = new DistillArtifactRepo();
export const distillRawRepo = new DistillRawRepo();
