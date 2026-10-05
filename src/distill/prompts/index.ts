import type { LLMMessage } from '@/llm/types';
import type { DistillJob, DistillTemplateId } from '@/types/distill';
import { MEMORIES_ANALYZER_PROMPT, PERSONA_ANALYZER_PROMPT, renderTagTranslation } from './analyzers';
import { MEMORIES_BUILDER_PROMPT, PERSONA_BUILDER_PROMPT } from './builders';
import { MERGER_PROMPT } from './merger';
import { CORRECTION_HANDLER_PROMPT } from './correction';
import { INTAKE_OPENING } from './intake';

/**
 * 蒸馏提示词模板出口（PRD §7.1：ex-skill 的 `prompts/*.md` → `src/distill/prompts/*.ts`）。
 *
 * ★★ 本文件导出的 `buildDistillPrompt(templateId, vars)` 是**蒸馏提示词的唯一入口**。
 *   蒸馏产物的角色是**外部角色**（PRD C2），不走欣然注入分支。
 *   任何需要蒸馏提示词的地方（含 T11 的 pipeline）都必须委托到这里，
 *   **禁止再抄一份模板**——否则就是两份真相，改一处漏一处。
 *
 * ★ 变更记录：此处原本指向 PersonaCompiler 里的一个蒸馏模板委托方法，
 *   该方法零调用且内含过期的「严格 5 层」表述，已裁定删除（B-05 / 6 层裁决）。
 *   删的是那个调用方，**本入口保留**——蒸馏提示词的真源仍然在这里。
 */

/** 模板源版本（PRD §7.4 C7：模板漂移 → 设置页展示「模板同步自 ex-skill v1.0.0」） */
export const TEMPLATE_SOURCE_VERSION = 'ex-skill v1.0.0';

/** 模板 ID 全量列表 */
export const DISTILL_TEMPLATE_IDS: readonly DistillTemplateId[] = [
  'intake',
  'memories_analyzer',
  'persona_analyzer',
  'memories_builder',
  'persona_builder',
  'merger',
  'correction_handler',
];

/** 模板 → 提示词原文 */
const RAW_TEMPLATES: Record<DistillTemplateId, string> = {
  intake: INTAKE_OPENING,
  memories_analyzer: MEMORIES_ANALYZER_PROMPT,
  persona_analyzer: PERSONA_ANALYZER_PROMPT,
  memories_builder: MEMORIES_BUILDER_PROMPT,
  persona_builder: PERSONA_BUILDER_PROMPT,
  merger: MERGER_PROMPT,
  correction_handler: CORRECTION_HANDLER_PROMPT,
};

/**
 * 变量替换：把 `{name}` 这类占位替换成 vars。
 * ★ 未命中的占位**原样保留**（模板里的示例占位如 `{howMet}` 由 LLM 自己填）。
 */
export function renderTemplate(id: DistillTemplateId, vars: Record<string, string>): string {
  const raw = RAW_TEMPLATES[id];
  return raw.replace(/\{(\w+)\}/g, (match, key: string) => {
    const v = vars[key];
    return v === undefined || v === null || v === '' ? match : v;
  });
}

/**
 * 把作业的「手动填写信息」渲染成提示词里的 profile 段。
 * 与 ex-skill 的 meta.json 字段一一对应，方便 LLM 直接引用。
 */
export function renderProfile(job: DistillJob): string {
  const p = job.profile;
  const lines: string[] = [`昵称：${job.name}`];
  if (p.duration) lines.push(`在一起：${p.duration}`);
  if (p.howMet) lines.push(`怎么认识的：${p.howMet}`);
  if (p.timeSinceBreakup) lines.push(`分手：${p.timeSinceBreakup}`);
  if (p.occupation) lines.push(`她的职业：${p.occupation}`);
  if (p.gender) lines.push(`性别：${p.gender}`);
  if (p.mbti) lines.push(`MBTI：${p.mbti}`);
  if (job.tags.attachment) lines.push(`依恋类型：${job.tags.attachment}`);
  if (job.tags.personality.length > 0) lines.push(`恋爱标签：${job.tags.personality.join('、')}`);
  if (job.impression) lines.push(`主观印象：${job.impression}`);
  return lines.join('\n');
}

/** 构造双线分析所需的公共变量 */
export function buildAnalysisVars(
  job: DistillJob,
  knowledge: string,
): Record<string, string> {
  return {
    name: job.name,
    profile: renderProfile(job),
    knowledge,
    howMet: job.profile.howMet ?? '（未填写）',
    duration: job.profile.duration ?? '（未填写）',
    occupation: job.profile.occupation ?? '（未填写）',
    mbti: job.profile.mbti ?? '（未填写）',
    attachment: job.tags.attachment ?? '（未填写）',
    impression: job.impression ?? '（未填写）',
    tagTranslation: renderTagTranslation(job.tags.personality, job.tags.attachment),
  };
}

/**
 * ★ 统一装配入口：`buildDistillPrompt(templateId, vars) → LLMMessage[]`
 *
 * 说明：蒸馏分析与生成**不启用流式**（需要结构化输出），与聊天主流程分开，
 * 避免状态污染（PRD §7.3）。
 */
export function buildDistillPrompt(
  templateId: DistillTemplateId,
  vars: Record<string, string>,
): LLMMessage[] {
  const body = renderTemplate(templateId, vars);

  switch (templateId) {
    case 'memories_analyzer':
      return [
        { role: 'system', content: MEMORIES_ANALYZER_SYSTEM },
        { role: 'user', content: body },
      ];
    case 'persona_analyzer':
      return [
        { role: 'system', content: PERSONA_ANALYZER_SYSTEM },
        { role: 'user', content: body },
      ];
    case 'memories_builder':
      return [
        { role: 'system', content: MEMORIES_BUILDER_SYSTEM },
        { role: 'user', content: body },
      ];
    case 'persona_builder':
      return [
        { role: 'system', content: PERSONA_BUILDER_SYSTEM },
        { role: 'user', content: body },
      ];
    case 'correction_handler':
      return [
        { role: 'system', content: CORRECTION_SYSTEM },
        { role: 'user', content: body },
      ];
    case 'merger':
      return [
        { role: 'system', content: MERGER_SYSTEM },
        { role: 'user', content: body },
      ];
    case 'intake':
    default:
      return [{ role: 'user', content: body }];
  }
}

/* ------------------------------ System 段 ------------------------------ */

/** 分析阶段的通用约束：中文、只依据原材料、JSON/结构化输出、不评价对错 */
const ANALYZER_COMMON = [
  '你是关系与人格分析助手。',
  '只依据原材料做判断，原材料没有的信息标注「原材料不足」，不要编造。',
  '输出用中文。引用原材料时保留原话并加引号。',
  '对感情内容保持温柔与尊重，不评价任何一方对错。',
].join('\n');

const MEMORIES_ANALYZER_SYSTEM = `${ANALYZER_COMMON}\n你现在负责【Memories 线路】：提取共同记忆、日常、偏好、冲突与情感动态。`;
const PERSONA_ANALYZER_SYSTEM = `${ANALYZER_COMMON}\n你现在负责【Persona 线路】：提取表达风格、情感逻辑、关系行为、边界雷区，并把用户标签翻译成具体行为规则。`;

const BUILDER_COMMON = [
  '你是 Markdown 文档生成器。',
  '严格按给定的标题结构输出，不要输出代码块围栏（不要 ```markdown）。',
  '输出用中文，描述要有画面感，避免「可能」「大概」这类模糊表述。',
].join('\n');

const MEMORIES_BUILDER_SYSTEM = `${BUILDER_COMMON}\n你要产出 memories.md（共同记忆）。`;
const PERSONA_BUILDER_SYSTEM = `${BUILDER_COMMON}\n你要产出 persona.md（人物性格）。Layer 0 必须是具体可执行的行为规则，不能是形容词。`;

const MERGER_SYSTEM = `${BUILDER_COMMON}\n你负责增量合并：只追加，不覆盖；发现矛盾要显式列出冲突让用户决定。`;

const CORRECTION_SYSTEM = [
  '你负责把用户的纠正转成结构化的 Correction 记录。',
  '只输出 JSON 对象，不要输出代码块围栏，不要额外解释。',
  '字段：target(persona|memories) / scene / wrong / correct / conflicts(字符串数组)。',
].join('\n');

export {
  MEMORIES_ANALYZER_PROMPT,
  PERSONA_ANALYZER_PROMPT,
  TAG_TRANSLATION_TABLE,
  ATTACHMENT_TRANSLATION_TABLE,
  renderTagTranslation,
} from './analyzers';
export {
  MEMORIES_BUILDER_PROMPT,
  PERSONA_BUILDER_PROMPT,
  buildEmptyMemoriesMd,
  buildEmptyPersonaMd,
} from './builders';
export { MERGER_PROMPT, parseMergerOutput } from './merger';
export type { MergerPatch } from './merger';
export {
  CORRECTION_HANDLER_PROMPT,
  CORRECTION_TRIGGERS,
  MAX_CORRECTIONS,
  formatCorrection,
  parseCorrections,
  appendCorrection,
  looksLikeCorrection,
  mergeCorrections,
} from './correction';
export type { CorrectionRecord } from './correction';
export {
  INTAKE_OPENING,
  INTAKE_Q1,
  INTAKE_Q2,
  INTAKE_Q3,
  ATTACHMENT_TYPES,
  LOVE_TAGS,
  ALL_LOVE_TAGS,
  MBTI_TYPES,
  ZODIACS,
  parseIntake,
  parseBasicInfo,
  parsePersonality,
  slugifyName,
  buildIntakeSummary,
} from './intake';
export type { IntakeAnswers, ParsedIntake } from './intake';
