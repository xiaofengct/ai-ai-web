import { distillArtifactRepo, distillJobRepo, distillRawRepo } from '@/db/repo/distillRepo';
import { AppError } from '@/lib/errors';
import { zipFiles } from '@/lib/zip';
import { nowISO } from '@/lib/time';
import type { UUID } from '@/types/common';
import type { ArtifactVersion, DistillJob, ExSkillArtifact, RawChunk } from '@/types/distill';

/**
 * 产物写入器（TS 重写 `tools/skill_writer.py`，EX-09）。
 *
 * ★★ 目录结构映射（PRD C3 / 架构 D4）：
 *   ex-skill 写 `./exes/{slug}/{memories.md,persona.md,meta.json,SKILL.md,versions/*}`
 *   Web 版存 IndexedDB（`distillArtifacts` + `distillRaw`），
 *   **导出 zip 时按原目录结构还原**，保证与 ex-skill 生态双向互通（验收要点⑥）。
 */

/** 架构文档 §3.10 的 ArtifactWriterApi（就地声明，避免为它单独开一个文件） */
export interface ArtifactWriterApi {
  write(args: { job: DistillJob; memoriesMd: string; personaMd: string }): Promise<ExSkillArtifact>;
  buildSkillMd(a: ExSkillArtifact, job: DistillJob): string;
  buildMetaJson(job: DistillJob): string;
  /** 还原 exes/{slug}/ 目录结构 */
  exportZip(jobId: UUID): Promise<Blob>;
}

/** ex-skill SKILL.md 模板（原文照搬 `tools/skill_writer.py` 的 SKILL_MD_TEMPLATE） */
export const SKILL_MD_TEMPLATE = `---
name: ex_{slug}
description: {name}，{identity}
user-invocable: true
---

# {name}

{identity}

---

## PART A：共同记忆

{memories_content}

---

## PART B：人物性格

{persona_content}

---

## 运行规则

接收到任何消息时：

1. **先由 PART B 判断**：她会不会回这条消息？用什么心情和态度回？
2. **再由 PART A 提供记忆**：相关的共同记忆、日常细节、重要时刻
3. **输出时保持 PART B 的表达风格**：她说话的方式、用词习惯、emoji 偏好

**PART B 的 Layer 0 规则永远优先，任何情况下不得违背。**
`;

/** 仅 memories 的子 skill（skill_writer.py 里也会写 memories_skill.md / persona_skill.md） */
export function buildMemoriesSkillMd(slug: string, name: string, memoriesContent: string): string {
  return [
    '---',
    `name: ex_${slug}_memories`,
    `description: ${name} 的共同记忆（仅 Memories，无 Persona）`,
    'user-invocable: true',
    '---',
    '',
    memoriesContent,
    '',
  ].join('\n');
}

export function buildPersonaSkillMd(slug: string, name: string, personaContent: string): string {
  return [
    '---',
    `name: ex_${slug}_persona`,
    `description: ${name} 的人物性格（仅 Persona，无共同记忆）`,
    'user-invocable: true',
    '---',
    '',
    personaContent,
    '',
  ].join('\n');
}

/** meta.json 的形状（与 ex-skill 的 meta.json 字段一一对应） */
export interface ExMetaJson {
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
  version: string;
  profile: {
    duration?: string;
    how_met?: string;
    time_since_breakup?: string;
    occupation?: string;
    gender?: string;
    mbti?: string;
  };
  tags: { personality: string[]; attachment?: string };
  impression?: string;
  knowledge_sources: string[];
  corrections_count: number;
}

/* ================================ 实现 ================================ */

async function requireJob(jobId: UUID): Promise<DistillJob> {
  const res = await distillJobRepo.get(jobId);
  if (!res.ok) throw res.error;
  if (!res.value) throw new AppError('DB_FAILED', '蒸馏作业不存在', { jobId });
  return res.value;
}

/** 构建 meta.json 字符串（ex-skill 字段顺序与命名保持一致） */
export function buildMetaJson(job: DistillJob, extra?: { version?: string; createdAt?: string }): string {
  const meta: ExMetaJson = {
    name: job.name,
    slug: job.slug,
    created_at: extra?.createdAt ?? job.createdAt,
    updated_at: nowISO(),
    version: extra?.version ?? 'v1',
    profile: {
      ...(job.profile.duration ? { duration: job.profile.duration } : {}),
      ...(job.profile.howMet ? { how_met: job.profile.howMet } : {}),
      ...(job.profile.timeSinceBreakup ? { time_since_breakup: job.profile.timeSinceBreakup } : {}),
      ...(job.profile.occupation ? { occupation: job.profile.occupation } : {}),
      ...(job.profile.gender ? { gender: job.profile.gender } : {}),
      ...(job.profile.mbti ? { mbti: job.profile.mbti } : {}),
    },
    tags: {
      personality: job.tags.personality,
      ...(job.tags.attachment ? { attachment: job.tags.attachment } : {}),
    },
    ...(job.impression ? { impression: job.impression } : {}),
    knowledge_sources: job.sources.map((s) => s.fileName ?? s.kind),
    corrections_count: job.correctionsCount,
  };
  return JSON.stringify(meta, null, 2);
}

/** 身份描述串（对应 skill_writer.build_identity_string） */
export function buildIdentityString(job: DistillJob): string {
  const p = job.profile;
  const parts: string[] = [];
  if (p.duration) parts.push(`在一起 ${p.duration}`);
  if (p.howMet) parts.push(p.howMet);
  if (p.timeSinceBreakup) parts.push(`分手 ${p.timeSinceBreakup}`);

  let identity = parts.length > 0 ? parts.join('，') : '前任';
  if (p.occupation) identity += `，${p.occupation}`;
  if (p.mbti) identity += `，MBTI ${p.mbti}`;
  return identity;
}

/** 渲染 SKILL.md */
export function buildSkillMd(a: ExSkillArtifact, job: DistillJob): string {
  const identity = buildIdentityString(job);
  return SKILL_MD_TEMPLATE.replace('{slug}', job.slug)
    .replace('{name}', job.name)
    .replace('{identity}', identity)
    .replace('{memories_content}', a.memoriesMd)
    .replace('{persona_content}', a.personaMd);
}

/* ================================ 写入 ================================ */

/**
 * 写入产物（验收要点④）：memories.md / persona.md / meta.json / SKILL.md + versions/v1 快照。
 * 快照由 `distillArtifactRepo.write` 内部压入（v1）。
 */
export async function write(args: {
  job: DistillJob;
  memoriesMd: string;
  personaMd: string;
}): Promise<ExSkillArtifact> {
  const { job, memoriesMd, personaMd } = args;

  const draft: ExSkillArtifact = {
    jobId: job.id,
    slug: job.slug,
    memoriesMd,
    personaMd,
    metaJson: buildMetaJson(job),
    skillMd: '',
    versions: [],
    updatedAt: nowISO(),
  };
  // SKILL.md 需要 memories/persona，先装配再写库
  draft.skillMd = buildSkillMd(draft, job);

  const res = await distillArtifactRepo.write({
    jobId: job.id,
    slug: job.slug,
    memoriesMd,
    personaMd,
    metaJson: draft.metaJson,
    skillMd: draft.skillMd,
  });
  if (!res.ok) throw res.error;
  return res.value;
}

/** 重生成 SKILL.md / meta.json（纠正或合并后调用） */
export async function refreshDerived(jobId: UUID, version?: string): Promise<ExSkillArtifact> {
  const job = await requireJob(jobId);
  const res = await distillArtifactRepo.get(jobId);
  if (!res.ok) throw res.error;
  const current = res.value;
  if (!current) throw new AppError('DB_FAILED', '产物不存在', { jobId });

  const updated = await distillArtifactRepo.updateContent(jobId, {
    skillMd: buildSkillMd(current, job),
    metaJson: buildMetaJson(job, { version: version ?? job.version, createdAt: job.createdAt }),
  });
  if (!updated.ok) throw updated.error;
  return updated.value;
}

/* ================================ 导出 zip ================================ */

/** knowledge 子目录（对应 ex-skill 的 knowledge/{chats,photos,social}） */
const KNOWLEDGE_DIR: Record<string, string> = {
  wechat: 'chats',
  imessage: 'chats',
  sms: 'chats',
  photo: 'photos',
  social: 'social',
  file: 'chats',
  paste: 'chats',
};

/**
 * 导出 zip：还原 `exes/{slug}/` 目录结构（决策 A4 / C3）。
 *
 * exes/{slug}/
 *   memories.md
 *   persona.md
 *   meta.json
 *   SKILL.md
 *   memories_skill.md
 *   persona_skill.md
 *   knowledge/chats|photos/social/*.txt
 *   versions/{version}/memories.md + persona.md + SKILL.md
 */
export async function exportZip(jobId: UUID): Promise<Blob> {
  const job = await requireJob(jobId);
  const aRes = await distillArtifactRepo.get(jobId);
  if (!aRes.ok) throw aRes.error;
  const artifact = aRes.value;
  if (!artifact) throw new AppError('DB_FAILED', '产物不存在，无法导出', { jobId });

  const root = `exes/${job.slug}`;
  const files: Record<string, string | Uint8Array> = {
    [`${root}/memories.md`]: artifact.memoriesMd,
    [`${root}/persona.md`]: artifact.personaMd,
    [`${root}/meta.json`]: artifact.metaJson,
    [`${root}/SKILL.md`]: artifact.skillMd || buildSkillMd(artifact, job),
    [`${root}/memories_skill.md`]: buildMemoriesSkillMd(job.slug, job.name, artifact.memoriesMd),
    [`${root}/persona_skill.md`]: buildPersonaSkillMd(job.slug, job.name, artifact.personaMd),
  };

  // 原材料归档（knowledge/）
  const rawRes = await distillRawRepo.listByJob(jobId);
  if (rawRes.ok) {
    rawRes.value.forEach((row, i) => {
      const dir = KNOWLEDGE_DIR[row.kind] ?? 'chats';
      const base = sanitizeFileName(row.fileName ?? `${row.kind}-${i + 1}`);
      const chunks = (row.chunks ?? []) as RawChunk[];
      const body = chunks
        .map((c) => {
          const ts = c.time ? `[${c.time}] ` : '';
          const who = c.speaker ? `${c.speaker}：` : '';
          return `${ts}${who}${c.text}`;
        })
        .join('\n');
      files[`${root}/knowledge/${dir}/${base}.txt`] = body;
    });
  }

  // 版本快照（versions/{version}/）
  for (const v of artifact.versions) {
    const dir = `${root}/versions/${sanitizeFileName(v.version)}`;
    files[`${dir}/memories.md`] = v.snapshot.memoriesMd;
    files[`${dir}/persona.md`] = v.snapshot.personaMd;
    files[`${dir}/SKILL.md`] = buildSkillMd(
      { ...artifact, memoriesMd: v.snapshot.memoriesMd, personaMd: v.snapshot.personaMd },
      job,
    );
    files[`${dir}/meta.json`] = JSON.stringify(
      {
        version: v.version,
        created_at: v.createdAt,
        note: v.note ?? '',
      },
      null,
      2,
    );
  }

  const bytes = zipFiles(files);
  // 复制一份，避免把 fflate 的底层 buffer 交给 Blob 后被转移
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy], { type: 'application/zip' });
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'untitled';
}

/** 导出用的默认文件名 */
export function exportFileName(job: DistillJob): string {
  const stamp = nowISO().slice(0, 16).replace(/[-:T]/g, '');
  return `exes-${job.slug}-${stamp}.zip`;
}

/* ================================ 接口导出 ================================ */

/** 架构文档 §3.10 的 ArtifactWriterApi 实现 */
export const artifactWriter: ArtifactWriterApi = {
  write,
  buildSkillMd,
  buildMetaJson: (job: DistillJob) => buildMetaJson(job),
  exportZip,
};

/** 取产物（不存在返回 undefined） */
export async function getArtifact(jobId: UUID): Promise<ExSkillArtifact | undefined> {
  const res = await distillArtifactRepo.get(jobId);
  if (!res.ok) throw res.error;
  return res.value;
}

/** 取版本列表 */
export async function listVersions(jobId: UUID): Promise<ArtifactVersion[]> {
  const a = await getArtifact(jobId);
  return a?.versions ?? [];
}

export default artifactWriter;
