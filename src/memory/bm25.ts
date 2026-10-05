import { tokenize } from '@/lib/text';

/**
 * BM25 打分实现（FN-57 默认方案；架构文档 §2 `src/memory/bm25.ts`）。
 *
 * 为什么不用向量：纯前端、无后端、无 embedding 接口，
 * BM25 是「零依赖 + 可解释 + 对中文 2-gram 分词效果可接受」的最优解
 * （能力表 FN-57 的 `alternative` 就是 `alt.bm25Score`）。
 *
 * 公式：
 *   idf(t) = ln(1 + (N - df(t) + 0.5) / (df(t) + 0.5))
 *   score  = Σ_t idf(t) · tf(t,d)·(k1+1) / (tf(t,d) + k1·(1 - b + b·len(d)/avgLen))
 */

export interface BM25Options {
  /** 词频饱和系数，默认 1.5 */
  k1?: number;
  /** 长度归一系数，默认 0.75 */
  b?: number;
}

export interface BM25DocInput {
  id: string;
  text: string;
}

interface IndexedDoc {
  id: string;
  terms: string[];
  len: number;
  tf: Map<string, number>;
}

export interface BM25Index {
  docs: IndexedDoc[];
  /** 文档频率：term → 出现过的文档数 */
  df: Map<string, number>;
  avgLen: number;
  k1: number;
  b: number;
}

export interface BM25Hit {
  id: string;
  /** 归一化后的得分，0~1 */
  score: number;
  /** 命中的查询词（用于 UI 高亮与「为什么命中」提示） */
  matchedTerms: string[];
}

const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;

/** 建立索引（对同一批文档只建一次，之后可反复打分） */
export function buildBM25Index(docs: readonly BM25DocInput[], options: BM25Options = {}): BM25Index {
  const k1 = options.k1 ?? DEFAULT_K1;
  const b = options.b ?? DEFAULT_B;
  const indexed: IndexedDoc[] = [];
  const df = new Map<string, number>();
  let totalLen = 0;

  for (const doc of docs) {
    const terms = tokenize(doc.text ?? '');
    const tf = new Map<string, number>();
    for (const term of terms) tf.set(term, (tf.get(term) ?? 0) + 1);
    for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    totalLen += terms.length;
    indexed.push({ id: doc.id, terms, len: terms.length, tf });
  }

  return {
    docs: indexed,
    df,
    avgLen: indexed.length > 0 ? totalLen / indexed.length : 0,
    k1,
    b,
  };
}

/** idf（带平滑，保证 df=N 时也不会变负数或除零） */
export function idfOf(index: BM25Index, term: string): number {
  const n = index.docs.length;
  const df = index.df.get(term) ?? 0;
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

/** 单文档打分（返回原始分 + 命中词） */
export function scoreDoc(
  index: BM25Index,
  doc: IndexedDoc,
  queryTerms: readonly string[],
): { raw: number; matchedTerms: string[] } {
  if (doc.len === 0 || index.avgLen === 0) return { raw: 0, matchedTerms: [] };

  const matchedTerms: string[] = [];
  let raw = 0;
  const seen = new Set<string>();

  for (const term of queryTerms) {
    const tf = doc.tf.get(term) ?? 0;
    if (tf === 0) continue;
    if (!seen.has(term)) {
      seen.add(term);
      matchedTerms.push(term);
    }
    const idf = idfOf(index, term);
    const norm = 1 - index.b + index.b * (doc.len / index.avgLen);
    raw += (idf * tf * (index.k1 + 1)) / (tf + index.k1 * norm);
  }

  return { raw, matchedTerms };
}

/**
 * 对整批文档打分并**归一化到 0~1**。
 * ★ 归一化方式：除以本次命中的最高分（相对分），
 *   这样阈值（如 0.35）在「记忆库越攒越多」时依然稳定可用——
 *   用绝对分的话，随着语料变大分数会整体漂移，阈值很快就失效。
 */
export function searchBM25(index: BM25Index, query: string, options: BM25Options = {}): BM25Hit[] {
  const queryTerms = [...new Set(tokenize(query ?? ''))];
  if (queryTerms.length === 0 || index.docs.length === 0) return [];

  void options;
  const scored: Array<{ id: string; raw: number; matchedTerms: string[] }> = [];
  let maxRaw = 0;

  for (const doc of index.docs) {
    const { raw, matchedTerms } = scoreDoc(index, doc, queryTerms);
    if (raw <= 0) continue;
    if (raw > maxRaw) maxRaw = raw;
    scored.push({ id: doc.id, raw, matchedTerms });
  }

  if (scored.length === 0) return [];
  return scored
    .map((item) => ({
      id: item.id,
      score: maxRaw > 0 ? Math.min(1, item.raw / maxRaw) : 0,
      matchedTerms: item.matchedTerms,
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * 「独特性」评分（供 `MemoryRetriever.reindex()` 用）：
 * 条目里出现越多稀有词 → 越独特 → 越值得长期记住。同样归一化到 0~1。
 */
export function distinctiveness(index: BM25Index, docId: string): number {
  const doc = index.docs.find((d) => d.id === docId);
  if (!doc || doc.terms.length === 0) return 0;
  const unique = new Set(doc.terms);
  let sum = 0;
  for (const term of unique) sum += idfOf(index, term);
  const raw = sum / unique.size;
  // idf 的理论上限随 N 增长，这里用一个温和的压缩函数映射到 0~1
  return Math.min(1, raw / (raw + 1));
}
