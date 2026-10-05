import { create } from 'zustand';
import { logRepo } from '@/db/repo/logRepo';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { redact } from '@/lib/errors';
import { LOG_KEEP } from '@/constants/limits';
import type { LogEntry, LogLevel, LogScope } from '@/types/log';

/**
 * 日志 Store（架构文档 §6.3）：统一入口 `push(level, scope, message, detail?)`。
 *
 * - 内存里保留最近 LOG_KEEP 条，供开发者页实时展示；
 * - 同时异步落 `logs` 表（滚动保留），失败**只告警不抛错**（日志不能反过来搞崩应用）；
 * - ★ **脱敏强制**：任何 detail 写入前过 `redact()`（Key / Authorization / token → `***`）。
 */

export interface LogState {
  logs: LogEntry[];
  /** 是否同步落库（开发者页可关，避免高频日志拖慢存储） */
  persistToDb: boolean;
  /** 控制台镜像（dev.rawLog 打开时） */
  mirrorToConsole: boolean;

  push(level: LogLevel, scope: LogScope, message: string, detail?: unknown, featureId?: string): LogEntry;
  pushMany(entries: readonly LogEntry[]): void;
  clear(): void;
  setPersistToDb(on: boolean): void;
  setMirrorToConsole(on: boolean): void;
  /** 导出为 .jsonl（FN-26，同样脱敏） */
  exportJSONL(): string;
  /** 从库里加载最近 N 条（开发者页打开时） */
  loadRecent(limit?: number): Promise<void>;
}

const MAX_IN_MEMORY = 500;

export const useLogStore = create<LogState>()((set, get) => ({
  logs: [],
  persistToDb: true,
  mirrorToConsole: false,

  push: (level, scope, message, detail, featureId) => {
    const entry: LogEntry = {
      id: newId(),
      at: nowISO(),
      level,
      scope,
      featureId,
      message,
      // ★ 脱敏
      detail: detail === undefined ? undefined : redact(detail),
    };

    set((state) => {
      const logs = [entry, ...state.logs].slice(0, MAX_IN_MEMORY);
      return { logs };
    });

    if (get().mirrorToConsole) {
      const line = `[${scope}] ${message}`;
      // eslint-disable-next-line no-console
      if (level === 'debug') console.debug(line, entry.detail ?? '');
      // eslint-disable-next-line no-console
      else if (level === 'info') console.info(line, entry.detail ?? '');
      // eslint-disable-next-line no-console
      else if (level === 'warn') console.warn(line, entry.detail ?? '');
      // eslint-disable-next-line no-console
      else console.error(line, entry.detail ?? '');
    }

    if (get().persistToDb) {
      void logRepo.push({ level, scope, message, detail, featureId }).catch(() => {
        /* 落库失败不影响主流程 */
      });
      // 顺手做一次滚动保留（异步，不阻塞）
      void logRepo.prune(LOG_KEEP).catch(() => undefined);
    }

    return entry;
  },

  pushMany: (entries) =>
    set((state) => ({
      logs: [...entries, ...state.logs].slice(0, MAX_IN_MEMORY),
    })),

  clear: () => {
    set({ logs: [] });
    void logRepo.clear().catch(() => undefined);
  },

  setPersistToDb: (on) => set({ persistToDb: on }),
  setMirrorToConsole: (on) => set({ mirrorToConsole: on }),

  exportJSONL: () => get().logs.map((l) => JSON.stringify(redact(l))).join('\n'),

  loadRecent: async (limit = 200) => {
    const res = await logRepo.listRecent(limit);
    if (res.ok) set({ logs: res.value });
  },
}));

/** 便捷函数（非组件场景，如服务层、repo 内部） */
export function logPush(
  level: LogLevel,
  scope: LogScope,
  message: string,
  detail?: unknown,
  featureId?: string,
): LogEntry {
  return useLogStore.getState().push(level, scope, message, detail, featureId);
}

/** 一行式便捷方法 */
export const log = {
  debug: (scope: LogScope, message: string, detail?: unknown, featureId?: string) =>
    logPush('debug', scope, message, detail, featureId),
  info: (scope: LogScope, message: string, detail?: unknown, featureId?: string) =>
    logPush('info', scope, message, detail, featureId),
  warn: (scope: LogScope, message: string, detail?: unknown, featureId?: string) =>
    logPush('warn', scope, message, detail, featureId),
  error: (scope: LogScope, message: string, detail?: unknown, featureId?: string) =>
    logPush('error', scope, message, detail, featureId),
};

export default useLogStore;
