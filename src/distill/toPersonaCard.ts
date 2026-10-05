import { personaRepo } from '@/db/repo/personaRepo';
import { distillArtifactRepo, distillJobRepo } from '@/db/repo/distillRepo';
import { usePersonaStore } from '@/store/personaStore';
import { AppError } from '@/lib/errors';
import type { UUID } from '@/types/common';
import type { PersonaCard, PersonaCardData } from '@/types/persona';
import type { DistillJob, ExSkillArtifact } from '@/types/distill';
import { buildIdentityString } from './artifactWriter';

/**
 * 蒸馏产物 → 可聊天的角色卡（XR-08 / 验收要点⑦）。
 *
 * ★★ 两条硬规则：
 * 1. **默认 `privacy.noImage = true`**（PRD C5 / XR-08）：
 *    蒸馏产物绝不允许被用于图像生成；用户可在人设编辑页显式放开。
 *
 *    ★ 取值链路（2026-10-04 确认）：本文件**不自己写 privacy 字面量**，
 *      而是 `personaRepo.create()` 内部取单一真源 `DEFAULT_PERSONA_PRIVACY`
 *      （`src/constants/defaults.ts`）。也就是说这条规则的兜底在 repo 层，
 *      改默认值请改那个常量，不要在这里补一份——否则又会变成两处漂移。
 *      `personaRepo.create()` 的入参不接受 privacy，所以这里也无法显式传。
 * 2. **走「外部角色」分支**（PRD C2）：
 *    origin = 'external'，PersonaCompiler 不注入欣然的 Layer0-4 与昵称约束，
 *    避免人格串味；欣然始终是默认且置顶。
 */

/** 从 persona.md 里抽 Layer 0（最高优先级规则）作为 system_prompt 的核心 */
export function extractLayer0(personaMd: string): string {
  const idx = personaMd.indexOf('## Layer 0');
  if (idx === -1) return '';
  const rest = personaMd.slice(idx);
  const end = rest.indexOf('\n## Layer 1');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/** 从 persona.md 里抽 Layer 2（表达风格）作为 mes_example / 风格补充 */
export function extractLayer2(personaMd: string): string {
  const start = personaMd.indexOf('## Layer 2');
  if (start === -1) return '';
  const rest = personaMd.slice(start);
  const end = rest.indexOf('\n## Layer 3');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/** 从 memories.md 里抽「关系概览」作为 scenario */
export function extractScenario(memoriesMd: string): string {
  const idx = memoriesMd.indexOf('## 关系概览');
  if (idx === -1) return '';
  const rest = memoriesMd.slice(idx + '## 关系概览'.length);
  const end = rest.indexOf('\n---');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/** 组装 chara_card_v2 的 9 字段（其余 Web 扩展字段写 extensions） */
export function buildPersonaCardData(job: DistillJob, artifact: ExSkillArtifact): PersonaCardData {
  const identity = buildIdentityString(job);
  const layer0 = extractLayer0(artifact.personaMd);
  const layer2 = extractLayer2(artifact.personaMd);
  const scenario = extractScenario(artifact.memoriesMd);

  return {
    name: job.name,
    description: `${job.name}，${identity}。由蒸馏生成（${artifact.versions.length} 个版本快照）。`,
    personality: job.tags.personality.join('、') || undefined,
    scenario: scenario || undefined,
    creator_notes: `由「蒸馏」生成。作业 ${job.slug}（${job.id}）。人格原文见附带的 persona.md / memories.md。`,
    first_mes: buildFirstMes(job),
    mes_example: layer2 || undefined,
    system_prompt: [
      layer0,
      '',
      '## 行为总原则',
      '1. Layer 0 优先级最高，任何情况下不得违背。',
      '2. 用她自己的说话方式，不要跳出角色变成通用 AI。',
      '3. Correction 层的规则优先于上面所有内容。',
    ]
      .filter(Boolean)
      .join('\n'),
    post_history_instructions: [
      '始终以她的身份说话。',
      '以下内容仅作为你们之间的记忆，不要主动复述全部，只在相关时自然提起：',
      artifact.memoriesMd,
    ].join('\n'),
    alternate_greetings: [],
    tags: ['distill', ...job.tags.personality],
    extensions: {
      distillJobId: job.id,
      distillSlug: job.slug,
      distillVersion: job.version,
      memoriesMd: artifact.memoriesMd,
      personaMd: artifact.personaMd,
    },
  };
}

function buildFirstMes(job: DistillJob): string {
  const how = job.profile.howMet ? `${job.profile.howMet}，` : '';
  const duration = job.profile.duration ? `在一起 ${job.profile.duration}。` : '';
  return `${how}${duration}我是${job.name}。`.trim();
}

/**
 * 把蒸馏产物转成角色卡（幂等：已转过则复用原来的 cardId）。
 * 转完后自动把当前聊天角色切到它（XR-08「可在聊天中切换」）。
 */
export async function artifactToPersonaCard(jobId: UUID): Promise<PersonaCard> {
  const jobRes = await distillJobRepo.get(jobId);
  if (!jobRes.ok) throw jobRes.error;
  const job = jobRes.value;
  if (!job) throw new AppError('DB_FAILED', '蒸馏作业不存在', { jobId });

  const aRes = await distillArtifactRepo.get(jobId);
  if (!aRes.ok) throw aRes.error;
  const artifact = aRes.value;
  if (!artifact) throw new AppError('DB_FAILED', '还没有产物，先把蒸馏跑完', { jobId });

  // 幂等：已有 cardId 且卡片还在 → 直接返回
  if (artifact.personaCardId) {
    const existing = await personaRepo.get(artifact.personaCardId);
    if (existing.ok && existing.value) return existing.value;
  }

  const data = buildPersonaCardData(job, artifact);
  const created = await personaRepo.create({
    name: job.name,
    data,
    origin: 'external',
    distillJobId: jobId,
  });
  if (!created.ok) throw created.error;

  const linked = await distillArtifactRepo.updateContent(jobId, { personaCardId: created.value.id });
  if (!linked.ok) throw linked.error;

  // 刷新人设列表并切到这个角色（欣然仍然置顶且可随时切回）
  const store = usePersonaStore.getState();
  await store.reload();
  store.select(created.value.id);

  return created.value;
}

/** 切换到某个蒸馏角色（聊天中切换，XR-08） */
export async function switchToDistillPersona(cardId: UUID): Promise<void> {
  const res = await personaRepo.get(cardId);
  if (!res.ok) throw res.error;
  if (!res.value) throw new AppError('IMPORT_INVALID', '角色不存在', { cardId });
  const store = usePersonaStore.getState();
  await store.reload();
  store.select(cardId);
}

/** 该角色卡是否来自蒸馏产物 */
export function isDistillPersona(card: PersonaCard): boolean {
  return Boolean(card.distillJobId) || card.origin === 'external' && card.data.tags?.includes('distill') === true;
}

export default artifactToPersonaCard;
