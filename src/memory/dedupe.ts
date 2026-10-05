import { tokenize } from '@/lib/text';
import { nowISO } from '@/lib/time';
import { log } from '@/store/logStore';
import { memoryRepo } from '@/db/repo/memoryRepo';
import { memoryRetriever } from './retrieve';
import type { MemoryEntry } from '@/types/memory';
import type { UUID } from '@/types/common';

/**
 * 记忆去重合并（架构文档 §2 `src/memory/dedupe.ts`、FN-57）。
 *
 * 相似度用 `lib/text.jaccard()`（CJK 2-gram + ASCII 词），阈值默认 0.72：
 * - 高于阈值 → **合并进已有条目**（保留旧 id、更新内容与时间、tags 取并集）；
 * - 低于阈值 → 作为新条目插入。
 *
 * ★ 合并时保留两条的措辞：新内容如果更长就替换（信息更多），
 *   否则把新内容作为「补充」接在后面——避免「记得更全的老记忆」被一句更短的新记忆覆盖。
 */

/** 默认相似阈值 */
export const DEFAULT_DEDUPE_THRESHOLD = 0.72;

/**
 * ★ 记忆专用相似度 = max(Jaccard, 重叠系数)。
 *
 * 为什么不能只用 Jaccard：记忆的典型重复形态是「旧条目 + 新补充」，
 * 例如「风喜欢拍黄瓜」与「风喜欢拍黄瓜，尤其是夏天」——
 * 这两条的 Jaccard 只有 0.56（新句子长了一倍，交集占比被摊薄），
 * 但短的那条**完全被长的包含**，重叠系数是 1.0。
 * 用 Jaccard 会漏合并、越攒越碎；用重叠系数则能正确识别出「同一件事的更完整版本」。
 */
export function similarity(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  const jac = union > 0 ? inter / union : 0;
  const overlap = inter / Math.min(sa.size, sb.size);
  return Math.max(jac, overlap);
}

/**
 * 判断是否「同一条记忆」。
 * 两条都极短（≤6 字）时额外要求**一条包含另一条**，避免「好的」「嗯」这类短语被误合并。
 */
export function isSameMemory(a: string, b: string, threshold: number = DEFAULT_DEDUPE_THRESHOLD): boolean {
  const score = similarity(a, b);
  if (score < threshold) return false;
  const shortOne = a.trim();
  const longOne = b.trim();
  if (Array.from(shortOne).length <= 6 && Array.from(longOne).length <= 6) {
    return shortOne.includes(longOne) || longOne.includes(shortOne);
  }
  return true;
}

export interface DedupeResult {
  /** 需要新建的条目 */
  toAdd: MemoryEntry[];
  /** 需要更新（合并后）的条目 */
  toMerge: MemoryEntry[];
  /** 被合并掉的来源条目 id（供日志/回撤用） */
  mergedFrom: UUID[];
}

/**
 * 把一批新记忆与已有记忆做比对，产出「新增 / 合并」两份清单。
 * 不直接写库——写库交给 `upsertMemories()`，方便单测与批量事务。
 */
export function dedupeEntries(
  incoming: readonly MemoryEntry[],
  existing: readonly MemoryEntry[],
  threshold: number = DEFAULT_DEDUPE_THRESHOLD,
): DedupeResult {
  const toAdd: MemoryEntry[] = [];
  const toMerge = new Map<UUID, MemoryEntry>();
  const mergedFrom: UUID[] = [];

  for (const candidate of incoming) {
    let best: { entry: MemoryEntry; score: number } | undefined;
    for (const old of existing) {
      const score = similarity(candidate.content, old.content);
      if (!isSameMemory(candidate.content, old.content, threshold)) continue;
      if (!best || score > best.score) best = { entry: old, score };
    }

    if (!best) {
      toAdd.push(candidate);
      continue;
    }

    const merged = mergeMemory(best.entry, candidate);
    toMerge.set(best.entry.id, merged);
    mergedFrom.push(candidate.id);
  }

  return { toAdd, toMerge: [...toMerge.values()], mergedFrom };
}

/**
 * 合并两条记忆。
 * - 内容：取更长的那条；若新内容更长且旧内容里有它没有的信息，则追加在后面；
 * - tags：并集去重；
 * - score：取较大值（更被认可的那次）；
 * - sourceMessageIds：并集；
 * - timeRef：保留更早的那个（记忆的时间锚点不宜被后来的总结改写）。
 */
export function mergeMemory(existing: MemoryEntry, incoming: MemoryEntry): MemoryEntry {
  const now = nowISO();
  const oldContent = existing.content.trim();
  const newContent = incoming.content.trim();

  let content: string;
  if (newContent.length === 0) {
    content = oldContent;
  } else if (oldContent.length === 0) {
    content = newContent;
  } else if (newContent.length > oldContent.length) {
    content = newContent;
  } else if (!oldContent.includes(newContent)) {
    content = `${oldContent}（补充：${newContent}）`;
  } else {
    content = oldContent;
  }

  return {
    ...existing,
    content,
    tags: [...new Set([...(existing.tags ?? []), ...(incoming.tags ?? [])])],
    score: Math.max(existing.score ?? 0, incoming.score ?? 0),
    weight: Math.max(existing.weight ?? 0, incoming.weight ?? 0) || undefined,
    sourceMessageIds: [
      ...new Set([...(existing.sourceMessageIds ?? []), ...(incoming.sourceMessageIds ?? [])]),
    ],
    timeRef: earlierOf(existing.timeRef, incoming.timeRef),
    updatedAt: now,
  };
}

function earlierOf(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

/**
 * 去重后落库（FN-57 的持久化部分）。
 * 返回 `{ added, merged }`，供 UI 用欣然口吻提示（ok.memorySaved）。
 */
export async function upsertMemories(
  incoming: readonly MemoryEntry[],
  options: { threshold?: number; sessionId?: UUID; personaId?: UUID } = {},
): Promise<{ added: number; merged: number }> {
  if (incoming.length === 0) return { added: 0, merged: 0 };

  const threshold = options.threshold ?? DEFAULT_DEDUPE_THRESHOLD;

  // 候选池：优先同会话（跨会话的记忆本就不该互相合并），其次同角色
  const poolRes = options.sessionId
    ? await memoryRepo.listByScope('session', options.sessionId)
    : await memoryRepo.listByScore(0, 5000);
  const pool = poolRes.ok ? poolRes.value : [];
  const existing = options.personaId
    ? pool.filter((e) => !e.personaId || e.personaId === options.personaId)
    : pool;

  const { toAdd, toMerge } = dedupeEntries(incoming, existing, threshold);

  let added = 0;
  for (const entry of toAdd) {
    const res = await memoryRepo.upsert(entry);
    if (res.ok) added += 1;
  }

  let merged = 0;
  for (const entry of toMerge) {
    const res = await memoryRepo.upsert(entry);
    if (res.ok) merged += 1;
  }

  if (added + merged > 0) {
    log.info('memory', '记忆已保存', { added, merged }, 'FN-57');
    // 记忆变了 → 检索索引要失效，否则下一轮还在用旧语料打分
    memoryRetriever.invalidate();
    // 给新条目算一次「独特性」作为默认权重
    for (const entry of toAdd) {
      void memoryRetriever.reindex(entry).catch(() => undefined);
    }
  }

  return { added, merged };
}

/** 单条插入的便捷封装（手动新增记忆用） */
export async function addMemory(
  input: {
    content: string;
    tags?: string[];
    sessionId?: UUID;
    personaId?: UUID;
    score?: number;
  },
): Promise<MemoryEntry> {
  const res = await memoryRepo.create(input);
  if (!res.ok) throw res.error;
  memoryRetriever.invalidate();
  void memoryRetriever.reindex(res.value).catch(() => undefined);
  return res.value;
}
