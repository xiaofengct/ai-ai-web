import { distillArtifactRepo, distillJobRepo } from '@/db/repo/distillRepo';
import { AppError } from '@/lib/errors';
import type { UUID } from '@/types/common';
import type { DistillJob, ExSkillArtifact } from '@/types/distill';
import { refreshDerived } from './artifactWriter';
import { backup } from './versioning';
import {
  MAX_CORRECTIONS,
  appendCorrection,
  formatCorrection,
  looksLikeCorrection,
  mergeCorrections,
  parseCorrections,
  type CorrectionRecord,
} from './prompts/correction';

/**
 * 对话纠正（EX-10）—— 对应 ex-skill 的 `prompts/correction_handler.md` + `skill_writer.update_skill`。
 *
 * 流程：
 *   用户在聊天里说「她不会这样」→ 解析成 Correction 记录
 *   → 追加到 memories.md / persona.md 的 `## Correction 记录` 节
 *   → 重新生成 SKILL.md → 升版本 → correctionsCount +1
 *
 * ★ PRD C4：纠正只作用于**外部角色**（蒸馏产物）。
 *   若传入的 persona 是欣然内置卡（isBuiltin），调用方必须先拦截改走「记忆修正」。
 */

/** 追加一条纠正并升版本（原子顺序：先存档 → 再改内容 → 再刷 SKILL.md） */
export async function applyCorrection(args: {
  jobId: UUID;
  record: CorrectionRecord;
  line?: string;
}): Promise<{ artifact: ExSkillArtifact; job: DistillJob; version: string }> {
  const { jobId, record } = args;
  const line = args.line ?? formatCorrection(record);

  const jobRes = await distillJobRepo.get(jobId);
  if (!jobRes.ok) throw jobRes.error;
  const job = jobRes.value;
  if (!job) throw new AppError('DB_FAILED', '蒸馏作业不存在', { jobId });

  const aRes = await distillArtifactRepo.get(jobId);
  if (!aRes.ok) throw aRes.error;
  const current = aRes.value;
  if (!current) throw new AppError('DB_FAILED', '产物不存在，无法追加纠正', { jobId });

  // ① 先存档当前版本（保证可逆）
  const version = await backup(jobId, '纠正前自动存档');

  // ② 追加到对应文件
  const patch =
    record.target === 'memories'
      ? { memoriesMd: appendCorrection(current.memoriesMd, line) }
      : { personaMd: appendCorrection(current.personaMd, line) };

  const updated = await distillArtifactRepo.updateContent(jobId, patch);
  if (!updated.ok) throw updated.error;

  // ③ 纠正计数 +1
  await distillJobRepo.bumpCorrections(jobId);

  // ④ 重新生成 SKILL.md / meta.json（version 用刚存档的版本号 +1）
  const refreshed = await refreshDerived(jobId, nextVersionOf(version.version));

  const jobAfter = await distillJobRepo.get(jobId);
  if (!jobAfter.ok) throw jobAfter.error;
  return {
    artifact: refreshed,
    job: jobAfter.value ?? { ...job, correctionsCount: job.correctionsCount + 1 },
    version: version.version,
  };
}

function nextVersionOf(v: string): string {
  const n = Number(/^v(\d+)$/.exec(v)?.[1] ?? Number.NaN);
  return Number.isFinite(n) ? `v${n + 1}` : v;
}

/**
 * 列出某产物已有的 Correction 记录（memories + persona 合并，带归属标记）。
 */
export async function listCorrections(jobId: UUID): Promise<CorrectionRecord[]> {
  const res = await distillArtifactRepo.get(jobId);
  if (!res.ok) throw res.error;
  const a = res.value;
  if (!a) return [];
  return [
    ...parseCorrections(a.memoriesMd, 'memories'),
    ...parseCorrections(a.personaMd, 'persona'),
  ];
}

/**
 * ★ Correction 层维护规则（correction_handler.md）：最多 50 条，超出合并相似项。
 * 合并策略：同一 `scene` 合并为 1 条，保留**最新**表述；合并后重写该节。
 */
export async function compactCorrections(jobId: UUID): Promise<{ mergedCount: number; total: number }> {
  const res = await distillArtifactRepo.get(jobId);
  if (!res.ok) throw res.error;
  const a = res.value;
  if (!a) return { mergedCount: 0, total: 0 };

  const memoriesRecords = parseCorrections(a.memoriesMd, 'memories');
  const personaRecords = parseCorrections(a.personaMd, 'persona');

  if (memoriesRecords.length + personaRecords.length <= MAX_CORRECTIONS) {
    return { mergedCount: 0, total: memoriesRecords.length + personaRecords.length };
  }

  const mMerged = mergeCorrections(memoriesRecords);
  const pMerged = mergeCorrections(personaRecords);
  const mergedCount = mMerged.mergedCount + pMerged.mergedCount;

  await backup(jobId, 'Correction 合并前自动存档');
  const updated = await distillArtifactRepo.updateContent(jobId, {
    memoriesMd: rewriteCorrectionSection(a.memoriesMd, mMerged.merged),
    personaMd: rewriteCorrectionSection(a.personaMd, pMerged.merged),
  });
  if (!updated.ok) throw updated.error;
  await refreshDerived(jobId);

  return { mergedCount, total: mMerged.merged.length + pMerged.merged.length };
}

/**
 * ★ 把「合并后的整份记录列表」写回两个文件（编辑 / 删除单条都走这里）。
 *
 * 顺序必须与 `listCorrections` 一致：**先 memories 再 persona**，
 * 否则按下标定位时会错位（UI 拿的是合并列表的下标）。
 */
async function writeBack(
  jobId: UUID,
  records: readonly CorrectionRecord[],
  note: string,
): Promise<void> {
  const res = await distillArtifactRepo.get(jobId);
  if (!res.ok) throw res.error;
  const a = res.value;
  if (!a) throw new AppError('DB_FAILED', '产物不存在，无法改写纠正记录', { jobId });

  await backup(jobId, note);
  const updated = await distillArtifactRepo.updateContent(jobId, {
    memoriesMd: rewriteCorrectionSection(a.memoriesMd, records.filter((r) => r.target === 'memories')),
    personaMd: rewriteCorrectionSection(a.personaMd, records.filter((r) => r.target === 'persona')),
  });
  if (!updated.ok) throw updated.error;
  await refreshDerived(jobId);
}

/**
 * 编辑第 index 条纠正（UI 传的下标来自 `listCorrections` 的合并列表）。
 * ★ 改动前先存档，保证可回滚到编辑前。
 */
export async function editCorrection(
  jobId: UUID,
  index: number,
  patch: Partial<Omit<CorrectionRecord, 'target'>>,
): Promise<CorrectionRecord[]> {
  const records = await listCorrections(jobId);
  if (index < 0 || index >= records.length) {
    throw new AppError('IMPORT_INVALID', '纠正条目不存在', { jobId, index });
  }
  const next = records.map((r, i) => (i === index ? { ...r, ...patch } : r));
  await writeBack(jobId, next, '编辑纠正前自动存档');
  return next;
}

/** 删除第 index 条纠正（同样先存档） */
export async function removeCorrection(jobId: UUID, index: number): Promise<CorrectionRecord[]> {
  const records = await listCorrections(jobId);
  if (index < 0 || index >= records.length) {
    throw new AppError('IMPORT_INVALID', '纠正条目不存在', { jobId, index });
  }
  const next = records.filter((_, i) => i !== index);
  await writeBack(jobId, next, '删除纠正前自动存档');
  return next;
}

/** 重写 `## Correction 记录` 整节（合并后使用） */
export function rewriteCorrectionSection(md: string, records: readonly CorrectionRecord[]): string {
  const heading = '## Correction 记录';
  const body =
    records.length > 0
      ? `\n\n${records.map(formatCorrection).join('\n')}\n`
      : '\n\n（暂无记录）\n';

  const idx = md.indexOf(heading);
  if (idx === -1) return `${md.trimEnd()}\n\n${heading}${body}`;

  const insertAt = idx + heading.length;
  const rest = md.slice(insertAt);
  const end = rest.search(/\n---/);
  const tail = end === -1 ? '' : rest.slice(end);
  return `${md.slice(0, insertAt)}${body}${tail}`;
}

/** 本地判断一句话是不是纠正意图（不花 token，供聊天层快速判断） */
export { looksLikeCorrection };
export { MAX_CORRECTIONS };
export type { CorrectionRecord };
