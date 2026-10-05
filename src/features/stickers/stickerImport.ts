/**
 * ★★ 表情包导入 —— 本地文件 → 表情包（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 支持两种输入（用户实际会拿到的两种东西）
 * ═══════════════════════════════════════════════════════════════════════════
 *   ① **多张图片**（png / jpg / gif / webp）—— 最常见的形态：手机相册里存了一堆
 *   ② **zip 包** —— 从别处整理好的表情包（原应用就是 zip 导入）
 *
 * ── 语义标签从哪来（这是本模块最关键的取舍）────────────────────────────
 * `StickerItem.description` 是**语义标签**，角色靠它自动配图。
 * 而用户给的图片只有文件名。所以：
 *
 *   · **有 `custom_stickers.json`**（zip 里常见）⇒ 用它做 `fileName → description` 映射；
 *   · **没有** ⇒ 用**文件名去掉扩展名**当标签。
 *
 *   ★ 为什么不更"智能"一点（比如调用多模态模型看图生成标签）：
 *     那要用户配 Key、要花钱、要等，而用户导入 30 张表情时这是不可接受的摩擦。
 *     文件名是**零成本且通常有效**的标签来源（"喵.png"、"生气.gif"），
 *     不够准用户还能在管理页改。**默认零成本、可事后修正**，
 *     比"默认精确但很贵"更适合这个场景。
 *
 * ── 加载 / 失败的处理原则（用户明确要求说明这一块）────────────────────
 *   ★ **逐条独立**：一张图失败不中断整批。用户导入 30 张时，
 *     因为第 17 张是个损坏文件就全批失败，是明显不可接受的。
 *   ★ **失败分类而非"导入失败"一句话**：超大小 / 格式不支持 / 解压失败 /
 *     写库失败，四种原因对应四种解法 —— 混成一句用户不知道该怎么办。
 *   ★ **成功的也报告**：只报失败会让用户不知道到底进去了几张。
 */

import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { extOfName } from '@/lib/file';
import { unzipFile, readZipText } from '@/lib/zip';
import { blobRepo } from '@/db/repo/blobRepo';
import { stickerRepo } from '@/db/repo/stickerRepo';
import { log } from '@/store/logStore';
import type { Result } from '@/lib/result';
import type { StickerItem } from '@/types/media';

/** 单张图的字节上限。2 MB 是权衡：表情包实际用不到更大，而 30 张 5MB 就是 150MB。 */
export const MAX_STICKER_BYTES = 2 * 1024 * 1024;
/** 单个包最多多少张。防手滑选错整个相册 */
export const MAX_STICKER_COUNT = 200;
/** 一批导入的总字节上限 */
export const MAX_BATCH_BYTES = 30 * 1024 * 1024;
/** 认哪些扩展名（也认 `image/*` 的 MIME，见 `isImageFile`） */
export const STICKER_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;

/** 失败原因（**分类的**，界面按它给不同的解法） */
export type StickerImportSkipReason =
  | 'tooLarge'
  | 'badFormat'
  | 'tooMany'
  | 'writeFailed'
  | 'unzipFailed'
  | 'empty';

export interface StickerImportReport {
  /** 成功入库的张数 */
  added: number;
  /** 跳过的明细：文件名 + 原因 */
  skipped: Array<{ name: string; reason: StickerImportSkipReason }>;
  /** 新建的包 id（`added === 0` 时为 `undefined`） */
  packId?: string;
  /** 包名（展示用） */
  packName?: string;
}

/**
 * 判断是不是图片。
 * ★ 同时看 **MIME 与扩展名**，任一命中即可 —— 两者都可能缺：
 *   · 从 zip 解出来的条目**没有 MIME**（只有文件名）；
 *   · 某些系统选图时 `File.type` 是空串（少见但真实存在）。
 *   只看一个会漏。
 */
export function isImageFile(name: string, mime?: string): boolean {
  if (mime && mime.startsWith('image/')) return true;
  const ext = extOfName(name).toLowerCase();
  return (STICKER_EXTS as readonly string[]).includes(ext);
}

/** 从文件名推出语义标签（去扩展名、去常见前缀数字） */
export function labelFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  // ★ 去掉前导序号（`01_喵` / `12-开心` / `3.生气`）——
  //   那是整理时编的号，当语义标签毫无意义，还会让自动配图匹配不上。
  return base.replace(/^[\s\d]+[_\-.\s]+/, '').trim() || base.trim();
}

/**
 * 读 zip 里的 `custom_stickers.json`
 * （与 `public/stickers/placeholder/custom_stickers.json` 同格式）。
 *
 * 形状宽容：`[{fileName, description}]` 或 `{stickers: [...]}`——
 * 这个文件来自各种导出工具，形状不统一；**只认一种形态等于大部分用户的包读不出来**。
 */
function parseDescriptionMap(files: Map<string, Uint8Array>): Map<string, string> {
  const map = new Map<string, string>();
  const raw = readZipText(files, 'custom_stickers.json') ?? readZipText(files, 'stickers.json');
  if (!raw) return map;
  try {
    const json = JSON.parse(raw) as unknown;
    const list = Array.isArray(json)
      ? json
      : typeof json === 'object' && json !== null && Array.isArray((json as { stickers?: unknown }).stickers)
        ? ((json as { stickers: unknown[] }).stickers as unknown[])
        : [];
    for (const entry of list) {
      if (typeof entry !== 'object' || entry === null) continue;
      const rec = entry as Record<string, unknown>;
      const fileName = typeof rec.fileName === 'string' ? rec.fileName : typeof rec.file === 'string' ? rec.file : '';
      const desc =
        typeof rec.description === 'string' ? rec.description : typeof rec.label === 'string' ? rec.label : '';
      if (fileName && desc) map.set(fileName.toLowerCase(), desc);
    }
  } catch {
    // ★ 映射文件坏了**不算失败** —— 退回"用文件名当标签"，导入照常进行。
    //   为一个可选文件放弃整批导入是不成比例的。
    log.warn('app', '表情包描述映射文件解析失败，改用文件名作标签');
  }
  return map;
}

/** 把一批「名字 + 字节」入库，返回报告 */
async function persist(
  entries: Array<{ name: string; bytes: Uint8Array; mime: string; descHint?: string }>,
  packName: string,
): Promise<StickerImportReport> {
  const skipped: StickerImportReport['skipped'] = [];
  const items: StickerItem[] = [];

  if (entries.length === 0) {
    return { added: 0, skipped, packId: undefined, packName };
  }

  const packId = newId();
  let totalBytes = 0;

  for (const [i, e] of entries.entries()) {
    if (i >= MAX_STICKER_COUNT) {
      skipped.push({ name: e.name, reason: 'tooMany' });
      continue;
    }
    if (e.bytes.byteLength > MAX_STICKER_BYTES) {
      skipped.push({ name: e.name, reason: 'tooLarge' });
      continue;
    }
    totalBytes += e.bytes.byteLength;
    if (totalBytes > MAX_BATCH_BYTES) {
      skipped.push({ name: e.name, reason: 'tooLarge' });
      continue;
    }

    // ★ blob 路径带**包 id 前缀**：将来「删除这个包」可以按前缀整批清理，
    //   不必逐条记 assetId 再逐个删（那样漏一个就留下永久孤儿 blob）。
    const path = `stickers/${packId}/${e.name}`;
    const putRes = await blobRepo.put(path, e.bytes, e.mime);
    if (!putRes.ok) {
      skipped.push({ name: e.name, reason: 'writeFailed' });
      continue;
    }
    items.push({
      description: e.descHint?.trim() || labelFromFileName(e.name),
      fileName: e.name,
      assetId: putRes.value,
      source: 'local',
      addedAt: nowISO(),
    });
  }

  if (items.length === 0) {
    return { added: 0, skipped, packId: undefined, packName };
  }

  const createRes = await stickerRepo.createPack(packName, items, { id: packId });
  if (!createRes.ok) {
    // 包没建成 ⇒ 刚才写进去的 blob 是孤儿。这里**如实报告 writeFailed**，
    // 不做"自动回滚删 blob"（删用户资产的风险比留几个孤儿大，见 blobRepo 的既有取舍）。
    for (const it of items) skipped.push({ name: it.fileName, reason: 'writeFailed' });
    return { added: 0, skipped, packId: undefined, packName };
  }

  log.info('app', '表情包导入完成', { packName, added: items.length, skipped: skipped.length }, 'FN-28');
  return { added: items.length, skipped, packId, packName };
}

/** 猜 MIME（zip 解出来的条目没有 MIME，得从扩展名推） */
function mimeOf(name: string): string {
  const ext = extOfName(name).toLowerCase();
  const table: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return table[ext] ?? 'application/octet-stream';
}

/**
 * 从**本地文件**导入表情包。
 *
 * 自动识别两种输入：
 *   · 单个 `.zip` ⇒ 解压，取里面的图片
 *   · 一批图片文件 ⇒ 直接入库（包名取第一个文件的目录名或"我的表情"）
 *   · **混合**（zip + 图片一起选）也支持：先处理图片，再展开 zip
 */
export async function importStickersFromFiles(files: readonly File[]): Promise<StickerImportReport> {
  const skipped: StickerImportReport['skipped'] = [];
  const loose: Array<{ name: string; bytes: Uint8Array; mime: string; descHint?: string }> = [];
  const zips: File[] = [];

  for (const f of files) {
    const ext = extOfName(f.name).toLowerCase();
    if (ext === 'zip') {
      zips.push(f);
    } else if (isImageFile(f.name, f.type)) {
      loose.push({
        name: f.name,
        bytes: new Uint8Array(await f.arrayBuffer()),
        mime: f.type || mimeOf(f.name),
      });
    } else {
      skipped.push({ name: f.name, reason: 'badFormat' });
    }
  }

  // 包名：有 zip 就用 zip 名；否则用"我的表情 + 日期"。
  // ★ 不用第一个图片名 —— 那会得到"喵"这种毫无意义的包名。
  const packName =
    zips.length > 0
      ? zips[0].name.replace(/\.zip$/i, '')
      : `我的表情 ${new Date().toLocaleDateString('zh-CN')}`;

  const looseReport = await persist(loose, packName);
  const allSkipped = [...skipped, ...looseReport.skipped];
  let added = looseReport.added;

  for (const z of zips) {
    let unzipped: Map<string, Uint8Array>;
    try {
      unzipped = await unzipFile(z);
    } catch (e) {
      skipped.push({ name: z.name, reason: 'unzipFailed' });
      log.warn('app', '表情包解压失败', String(e));
      continue;
    }
    const descMap = parseDescriptionMap(unzipped);
    const entries: Array<{ name: string; bytes: Uint8Array; mime: string; descHint?: string }> = [];
    for (const [path, bytes] of unzipped) {
      // 跳过目录条目与 macOS 的 `__MACOSX/` 元数据、`.DS_Store`
      if (path.endsWith('/')) continue;
      if (path.includes('__MACOSX/') || path.endsWith('.DS_Store')) continue;
      const base = path.split('/').pop() ?? path;
      if (!isImageFile(base)) continue;
      if (bytes.byteLength === 0) continue;
      entries.push({
        name: base,
        bytes,
        mime: mimeOf(base),
        descHint: descMap.get(base.toLowerCase()),
      });
    }
    if (entries.length === 0) {
      skipped.push({ name: z.name, reason: 'empty' });
      continue;
    }
    const rep = await persist(entries, z.name.replace(/\.zip$/i, ''));
    added += rep.added;
    allSkipped.push(...rep.skipped);
  }

  return {
    added,
    skipped: allSkipped,
    packId: looseReport.packId,
    packName,
  };
}

/**
 * 联网搜到的图片**不做下载**，只登记链接（理由见 `types/media.ts` 的 `remoteUrl` 注释：
 * 跨域 `fetch` 会撞 CORS，绝大多数图床拿不到字节；`<img src>` 则不受同源限制）。
 *
 * ⇒ 这里只是"把用户选中的链接存成一个表情条目"，代价是**图源挂了就显示不出来**，
 *   由 `StickerImage` 退化成文字标签兜住。
 */
export async function addRemoteStickers(
  candidates: readonly { url: string; description: string }[],
  packName = '联网搜来的',
): Promise<StickerImportReport> {
  const skipped: StickerImportReport['skipped'] = [];
  const items: StickerItem[] = [];
  const packId = newId();

  for (const c of candidates) {
    if (items.length >= MAX_STICKER_COUNT) {
      skipped.push({ name: c.url, reason: 'tooMany' });
      continue;
    }
    items.push({
      description: c.description || '表情',
      fileName: c.url.split('/').pop()?.split('?')[0] || 'remote',
      remoteUrl: c.url,
      source: 'remote',
      addedAt: nowISO(),
    });
  }

  if (items.length === 0) return { added: 0, skipped, packName };

  // ★ 复用同名包（key 用固定 id）：多次搜索的结果**累积在同一个包里** ——
  //   否则搜 5 次就得到 5 个"联网搜来的"包，管理页立刻一团乱。
  const existing = await stickerRepo.listEnabled();
  const found = existing.ok
    ? existing.value.find((p) => p.name === packName && p.items.some((i) => i.source === 'remote'))
    : undefined;

  if (found) {
    const res = await stickerRepo.addItems(found.id, items);
    if (!res.ok) for (const it of items) skipped.push({ name: it.fileName, reason: 'writeFailed' });
    return { added: res.ok ? items.length : 0, skipped, packId: found.id, packName };
  }

  const res = await stickerRepo.createPack(packName, items, { id: packId });
  if (!res.ok) {
    for (const it of items) skipped.push({ name: it.fileName, reason: 'writeFailed' });
    return { added: 0, skipped, packName };
  }
  return { added: items.length, skipped, packId, packName };
}

/** 供界面做"重复导入"提示：问一句这批文件里有没有已经导过的包名 */
export function existingPackNames(packs: readonly { name: string }[]): Set<string> {
  return new Set(packs.map((p) => p.name));
}

/** 类型再导出（界面按它做失败文案分流） */
export type { Result };
