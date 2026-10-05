import { create } from 'zustand';
import { distillArtifactRepo, distillJobRepo, distillRawRepo } from '@/db/repo/distillRepo';
import { AppError, toAppError } from '@/lib/errors';
import { nowISO } from '@/lib/time';
import type { UUID } from '@/types/common';
import type {
  ArtifactVersion,
  DistillJob,
  DistillSource,
  DistillStatus,
  ExSkillArtifact,
  RawChunk,
  RawSourceKind,
} from '@/types/distill';
import type { PersonaCard } from '@/types/persona';
import { assertTransition, prevStatus, stepOf, TOTAL_STEPS } from '@/distill/flow';
import {
  estimateCost,
  runAnalysis,
  runBuild,
  runCorrection,
  runMerger,
  splitIntoBatches,
  type CostEstimate,
} from '@/distill/pipeline';
import { useSettingsStore } from '@/store/settingsStore';
import { exportZip, getArtifact, write } from '@/distill/artifactWriter';
import {
  exportJson,
  exportPng,
  importArtifactFile,
  jsonFileName,
  pngFileName,
} from '@/distill/artifactTransfer';
import {
  backup,
  list as listVersions,
  removeVersion as removeVersionApi,
  rollback,
} from '@/distill/versioning';
import {
  applyCorrection,
  editCorrection as editCorrectionApi,
  listCorrections,
  removeCorrection as removeCorrectionApi,
} from '@/distill/corrections';
import { artifactToPersonaCard } from '@/distill/toPersonaCard';
import { runParser, getParser } from '@/distill/parsers/index';
import type { ParseInput, ParseOptions } from '@/distill/parsers/types';
import { parseIntake, slugifyName } from '@/distill/prompts/index';
import type { CorrectionRecord } from '@/distill/prompts/correction';
import { log } from './logStore';

/**
 * 蒸馏 Store（架构文档 §6.6）：作业列表 + 5 步向导 + 产物 / 版本 / 纠正编排。
 *
 * ★ 状态机严格走 `distill/flow.ts`（§4.7），UI 不允许绕过：
 *   每次 `setStatus` 都过 `assertTransition`；
 *   进入 done 前必须先 backup（见 `confirmWrite`）。
 */

/* ============================ Provider 可用性 ============================ */

/**
 * ★ 判断「有没有真正能用的模型服务」，而不是「适配器有没有注入」。
 *
 * 为什么不能只用 `hasLlmAdapter()`：
 *   `main.tsx` 启动时**必然**执行 `setLlmAdapter({...})`，所以它恒为 true，
 *   用它当守卫会让「没配 Key」被判成「服务故障」，用户永远拿不到
 *   `err.llmNoProvider`（还没接模型…）这条最准的提示——那条文案成了死代码。
 *
 * 判据与路由守卫 `useHasProvider()` 保持一致：`baseUrl` 与 `model` 都非空。
 */
export function hasUsableProvider(): boolean {
  try {
    const provider = useSettingsStore.getState().activeProvider();
    return Boolean(provider && provider.baseUrl.trim() !== '' && provider.model.trim() !== '');
  } catch {
    return false;
  }
}

/* ================================ 类型 ================================ */

export interface DistillDraft {
  name: string;
  slug: string;
  basic: string;
  personality: string;
}

export interface DistillState {
  jobs: DistillJob[];
  current?: DistillJob;
  artifact?: ExSkillArtifact;
  versions: ArtifactVersion[];
  corrections: CorrectionRecord[];

  /** 向导 */
  wizardOpen: boolean;
  step: number;
  draft: DistillDraft;
  /** 当前作业已导入的原材料（内存态，落库走 distillRaw） */
  chunks: RawChunk[];
  sources: DistillSource[];

  /** Step3 / Step4 的中间结果 */
  analysis: { memoriesAnalysis: string; personaAnalysis: string; batches: number };
  draftArtifact: { memoriesMd: string; personaMd: string };
  cost?: CostEstimate;

  busy: boolean;
  progress: number;
  progressLabel?: string;
  /** 面向用户的错误码（页面层据此取欣然文案） */
  errorCode?: string;

  /* ------------------------------ 动作 ------------------------------ */
  reload(): Promise<void>;
  startNew(): void;
  openJob(jobId: UUID): Promise<void>;
  closeWizard(): void;

  setDraft(patch: Partial<DistillDraft>): void;
  submitIntake(): Promise<DistillJob>;

  addSource(kind: RawSourceKind, input: ParseInput, opts?: ParseOptions): Promise<number>;
  removeSource(index: number): void;

  goStep(step: number): Promise<void>;
  back(): Promise<void>;
  setStatus(next: DistillStatus, errorInfo?: DistillJob['errorInfo']): Promise<void>;

  estimate(): CostEstimate | undefined;
  analyze(): Promise<void>;
  build(): Promise<void>;
  confirmWrite(): Promise<void>;

  loadArtifact(jobId: UUID): Promise<void>;
  backupVersion(note?: string): Promise<void>;
  rollbackTo(version: string): Promise<void>;
  /** 删除某一个历史版本（v1 不可删，由 versioning 层拦截） */
  removeVersion(version: string): Promise<void>;

  applyCorrectionText(text: string): Promise<CorrectionRecord>;
  /** 单条编辑纠正记录（下标来自 `corrections` 合并列表） */
  editCorrection(index: number, patch: Partial<Omit<CorrectionRecord, 'target'>>): Promise<void>;
  /** 删除单条纠正记录 */
  removeCorrection(index: number): Promise<void>;
  mergeMaterial(chunks: readonly RawChunk[]): Promise<{ memories: boolean; persona: boolean }>;

  exportJobZip(jobId: UUID): Promise<Blob>;
  /** 导出 JSON（结构化快照，可再导入回来） */
  exportJobJson(jobId: UUID): Promise<Blob>;
  /** 导出 PNG 长图（canvas 自绘，不引第三方库） */
  exportJobPng(jobId: UUID): Promise<Blob>;
  /** 建议的导出文件名（与导出格式一一对应） */
  jsonFileNameOf(job: DistillJob): string;
  pngFileNameOf(job: DistillJob): string;
  /** 导入产物文件（.json / .zip）→ 新建一条作业 */
  importArtifact(file: File): Promise<{ jobId: UUID; name: string }>;
  removeJob(jobId: UUID): Promise<void>;
  toPersonaCard(jobId: UUID): Promise<PersonaCard>;
}

/* ================================ 实现 ================================ */

const EMPTY_DRAFT: DistillDraft = { name: '', slug: '', basic: '', personality: '' };
const EMPTY_ANALYSIS = { memoriesAnalysis: '', personaAnalysis: '', batches: 0 };
const EMPTY_DRAFT_ARTIFACT = { memoriesMd: '', personaMd: '' };

export const useDistillStore = create<DistillState>()((set, get) => ({
  jobs: [],
  artifact: undefined,
  versions: [],
  corrections: [],

  wizardOpen: false,
  step: 1,
  draft: { ...EMPTY_DRAFT },
  chunks: [],
  sources: [],

  analysis: { ...EMPTY_ANALYSIS },
  draftArtifact: { ...EMPTY_DRAFT_ARTIFACT },
  cost: undefined,

  busy: false,
  progress: 0,
  progressLabel: undefined,
  errorCode: undefined,

  /* ------------------------------ 列表 ------------------------------ */

  reload: async () => {
    const res = await distillJobRepo.listAll();
    if (!res.ok) {
      log.error('db', '加载蒸馏作业失败', res.error, 'EX-01');
      set({ errorCode: 'DB_FAILED' });
      return;
    }
    set({ jobs: res.value, errorCode: undefined });
  },

  startNew: () => {
    set({
      wizardOpen: true,
      step: 1,
      current: undefined,
      artifact: undefined,
      versions: [],
      corrections: [],
      draft: { ...EMPTY_DRAFT },
      chunks: [],
      sources: [],
      analysis: { ...EMPTY_ANALYSIS },
      draftArtifact: { ...EMPTY_DRAFT_ARTIFACT },
      cost: undefined,
      progress: 0,
      progressLabel: undefined,
      errorCode: undefined,
    });
  },

  openJob: async (jobId) => {
    const res = await distillJobRepo.get(jobId);
    if (!res.ok || !res.value) {
      set({ errorCode: 'DB_FAILED' });
      return;
    }
    const job = res.value;

    // 从库里取回已归档的 chunks（用于追加 / 重新分析）
    const rawRes = await distillRawRepo.listChunks(jobId);
    const chunks = rawRes.ok ? rawRes.value : [];

    const artifact = await getArtifact(jobId);
    const versions = artifact ? [...artifact.versions].reverse() : [];
    const corrections = artifact ? await listCorrections(jobId) : [];

    const finished = job.status === 'done';
    set({
      current: job,
      artifact,
      versions,
      corrections,
      wizardOpen: !finished,
      step: finished ? TOTAL_STEPS : (stepOf(job.status) ?? 1),
      draft: {
        name: job.name,
        slug: job.slug,
        basic: '',
        personality: '',
      },
      chunks,
      sources: job.sources,
      analysis: { ...EMPTY_ANALYSIS },
      draftArtifact: artifact
        ? { memoriesMd: artifact.memoriesMd, personaMd: artifact.personaMd }
        : { ...EMPTY_DRAFT_ARTIFACT },
      errorCode: undefined,
    });
  },

  closeWizard: () => {
    set({ wizardOpen: false });
    void get().reload();
  },

  /* ------------------------------ Step1 ------------------------------ */

  setDraft: (patch) => {
    const draft = { ...get().draft, ...patch };
    // 称呼变了就重算 slug（用户没手动改过 slug 的情况下）
    if (patch.name !== undefined && !get().current) {
      draft.slug = slugifyName(patch.name);
    }
    set({ draft });
  },

  submitIntake: async () => {
    const { draft, current } = get();
    const name = draft.name.trim();
    if (!name) {
      set({ errorCode: 'IMPORT_INVALID' });
      throw new AppError('IMPORT_INVALID', '蒸馏缺少称呼');
    }

    const parsed = parseIntake({ name, basic: draft.basic, personality: draft.personality });
    const slug = draft.slug.trim() || slugifyName(name);

    if (current) {
      // 编辑已有作业的基础信息（importing → intake 是合法回退）
      const res = await distillJobRepo.update(current.id, {
        name,
        slug,
        profile: parsed.profile,
        tags: parsed.tags,
        ...(parsed.impression ? { impression: parsed.impression } : {}),
      });
      if (!res.ok) throw res.error;
      const refreshed = await distillJobRepo.get(current.id);
      if (!refreshed.ok) throw refreshed.error;
      const job = refreshed.value ?? { ...current, name, slug };
      set({ current: job, step: 2, errorCode: undefined });
      await get().setStatus('importing');
      return job;
    }

    const created = await distillJobRepo.create({
      name,
      slug,
      profile: parsed.profile,
      tags: parsed.tags,
      ...(parsed.impression ? { impression: parsed.impression } : {}),
    });
    if (!created.ok) throw created.error;

    set({ current: created.value, step: 2, errorCode: undefined });
    await get().setStatus('importing');
    await get().reload();
    return created.value;
  },

  /* ------------------------------ Step2 ------------------------------ */

  /**
   * 解析并归档一份原材料。
   * 返回新增的 chunk 数（0 表示解析出空内容，UI 会提示）。
   */
  addSource: async (kind, input, opts = {}) => {
    const job = get().current;
    if (!job) throw new AppError('IMPORT_INVALID', '还没有作业');

    set({ busy: true, progress: 0, errorCode: undefined });
    try {
      const report = await runParser(kind, input, opts);
      if (report.chunks.length === 0) {
        set({ busy: false, errorCode: 'PARSE_FAIL' });
        return 0;
      }

      // 归档原文到 distillRaw（对应 ex-skill 的 knowledge/ 目录）
      const archived = await distillRawRepo.putChunks({
        jobId: job.id,
        slug: job.slug,
        kind,
        fileName: report.fileName,
        chunks: report.chunks,
      });
      if (!archived.ok) throw archived.error;

      const source: DistillSource = {
        id: archived.value,
        kind,
        fileName: report.fileName,
        chunkCount: report.chunks.length,
      };
      await distillJobRepo.addSource(job.id, source);

      const refreshed = await distillJobRepo.get(job.id);
      if (!refreshed.ok) throw refreshed.error;
      set({
        busy: false,
        progress: 1,
        chunks: [...get().chunks, ...report.chunks],
        sources: [...get().sources, source],
        current: refreshed.value ?? job,
      });
      log.info('distill', '原材料解析完成', { kind, chunks: report.chunks.length }, getParser(kind).featureId);
      return report.chunks.length;
    } catch (e) {
      const err = toAppError(e, 'PARSE_FAIL');
      set({ busy: false, errorCode: err.code });
      log.error('distill', '原材料解析失败', err, getParser(kind).featureId);
      throw err;
    }
  },

  removeSource: (index) => {
    const sources = get().sources.filter((_, i) => i !== index);
    set({ sources });
    // 库里的 sources 同步（chunks 保留，避免误删已归档原文）
    const job = get().current;
    if (job) void distillJobRepo.update(job.id, { sources });
  },

  /* ------------------------------ 向导流转 ------------------------------ */

  goStep: async (step) => {
    const job = get().current;
    if (!job) {
      set({ step });
      return;
    }
    const target = step <= 1 ? 'intake' : step === 2 ? 'importing' : step === 3 ? 'analyzing' : step === 4 ? 'preview' : 'writing';
    if (target === job.status) {
      set({ step });
      return;
    }
    await get().setStatus(target);
    set({ step });
  },

  back: async () => {
    const job = get().current;
    const prev = job ? prevStatus(job.status) : undefined;
    if (!job || !prev) {
      set({ step: Math.max(1, get().step - 1) });
      return;
    }
    await get().setStatus(prev);
    set({ step: Math.max(1, (stepOf(prev) ?? 1) ) });
  },

  setStatus: async (next, errorInfo) => {
    const job = get().current;
    if (!job) return;
    // ★ 状态机守卫：非法转移直接抛错，UI 不允许绕过
    assertTransition(job.status, next);
    const res = await distillJobRepo.setStatus(job.id, next, errorInfo);
    if (!res.ok) throw res.error;
    const refreshed = await distillJobRepo.get(job.id);
    if (!refreshed.ok) throw refreshed.error;
    set({ current: refreshed.value ?? { ...job, status: next, updatedAt: nowISO() } });
    await get().reload();
  },

  /* ------------------------------ Step3 分析 ------------------------------ */

  /** 成本预估（★ 弹窗确认前只调这个，不发起任何请求） */
  estimate: () => {
    const { current, chunks } = get();
    if (!current) return undefined;
    const cost = estimateCost(current, chunks);
    set({ cost });
    return cost;
  },

  analyze: async () => {
    const job = get().current;
    if (!job) throw new AppError('IMPORT_INVALID', '还没有作业');
    if (!hasUsableProvider()) {
      set({ errorCode: 'LLM_NO_PROVIDER' });
      throw new AppError('LLM_NO_PROVIDER', '还没有可用的模型服务（接口地址或模型为空）');
    }

    set({ busy: true, progress: 0, progressLabel: undefined, errorCode: undefined });
    try {
      await get().setStatus('analyzing');
      const result = await runAnalysis(job, get().chunks, {
        onProgress: (p, label) => set({ progress: p, progressLabel: label }),
      });
      set({ analysis: { memoriesAnalysis: result.memoriesAnalysis, personaAnalysis: result.personaAnalysis, batches: result.batches } });

      // 分析完直接进入生成（Step4 预览需要草案）
      const built = await runBuild(job, result, {
        hasMaterial: get().chunks.length > 0,
        onProgress: (p, label) => set({ progress: p, progressLabel: label }),
      });
      set({ draftArtifact: built, busy: false, progress: 1 });
      await get().setStatus('preview');
      set({ step: 4 });
      log.info('distill', '双线分析完成', { batches: result.batches, failed: result.failedBatches }, 'EX-08');
    } catch (e) {
      const err = toAppError(e, 'LLM_BAD_RESPONSE');
      set({ busy: false, errorCode: err.code });
      await get().setStatus('failed', { code: err.code, message: err.message });
      log.error('distill', '双线分析失败', err, 'EX-08');
      throw err;
    }
  },

  build: async () => {
    const job = get().current;
    if (!job) throw new AppError('IMPORT_INVALID', '还没有作业');
    if (!hasUsableProvider()) {
      set({ errorCode: 'LLM_NO_PROVIDER' });
      throw new AppError('LLM_NO_PROVIDER', '还没有可用的模型服务（接口地址或模型为空）');
    }
    set({ busy: true, progress: 0, errorCode: undefined });
    try {
      const built = await runBuild(job, get().analysis, {
        hasMaterial: get().chunks.length > 0,
        onProgress: (p, label) => set({ progress: p, progressLabel: label }),
      });
      set({ draftArtifact: built, busy: false, progress: 1 });
      await get().setStatus('preview');
      set({ step: 4 });
    } catch (e) {
      const err = toAppError(e, 'LLM_BAD_RESPONSE');
      set({ busy: false, errorCode: err.code });
      await get().setStatus('failed', { code: err.code, message: err.message });
      throw err;
    }
  },

  /* ------------------------------ Step5 写入 ------------------------------ */

  confirmWrite: async () => {
    const job = get().current;
    if (!job) throw new AppError('IMPORT_INVALID', '还没有作业');
    const { memoriesMd, personaMd } = get().draftArtifact;
    if (!memoriesMd && !personaMd) throw new AppError('IMPORT_INVALID', '还没有草案');

    set({ busy: true, progress: 0.2, errorCode: undefined });
    try {
      await get().setStatus('writing');

      // ★ 进入 done 前必须先 backup（§4.7 note）：已有产物时先存档
      const existing = await getArtifact(job.id);
      if (existing) {
        await backup(job.id, '写入前自动存档');
      }

      const artifact = await write({ job, memoriesMd, personaMd });
      set({ artifact, progress: 1 });

      const versions = await listVersions(job.id);
      set({ versions });

      await get().setStatus('done');
      set({ busy: false, step: 5 });
      await get().reload();
      log.info('distill', '产物写入完成', { slug: job.slug, versions: artifact.versions.length }, 'EX-09');
    } catch (e) {
      const err = toAppError(e, 'DB_FAILED');
      set({ busy: false, errorCode: err.code });
      await get().setStatus('failed', { code: err.code, message: err.message });
      log.error('distill', '产物写入失败', err, 'EX-09');
      throw err;
    }
  },

  /* ------------------------------ 产物 / 版本 ------------------------------ */

  loadArtifact: async (jobId) => {
    const artifact = await getArtifact(jobId);
    set({
      artifact,
      versions: artifact ? [...artifact.versions].reverse() : [],
      corrections: artifact ? await listCorrections(jobId) : [],
    });
  },

  backupVersion: async (note) => {
    const job = get().current;
    if (!job) throw new AppError('IMPORT_INVALID', '还没有作业');
    await backup(job.id, note ?? '手动存档');
    set({ versions: await listVersions(job.id) });
  },

  /**
   * 回滚：repo 内部会先自动存档 `{version}_before_rollback`（验收要点⑤）。
   */
  rollbackTo: async (version) => {
    const job = get().current;
    if (!job) throw new AppError('IMPORT_INVALID', '还没有作业');
    set({ busy: true, errorCode: undefined });
    try {
      const artifact = await rollback(job.id, version);
      set({
        artifact,
        versions: await listVersions(job.id),
        draftArtifact: { memoriesMd: artifact.memoriesMd, personaMd: artifact.personaMd },
        busy: false,
      });
      log.info('distill', '版本回滚完成', { version }, 'EX-09');
    } catch (e) {
      const err = toAppError(e, 'DB_FAILED');
      set({ busy: false, errorCode: err.code });
      throw err;
    }
  },

  /**
   * 删除某一个历史版本。
   * ★ v1 与「版本不存在」都由 `versioning.removeVersion` 抛错拦下，
   *   这里只负责把错误码记下来 + 抛出（UI 转成中文提示）。
   */
  removeVersion: async (version) => {
    const job = get().current;
    if (!job) throw new AppError('IMPORT_INVALID', '还没有作业');
    set({ busy: true, errorCode: undefined });
    try {
      const versions = await removeVersionApi(job.id, version);
      set({ versions, busy: false });
      log.info('distill', '历史版本已删除', { version }, 'EX-09');
    } catch (e) {
      const err = toAppError(e, 'DB_FAILED');
      set({ busy: false, errorCode: err.code });
      throw err;
    }
  },

  /* ------------------------------ 纠正 / 合并 ------------------------------ */

  applyCorrectionText: async (text) => {
    const job = get().current;
    if (!job) throw new AppError('IMPORT_INVALID', '还没有作业');
    if (!hasUsableProvider()) {
      set({ errorCode: 'LLM_NO_PROVIDER' });
      throw new AppError('LLM_NO_PROVIDER', '还没有可用的模型服务（接口地址或模型为空）');
    }
    const artifact = get().artifact ?? (await getArtifact(job.id));
    if (!artifact) throw new AppError('DB_FAILED', '还没有产物');

    set({ busy: true, errorCode: undefined });
    try {
      const parsed = await runCorrection(job, {
        utterance: text,
        currentPersona: artifact.personaMd,
        currentMemories: artifact.memoriesMd,
      });
      await applyCorrection({ jobId: job.id, record: parsed.record });
      await get().loadArtifact(job.id);
      set({ busy: false });
      log.info('distill', '纠正已写入', { target: parsed.record.target }, 'EX-10');
      return parsed.record;
    } catch (e) {
      const err = toAppError(e, 'LLM_BAD_RESPONSE');
      set({ busy: false, errorCode: err.code });
      throw err;
    }
  },

  /**
   * 单条编辑纠正记录。
   * ★ 不重新解析 LLM——用户改的是「已经落地的那条记录」，
   *   直接改写 md 的 Correction 节即可（`corrections.editCorrection` 内部会先存档）。
   */
  editCorrection: async (index, patch) => {
    const job = get().current;
    if (!job) throw new AppError('IMPORT_INVALID', '还没有作业');
    set({ busy: true, errorCode: undefined });
    try {
      const corrections = await editCorrectionApi(job.id, index, patch);
      const artifact = await getArtifact(job.id);
      set({ corrections, artifact: artifact ?? get().artifact, busy: false });
      log.info('distill', '纠正条目已修改', { index }, 'EX-10');
    } catch (e) {
      const err = toAppError(e, 'DB_FAILED');
      set({ busy: false, errorCode: err.code });
      throw err;
    }
  },

  removeCorrection: async (index) => {
    const job = get().current;
    if (!job) throw new AppError('IMPORT_INVALID', '还没有作业');
    set({ busy: true, errorCode: undefined });
    try {
      const corrections = await removeCorrectionApi(job.id, index);
      const artifact = await getArtifact(job.id);
      set({ corrections, artifact: artifact ?? get().artifact, busy: false });
      log.info('distill', '纠正条目已删除', { index }, 'EX-10');
    } catch (e) {
      const err = toAppError(e, 'DB_FAILED');
      set({ busy: false, errorCode: err.code });
      throw err;
    }
  },

  /**
   * 追加原材料（done → analyzing → preview）：merger 增量合并，先 backup 再改。
   */
  mergeMaterial: async (newChunks) => {
    const job = get().current;
    if (!job) throw new AppError('IMPORT_INVALID', '还没有作业');
    if (!hasUsableProvider()) {
      set({ errorCode: 'LLM_NO_PROVIDER' });
      throw new AppError('LLM_NO_PROVIDER', '还没有可用的模型服务（接口地址或模型为空）');
    }
    const artifact = get().artifact ?? (await getArtifact(job.id));
    if (!artifact) throw new AppError('DB_FAILED', '还没有产物');

    set({ busy: true, progress: 0.1, errorCode: undefined });
    try {
      // 先把新 chunks 归档
      if (newChunks.length > 0) {
        const archived = await distillRawRepo.putChunks({
          jobId: job.id,
          slug: job.slug,
          kind: newChunks[0].kind,
          chunks: newChunks,
        });
        if (archived.ok) {
          const source: DistillSource = {
            id: archived.value,
            kind: newChunks[0].kind,
            chunkCount: newChunks.length,
          };
          await distillJobRepo.addSource(job.id, source);
        }
      }

      await get().setStatus('analyzing');
      await backup(job.id, '追加原材料前自动存档');

      const batches = splitIntoBatches(newChunks);
      const knowledge = batches.map((b, i) => `### 第 ${i + 1} 批\n${b.map((c) => c.text).join('\n')}`).join('\n\n');

      const patch = await runMerger(job, {
        currentMemories: artifact.memoriesMd,
        currentPersona: artifact.personaMd,
        newKnowledge: knowledge,
      });

      const updated = await distillArtifactRepo.updateContent(job.id, {
        ...(patch.memoriesPatch ? { memoriesMd: `${artifact.memoriesMd}\n\n${patch.memoriesPatch}` } : {}),
        ...(patch.personaPatch ? { personaMd: `${artifact.personaMd}\n\n${patch.personaPatch}` } : {}),
      });
      if (!updated.ok) throw updated.error;

      set({
        chunks: [...get().chunks, ...newChunks],
        draftArtifact: { memoriesMd: updated.value.memoriesMd, personaMd: updated.value.personaMd },
        busy: false,
        progress: 1,
      });
      await get().setStatus('preview');
      set({ step: 4 });
      return { memories: Boolean(patch.memoriesPatch), persona: Boolean(patch.personaPatch) };
    } catch (e) {
      const err = toAppError(e, 'LLM_BAD_RESPONSE');
      set({ busy: false, errorCode: err.code });
      await get().setStatus('failed', { code: err.code, message: err.message });
      throw err;
    }
  },

  /* ------------------------------ 导出 / 删除 / 转卡 ------------------------------ */

  exportJobZip: async (jobId) => {
    const blob = await exportZip(jobId);
    log.info('distill', '产物已导出', { jobId, size: blob.size }, 'EX-09');
    return blob;
  },

  exportJobJson: async (jobId) => {
    const blob = await exportJson(jobId);
    log.info('distill', '产物已导出为 JSON', { jobId, size: blob.size }, 'EX-09');
    return blob;
  },

  exportJobPng: async (jobId) => {
    const blob = await exportPng(jobId);
    log.info('distill', '产物已导出为 PNG', { jobId, size: blob.size }, 'EX-09');
    return blob;
  },

  jsonFileNameOf: (job) => jsonFileName(job),

  pngFileNameOf: (job) => pngFileName(job),

  importArtifact: async (file) => {
    const result = await importArtifactFile(file);
    await get().reload();
    log.info('distill', '产物已导入', { jobId: result.jobId, file: file.name }, 'EX-09');
    return result;
  },

  removeJob: async (jobId) => {
    const res = await distillJobRepo.removeWithChildren(jobId);
    if (!res.ok) throw res.error;
    set({
      current: get().current?.id === jobId ? undefined : get().current,
      artifact: get().artifact?.jobId === jobId ? undefined : get().artifact,
      versions: [],
      corrections: [],
      wizardOpen: false,
    });
    await get().reload();
  },

  /** 转成可聊天角色卡（默认 privacy.noImage = true，PRD C5） */
  toPersonaCard: async (jobId) => {
    set({ busy: true, errorCode: undefined });
    try {
      const card = await artifactToPersonaCard(jobId);
      await get().loadArtifact(jobId);
      set({ busy: false });
      log.info('distill', '产物已转为角色卡', { jobId, cardId: card.id }, 'XR-08');
      return card;
    } catch (e) {
      const err = toAppError(e, 'DB_FAILED');
      set({ busy: false, errorCode: err.code });
      throw err;
    }
  },
}));

/* ================================ 选择器 ================================ */

export const selectCurrentJob = (s: DistillState): DistillJob | undefined => s.current;
export const selectArtifact = (s: DistillState): ExSkillArtifact | undefined => s.artifact;
export const selectVersions = (s: DistillState): readonly ArtifactVersion[] => s.versions;
export const selectChunks = (s: DistillState): readonly RawChunk[] => s.chunks;
export const selectBusy = (s: DistillState): boolean => s.busy;

/** 当前向导步骤对应的状态（供 UI 校验） */
export const selectStepStatus = (s: DistillState): DistillStatus | undefined =>
  s.current ? s.current.status : undefined;

export default useDistillStore;
