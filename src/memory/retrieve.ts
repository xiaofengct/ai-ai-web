import { MEMORY_TOKEN_BUDGET } from '@/constants/limits';
import { estimateTokens } from '@/lib/token';
import { log } from '@/store/logStore';
import { memoryRepo } from '@/db/repo/memoryRepo';
import { buildBM25Index, distinctiveness, searchBM25, type BM25Index } from './bm25';
import type { MemoryEntry, MemoryHit, MemoryQuery } from '@/types/memory';

/**
 * ★ 记忆检索（架构文档 §2 `src/memory/retrieve.ts`、§3.10 `MemoryRetriever`）。
 *
 * 流程：按 scope 取候选 → BM25 打分 → 阈值过滤 → token 预算截断 → 限制条数。
 *
 * ★ 关键取舍：预算截断放在**最后**，因为阈值过滤通常会砍掉 90% 以上的条目，
 *   先截断会把真正相关的条目挡在外面。
 */

/** 检索器（可注入 repo，便于测试） */
export class BM25MemoryRetriever {
  private indexCache: { signature: string; index: BM25Index } | undefined;

  constructor(private readonly repo: typeof memoryRepo = memoryRepo) {}

  /** 按查询检索 */
  async search(q: MemoryQuery): Promise<MemoryHit[]> {
    const candidates = await this.candidates(q);
    if (candidates.length === 0) return [];

    const index = this.buildIndex(candidates);
    const hits = searchBM25(index, q.query);

    const threshold = q.threshold ?? 0;
    const filtered = hits.filter((h) => h.score >= threshold);

    const budget = q.tokenBudget ?? MEMORY_TOKEN_BUDGET;
    const limit = q.limit ?? 50;

    const out: MemoryHit[] = [];
    let used = 0;
    for (const hit of filtered) {
      const entry = candidates.find((c) => c.id === hit.id);
      if (!entry) continue;
      const cost = estimateTokens(entry.content);
      if (used + cost > budget) break;
      used += cost;
      out.push({ entry: { ...entry, score: hit.score }, score: hit.score, matchedTerms: hit.matchedTerms });
      if (out.length >= limit) break;
    }

    if (out.length === 0) {
      log.debug('memory', '记忆检索没有命中', { candidates: candidates.length, threshold }, 'FN-29');
    }
    return out;
  }

  /**
   * 重算并持久化某条记忆的 score。
   * ★ 用的是「独特性」而不是「与当前查询的相关度」——
   *   相关度是查询相关的，不能写回条目；独特性是条目固有属性，适合落库当默认权重。
   */
  async reindex(entry: MemoryEntry): Promise<void> {
    const res = await this.repo.listByScore(0, 5000);
    if (!res.ok) return;
    const docs = res.value.map((e) => ({ id: e.id, text: e.content }));
    const index = buildBM25Index(docs);
    const score = distinctiveness(index, entry.id);
    await this.repo.setScore(entry.id, score);
  }

  /** 按 scope 取候选集 */
  private async candidates(q: MemoryQuery): Promise<MemoryEntry[]> {
    if (q.scope === 'range' && q.range) {
      const res = await this.repo.listByRange(q.range.from, q.range.to);
      return res.ok ? res.value : [];
    }
    if (q.scope === 'session') {
      const res = await this.repo.listByScope('session', q.sessionId);
      return res.ok ? res.value : [];
    }
    const res = await this.repo.listByScope('global');
    return res.ok ? res.value : [];
  }

  /** 建索引（同批候选复用，避免每条查询都重建） */
  private buildIndex(entries: readonly MemoryEntry[]): BM25Index {
    const signature = `${entries.length}:${entries[0]?.id ?? ''}:${entries[entries.length - 1]?.id ?? ''}`;
    if (this.indexCache && this.indexCache.signature === signature) return this.indexCache.index;
    const index = buildBM25Index(entries.map((e) => ({ id: e.id, text: e.content })));
    this.indexCache = { signature, index };
    return index;
  }

  /** 外部手动清缓存（记忆增删后调用，保证下一轮检索拿到新数据） */
  invalidate(): void {
    this.indexCache = undefined;
  }
}

/** 全局单例 */
export const memoryRetriever = new BM25MemoryRetriever();

export default memoryRetriever;

/**
 * 供 chatStore 直接调用的便捷函数：
 * 用「最近几条消息 + 当前输入」当查询串，检索出该注入的记忆。
 */
export async function retrieveForPrompt(args: {
  query: string;
  scope: MemoryQuery['scope'];
  sessionId?: string;
  settings: { memoryScoreThreshold: number; provideFullMemory: boolean };
  personaId?: string;
  tokenBudget?: number;
}): Promise<MemoryHit[]> {
  const hits = await memoryRetriever.search({
    query: args.query,
    scope: args.scope,
    sessionId: args.sessionId,
    // ★ 全量模式：阈值压到 0（不过滤），但仍受 token 预算约束
    threshold: args.settings.provideFullMemory ? 0 : args.settings.memoryScoreThreshold,
    tokenBudget: args.tokenBudget ?? MEMORY_TOKEN_BUDGET,
  });

  if (!args.personaId) return hits;
  // ★ 记忆与角色隔离：蒸馏角色的记忆不该混进欣然的上下文
  return hits.filter((h) => !h.entry.personaId || h.entry.personaId === args.personaId);
}

/** 把检索结果拼成一段可读文本（开发者页 / 记忆管理页展示用） */
export function formatHits(hits: readonly MemoryHit[]): string {
  return hits
    .map((h, i) => `${i + 1}. [${h.score.toFixed(2)}] ${h.entry.content}`)
    .join('\n');
}
