import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useSettingsStore, type DeepPartial } from '@/store/settingsStore';
import { sessionRepo } from '@/db/repo/sessionRepo';
import { deepMerge } from '@/constants/defaults';
import { useSnack } from '@/hooks/useSnack';
import type { ChatSession } from '@/types/chat';
import type { ChatSettings } from '@/types/settings';

/**
 * ★ 会话级设置读写（PG-09 聊天设置 / PG-10 上下文设置 共用）。
 *
 * ★ 为什么是「覆盖（override）」而不是直接改全局：
 *   同一份全局设置下，不同会话可以有不同脾气（比如「深夜档」会话关掉主动消息）。
 *   落库的是**与全局的差异部分**（`settingsOverride`），读取时由
 *   `settingsStore.effectiveChat()` 做深合并——全局改了，没被覆盖的项会跟着变。
 *
 * ★ 合并语义（与 settingsStore 保持一致）：
 *   - 数组整体替换（`contentFilter.words` 改了就是改了，不做逐项并集）；
 *   - 对象递归合并（只写 `proactive.enabled` 不会清掉 `intervalMin`）；
 *   - `null` 表示显式清空，`undefined` 表示「这一项不覆盖」（跟着全局）。
 */

export interface SessionSettingsApi {
  session?: ChatSession;
  /** 全局 + 会话覆盖后的有效设置 */
  effective: ChatSettings;
  /** 写覆盖（深合并进已有 override） */
  patch: (partial: DeepPartialChat) => Promise<void>;
  /** 丢弃本会话的全部覆盖，回到「跟随全局」 */
  resetToGlobal: () => Promise<void>;
  /** 本会话是否有覆盖（用于显示「已自定义」角标） */
  overridden: boolean;
  loading: boolean;
}

type DeepPartialChat = DeepPartial<ChatSettings>;

export function useSessionSettings(sessionId: string | undefined): SessionSettingsApi {
  const snack = useSnack();
  const globalSettings = useSettingsStore((s) => s.settings);
  const refreshChat = useChatStore((s) => s.refresh);
  const currentSessionId = useChatStore((s) => s.sessionId);

  const [session, setSession] = useState<ChatSession | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  /* —— 载入会话 —— */
  useEffect(() => {
    if (!sessionId) {
      setSession(undefined);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    void (async () => {
      const res = await sessionRepo.get(sessionId);
      if (!alive) return;
      if (res.ok) setSession(res.value);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const effective = useMemo(
    () => useSettingsStore.getState().effectiveChat(session?.settingsOverride),
    // globalSettings 变化时也要重算（否则全局改了页面不刷新）
    [session?.settingsOverride, globalSettings],
  );

  const write = useCallback(
    async (nextOverride: Partial<ChatSettings>): Promise<void> => {
      if (!sessionId) return;
      const res = await sessionRepo.setOverride(sessionId, nextOverride);
      if (!res.ok) {
        snack.error('err.dbFailed');
        return;
      }
      const refreshed = await sessionRepo.get(sessionId);
      if (refreshed.ok) setSession(refreshed.value);
      // 当前就在这个会话里 → 让消息页用新设置重新加载（加载范围变了要生效）
      if (currentSessionId === sessionId) await refreshChat();
    },
    [sessionId, snack, currentSessionId, refreshChat],
  );

  const patch = useCallback(
    async (partial: DeepPartialChat): Promise<void> => {
      const base = (session?.settingsOverride ?? {}) as Partial<ChatSettings>;
      const next = deepMerge<Partial<ChatSettings>>(base, partial);
      await write(next);
    },
    [session?.settingsOverride, write],
  );

  const resetToGlobal = useCallback(async () => {
    await write({});
    snack.success('ok.saved');
  }, [write, snack]);

  const overridden = Boolean(session?.settingsOverride && Object.keys(session.settingsOverride).length > 0);

  return { session, effective, patch, resetToGlobal, overridden, loading };
}

export default useSessionSettings;
