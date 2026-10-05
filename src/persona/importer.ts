import { MAX_FILE_SIZE, MAX_IMPORT_FILES } from '@/constants/limits';
import { DEFAULT_PERSONA_PRIVACY } from '@/constants/defaults';
// ★ 文案一律走主表 `t()`（`src/copy/`）。领域层引用 `@/copy` 是允许的（同 `src/db/bootstrap.ts`、
//   `src/persona/xinranCard.ts` 引用 `@/copy/xinran`）；**禁止**反向引用 `@/features/**`。
//   原因：本文件抛出的 message 有两条出路，都会进 DOM——
//   ① `ImportReport.items[].reason` → 导入对话框逐条展示；
//   ② `AppError` 作为 log detail → 诊断页「最近错误」`JSON.stringify(detail)` 展开。
import { t } from '@/copy';
import { newId, newPrefixedId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { AppError } from '@/lib/errors';
import { readBytes, readText } from '@/lib/file';
import { listByExt, readZipText, unzipFile } from '@/lib/zip';
import { blobRepo } from '@/db/repo/blobRepo';
import { stickerRepo } from '@/db/repo/stickerRepo';
import { live2dRepo } from '@/db/repo/live2dRepo';
import { personaRepo } from '@/db/repo/personaRepo';
import type { PersonaCard, PersonaCardData } from '@/types/persona';
import type { ImportReport } from '@/types/backup';
import type { StickerItem } from '@/types/media';
import type { UUID } from '@/types/common';

/**
 * ★ 人设导入（架构文档 §2 `src/persona/importer.ts`、流程 §4.2、取证 §5.1/§5.3）。
 *
 * 必须同时吃下原应用导出的**两种变体**：
 * - 变体 A（新）：`{ data: { prompts: { "<UUID>": { data: {...} } } } }`
 * - 变体 B（老）：`{ version, timestamp, data: { prompts: { "shuoshuo's prompt": { spec, spec_version, data } } } }`
 * 另外兼容「单卡裸 JSON」（SillyTavern 直接导出的 `{ spec, spec_version, data }`）。
 *
 * zip 里还可能有三类资产：表情包（`custom_stickers.json` + PNG）、Live2D（`*.model3.json`）、主题（`theme.json`）。
 *
 * ★ 失败口径：单文件失败**不影响其它文件**，全部结果汇总进 `ImportReport`；
 *   只有「一个文件都没解析出东西」才抛 `IMPORT_INVALID`。
 */

export type CardVariant = 'A' | 'B' | 'unknown';

export interface ImportResult {
  cards: PersonaCard[];
  report: ImportReport;
  /** 导入过程中新建的表情包 ID */
  stickerPackIds: UUID[];
  /** 导入过程中新建的 Live2D 模型 ID */
  live2dIds: UUID[];
  /** zip 里的 theme.json（不自动应用，返回给 UI 预览后再决定） */
  theme?: Record<string, unknown>;
}

function emptyReport(): ImportReport {
  return { total: 0, success: 0, failed: 0, items: [] };
}

function mergeReport(base: ImportReport, name: string, ok: boolean, reason?: string): void {
  base.total += 1;
  base.items.push({ name, ok, reason });
  if (ok) base.success += 1;
  else base.failed += 1;
}

/* ============================================================
   变体识别与抽取
   ============================================================ */

/** 是否为「非空普通对象」 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ============================================================
   中英文键名别名表
   ============================================================ */

/**
 * ★★ 卡片字段的**中英文键名别名表**。
 *
 * 起因（真 bug）：原先只按英文键名 `name` / `data` / `prompts` 取字段，
 * **中文键名的卡一条都取不到**；而在 zip 里，这类取不到会被静默吞掉——
 * 用户导入 10 本只进来 9 本，不报错、不提示，数据 quietly 少一块。
 * 这是最坏的一类 bug：不崩、不红、不报。
 *
 * 先例：蒸馏解析器 `src/distill/parsers/wechat.ts` 用的就是同一套写法
 *   `pickField(row, ['content', '内容', 'message', '消息'])`。
 * 所以这里不是自创规范，是沿用项目已有的字段别名约定。
 */
const CARD_CONTAINER_KEY = {
  spec: ['spec', '规格'],
  data: ['data', '数据'],
  prompts: ['prompts', '提示词', '人设', '角色卡'],
} as const;

/** 卡片**内容字段**的中英文别名表（对应 `PersonaCardData` 的字段） */
const CARD_FIELD_KEY = {
  name: ['name', '名称', '名字', '角色名', 'char_name'],
  description: ['description', '描述', '简介'],
  personality: ['personality', '性格', '人物性格'],
  scenario: ['scenario', '场景', '情景', '背景'],
  creator_notes: ['creator_notes', '作者备注', '创作者备注', '备注'],
  first_mes: ['first_mes', '开场白', '首条消息', '问候语'],
  mes_example: ['mes_example', '对话示例', '示例对话'],
  system_prompt: ['system_prompt', '系统提示', '系统提示词'],
  post_history_instructions: ['post_history_instructions', '历史后指令'],
  tags: ['tags', '标签'],
  character_book: ['character_book', '世界书', '角色书'],
  extensions: ['extensions', '扩展'],
} as const;

/** 表情包条目字段的中英文别名表（同上，`fileName` 只认英文会整包静默丢） */
const STICKER_KEY = {
  fileName: ['fileName', 'file_name', 'filename', '文件名', '图片名', '文件'],
  description: ['description', 'desc', '描述', '说明'],
} as const;

/** 按别名表取值（中英文都认；全取不到返回 undefined） */
function pickByAlias(rec: Record<string, unknown>, aliases: readonly string[]): unknown {
  for (const key of aliases) {
    const value = rec[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** 按别名表取**非空字符串**（类型也一并校验，避免把对象塞进 name） */
function pickStr(rec: Record<string, unknown>, aliases: readonly string[]): string | undefined {
  const value = pickByAlias(rec, aliases);
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * ★ 把「可能用中文键名」的卡片对象**归一成英文键名**的 `PersonaCardData`。
 *
 * 为什么必须归一而不只是「取到就算」：抽取出来只是**第一步**，后面
 * `normalizeCard()` / UI / 导出全都按 `data.name` 等**英文键**读写。
 * 直接把中文键名的原对象透传下去，卡能进来但名字是空的——
 * 那只是把「静默丢一本」换成了「进来一本空的」，一样是坏结果。
 *
 * ★ 非破坏性：先整份浅拷贝（中文键全部保留，不丢数据），
 *   再**仅在英文规范键缺失时**补上。英文卡走这条路结果与原对象逐字段相同。
 */
function toCardData(rec: Record<string, unknown>): PersonaCardData {
  const out: Record<string, unknown> = { ...rec };

  for (const [field, aliases] of Object.entries(CARD_FIELD_KEY)) {
    if (out[field] === undefined) {
      const value = pickByAlias(rec, aliases);
      if (value !== undefined) out[field] = value;
    }
  }

  // 中文导出里「标签」常是逗号串（"温柔,姐姐"），而 PersonaCardData.tags 是数组；
  // 不转的话下游按数组渲染会炸（比静默丢更显眼，但仍是 bug）。
  if (typeof out.tags === 'string') {
    out.tags = out.tags
      .split(/[、,，/]/)
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }

  return out as unknown as PersonaCardData;
}

/**
 * 按后缀找**路径**（`lib/zip.findBySuffix` 返回的是字节，这里要的是路径，
 * 因为表情包还要按路径里的目录去取同名 PNG）。
 */
function findPathBySuffix(files: ReadonlyMap<string, Uint8Array>, suffix: string): string | undefined {
  for (const path of files.keys()) {
    if (path.endsWith(suffix)) return path;
  }
  return undefined;
}

/** 识别变体（只看结构，不做严格校验）★ 键名走别名表，中英文都认 */
export function detectVariant(raw: unknown): CardVariant {
  if (!isRecord(raw)) return 'unknown';

  // 单卡裸 JSON：{ spec: 'chara_card_v2', spec_version, data }
  if (pickByAlias(raw, CARD_CONTAINER_KEY.spec) === 'chara_card_v2') return 'B';

  const data = pickByAlias(raw, CARD_CONTAINER_KEY.data);
  if (!isRecord(data)) return 'unknown';

  const prompts = pickByAlias(data, CARD_CONTAINER_KEY.prompts);
  if (!isRecord(prompts)) return 'unknown';

  for (const value of Object.values(prompts)) {
    if (!isRecord(value)) continue;
    if (pickByAlias(value, CARD_CONTAINER_KEY.spec) === 'chara_card_v2') return 'B';
    if (isRecord(pickByAlias(value, CARD_CONTAINER_KEY.data))) return 'A';
  }
  return 'unknown';
}

/**
 * 从任意形状的导出文件里抽出卡片数据数组。
 * 宽松策略：只要里面有 `data` 且 `data.name` 是字符串就认（**键名走中英文别名表**），
 * 因为原应用历史上出现过 `spec_version` 缺失的情况，卡太严会把用户的卡挡在门外。
 *
 * ★ 抽出来的每一张都会过 `toCardData()` 归一成英文键名，
 *   因为下游（`normalizeCard` / UI / 导出）一律按英文键读写。
 */
export function extractCardData(raw: unknown): PersonaCardData[] {
  const out: PersonaCardData[] = [];
  if (!isRecord(raw)) return out;

  const push = (candidate: unknown): void => {
    if (!isRecord(candidate)) return;
    // 情形 1：{ spec, data }（变体 B 的条目 / 单卡裸 JSON）——★ 键名走别名表
    const inner = pickByAlias(candidate, CARD_CONTAINER_KEY.data);
    if (isRecord(inner) && pickStr(inner, CARD_FIELD_KEY.name) !== undefined) {
      out.push(toCardData(inner));
      return;
    }
    // 情形 2：本身就是 card data（有 name）
    // （原代码还有一条「情形 3：变体 A 的 { data: {...} }」，与情形 1 完全重复、
    //   永远走不到，已删除；行为不变。）
    if (pickStr(candidate, CARD_FIELD_KEY.name) !== undefined) {
      out.push(toCardData(candidate));
    }
  };

  if (
    pickByAlias(raw, CARD_CONTAINER_KEY.spec) === 'chara_card_v2' ||
    pickStr(raw, CARD_FIELD_KEY.name) !== undefined
  ) {
    push(raw);
    return out;
  }

  const data = pickByAlias(raw, CARD_CONTAINER_KEY.data);
  if (!isRecord(data)) return out;
  const prompts = pickByAlias(data, CARD_CONTAINER_KEY.prompts);
  if (isRecord(prompts)) {
    for (const value of Object.values(prompts)) push(value);
  }
  return out;
}

/**
 * ★ zip 里的一个 json 是否「看起来像角色卡」。
 *
 * 必须**中英双语**：只认 `chara_card_v2` / `"prompts"` 这些英文标记的话，
 * 中文键名的卡会被判成「不是卡」，于是解析失败被静默 `continue` 掉——
 * 用户根本不知道少了一本。判为「像卡」的失败会**明确计入 ImportReport**。
 */
export function looksLikeCardJson(text: string): boolean {
  if (text.includes('chara_card_v2')) return true;
  for (const key of [...CARD_FIELD_KEY.name, ...CARD_CONTAINER_KEY.prompts]) {
    if (text.includes(`"${key}"`)) return true;
  }
  return false;
}

/** 归一化成 Web 版 PersonaCard（补全 origin / privacy / portrait 等扩展字段） */
export function normalizeCard(
  data: PersonaCardData,
  options: { id?: UUID; origin?: PersonaCard['origin']; privacyNoImage?: boolean } = {},
): PersonaCard {
  const now = nowISO();
  const ext = isRecord(data.extensions) ? data.extensions : undefined;
  const aiyu = ext && isRecord(ext.aiyu) ? (ext.aiyu as Record<string, unknown>) : undefined;
  const privacy = aiyu && isRecord(aiyu.privacy) ? (aiyu.privacy as { noImage?: boolean }) : undefined;

  return {
    id: options.id ?? newPrefixedId('persona'),
    spec: 'chara_card_v2',
    specVersion: '2.0',
    data: {
      ...data,
      // tags / character_book 缺失时补空，避免下游到处判空
      tags: data.tags ?? [],
      character_book: data.character_book ?? { entries: [] },
    },
    origin: options.origin ?? 'external',
    // ★ 保守默认：导入卡一律先禁止生图，由用户在人设页显式放开（XR-06 / PRD C5）。
    //   ⚠️ 这里原本是 `?? false`（导入即允许生图），2026-10-04 统一改为取单一真源
    //   DEFAULT_PERSONA_PRIVACY（= true），与新建 / 迁移 / UI 默认值保持一致。
    //   若某张卡的原文件里明确带了 aiyu.privacy.noImage，仍以文件里的值为准。
    privacy: { noImage: options.privacyNoImage ?? privacy?.noImage ?? DEFAULT_PERSONA_PRIVACY.noImage },
    isBuiltin: false,
    createdAt: now,
    updatedAt: now,
  };
}

/* ============================================================
   JSON 导入
   ============================================================ */

/** 导入一段 JSON 文本 */
export function importJsonText(text: string, fileName = 'card.json'): PersonaCard[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new AppError('IMPORT_INVALID', t('err.importNotJson', { name: fileName }), e);
  }
  const list = extractCardData(raw);
  if (list.length === 0) {
    throw new AppError('IMPORT_INVALID', t('err.importNoCard', { name: fileName }), undefined);
  }
  return list.map((data) => normalizeCard(data));
}

/* ============================================================
   zip 导入（表情包 / Live2D / 主题 / 内嵌卡）
   ============================================================ */

/**
 * 处理 `custom_stickers.json` + 同名 PNG。
 *
 * ★ 丢弃必须可见：任何一个环节取不到（读不出文本 / 不是数组 / 条目键名不认得 /
 *   图片不在 zip 里 / 落库失败），都要**明确计一条失败进 ImportReport**，
 *   不能 `return undefined` 了事——否则用户丢了一整包表情也毫无察觉。
 */
async function importStickerPack(
  files: ReadonlyMap<string, Uint8Array>,
  jsonPath: string,
  itemName: string,
  report: ImportReport,
): Promise<UUID | undefined> {
  const skip = (): undefined => {
    mergeReport(report, itemName, false, t('err.importStickerSkipped'));
    return undefined;
  };

  const text = readZipText(files as Map<string, Uint8Array>, jsonPath);
  if (!text) return skip();
  let entries: unknown;
  try {
    entries = JSON.parse(text);
  } catch {
    return skip();
  }
  if (!Array.isArray(entries)) return skip();

  const packId = newPrefixedId('sticker-pack');
  const dir = jsonPath.includes('/') ? jsonPath.slice(0, jsonPath.lastIndexOf('/')) : '';
  const items: StickerItem[] = [];

  for (const raw of entries) {
    if (!isRecord(raw)) continue;
    // ★ 键名走别名表：只认英文 `fileName` 会让中文键名的一整包表情被静默丢掉
    const fileName = pickStr(raw, STICKER_KEY.fileName);
    if (!fileName) continue;
    const data = files.get(dir ? `${dir}/${fileName}` : fileName);
    if (!data) continue;
    const assetId = await blobRepo.put(`stickers/${packId}/${fileName}`, data, guessImageMime(fileName));
    if (!assetId.ok) continue;
    items.push({
      description: pickStr(raw, STICKER_KEY.description) ?? fileName,
      fileName,
      assetId: assetId.value,
    });
  }

  if (items.length === 0) return skip();
  // 表情包默认名是个「命名模板」，也走主表（key 由 copy 表归口方定为 ui.stickerPackName）
  const pack = await stickerRepo.createPack(
    t('ui.stickerPackName', { date: nowISO().slice(0, 10) }),
    items,
    { id: packId },
  );
  return pack.ok ? packId : undefined;
}

function guessImageMime(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

/** 处理 Live2D（*.model3.json + 整个 zip 归档） */
async function importLive2D(
  modelJsonPath: string,
  zipBytes: Uint8Array,
  packName: string,
): Promise<UUID | undefined> {
  const zipAsset = await blobRepo.put(`live2d/${newId()}.zip`, zipBytes, 'application/zip');
  if (!zipAsset.ok) return undefined;
  const model = await live2dRepo.create({
    name: packName,
    zipAssetId: zipAsset.value,
    modelJsonPath,
  });
  return model.ok ? model.value.id : undefined;
}

/** 导入一个 zip（表情包 / Live2D / 主题 / 内嵌角色卡） */
export async function importZip(file: Blob, fileName = 'bundle.zip'): Promise<ImportResult> {
  const result: ImportResult = { cards: [], report: emptyReport(), stickerPackIds: [], live2dIds: [] };
  const files = await unzipFile(file);

  // —— 内嵌角色卡 ——
  for (const path of listByExt(files, '.json')) {
    if (path.endsWith('custom_stickers.json') || path.endsWith('theme.json')) continue;
    if (path.includes('.model3.json')) continue;
    const text = readZipText(files, path);
    if (!text) continue;
    try {
      const cards = importJsonText(text, path);
      result.cards.push(...cards);
      mergeReport(result.report, `${fileName}/${path}`, true);
    } catch (e) {
      // ★ 只有「看起来像卡」的才计失败（主题 / 配置类 json 解析失败不算，
      //   否则会把 zip 里的配置文件刷成一堆假失败）。
      //   ★★ 但判断必须中英双语（见 `looksLikeCardJson`）：只认英文标记会把
      //   中文键名的卡判成「不是卡」→ 静默跳过 → 用户不知道少了一本。
      if (looksLikeCardJson(text)) {
        mergeReport(result.report, `${fileName}/${path}`, false, e instanceof Error ? e.message : String(e));
      }
    }
  }

  // —— 表情包 ——
  const stickerJsonPath = findPathBySuffix(files, 'custom_stickers.json');
  if (stickerJsonPath) {
    const packId = await importStickerPack(
      files,
      stickerJsonPath,
      `${fileName}/${stickerJsonPath}`,
      result.report,
    );
    if (packId) result.stickerPackIds.push(packId);
  }

  // —— Live2D ——
  for (const path of files.keys()) {
    if (!path.endsWith('.model3.json')) continue;
    const bytes = await readBytes(file);
    const modelId = await importLive2D(path, bytes, path.split('/').pop() ?? 'Live2D');
    if (modelId) result.live2dIds.push(modelId);
    break; // 一个 zip 只处理一个模型，避免重复归档
  }

  // —— 主题（只读取、不应用） ——
  const themePath = findPathBySuffix(files, 'theme.json');
  if (themePath) {
    const text = readZipText(files, themePath);
    if (text) {
      try {
        result.theme = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* 主题损坏不影响主流程 */
      }
    }
  }

  if (result.cards.length === 0 && result.stickerPackIds.length === 0 && result.live2dIds.length === 0) {
    throw new AppError('IMPORT_INVALID', t('err.importEmpty', { name: fileName }), undefined);
  }
  return result;
}

/* ============================================================
   统一入口
   ============================================================ */

/**
 * 导入一批文件（.json / .zip，可多选）。
 * 卡片会自动落库（`personaRepo.importCards`），并返回报告供 UI 用欣然口吻提示。
 */
export async function importFiles(files: readonly File[]): Promise<ImportResult> {
  if (files.length === 0) {
    throw new AppError('IMPORT_INVALID', t('err.importNoFile'), undefined);
  }
  if (files.length > MAX_IMPORT_FILES) {
    throw new AppError('IMPORT_INVALID', t('err.importTooMany', { max: MAX_IMPORT_FILES }), undefined);
  }

  const result: ImportResult = { cards: [], report: emptyReport(), stickerPackIds: [], live2dIds: [] };
  /** 「暂不支持的载体」计数（目前只有 PNG 角色卡一类），用于决定最后是否要抛 */
  let unsupportedCarriers = 0;

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      mergeReport(result.report, file.name, false, t('err.importTooLarge'));
      continue;
    }
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.png')) {
        // ★ PNG 角色卡（`chara_card_v2` 嵌在 PNG 的 tEXt 块里）**暂不支持**。
        //   验收前不实现解析（要动整条解析链路，风险不划算），但**绝不能硬失败或静默**：
        //   明确告诉用户是什么、为什么、以及替代办法（导出 .json / .zip）。
        unsupportedCarriers += 1;
        mergeReport(result.report, file.name, false, t('err.importPngCard'));
      } else if (lower.endsWith('.zip')) {
        const part = await importZip(file, file.name);
        result.cards.push(...part.cards);
        result.stickerPackIds.push(...part.stickerPackIds);
        result.live2dIds.push(...part.live2dIds);
        if (part.theme) result.theme = part.theme;
        mergeReport(result.report, file.name, true);
      } else if (lower.endsWith('.json')) {
        const cards = importJsonText(await readText(file), file.name);
        result.cards.push(...cards);
        mergeReport(result.report, file.name, true);
      } else {
        mergeReport(result.report, file.name, false, t('err.importBadExt'));
      }
    } catch (e) {
      mergeReport(result.report, file.name, false, e instanceof Error ? e.message : String(e));
    }
  }

  if (result.cards.length > 0) {
    const saved = await personaRepo.importCards(result.cards);
    if (!saved.ok) {
      throw new AppError('DB_FAILED', t('err.dbFailed'), saved.error);
    }
  }

  if (result.cards.length === 0 && result.report.failed > 0) {
    // ★ 全是「暂不支持的载体」（PNG 角色卡）时**不抛**：报告里已经有逐条具体原因，
    //   抛出去会把这些原因吞掉，用户只看到一个笼统错误——等于又变回「不可见」。
    if (unsupportedCarriers > 0 && unsupportedCarriers === result.report.failed) {
      return result;
    }
    // ⚠️ 不复用 `personaCopy.label.importNone`：那是 `@/features/persona` 的域表 key，
    //    从领域层反向引用 `@/features/**` 会开第一条「persona → features」的依赖边。
    //    这里用主表已有的 `err.importInvalid`（与抛出的 code 同名），不新建 key。
    throw new AppError('IMPORT_INVALID', t('err.importInvalid'), undefined);
  }
  return result;
}

/** 只解析不落库（导入预览用） */
export async function previewFiles(files: readonly File[]): Promise<PersonaCard[]> {
  const cards: PersonaCard[] = [];
  for (const file of files) {
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.json')) {
        cards.push(...importJsonText(await readText(file), file.name));
      } else if (lower.endsWith('.zip')) {
        const part = await importZip(file, file.name);
        cards.push(...part.cards);
      }
    } catch {
      /* 预览阶段忽略失败，正式导入时才报错 */
    }
  }
  return cards;
}
