import { distillArtifactRepo, distillJobRepo } from '@/db/repo/distillRepo';
import { MAX_VERSIONS } from '@/constants/limits';
import { AppError } from '@/lib/errors';
import { readZipText, unzipFile } from '@/lib/zip';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { buildSkillMd } from './artifactWriter';
import { dt } from './copy';
import type { UUID } from '@/types/common';
import type { ArtifactVersion, DistillJob, ExSkillArtifact } from '@/types/distill';

/**
 * ★ 产物的**导入 / 导出**（导出 JSON、导出 PNG、导入产物）。
 *
 * 为什么单独一个文件：`artifactWriter.ts` 管的是「写库 + 还原 `exes/{slug}/` 目录」，
 * 这一块管的是「把产物搬进搬出浏览器」，职责不同，混在一起会让它越来越难读。
 *
 * ★★ 复用优先（用户第三条要求）——能复用的一律不自己写：
 * - **zip**：`lib/zip.ts` 的 `zipFiles` / `unzipFile`（底层是已装的 **fflate**，
 *   构建产物里的 `vendor-zip` chunk 就是它）。本文件**没有**自己实现任何 zip 算法。
 * - **PNG**：项目内**没有**现成的图片导出工具（全库只有 `PortraitStage.tsx` 用 canvas 画立绘，
 *   不提供导出）。因此这里用**浏览器原生 canvas**自绘文本再 `toBlob`，**不引入任何新依赖**
 *   （`html2canvas` / `dom-to-image` 都不装）。
 * - **导入**：走 `distillJobRepo.create` + `distillArtifactRepo.write`，与向导写入同一条路径，
 *   不另起一套存储结构。
 */

/** 导出 JSON 的标记（导入时据此识别；也方便将来做版本迁移） */
export const ARTIFACT_BUNDLE_FORMAT = 'ai-ai-distill-artifact';
export const ARTIFACT_BUNDLE_VERSION = 1;

/** 一份产物的完整快照（导出 JSON 的内容） */
export interface ArtifactBundle {
  format: string;
  bundleVersion: number;
  exportedAt: string;
  job: {
    name: string;
    slug: string;
    profile: DistillJob['profile'];
    tags: DistillJob['tags'];
    impression?: string;
    version: string;
    correctionsCount: number;
    sources: { kind: string; fileName?: string }[];
    createdAt: string;
    updatedAt: string;
  };
  artifact: {
    memoriesMd: string;
    personaMd: string;
    metaJson: string;
    skillMd: string;
  };
  versions: {
    version: string;
    createdAt: string;
    note?: string;
    snapshot: { memoriesMd: string; personaMd: string };
  }[];
}

/* ================================ 取数 ================================ */

async function requireJob(jobId: UUID): Promise<DistillJob> {
  const res = await distillJobRepo.get(jobId);
  if (!res.ok) throw res.error;
  if (!res.value) throw new AppError('DB_FAILED', dt('distill.export.jobMissing'), { jobId });
  return res.value;
}

async function requireArtifact(jobId: UUID): Promise<{ job: DistillJob; artifact: ExSkillArtifact }> {
  const job = await requireJob(jobId);
  const res = await distillArtifactRepo.get(jobId);
  if (!res.ok) throw res.error;
  if (!res.value) throw new AppError('IMPORT_INVALID', dt('distill.export.empty'), { jobId });
  return { job, artifact: res.value };
}

/* ================================ 导出 JSON ================================ */

/** 组装导出用的结构化数据 */
export async function buildArtifactBundle(jobId: UUID): Promise<ArtifactBundle> {
  const { job, artifact } = await requireArtifact(jobId);
  return {
    format: ARTIFACT_BUNDLE_FORMAT,
    bundleVersion: ARTIFACT_BUNDLE_VERSION,
    exportedAt: nowISO(),
    job: {
      name: job.name,
      slug: job.slug,
      profile: job.profile,
      tags: job.tags,
      ...(job.impression ? { impression: job.impression } : {}),
      version: job.version,
      correctionsCount: job.correctionsCount,
      sources: job.sources.map((s) => ({ kind: s.kind, ...(s.fileName ? { fileName: s.fileName } : {}) })),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
    artifact: {
      memoriesMd: artifact.memoriesMd,
      personaMd: artifact.personaMd,
      metaJson: artifact.metaJson,
      skillMd: artifact.skillMd || buildSkillMd(artifact, job),
    },
    versions: artifact.versions.map((v) => ({
      version: v.version,
      createdAt: v.createdAt,
      ...(v.note ? { note: v.note } : {}),
      snapshot: { memoriesMd: v.snapshot.memoriesMd, personaMd: v.snapshot.personaMd },
    })),
  };
}

/** 导出为 JSON Blob */
export async function exportJson(jobId: UUID): Promise<Blob> {
  const bundle = await buildArtifactBundle(jobId);
  return new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' });
}

function stamp(): string {
  return nowISO().slice(0, 16).replace(/[-:T]/g, '');
}

export function jsonFileName(job: DistillJob): string {
  return `exes-${job.slug}-${stamp()}.json`;
}

export function pngFileName(job: DistillJob): string {
  return `exes-${job.slug}-${stamp()}.png`;
}

/* ================================ 导出 PNG ================================ */

/** 画布排版参数（改这里就能调整出图效果） */
const PNG_LAYOUT = {
  width: 900,
  padding: 48,
  titleSize: 26,
  subtitleSize: 15,
  headingSize: 19,
  bodySize: 15,
  lineHeight: 24,
  headingGap: 14,
  sectionGap: 28,
  /** 单段最多画多少字：超过就截断并在末尾注明，避免画布高度爆掉（浏览器有上限） */
  maxCharsPerSection: 6000,
  background: '#ffffff',
  foreground: '#1f2328',
  muted: '#6b7280',
  font: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif',
} as const;

interface PngLine {
  text: string;
  size: number;
  color: string;
  bold: boolean;
  /** 行间距（标题/小标题额外留白） */
  gap: number;
}

/**
 * 按像素宽度折行。
 * ★ 中英混排：中文没有空格，必须**逐字符**量宽度，不能按空格切词。
 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const ch of paragraph) {
      const next = line + ch;
      if (ctx.measureText(next).width > maxWidth && line !== '') {
        out.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    out.push(line);
  }
  return out;
}

/** 超出上限就截断，返回被截掉的字数 */
function truncateText(text: string, max: number): { text: string; cut: number } {
  if (text.length <= max) return { text, cut: 0 };
  return { text: `${text.slice(0, max)}…`, cut: text.length - max };
}

export interface PngSection {
  heading: string;
  body: string;
}

/**
 * 把产物画成一张 PNG（长图）。
 *
 * ★ 只画文本，不依赖任何截图库：`html2canvas` 要 ~50KB 且对 CJK 字体回退支持差，
 *   而这里的内容本来就是纯 markdown 文本，直接量宽度画更快也更可控。
 */
export async function renderArtifactPng(input: {
  title: string;
  subtitle?: string;
  sections: readonly PngSection[];
  /** 截断提示的取值函数（由调用方传 `dt`，避免领域层反向依赖 UI） */
  truncatedNote?: (cut: number) => string;
}): Promise<Blob> {
  if (typeof document === 'undefined') {
    throw new AppError('CAPABILITY_UNAVAILABLE', dt('distill.export.canvasUnavailable'), undefined);
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AppError('CAPABILITY_UNAVAILABLE', dt('distill.export.canvasUnavailable'), undefined);

  const layout = PNG_LAYOUT;
  const maxWidth = layout.width - layout.padding * 2;
  const setFont = (size: number, bold: boolean): void => {
    ctx.font = `${bold ? '700 ' : ''}${size}px ${layout.font}`;
  };

  // —— 第一遍：只排版、不画，先算出总高度 ——
  const lines: PngLine[] = [];
  lines.push({ text: input.title, size: layout.titleSize, color: layout.foreground, bold: true, gap: 10 });
  if (input.subtitle) {
    lines.push({ text: input.subtitle, size: layout.subtitleSize, color: layout.muted, bold: false, gap: layout.headingGap });
  }
  for (const section of input.sections) {
    lines.push({ text: section.heading, size: layout.headingSize, color: layout.foreground, bold: true, gap: 8 });
    const { text, cut } = truncateText(section.body, layout.maxCharsPerSection);
    for (const line of wrapTextWithFont(ctx, setFont, text, maxWidth, layout.bodySize)) {
      lines.push({ text: line, size: layout.bodySize, color: layout.foreground, bold: false, gap: 0 });
    }
    if (cut > 0 && input.truncatedNote) {
      lines.push({ text: input.truncatedNote(cut), size: layout.bodySize, color: layout.muted, bold: false, gap: 0 });
    }
    lines.push({ text: '', size: layout.bodySize, color: layout.foreground, bold: false, gap: layout.sectionGap });
  }

  let height = layout.padding * 2;
  for (const line of lines) height += line.size + 8 + line.gap;

  canvas.width = layout.width;
  canvas.height = Math.max(height, 240);
  ctx.fillStyle = layout.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'top';

  // —— 第二遍：真正画 ——
  let y = layout.padding;
  for (const line of lines) {
    setFont(line.size, line.bold);
    ctx.fillStyle = line.color;
    if (line.text !== '') ctx.fillText(line.text, layout.padding, y);
    y += line.size + 8 + line.gap;
  }

  return canvasToBlob(canvas);
}

/** 按指定字号量宽度折行（折行前必须先设好字体，否则量出来的是上一次的字号） */
function wrapTextWithFont(
  ctx: CanvasRenderingContext2D,
  setFont: (size: number, bold: boolean) => void,
  text: string,
  maxWidth: number,
  size: number,
): string[] {
  setFont(size, false);
  return wrapText(ctx, text, maxWidth);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new AppError('CAPABILITY_UNAVAILABLE', dt('distill.export.canvasExportFailed'), undefined));
      }, 'image/png');
      return;
    }
    // 极老浏览器的降级：dataURL → bytes
    try {
      const url = canvas.toDataURL('image/png');
      const base64 = url.slice(url.indexOf(',') + 1);
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      resolve(new Blob([bytes], { type: 'image/png' }));
    } catch (e) {
      reject(new AppError('CAPABILITY_UNAVAILABLE', dt('distill.export.canvasExportFailed'), e));
    }
  });
}

/** 导出为 PNG Blob */
export async function exportPng(jobId: UUID): Promise<Blob> {
  const { job, artifact } = await requireArtifact(jobId);
  return renderArtifactPng({
    title: job.name,
    subtitle: `exes/${job.slug}/ · ${job.version}`,
    sections: [
      { heading: dt('distill.preview.memories'), body: artifact.memoriesMd },
      { heading: dt('distill.preview.persona'), body: artifact.personaMd },
    ],
    truncatedNote: (cut) => dt('distill.export.pngTruncated', { n: cut }),
  });
}

/* ================================ 导入 ================================ */

interface ImportPayload {
  name: string;
  slug: string;
  profile: DistillJob['profile'];
  tags: DistillJob['tags'];
  impression?: string;
  memoriesMd: string;
  personaMd: string;
  metaJson: string;
  skillMd: string;
  versions: ArtifactVersion[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** 从我们自己的导出 JSON 里还原 */
function fromBundle(raw: Record<string, unknown>): ImportPayload {
  const job = isRecord(raw.job) ? raw.job : {};
  const artifact = isRecord(raw.artifact) ? raw.artifact : {};
  const versionsRaw = Array.isArray(raw.versions) ? raw.versions : [];
  const versions: ArtifactVersion[] = [];
  for (const item of versionsRaw) {
    if (!isRecord(item)) continue;
    const snapshot = isRecord(item.snapshot) ? item.snapshot : {};
    versions.push({
      version: str(item.version, `v${versions.length + 1}`),
      createdAt: str(item.createdAt, nowISO()),
      snapshot: { memoriesMd: str(snapshot.memoriesMd), personaMd: str(snapshot.personaMd) },
      ...(typeof item.note === 'string' ? { note: item.note } : {}),
    });
  }
  const tags = isRecord(job.tags) ? job.tags : {};
  const profile = isRecord(job.profile) ? (job.profile as DistillJob['profile']) : {};
  return {
    name: str(job.name, '未命名'),
    slug: str(job.slug),
    profile,
    tags: {
      personality: Array.isArray(tags.personality) ? tags.personality.filter((x): x is string => typeof x === 'string') : [],
      ...(typeof tags.attachment === 'string' ? { attachment: tags.attachment } : {}),
    },
    ...(typeof job.impression === 'string' ? { impression: job.impression } : {}),
    memoriesMd: str(artifact.memoriesMd),
    personaMd: str(artifact.personaMd),
    metaJson: str(artifact.metaJson),
    skillMd: str(artifact.skillMd),
    versions,
  };
}

/** 从「裸产物」形态还原（别人手搓的 json：{ name, memories, persona }） */
function fromLoose(raw: Record<string, unknown>): ImportPayload {
  const tags = isRecord(raw.tags) ? raw.tags : {};
  const profile = isRecord(raw.profile) ? (raw.profile as DistillJob['profile']) : {};
  return {
    name: str(raw.name, '未命名'),
    slug: str(raw.slug),
    profile,
    tags: {
      personality: Array.isArray(tags.personality) ? tags.personality.filter((x): x is string => typeof x === 'string') : [],
      ...(typeof tags.attachment === 'string' ? { attachment: tags.attachment } : {}),
    },
    ...(typeof raw.impression === 'string' ? { impression: raw.impression } : {}),
    memoriesMd: str(raw.memoriesMd, str(raw.memories)),
    personaMd: str(raw.personaMd, str(raw.persona)),
    metaJson: str(raw.metaJson),
    skillMd: str(raw.skillMd, str(raw.skill)),
    versions: [],
  };
}

/** 从 `exes/{slug}/` 的 zip 里还原（复用 `lib/zip`，底层 fflate） */
async function fromZip(file: File): Promise<ImportPayload> {
  const files = await unzipFile(file);
  const pick = (suffix: string): string => {
    for (const path of files.keys()) {
      // 只取最外层：跳过 versions/ 里的同名文件
      if (!path.endsWith(suffix)) continue;
      if (path.includes('/versions/')) continue;
      return readZipText(files, path) ?? '';
    }
    return '';
  };
  const memoriesMd = pick('memories.md');
  const personaMd = pick('persona.md');
  const metaJson = pick('meta.json');
  const skillMd = pick('SKILL.md');
  if (memoriesMd === '' && personaMd === '') {
    throw new AppError('IMPORT_INVALID', dt('distill.import.invalid'), { fileName: file.name });
  }

  let name = '未命名';
  let slug = '';
  let profile: DistillJob['profile'] = {};
  let tags: DistillJob['tags'] = { personality: [] };
  let impression: string | undefined;
  if (metaJson !== '') {
    try {
      const meta = JSON.parse(metaJson) as Record<string, unknown>;
      name = str(meta.name, name);
      slug = str(meta.slug);
      if (isRecord(meta.profile)) profile = meta.profile as DistillJob['profile'];
      if (isRecord(meta.tags)) {
        const t = meta.tags;
        tags = {
          personality: Array.isArray(t.personality)
            ? t.personality.filter((x): x is string => typeof x === 'string')
            : [],
          ...(typeof t.attachment === 'string' ? { attachment: t.attachment } : {}),
        };
      }
      if (typeof meta.impression === 'string') impression = meta.impression;
    } catch {
      /* meta.json 坏了不影响正文，按缺省走 */
    }
  }
  return { name, slug, profile, tags, ...(impression ? { impression } : {}), memoriesMd, personaMd, metaJson, skillMd, versions: [] };
}

/** slug 去重（同名的第二份加 `-2` 后缀） */
async function ensureUniqueSlug(slug: string): Promise<string> {
  const base = slug.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || `ex-${newId().slice(0, 8)}`;
  let candidate = base;
  for (let i = 2; i <= 50; i += 1) {
    const res = await distillJobRepo.getBySlug(candidate);
    if (!res.ok) throw res.error;
    if (!res.value) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${newId().slice(0, 4)}`;
}

/**
 * 组装导入后的版本列表。
 * - 有历史就用历史（v1 缺失时用当前内容补一条，保证「v1 是溯源基线」这条不破）；
 * - 一条历史都没有 → 用当前内容造 v1；
 * - 超过 `MAX_VERSIONS` 时保留 v1 + 最近的若干条（与 `versioning` 的裁剪口径一致）。
 */
function buildImportVersions(
  payload: ImportPayload,
  memoriesMd: string,
  personaMd: string,
): ArtifactVersion[] {
  const base: ArtifactVersion[] = payload.versions.filter((v) => v.version !== 'v1');
  const hasV1 = payload.versions.some((v) => v.version === 'v1');
  const v1: ArtifactVersion = hasV1
    ? (payload.versions.find((v) => v.version === 'v1') as ArtifactVersion)
    : {
        version: 'v1',
        createdAt: nowISO(),
        snapshot: { memoriesMd, personaMd },
        // ★ 这条会经 VersionHistory 渲染给用户看（存档备注），必须走文案表
        note: dt('distill.import.baseNote'),
      };
  const versions = hasV1 ? payload.versions : [v1, ...base];
  if (versions.length <= MAX_VERSIONS) return versions;
  return [versions[0], ...versions.slice(versions.length - (MAX_VERSIONS - 1))];
}

/** 落库：作业 + 产物（写入时会自动压 versions/v1 快照） */
async function persist(payload: ImportPayload): Promise<{ jobId: UUID; name: string }> {
  const created = await distillJobRepo.create({
    name: payload.name,
    slug: await ensureUniqueSlug(payload.slug),
    profile: payload.profile,
    tags: payload.tags,
    ...(payload.impression ? { impression: payload.impression } : {}),
  });
  if (!created.ok) throw created.error;
  const job = created.value;

  const written = await distillArtifactRepo.write({
    jobId: job.id,
    slug: job.slug,
    memoriesMd: payload.memoriesMd,
    personaMd: payload.personaMd,
    metaJson: payload.metaJson || JSON.stringify({ name: job.name, slug: job.slug, version: 'v1' }, null, 2),
    skillMd: payload.skillMd || buildSkillMd(
      {
        jobId: job.id,
        slug: job.slug,
        memoriesMd: payload.memoriesMd,
        personaMd: payload.personaMd,
        metaJson: '',
        skillMd: '',
        versions: [],
        updatedAt: nowISO(),
      },
      job,
    ),
  });
  if (!written.ok) throw written.error;

  /**
   * 历史版本：整体写回 `versions[]`。
   *
   * ★ 不能「逐个 backup + updateContent」去回放——`backup()` 快照的是**当前正文**，
   *   回放会把当前内容一路改掉，最后停在最后一个历史版本上（等于把导入的产物搞错）。
   *   仓库层的 `updateContent` 允许整体写 `versions`，所以直接一次写回最干净。
   */
  const versions = buildImportVersions(payload, payload.memoriesMd, payload.personaMd);
  const patched = await distillArtifactRepo.updateContent(job.id, { versions });
  if (!patched.ok) throw patched.error;

  const done = await distillJobRepo.setStatus(job.id, 'done');
  if (!done.ok) throw done.error;

  return { jobId: job.id, name: job.name };
}

/** 导入一个产物文件（.json 或 .zip） */
export async function importArtifactFile(file: File): Promise<{ jobId: UUID; name: string }> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.zip')) return persist(await fromZip(file));

  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError('IMPORT_INVALID', dt('distill.import.invalid'), { fileName: file.name });
  }
  if (!isRecord(raw)) throw new AppError('IMPORT_INVALID', dt('distill.import.invalid'), { fileName: file.name });

  const payload =
    str(raw.format) === ARTIFACT_BUNDLE_FORMAT ? fromBundle(raw) : fromLoose(raw);
  if (payload.memoriesMd === '' && payload.personaMd === '') {
    throw new AppError('IMPORT_INVALID', dt('distill.import.invalid'), { fileName: file.name });
  }
  return persist(payload);
}
