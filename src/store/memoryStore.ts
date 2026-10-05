import { create } from 'zustand';
import { memoryRepo } from '@/db/repo/memoryRepo';
import { log } from './logStore';
import type { MemoryEntry, MemoryHit, MemoryQuery, MemoryScope } from '@/types/memory';
import type { UUID } from '@/types/common';

/**
 * 记忆 Store（架构文档 §6.6）：记忆库缓存与检索结果。
 * **不做总结**（那是 MemorySummarizer 的职责，T06）；
 * 检索算法（BM25）在 `memory/retrieve.ts`，这里只缓存结果与做 CRUD。
 */

export interface MemoryState {
  entries: MemoryEntry[];
  hits: MemoryHit[];
  loading: boolean;
  /** 当前检索串（开发者页展示用） */
  lastQuery?: string;
  /** 过滤器 */
  filter: { scope: MemoryScope; sessionId?: UUID; tag?: string; keyword: string; minScore: number };

  reload(scope?: MemoryScope, sessionId?: UUID): Promise<void>;
  setFilter(patch: Partial<MemoryState['filter']>): void;
  /** 本地关键词检索（BM25 上线后由 memory/retrieve.ts 接管） */
  search(query: string, q?: Partial<MemoryQuery>): Promise<MemoryHit[]>;
  create(input: {
    content: string;
    tags?: string[];
    sessionId?: UUID;
    personaId?: UUID;
    score?: number;
    weight?: number;
    timeRef?: string;
  }): Promise<MemoryEntry>;
  update(id: UUID, patch: Partial<MemoryEntry>): Promise<void>;
  remove(id: UUID): Promise<void>;
  removeMany(ids: readonly UUID[]): Promise<void>;
  allTags(): string[];
  bySession(sessionId: UUID): MemoryEntry[];
}

/** 简易打分：命中词频 / 内容长度，归一化到 0~1（BM25 未接入前的兜底） */
function localScore(content: string, query: string): number {
  if (!query) return 0;
  const lower = content.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  let hit = 0;
  for (const t of terms) if (lower.includes(t)) hit += 1;
  return Math.min(1, hit / terms.length);
}

export const useMemoryStore = create<MemoryState>()((set, get) => ({
  entries: [],
  hits: [],
  loading: false,
  filter: { scope: 'session', tag: undefined, keyword: '', minScore: 0 },

  reload: async (scope, sessionId) => {
    const useScope = scope ?? get().filter.scope;
    const useSession = sessionId ?? get().filter.sessionId;
    set({ loading: true });
    const res = await memoryRepo.listByScope(useScope, useSession);
    if (!res.ok) {
      set({ loading: false });
      log.error('db', '加载记忆失败', res.error, 'FN-56');
      return;
    }
    set({ entries: res.value, loading: false });
  },

  setFilter: (patch) => set((state) => ({ filter: { ...state.filter, ...patch } })),

  /**
   * 检索：走 memoryRepo 取候选 → 本地打分 → 阈值过滤 → 按得分排序。
   * 说明：真正的 BM25 在 `memory/bm25.ts`（T06）；此处保持接口一致，便于后续替换实现。
   */
  search: async (query, q) => {
    const threshold = q?.threshold ?? get().filter.minScore;
    const limit = q?.limit ?? 20;
    set({ lastQuery: query, loading: true });

    const res = await memoryRepo.listByScope(q?.scope ?? 'global', q?.sessionId, 2000);
    if (!res.ok) {
      set({ loading: false, hits: [] });
      log.error('db', '记忆检索失败', res.error, 'FN-57');
      return [];
    }

    const hits: MemoryHit[] = res.value
      .map((entry) => {
        const score = localScore(entry.content, query);
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        const matched = terms.filter((t) => entry.content.toLowerCase().includes(t));
        return { entry, score, matchedTerms: matched };
      })
      .filter((h) => h.score >= threshold)
      .sort((a, b) => b.score - a.score || (b.entry.weight ?? 0) - (a.entry.weight ?? 0))
      .slice(0, limit);

    set({ hits, loading: false });
    return hits;
  },

  create: async (input) => {
    const res = await memoryRepo.create(input);
    if (!res.ok) {
      log.error('db', '新增记忆失败', res.error, 'FN-56');
      throw res.error;
    }
    await get().reload();
    return res.value;
  },

  update: async (id, patch) => {
    const res = await memoryRepo.upsert({ ...(get().entries.find((e) => e.id === id) as MemoryEntry), ...patch });
    if (!res.ok) throw res.error;
    await get().reload();
  },

  remove: async (id) => {
    const res = await memoryRepo.remove(id);
    if (!res.ok) throw res.error;
    await get().reload();
  },

  removeMany: async (ids) => {
    const res = await memoryRepo.removeMany(ids);
    if (!res.ok) throw res.error;
    await get().reload();
  },

  allTags: () => [...new Set(get().entries.flatMap((e) => e.tags ?? []))].sort(),

  bySession: (sessionId) => get().entries.filter((e) => e.sessionId === sessionId),
}));

export default useMemoryStore;
