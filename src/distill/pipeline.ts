import type { ChatSettings } from '@/types/settings';
import type { UUID } from '@/types/common';
import type { DistillJob, DistillTemplateId, RawChunk } from '@/types/distill';
import { toAppError } from '@/lib/errors';
import { BATCH_CHARS } from '@/constants/limits';
import { estimateTokens } from '@/lib/token';
import { formatKnowledge } from './parsers/common';
import { buildDistillPrompt, buildAnalysisVars, renderProfile } from './prompts/index';
import { parseMergerOutput, type MergerPatch } from './prompts/merger';
import { formatCorrection, type CorrectionRecord } from './prompts/correction';

/**
 * 蒸馏流水线（EX-08：双线分析 + 生成）。
 *
 * ★★ LLM 适配接口（**关键约定**）
 * ------------------------------------------------------------------
 * `src/llm/client.ts`（T05 / 工程师 A）在 T11 开发时可能还没落地，
 * 因此这里**只依赖 `src/llm/types.ts` 里已有的类型**，通过一个窄接口调用：
 *
 *   type LlmComplete = (req: LlmCompleteRequest) => Promise<string>
 *
 * 运行时由应用注入：见 `src/llm/adapter/registry.ts` 的 `setLlmAdapter()`。
 *
 * ★★ 未注入 = 蒸馏完全不可用（不是降级）。
 *   `hasLlmAdapter()` 恒 false → StepAnalyze 守卫命中 → 双线分析永不执行。
 *   所以**应用启动时必须调一次 `setLlmAdapter()`**，这是硬要求不是建议。
 *
 * 在应用启动处（`src/main.tsx`，与 `bootstrap()` 同一处序列）写：
 *
 *   import { llmClient } from '@/llm/client';   // ★ 门面单例，不是 createLLMClient
 *   import { setLlmAdapter } from '@/llm/adapter/registry';
 *   setLlmAdapter({
 *     complete: (req) => llmClient.complete({ ...req, stream: false }),
 *   });
 *
 * ★★ 为什么 `setLlmAdapter` 住在 `@/llm/adapter/registry`，不在本文件：
 *   `main.tsx` 属于**主入口 chunk**。若从本文件（`src/distill/pipeline`）取
 *   setLlmAdapter，一行 import 就会把整个蒸馏引擎（pipeline / parsers /
 *   prompts，源码 ~65 kB）拽进首屏主包，懒加载失效——
 *   实测入口 193.42 kB → 205.95 kB（+12.5 kB）就是这个原因。
 *   registry 刻意零重依赖，所以主入口可以安全地 import 它。
 *   ★ 不要把注册表的实现搬回本文件，那会让懒加载再次退化。
 *
 * ★ 必须走 `llmClient` 门面（不能裸 fetch）：重试（5xx/超时）、内容过滤、
 *   脱敏日志、错误归一化都在门面里，蒸馏是最烧 token 的一路。
 * ★ `LlmCompleteRequest` 与门面的 `CompletionOptions` **字段 1:1 对应**，
 *   唯一多出来的是 `stream`，显式传 false（蒸馏不启用流式，PRD §7.3）。
 *
 * 这样蒸馏层与 LLM 层完全解耦，替换实现不用改 T11 的任何文件。
 * ------------------------------------------------------------------
 */

/* ============================== LLM 适配接口 ============================== */

import { getLlmAdapter, peekLlmAdapter } from '@/llm/adapter/registry';

/**
 * ◆ 兼容再导出：老调用点（`distillStore` / `StepAnalyze`）仍从本文件取。
 * ★ 新代码请直接 `import ... from '@/llm/adapter/registry'`，
 *   尤其是**主入口**链路——从本文件取会把整个蒸馏引擎带进首屏主包。
 */
export type { LlmAdapter, LlmComplete, LlmCompleteRequest } from '@/llm/adapter/registry';
export { getLlmAdapter, hasLlmAdapter, setLlmAdapter } from '@/llm/adapter/registry';

/* ================================ 分批策略 ================================ */

/**
 * 按字符数分批（默认 8000 字符/批，C6 + constants/limits.BATCH_CHARS）。
 * ★ 在**消息边界**切，不把一条消息劈成两半（否则 LLM 会看到半截话）。
 */
export function splitIntoBatches(chunks: readonly RawChunk[], batchChars = BATCH_CHARS): RawChunk[][] {
  if (chunks.length === 0) return [];
  const batches: RawChunk[][] = [];
  let current: RawChunk[] = [];
  let size = 0;

  for (const c of chunks) {
    const len = c.text.length + (c.speaker?.length ?? 0) + 24; // 24 ≈ 时间前缀 + 分隔符
    if (current.length > 0 && size + len > batchChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(c);
    size += len;
    // 单条超长（罕见）→ 单独成批，避免死循环
    if (size >= batchChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** 单批 → 给 LLM 的知识文本 */
export function batchToKnowledge(chunks: readonly RawChunk[], index: number, total: number): string {
  return formatKnowledge(chunks, {
    title: `原材料提取结果（第 ${index + 1}/${total} 批）`,
  });
}

/* ================================ 成本预估 ================================ */

export interface CostEstimate {
  /** 原材料字符数 */
  chars: number;
  /** 预估输入 token（含模板与 profile） */
  promptTokens: number;
  /** 预估输出 token（按每批产出上限估） */
  completionTokens: number;
  /** 预估总 token */
  totalTokens: number;
  /** 批次数 */
  batches: number;
  /** 预估请求次数：分析（2 条线 × 批次）+ 生成（2 次） */
  calls: number;
  /** 展示用模型名 */
  modelLabel: string;
}

/** 每批分析的产出上限（用于估输出 token） */
const ANALYSIS_OUTPUT_TOKENS = 1200;
const BUILD_OUTPUT_TOKENS = 4000;
/** 提示词模板本身的固定开销（system + user 模板骨架） */
const TEMPLATE_OVERHEAD_TOKENS = 900;

/**
 * ★ 成本预估（验收要点③：分批调用 LLM 前先算字符数/预估 token，弹窗确认后才请求）。
 * 这是防止用户误烧额度的关键——任何一次 analyses 之前都必须先跑这个。
 */
export function estimateCost(
  job: DistillJob,
  chunks: readonly RawChunk[],
  opts: { batchChars?: number; modelLabel?: string } = {},
): CostEstimate {
  const batchChars = opts.batchChars ?? BATCH_CHARS;
  const batches = Math.max(1, splitIntoBatches(chunks, batchChars).length);
  const profile = renderProfile(job);
  const chars = chunks.reduce((s, c) => s + c.text.length, 0);

  // 输入 token：原材料逐条估算 + 每批的模板 / profile 固定开销
  const materialTokens = chunks.reduce((s, c) => s + estimateTokens(c.text) + estimateTokens(c.speaker ?? ''), 0);
  const perBatchOverhead = estimateTokens(profile) + TEMPLATE_OVERHEAD_TOKENS;
  const promptTokens = materialTokens + batches * perBatchOverhead;
  const completionTokens = batches * ANALYSIS_OUTPUT_TOKENS * 2 + BUILD_OUTPUT_TOKENS * 2;

  return {
    chars,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    batches,
    // 分析：每条线每批 1 次；生成：2 次；再加 1 次冗余（重试/容错）
    calls: batches * 2 + 2,
    // ★ 用 peek 不用 get：成本预估是「展示」路径，未注入不该抛错（原行为如此）
    modelLabel: opts.modelLabel ?? peekLlmAdapter()?.modelLabel ?? '（未选择模型）',
  };
}

/* ============================== JSON 容错解析 ============================== */

/**
 * 从 LLM 输出里捞 JSON（PRD C6「JSON 模式 + 容错解析」）。
 * 容错分支：
 *   ① 直接 JSON.parse
 *   ② 去掉 ```json 围栏
 *   ③ 截取第一个 { 到最后一个 }
 *   ④ 都不行 → 返回 null（调用方降级，不抛错）
 */
export function parseLooseJson<T>(text: string): T | null {
  const raw = text.trim();
  if (!raw) return null;

  const attempts: string[] = [
    raw,
    raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''),
    sliceBraces(raw),
  ].filter((s): s is string => Boolean(s));

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* 继续尝试下一个 */
    }
  }
  return null;
}

function sliceBraces(s: string): string {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return '';
  return s.slice(start, end + 1);
}

/** 从 Markdown 输出里剥掉代码块围栏（builder 有时自作主张加围栏） */
export function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:markdown|md)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}

/* ================================= 分析 ================================= */

export interface AnalysisResult {
  memoriesAnalysis: string;
  personaAnalysis: string;
  batches: number;
  /** 失败被跳过的批次数（容错：不让一批发错就整条链路崩掉） */
  failedBatches: number;
}

export interface PipelineOptions {
  signal?: AbortSignal;
  batchChars?: number;
  onProgress?(p: number, label?: string): void;
  /** 每批完成后回调（UI 展示进度文案） */
  onBatch?(done: number, total: number): void;
  params?: Partial<ChatSettings['params']>;
  model?: string;
  providerId?: UUID;
  timeoutMs?: number;
}

/**
 * 双线分析（Step3）：
 *   线路 A = memories_analyzer，线路 B = persona_analyzer；
 *   每条线按 8000 字符分批调用，逐批累积，最后合并成一份分析文本。
 *
 * ★ 容错：某批失败记录 failedBatches 继续跑，不中断整条链路（避免已花的 token 全废）。
 */
export async function runAnalysis(
  job: DistillJob,
  chunks: readonly RawChunk[],
  opts: PipelineOptions = {},
): Promise<AnalysisResult> {
  const llm = getLlmAdapter();
  const batchChars = opts.batchChars ?? BATCH_CHARS;
  const batches = splitIntoBatches(chunks, batchChars);
  if (batches.length === 0) {
    return { memoriesAnalysis: '', personaAnalysis: '', batches: 0, failedBatches: 0 };
  }

  const memoriesParts: string[] = [];
  const personaParts: string[] = [];
  let failedBatches = 0;

  for (let i = 0; i < batches.length; i += 1) {
    assertLive(opts.signal);
    const knowledge = batchToKnowledge(batches[i], i, batches.length);
    const vars = buildAnalysisVars(job, knowledge);

    // 线路 A
    try {
      const out = await llm.complete({
        messages: buildDistillPrompt('memories_analyzer', vars),
        responseFormat: 'text',
        ...(opts.params ? { params: opts.params } : {}),
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.providerId ? { providerId: opts.providerId } : {}),
        ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      memoriesParts.push(stripCodeFence(out));
    } catch (e) {
      failedBatches += 1;
      logPipelineWarn('memories_analyzer 批次失败', e, i);
    }

    // 线路 B
    try {
      const out = await llm.complete({
        messages: buildDistillPrompt('persona_analyzer', vars),
        responseFormat: 'text',
        ...(opts.params ? { params: opts.params } : {}),
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.providerId ? { providerId: opts.providerId } : {}),
        ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      personaParts.push(stripCodeFence(out));
    } catch (e) {
      failedBatches += 1;
      logPipelineWarn('persona_analyzer 批次失败', e, i);
    }

    opts.onBatch?.(i + 1, batches.length);
    // 两条线，所以进度按 (i+1)/batches
    opts.onProgress?.((i + 1) / batches.length, `第 ${i + 1}/${batches.length} 批`);
  }

  return {
    memoriesAnalysis: joinParts(memoriesParts, batches.length),
    personaAnalysis: joinParts(personaParts, batches.length),
    batches: batches.length,
    failedBatches,
  };
}

function joinParts(parts: readonly string[], total: number): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const head = `（以下为 ${parts.length}/${total} 批分析结果的合并，按批次顺序排列）\n\n`;
  return head + parts.map((p, i) => `### 第 ${i + 1} 批\n\n${p}`).join('\n\n---\n\n');
}

/* ================================= 生成 ================================= */

export interface BuildResult {
  memoriesMd: string;
  personaMd: string;
}

/**
 * Step4 生成：memories_builder → memories.md；persona_builder → persona.md（Layer 0~5）。
 * 无原材料时（用户跳过 Step2）不调 LLM，直接用骨架模板（省 token）。
 */
export async function runBuild(
  job: DistillJob,
  analysis: Pick<AnalysisResult, 'memoriesAnalysis' | 'personaAnalysis'>,
  opts: PipelineOptions & { hasMaterial?: boolean } = {},
): Promise<BuildResult> {
  const hasMaterial = opts.hasMaterial ?? Boolean(analysis.memoriesAnalysis || analysis.personaAnalysis);

  if (!hasMaterial) {
    // ★ 无原材料时**不调 LLM**，只用下面这些手动信息拼骨架（行为事实，别删：
    //   这不是"缺功能"，是刻意的设计——见 `distill.write.skeletonDone` 那条文案，
    //   它会如实告诉用户「这只是个空架子，不是我记得的她」）。
    //   （原先这里还括了一句 PRD 出处，但 PRD 里查无此句，已删除——行为不变。）
    const { buildEmptyMemoriesMd, buildEmptyPersonaMd } = await import('./prompts/builders');
    return {
      memoriesMd: buildEmptyMemoriesMd(job.name, job.profile.howMet, job.profile.duration),
      personaMd: buildEmptyPersonaMd({
        name: job.name,
        occupation: job.profile.occupation,
        mbti: job.profile.mbti,
        attachment: job.tags.attachment,
        duration: job.profile.duration,
        howMet: job.profile.howMet,
        impression: job.impression,
        tags: job.tags.personality,
      }),
    };
  }

  const llm = getLlmAdapter();
  opts.onProgress?.(0.6, '生成共同记忆');

  const memoriesMd = stripCodeFence(
    await llm.complete({
      messages: buildDistillPrompt('memories_builder', {
        ...buildAnalysisVars(job, ''),
        analysis: analysis.memoriesAnalysis || '（原材料不足，请基于手动信息生成骨架）',
      }),
      responseFormat: 'text',
      ...(opts.params ? { params: opts.params } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.providerId ? { providerId: opts.providerId } : {}),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }),
  );

  opts.onProgress?.(0.85, '生成人物性格');

  const personaMd = stripCodeFence(
    await llm.complete({
      messages: buildDistillPrompt('persona_builder', {
        ...buildAnalysisVars(job, ''),
        analysis: analysis.personaAnalysis || '（原材料不足，请基于手动信息生成骨架）',
      }),
      responseFormat: 'text',
      ...(opts.params ? { params: opts.params } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.providerId ? { providerId: opts.providerId } : {}),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }),
  );

  opts.onProgress?.(1, '生成完成');
  return { memoriesMd: ensureTitle(memoriesMd, `# ${job.name} — 共同记忆`), personaMd: ensureTitle(personaMd, `# ${job.name} — Persona`) };
}

/** LLM 有时会漏掉一级标题，这里补上，保证 SKILL.md 装配时结构完整 */
function ensureTitle(md: string, title: string): string {
  const t = md.trim();
  if (!t) return `${title}\n`;
  if (t.startsWith('# ')) return t;
  return `${title}\n\n${t}`;
}

/* ============================== 增量合并 ============================== */

/** 追加原材料（done → analyzing）：先由 merger 产出 patch，再由调用方落库 */
export async function runMerger(
  job: DistillJob,
  input: { currentMemories: string; currentPersona: string; newKnowledge: string },
  opts: PipelineOptions = {},
): Promise<MergerPatch> {
  const llm = getLlmAdapter();
  const text = await llm.complete({
    messages: buildDistillPrompt('merger', {
      name: job.name,
      profile: renderProfile(job),
      currentMemories: input.currentMemories.slice(0, 12_000),
      currentPersona: input.currentPersona.slice(0, 12_000),
      newKnowledge: input.newKnowledge,
    }),
    responseFormat: 'text',
    ...(opts.params ? { params: opts.params } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.providerId ? { providerId: opts.providerId } : {}),
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  return parseMergerOutput(text);
}

/* ============================== 对话纠正 ============================== */

export interface CorrectionParseResult {
  record: CorrectionRecord;
  conflicts: string[];
}

/** 解析用户的纠正原话 → 标准 Correction 记录（EX-10） */
export async function runCorrection(
  job: DistillJob,
  input: { utterance: string; currentPersona: string; currentMemories: string },
  opts: PipelineOptions = {},
): Promise<CorrectionParseResult> {
  const llm = getLlmAdapter();
  const raw = await llm.complete({
    messages: buildDistillPrompt('correction_handler', {
      name: job.name,
      utterance: input.utterance,
      currentPersona: input.currentPersona.slice(0, 8_000),
      currentMemories: input.currentMemories.slice(0, 8_000),
    }),
    responseFormat: 'json',
    ...(opts.params ? { params: opts.params } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.providerId ? { providerId: opts.providerId } : {}),
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  const parsed = parseLooseJson<Partial<CorrectionRecord> & { conflicts?: string[] }>(raw);
  if (!parsed) {
    // ★ 容错：JSON 解析不出来时降级为「通用场景 + 原话」，绝不丢用户的纠正
    return {
      record: {
        target: 'persona',
        scene: '通用',
        wrong: '按之前的方式回应',
        correct: input.utterance.replace(/^(她|这|那)?(不会|不对|其实是|应该是)/, '').trim() || input.utterance,
      },
      conflicts: [],
    };
  }

  return {
    record: {
      target: parsed.target === 'memories' ? 'memories' : 'persona',
      scene: (parsed.scene ?? '通用').trim(),
      wrong: (parsed.wrong ?? '按之前的方式回应').trim(),
      correct: (parsed.correct ?? input.utterance).trim(),
    },
    conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts.map(String) : [],
  };
}

/** Correction 渲染（供 UI 预览「将写入什么」） */
export function previewCorrectionLine(r: CorrectionRecord): string {
  return formatCorrection(r);
}

/* ================================= 工具 ================================= */

function assertLive(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const e = new Error('已取消');
    e.name = 'AbortError';
    throw e;
  }
}

/** 流水线内部告警（不抛错，只记日志——日志层由 logStore 提供，这里做最小依赖） */
function logPipelineWarn(message: string, e: unknown, batch: number): void {
  const err = toAppError(e, 'LLM_BAD_RESPONSE');
  // 用 console.warn 而非 logStore，避免 T11 反向依赖 store 层造成循环引用；
  // store 层的 runAnalysis 会把同样的错误写进 logStore。
  // eslint-disable-next-line no-console
  console.warn(`[distill] ${message}`, { batch, code: err.code });
}

/** 模板 ID → 人类可读名（开发者页 / 日志用） */
export const TEMPLATE_LABEL: Record<DistillTemplateId, string> = {
  intake: '基础信息录入',
  memories_analyzer: 'Memories 分析',
  persona_analyzer: 'Persona 分析',
  memories_builder: 'Memories 生成',
  persona_builder: 'Persona 生成',
  merger: '增量合并',
  correction_handler: '对话纠正',
};
