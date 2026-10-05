import type { ISODate, UUID } from './common';

export type MemoryScope = 'session' | 'global' | 'range';

export interface MemoryEntry {
  id: UUID;
  /** 全局记忆为 undefined */
  sessionId?: UUID;
  /** 归属角色（蒸馏角色与欣然记忆隔离） */
  personaId?: UUID;
  content: string;
  tags: string[];
  /** 检索得分（BM25 归一化 0~1） */
  score: number;
  /** 人工置顶权重 */
  weight?: number;
  sourceMessageIds?: UUID[];
  timeRef?: ISODate;
  createdAt: ISODate;
  updatedAt: ISODate;
  /** Correction 记录（EX-10） */
  correction?: string[];
}

export interface MemoryQuery {
  /** 检索串（最近若干条消息拼成） */
  query: string;
  scope: MemoryScope;
  sessionId?: UUID;
  range?: { from: ISODate; to: ISODate };
  threshold: number;
  tokenBudget: number;
  limit?: number;
}

export interface MemoryHit {
  entry: MemoryEntry;
  score: number;
  matchedTerms: string[];
}

/** 总结范围（PG-11 / FN-48）：时间 / 条数 / 锚点 / 全选 */
export interface SummaryRange {
  mode: 'time' | 'count' | 'anchor' | 'all';
  from?: ISODate;
  to?: ISODate;
  count?: number;
  anchorStartId?: UUID;
  anchorEndId?: UUID;
}
