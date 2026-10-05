import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useSettingsStore } from '@/store/settingsStore';
import { BUILTIN_XINRAN } from '@/constants/buildMode';
import { activeWorldCard } from '@/world/activeWorld';
import { momentRepo } from '@/db/repo/momentRepo';
import { pickStickerForMoment } from '@/proactive/stickerPicker';
import type { Moment } from '@/types/moment';
import { personaCompiler } from '@/persona/PersonaCompiler';
import { llmClient } from '@/llm/client';
import { deliverProactiveMessage } from '@/proactive/notify';
import { proactiveEvents, type ProactiveTriggerPayload } from '@/proactive/scheduler';
import { log } from '@/store/logStore';
import { toAppError } from '@/lib/errors';
import type { ChatSession } from '@/types/chat';
import type { PersonaCard } from '@/types/persona';
import type { Message } from '@/types/chat';
import type { UUID } from '@/types/common';

/**
 * ★ 会话实时绑定（架构文档 §2 `src/hooks/useLiveSession.ts`）。
 *
 * 职责：
 * 1. 路由参数变化 → 加载会话 / 角色 / 消息，卸载时重置，避免串会话；
 * 2. **订阅 `proactiveEvents`**：收到主动消息触发后，
 *    用 `PersonaCompiler` 装提示词 → `llmClient.complete()`（非流式，短文本）→ 落库；
 * 3. 页面隐藏时额外走一次系统通知（`deliverProactiveMessage`）。
 *
 * ★ 职责边界（team-lead 明确）：**调度逻辑不在这里**——
 *   jiwen 状态机、闸门、动态间隔都由 `src/proactive/*`（工程师 D）负责，
 *   本文件只消费它发出的 `proactive:trigger` 事件，
 *   并把 jiwen 给的 `promptContext` / `styleGuidance` 作为**额外约束**注入提示词。
 *
 * ★ 不在这里 `startProactiveScheduler()`：调度器的启动由应用级（`main.tsx` / App）统一控制，
 *   页面级启动会导致重复注册。
 */

export interface LiveSession {
  sessionId?: UUID;
  session?: ChatSession;
  persona?: PersonaCard;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  summarizing: boolean;
  streamingId?: UUID;
  streamingText: string;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

/** 主动消息只参考最近这几条历史（避免提示词过长） */
const PROACTIVE_RECENT = 10;

export function useLiveSession(sessionId: string | undefined): LiveSession {
  const attach = useChatStore((s) => s.attach);
  const reset = useChatStore((s) => s.reset);
  const loadMore = useChatStore((s) => s.loadMore);
  const refresh = useChatStore((s) => s.refresh);
  const appendProactive = useChatStore((s) => s.appendProactive);

  const session = useChatStore((s) => s.session);
  const persona = useChatStore((s) => s.persona);
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const summarizing = useChatStore((s) => s.summarizing);
  const streamingId = useChatStore((s) => s.streamingId);
  const streamingText = useChatStore((s) => s.streamingText);
  const hasMore = useChatStore((s) => s.hasMore);

  /* —— 会话切换：加载 / 卸载重置 —— */
  useEffect(() => {
    if (!sessionId) {
      reset();
      return;
    }
    void attach(sessionId);
    return () => {
      reset();
    };
  }, [sessionId, attach, reset]);

  /* —— 主动消息：订阅 jiwen 的触发事件 —— */
  // 用 ref 持有「当前会话上下文」，避免把整个闭包塞进事件回调导致频繁重订阅
  const ctxRef = useRef<{ session?: ChatSession; persona?: PersonaCard; messages: Message[] }>({
    session: undefined,
    persona: undefined,
    messages: [],
  });
  ctxRef.current = { session, persona, messages };

  useEffect(() => {
    const handler = (payload: ProactiveTriggerPayload): void => {
      void (async () => {
        const current = ctxRef.current;
        const targetId = payload.sessionId ?? current.session?.id;
        if (!targetId || !current.session) return;
        if (current.session.id !== targetId) return;

        const settings = useSettingsStore.getState().effectiveChat(current.session.settingsOverride);
        const recent = current.messages.slice(-PROACTIVE_RECENT);

        // ★ 额外约束：把 jiwen 算出来的「她此刻的状态」与「说话风格指引」原样交给模型
        const extraConstraints = [payload.promptContext, payload.styleGuidance].filter(
          (s): s is string => typeof s === 'string' && s.trim().length > 0,
        );

        try {
          /**
           * ★ `current.persona` 缺失时的兜底（2026-10-04 改）。
           *
           * 改前：`current.persona ?? (await fallbackPersona())` —— 兜底**无条件**可用。
           * 问题：不内置版里也不存在内置欣然，这个兜底却会**凭空造一个欣然**出来
           * （`createXinranCard()` 是纯内存构造，不需要 DB 里有卡），
           * 于是"不内置欣然"的包里跑出了欣然的主动消息。
           *
           * 改后：拿不到角色就**不开这个口**。没有角色时本来也没有"她"可以开口 ——
           * 这是"不发"比"发错人"更正确的场景。
           *
           * ★ 顺带解决构建问题：这里原来有一个**无条件的 `await import()`**，
           *   而动态 import **无法被 tree-shaking 消除** ⇒ 它把整个
           *   `persona/xinranCard.ts`（含 `world/builtinWorlds.ts` 的世界数据）
           *   钉死在不内置版产物里。现在 dynamic import 落在 `!BUILTIN_XINRAN`
           *   的提前返回之后，不内置版里该分支整体不可达 ⇒ 动态 import 被移除。
           *   见 `scripts/qa/check-build-separation.mjs`。
           */
          const persona = current.persona ?? (await fallbackPersona());
          if (!persona) {
            log.debug('proactive', '没有角色可直接使用，跳过本次主动开口', undefined, 'FN-06');
            return;
          }

          const built = personaCompiler.build({
            persona,
            session: current.session,
            settings,
            history: recent,
            userInput: '（这里没有新消息）请你主动开口，说一句你现在想说的话。',
            overrides: { extraConstraints },
            kind: 'proactive',
          });

          const text = await llmClient.complete({
            messages: built.messages,
            params: { ...settings.params, maxTokens: 120, temperature: 1 },
            stream: false,
          });

          const clean = text.trim().replace(/^["'「」]|["'「」]$/g, '');
          if (!clean) return;

          await appendProactive(clean);

          // 页面在后台 → 再补一条系统通知（应用内的消息她回来也能看到）
          if (typeof document !== 'undefined' && document.hidden) {
            deliverProactiveMessage(clean);
          }
          log.info('proactive', '主动消息已生成', { urgency: payload.urgency }, 'FN-19');
        } catch (e) {
          const err = toAppError(e);
          log.warn('proactive', '主动消息生成失败', { code: err.code }, 'FN-19');
        }
      })();
    };

    proactiveEvents.on('proactive:trigger', handler);
    return () => {
      proactiveEvents.off('proactive:trigger', handler);
    };
  }, [appendProactive]);

  /**
   * ★★ 动态发布（2026-10-04 加）：收到 `proactive:moment` 就生成一条并落库。
   *
   * ── 为什么订阅在这里，而不是在某个"动态页"里 ─────────────────────────
   *   调度器是**全局**的（不论用户在哪个页面都在跑），而动态要能"在她想发的时候发"，
   *   不能依赖"用户正巧打开着朋友圈页"。
   *   `useLiveSession` 是本项目**唯一**已有的"应用级事件 → 生成内容"落点
   *   （主动消息就走它），沿用它比新开一个全局副作用更不容易出问题
   *   （StrictMode 双挂载、会话切换清理这些坑它已经处理过了）。
   *
   * ★ 它**不依赖 sessionId** —— 动态不属于会话。所以事件来的时候
   *   即便 `sessionId` 是 undefined（不内置版首启没有会话），也照常生成。
   *   这是与上面 `proactive:trigger` 处理器的**关键区别**：
   *   那个第 3 行就 `if (!targetId ...) return`，动态这个不能那样写。
   */
  useEffect(() => {
    const handler = (payload: { situation?: string; index: number }): void => {
      void (async () => {
        try {
          // ① 取角色：优先当前卡；没有会话时也要能拿到（不内置版导入角色后即属此列）
          const current = ctxRef.current;
          const card = current.persona ?? activeWorldCard();
          if (!card) {
            log.debug('proactive', '没有角色，跳过发动态');
            return;
          }

          // ② 装配提示词（人格层照常注入 ⇒ 语气与人设由它保证）
          const settings = useSettingsStore.getState().settings.chat;
          const recentRes = await momentRepo.listRecent(5);
          const recentMoments = recentRes.ok
            ? recentRes.value.filter((m: Moment) => m.authorKind === 'persona').map((m: Moment) => m.content.slice(0, 20))
            : [];

          const built = personaCompiler.buildMoment({
            persona: card,
            settings,
            ...(settings.moments.useWorldContext && payload.situation
              ? { situation: payload.situation }
              : {}),
            recentMoments,
          });

          // ③ 生成（非流式：动态是一次性产物，流式没有意义）
          const text = await llmClient.complete({
            messages: built.messages,
            // ★ 动态比主动消息长（≤120 字），所以 token 上限比主动消息的 120 宽；
            //   温度略低于聊天，避免每句话都在"用力表演"。
            params: { ...settings.params, maxTokens: 300, temperature: 0.95 },
            stream: false,
          });
          const content = text.trim().replace(/^["'「」]|["'"]$/g, '').replace(/^["'「」]|["'「」]$/g, '');
          if (!content) {
            log.warn('proactive', '动态生成为空，丢弃这次');
            return;
          }

          // ④ 配表情（可选）—— 见 `pickStickerForMoment`
          const images: string[] = [];
          const stickerPath = settings.moments.allowSticker ? await pickStickerForMoment(content) : null;
          if (stickerPath) images.push(stickerPath);

          // ⑤ 落库
          const res = await momentRepo.create({
            content,
            images,
            authorId: card.id,
            authorKind: 'persona',
            // ★ 作者名取**发布当时**的卡名（改名后历史动态仍显示当时那个名字）
            authorName: card.data.name || '她',
          });
          if (!res.ok) {
            log.warn('proactive', '动态落库失败', String(res.error));
            return;
          }
          log.info('proactive', '动态已发布', { length: content.length, withSticker: images.length > 0 }, 'FN-28');
        } catch (e) {
          // ★ 失败**不重试、不提示用户**：动态是"她会自己发"的低频行为，
          //   失败一次（模型超时/没配 Key）静默跳过即可，下次 tick 自然还会试。
          //   弹一个错误提示出来反而像是用户操作失败了 —— 他什么都没做。
          log.warn('proactive', '动态生成失败', String(e));
        }
      })();
    };

    proactiveEvents.on('proactive:moment', handler);
    return () => {
      proactiveEvents.off('proactive:moment', handler);
    };
  }, []);

  const onLoadMore = useCallback(async () => {
    await loadMore();
  }, [loadMore]);

  const onRefresh = useCallback(async () => {
    await refresh();
  }, [refresh]);

  return useMemo(
    () => ({
      sessionId,
      session,
      persona,
      messages,
      loading,
      sending,
      summarizing,
      streamingId,
      streamingText,
      hasMore,
      loadMore: onLoadMore,
      refresh: onRefresh,
    }),
    [
      sessionId,
      session,
      persona,
      messages,
      loading,
      sending,
      summarizing,
      streamingId,
      streamingText,
      hasMore,
      onLoadMore,
      onRefresh,
    ],
  );
}

/**
 * 没有角色时的兜底：**仅内置版**拿内置欣然。
 *
 * ★ 两处约束，缺一不可：
 *   ① **语义**：找不回 DB 里的内置卡（首启竞态等）时，用代码里那份重建一张 ——
 *      主动消息不能因为"卡还没落库"就发不出来。这是内置版才成立的需求。
 *   ② **构建**：不内置版里必须**提前返回 `null`**，让下面的 `await import()`
 *      成为不可达代码。动态 import 不会被 tree-shaking 消除，
 *      留在可达路径上就等于把内置欣然（及其世界数据）钉进不内置版产物。
 *
 * 返回 `null` = "没有可用角色，别开口"（调用方据此跳过本次生成）。
 */
async function fallbackPersona(): Promise<PersonaCard | null> {
  const { personaRepo } = await import('@/db/repo/personaRepo');
  const res = await personaRepo.getXinran();
  if (res.ok && res.value) return res.value;

  // ★ 不内置版到此为止：没有就是没有，不凭空造一个欣然（见 doc 上 ②）
  if (!BUILTIN_XINRAN) return null;

  const { createXinranCard } = await import('@/persona/xinranCard');
  return createXinranCard();
}

export default useLiveSession;
