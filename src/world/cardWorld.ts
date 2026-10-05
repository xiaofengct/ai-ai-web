/**
 * 世界包 ↔ 角色卡 的读写 —— 世界设定的**落库**层。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 设计：世界包存在角色卡的 `extensions` 里，条目并进 `character_book`
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么存进**角色卡**而不是单独一张表：
 *   - 世界是**属于某个角色**的（欣然的世界 ≠ 别人的世界）；
 *   - 存进卡里 ⇒ **导出/导入人设时世界自动跟着走**，不需要额外的打包逻辑；
 *   - 与既有的 `extensions.aiyuLayers`（5 层人格）、`extensions.aiyu.personaMd`
 *     （外部角色人格）**同一套约定**，不新造第二种存放方式。
 *
 * 为什么**同时**要把条目并进 `character_book.entries`：
 *   因为 `worldBookSegment`（提示词第 5 段）读的就是 `character_book.entries`，
 *   它已经实现了关键词触发、常驻条目、token 预算与截断。
 *   ⇒ 世界书这部分**零改动**就能用上 —— 只把内容放进那个容器即可。
 *
 * ★ 合并时**只动自己的条目**：用 `extensions.aiyuWorld === true` 标记来源，
 *   重新应用世界包时先摘掉旧的标记条目，再追加新的。
 *   这样**用户在蒸馏/手工产生的世界书条目不会被误删**。
 */

import { deepClone } from '@/lib/clone';
import { isWorldPack, isWorldPackUsable } from './types';
import type { WorldEntry, WorldPack } from './types';
import type { PersonaCard, PersonaCardData, CharacterBookEntry } from '@/types/persona';

/** 世界条目在 `character_book` 里的来源标记（用于"只清自己"） */
const WORLD_ENTRY_MARKER = 'aiyuWorld';

/** 从角色卡读世界包（读不到 / 结构不对 → undefined） */
export function worldOfCard(card: PersonaCard | undefined | null): WorldPack | undefined {
  if (!card) return undefined;
  const ext = card.data.extensions as { aiyu?: { world?: unknown } } | undefined;
  const raw = ext?.aiyu?.world;
  return isWorldPack(raw) ? raw : undefined;
}

/** 该卡有没有可用的世界设定 */
export function hasWorld(card: PersonaCard | undefined | null): boolean {
  return isWorldPackUsable(worldOfCard(card));
}

/** 判断一个世界书条目是不是"由世界包生成的" */
function isWorldOwnedEntry(entry: CharacterBookEntry): boolean {
  const ext = entry.extensions as Record<string, unknown> | undefined;
  return ext?.[WORLD_ENTRY_MARKER] === true;
}

/** 世界条目 → 角色卡的世界书条目（带上来源标记与插入顺序） */
function toBookEntries(entries: readonly WorldEntry[], orderBase = 100): CharacterBookEntry[] {
  return entries.map((e, i) => ({
    keys: [...e.keys],
    content: e.content,
    enabled: true,
    // ★ 从 100 起排：给用户/蒸馏产生的条目留出前 100 的位置，
    //   世界条目按原顺序接在后面（`worldBookSegment` 按 insertion_order 升序注入）
    insertion_order: orderBase + i,
    ...(e.comment ? { comment: e.comment } : {}),
    extensions: { [WORLD_ENTRY_MARKER]: true },
  }));
}

/**
 * 把世界包写进角色卡（**纯函数**，返回新卡，不改原对象）。
 *
 * 三件事同时做：
 *   ① `extensions.aiyu.world` ← 世界包本体（供排班/时段计算读取）；
 *   ② `character_book.entries` ← 世界条目（供 `worldBookSegment` 注入提示词）；
 *   ③ 摘掉上一次由世界包写入的条目（靠标记识别，不碰别人的条目）。
 *
 * `pack` 传 `undefined`/`null` 等价于"清空世界"。
 */
export function applyWorldToCard(card: PersonaCard, pack: WorldPack | null | undefined): PersonaCard {
  const data: PersonaCardData = { ...card.data };
  const ext = (data.extensions ?? {}) as Record<string, unknown>;
  const aiyu = (ext.aiyu ?? {}) as Record<string, unknown>;

  // ① 先摘掉旧的世界条目（只摘带标记的）
  const book = data.character_book ?? { entries: [] };
  const keptEntries = (book.entries ?? []).filter((e) => !isWorldOwnedEntry(e));

  if (!pack) {
    // 清空：连 extensions 里的 world 也一起去掉
    const nextAiAi = { ...aiyu };
    delete nextAiAi.world;
    data.extensions = { ...ext, aiyu: nextAiAi };
    data.character_book = { entries: keptEntries };
    return { ...card, data, updatedAt: new Date().toISOString() };
  }

  // ② 写入世界包本体 + 追加新的世界条目
  /*
   * ★ 世界包本体做**深拷贝**再写入。
   *   原因：内置包 `XINRAN_WORLD` 是模块级**常量**，若直接存引用，
   *   所有内置版用户的卡会指向**同一个对象**——
   *   任何一处（比如设置页的"改概率门"）改了它，等于改掉了全局默认值，
   *   而且下次启动又是"干净的常量"，表现为"改了有时生效有时不生效"。
   *   这类共享可变状态的 bug 极难查，一行深拷贝就断根。
   */
  const cloned = deepClone(pack);
  data.extensions = { ...ext, aiyu: { ...aiyu, world: cloned } };
  data.character_book = { entries: [...keptEntries, ...toBookEntries(cloned.entries)] };
  return { ...card, data, updatedAt: new Date().toISOString() };
}

/** 摘要（UI 展示用）：一句话说明这个世界包有什么 */
export function describeWorldPack(pack: WorldPack | undefined | null): string {
  if (!pack) return '（无世界设定）';
  const bits: string[] = [];
  if (pack.schedule) {
    bits.push(`排班 ${pack.schedule.cycle.length} 天一轮（${[...new Set(pack.schedule.cycle)].join('/')}）`);
  }
  if (pack.rhythm.quietHours) bits.push(`静默 ${pack.rhythm.quietHours.from}–${pack.rhythm.quietHours.to}`);
  if (pack.rhythm.gate) bits.push(`概率门 ${pack.rhythm.gate.threshold}`);
  bits.push(`世界书 ${pack.entries.length} 条`);
  return bits.join('｜');
}
