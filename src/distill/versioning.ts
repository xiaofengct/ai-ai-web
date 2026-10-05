import { distillArtifactRepo } from '@/db/repo/distillRepo';
import { AppError } from '@/lib/errors';
import { MAX_VERSIONS } from '@/constants/limits';
import type { UUID } from '@/types/common';
import type { ArtifactVersion, ExSkillArtifact } from '@/types/distill';

/**
 * 版本管理（TS 重写 `tools/version_manager.py`，EX-09）。
 *
 * 语义差异：Python 版用 `versions/{version}/` 目录 + 复制文件；
 * Web 版把快照内嵌在 `ExSkillArtifact.versions[]`（上限 MAX_VERSIONS=10）。
 *
 * ★★ 回滚安全铁律（验收要点⑤）：
 *   回滚前**自动存档**当前内容为 `{version}_before_rollback`，
 *   保证任何一次回滚都可逆（原 Python 版也是这么做的）。
 */

/** 架构文档 §3.10 的 VersioningApi */
export interface VersioningApi {
  backup(jobId: UUID, note?: string): Promise<ArtifactVersion>;
  list(jobId: UUID): Promise<ArtifactVersion[]>;
  rollback(jobId: UUID, version: string): Promise<ExSkillArtifact>;
  /** 超出 MAX_VERSIONS 时清理最旧（返回清理条数） */
  cleanup(jobId: UUID): Promise<number>;
}

async function requireArtifact(jobId: UUID): Promise<ExSkillArtifact> {
  const res = await distillArtifactRepo.get(jobId);
  if (!res.ok) throw res.error;
  if (!res.value) throw new AppError('DB_FAILED', '产物不存在', { jobId });
  return res.value;
}

/** 存档当前内容（写入前 / 追加原材料前调用） */
export async function backup(jobId: UUID, note?: string): Promise<ArtifactVersion> {
  const res = await distillArtifactRepo.backup(jobId, note ?? '手动存档');
  if (!res.ok) throw res.error;
  return res.value;
}

/** 列出历史版本（新→旧） */
export async function list(jobId: UUID): Promise<ArtifactVersion[]> {
  const a = await requireArtifact(jobId);
  return [...a.versions].reverse();
}

/**
 * 回滚到任意历史版本。
 * ★ 回滚前自动把当前内容存档为 `{version}_before_rollback`（由 repo.rollback 内部完成）。
 */
export async function rollback(jobId: UUID, version: string): Promise<ExSkillArtifact> {
  if (!version) throw new AppError('IMPORT_INVALID', '需要指定目标版本');
  const res = await distillArtifactRepo.rollback(jobId, version);
  if (!res.ok) throw res.error;
  return res.value;
}

/**
 * 清理超限版本（超出 MAX_VERSIONS=10 时）。
 *
 * 实现说明：`distillArtifactRepo` 没有暴露「直接写 versions」的方法，
 * 但它的 `backup()` / `rollback()` 内部都会调用 `trimVersions()` 裁剪到 MAX_VERSIONS。
 * 因此这里在确实超限时触发一次存档，由 repo 完成裁剪（等价效果，且不绕过仓储层）。
 * 策略（repo.trimVersions）：v1 永远保留（便于溯源），其余保留最新的若干条。
 */
export async function cleanup(jobId: UUID): Promise<number> {
  const a = await requireArtifact(jobId);
  const over = a.versions.length - MAX_VERSIONS;
  if (over <= 0) return 0;
  await distillArtifactRepo.backup(jobId, '超限清理');
  return over;
}

/** 是否存在某个版本 */
export async function hasVersion(jobId: UUID, version: string): Promise<boolean> {
  const versions = await list(jobId);
  return versions.some((v) => v.version === version);
}

/** 取某个版本（找不到返回 undefined） */
export async function getVersion(jobId: UUID, version: string): Promise<ArtifactVersion | undefined> {
  const versions = await list(jobId);
  return versions.find((v) => v.version === version);
}

/** 下一个版本号（用于 UI 展示「将升级到 vN」） */
export async function nextVersionName(jobId: UUID): Promise<string> {
  const versions = await list(jobId);
  const nums = versions
    .map((v) => Number(/^v(\d+)$/.exec(v.version)?.[1] ?? Number.NaN))
    .filter((n) => Number.isFinite(n));
  const max = nums.length > 0 ? Math.max(...nums) : 1;
  return `v${max + 1}`;
}

/**
 * 删除某一个历史版本（EX-09 修订历史入口的「删除这一版」）。
 *
 * ★ 两条护栏：
 * 1. **v1 永不可删**——它是溯源基线（`trimVersions` 也刻意保留 v1），
 *    删了就没有「最初长什么样」可对照；
 * 2. 删之前**先存档当前内容**，和回滚同一条铁律：任何破坏性操作都可逆。
 *
 * 当前版本（`ExSkillArtifact.version` 指向的那版）也不建议删，
 * 但这里只拦 v1 —— 当前版本删了内容还在（删的是快照），交给 UI 层提示即可。
 */
export async function removeVersion(jobId: UUID, version: string): Promise<ArtifactVersion[]> {
  if (!version) throw new AppError('IMPORT_INVALID', '需要指定版本');
  if (version === 'v1') throw new AppError('IMPORT_INVALID', 'v1 是溯源基线，不能删');

  const a = await requireArtifact(jobId);
  const next = a.versions.filter((v) => v.version !== version);
  if (next.length === a.versions.length) {
    throw new AppError('DB_FAILED', '版本不存在', { jobId, version });
  }

  await backup(jobId, `删除 ${version} 前自动存档`);
  const res = await distillArtifactRepo.updateContent(jobId, { versions: next });
  if (!res.ok) throw res.error;
  return [...res.value.versions].reverse();
}

/** 是否为「回滚前自动存档」的版本 */
export function isRollbackSnapshot(version: string): boolean {
  return version.endsWith('_before_rollback');
}

export const versioning: VersioningApi = { backup, list, rollback, cleanup };

export default versioning;
