import type { ISODate, UUID } from './common';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * 日志作用域（架构文档 §6.3 给的 6 个是最小集）。
 *
 * 采用「已知字面量联合 + `(string & {})`」的写法：
 * - 已知值有自动补全与拼写检查；
 * - 新增分层（router / guide / pet ...）时不必回头改这里，避免多个任务并行时互相阻塞。
 */
export type LogScope =
  | 'llm'
  | 'db'
  | 'persona'
  | 'distill'
  | 'proactive'
  | 'ui'
  | 'router'
  | 'memory'
  | 'backup'
  | 'voice'
  | 'media'
  | 'bridge'
  | 'pwa'
  | 'app'
  | (string & Record<never, never>);

export interface LogEntry {
  id: UUID;
  at: ISODate;
  level: LogLevel;
  scope: LogScope;
  /** PG-01 / FN-30 ... */
  featureId?: string;
  message: string;
  /** ★ 必须脱敏（Key/Authorization 打码） */
  detail?: unknown;
}
