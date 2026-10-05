import { stickerRepo } from '@/db/repo/stickerRepo';
import { blobRepo } from '@/db/repo/blobRepo';
import { log } from '@/store/logStore';
import type { StickerItem } from '@/types/media';

/**
 * ★★ 角色发表情包 —— 匹配与挑选（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 「自然融入」是怎么做到的（用户明确要求，这里是唯一真源）
 * ═══════════════════════════════════════════════════════════════════════════
 * 关键决定：**不做"每句话都配图"，而是有门槛地配**。
 * 一个每句话都贴表情的角色不像人，像表情包机器人。所以有四道收敛：
 *
 * **① 只在**内容真的带情绪**时才配（`EMOTION_HINTS` 命中）。**
 *   她发"今天白班，累"可以配"生无可恋"；发"文件我收到了"不该配任何图。
 *
 * **② 标签必须**真的对得上**才用（`matchByDescription` 的语义匹配结果）。**
 *   匹配不到就**不配** —— 而不是"随便挑一张""挑最近添加的"。
 *   硬凑的表情比没有表情糟糕得多（说"开心"配一张"生无可恋"）。
 *
 * **③ 有概率门槛。** 即使情绪与标签都命中，也只有 `STICKER_PROBABILITY` 的概率真的贴上。
 *   这模拟"她今天正好想用这张"的随机性 —— 每次都贴反而不自然。
 *
 * **④ 同一条内容只配一张。** 不叠加。
 *
 * ── 对话里怎么用（与动态共用一个入口）─────────────────────────────────
 *   `pickStickerForMoment()` 给动态用；对话侧由调用方在自己生成完正文后
 *   调 `pickStickerForText()` 拿一张，塞进 `attachments`（`kind: 'sticker'`）。
 *   两个函数共用 `chooseSticker()`，**不各写一套匹配** —— 否则某天改了策略，
 *   聊天配得好好的、动态还是旧行为。
 */

/** 情绪线索词。★ 这份表刻意**短而保守**：宁可漏配，不可乱配 */
const EMOTION_HINTS: readonly string[] = [
  // 负面 / 疲惫
  '累',
  '困',
  '烦',
  '气',
  '烦死',
  '生无可恋',
  '崩溃',
  'emo',
  '难过',
  '委屈',
  '想哭',
  '呜呜',
  '唉',
  '叹气',
  '没力气',
  '不想动',
  '加班',
  // 正面
  '开心',
  '高兴',
  '哈哈',
  '笑死',
  '嘿嘿',
  '爽',
  '舒服',
  '满足',
  '好耶',
  '终于',
  // 撒娇 / 亲密
  '想你',
  '要抱',
  '抱抱',
  '贴贴',
  '亲',
  '么么',
  '黏',
  '赖',
  // 语气
  '嘤',
  '喵',
  '哼',
  '略',
  '噗',
  '惊',
];

/** 命中情绪线索后，真正贴出的概率（理由见文件头 ③） */
export const STICKER_PROBABILITY = 0.55;

/** 命中的线索词（返回第一个，供日志说明"为什么配了这张"） */
export function detectEmotionHint(text: string): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const hint of EMOTION_HINTS) {
    if (t.includes(hint.toLowerCase())) return hint;
  }
  return null;
}

/**
 * 挑选一张表情（核心逻辑，聊天与动态共用）。
 *
 * @returns blob 逻辑路径（可直接写进 `Moment.images`）；
 *          或 `undefined` = **这次不配**（这是正常结果，不是失败）
 *
 * ★ 返回 **blob 路径**而不是 item：动态的 `images` 存的是路径
 *   （与用户手动发的图同一个格式，见 `types/moment.ts`）。
 *   `assetId` 是内部 id、`remoteUrl` 是外链，两个都不能直接进 `images`。
 *   ⇒ 统一的出口是"路径"：
 *     · 本地图（有 assetId）→ `getByPath` 反查它自己的路径；
 *     · 远程图（只有 remoteUrl）→ **不配**（动态的 images 渲染走 blob，
 *       外链塞进去会因为查不到 blob 而显示空白，属于"配了但看不见"）。
 */
async function chooseSticker(
  text: string,
  rng: () => number = Math.random,
): Promise<{ path: string; description: string; hint: string } | undefined> {
  const hint = detectEmotionHint(text);
  // ① 没情绪 ⇒ 不配
  if (!hint) return undefined;
  // ③ 概率门槛
  if (rng() > STICKER_PROBABILITY) return undefined;

  // ② 语义匹配：拿**命中的线索词**去匹配标签（不是拿整段正文）
  //    ★ 用整段正文匹配会撞上"包含"规则：正文里任意两个字碰巧是某张标签
  //      就会被选中（"我今天看了个电影"命中标签"电影"）。
  //      而线索词是**我们主动挑出来的情绪信号**，拿它去匹配准得多。
  const res = await stickerRepo.matchByDescription(hint);
  if (!res.ok || !res.value) return undefined;

  const item: StickerItem = res.value.item;
  // 旧占位包只有描述、没有图 ⇒ 不配（"文字表情"没有贴出来的意义）
  if (!item.assetId) return undefined;

  // assetId → blob 记录 → 逻辑路径（动态的 images 存的是路径）
  const rec = await blobRepo.get(item.assetId);
  if (!rec.ok || !rec.value) return undefined;

  return { path: rec.value.path, description: item.description, hint };
}

/** 给动态用：挑一张表情，返回 blob 路径（`undefined` = 这次不配） */
export async function pickStickerForMoment(
  content: string,
  rng: () => number = Math.random,
): Promise<string | undefined> {
  try {
    const picked = await chooseSticker(content, rng);
    if (!picked) return undefined;
    log.debug('proactive', `动态配了表情`, { description: picked.description, hint: picked.hint }, 'FN-28');
    return picked.path;
  } catch (e) {
    // ★ 配表情失败**绝不影响动态本身** —— 图是锦上添花，正文才是要发的东西
    log.warn('proactive', '挑选表情失败，动态不配图', String(e));
    return undefined;
  }
}

/**
 * 给对话用：挑一张表情，返回 `{ assetId, description }`（`undefined` = 这次不配）。
 *
 * ★ 对话存的是 `assetId`（进 `MessageAttachment`），与动态存路径不同 ——
 *   两者的存储约定本来就不一样（消息附件 → blobs id；动态配图 → 逻辑路径）。
 *   所以这里返回 id，由调用方组 `MessageAttachment`。
 */
export async function pickStickerForText(
  text: string,
  rng: () => number = Math.random,
): Promise<{ assetId: string; description: string } | undefined> {
  try {
    const hint = detectEmotionHint(text);
    if (!hint) return undefined;
    if (rng() > STICKER_PROBABILITY) return undefined;
    const res = await stickerRepo.matchByDescription(hint);
    if (!res.ok || !res.value?.item.assetId) return undefined;
    return { assetId: res.value.item.assetId, description: res.value.item.description };
  } catch {
    return undefined;
  }
}
