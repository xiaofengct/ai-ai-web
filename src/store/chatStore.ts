import { create } from 'zustand';
import { AppError, isAbortError, toAppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import { sleepCancellable } from '@/llm/retry';
import { contentFilter } from '@/llm/filter';
import { llmClient } from '@/llm/client';
import { log } from '@/store/logStore';
import { snack } from '@/hooks/useSnack';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { messageRepo } from '@/db/repo/messageRepo';
import { sessionRepo } from '@/db/repo/sessionRepo';
import { personaRepo } from '@/db/repo/personaRepo';
import { personaCompiler } from '@/persona/PersonaCompiler';
import { nicknameGuard } from '@/persona/nicknameGuard';
import { pickStickerForText } from '@/proactive/stickerPicker';
import { retrieveForPrompt } from '@/memory/retrieve';
import { memorySummarizer } from '@/memory/summarizer';
import { upsertMemories } from '@/memory/dedupe';
import { splitIntoMessages, makePreview, cleanText } from '@/lib/text';
import { estimateTokens } from '@/lib/token';
import { nowISO } from '@/lib/time';
import { t } from '@/copy';
import type { ChatSession, Message, MessageAttachment } from '@/types/chat';
import type { ChatSettings } from '@/types/settings';
import type { PersonaCard } from '@/types/persona';
import type { UUID } from '@/types/common';

/**
 * ★★ 聊天核心 Store（架构文档 §2 `src/store/chatStore.ts`、流程 §4.1）。
 *
 * 职责边界（§6.6）：
 * - **负责**：当前会话、消息增量、发送流程、多选态、流式状态；
 * - **不负责**：持久化写入（一律调 repo）、提示词编译（调 PersonaCompiler）、
 *   记忆总结（调 MemorySummarizer）。
 *
 * ★ 流式落库策略：**增量进内存、节流写库**。
 *   每来一个 chunk 都写一次 IndexedDB 会把长回复拖成几百次事务；
 *   这里按 `PERSIST_INTERVAL_MS` 节流，且 `stop()` / 结束时补一次全量写入，
 *   保证「刷新后消息还在」（PG-16 验收要点①）。
 */

/** 流式增量落库节流间隔 */
const PERSIST_INTERVAL_MS = 400;

/** 主动消息在上下文里保留的条数上限（避免她自己说的话挤掉用户的） */
const MAX_PROACTIVE_IN_CONTEXT = 2;

export interface SendPayload {
  text: string;
  attachments?: MessageAttachment[];
}

export interface ChatState {
  sessionId?: UUID;
  session?: ChatSession;
  persona?: PersonaCard;
  messages: Message[];
  /** 正在流式的 assistant 消息 id */
  streamingId?: UUID;
  /** 流式增量（UI 直接读它做逐字渲染） */
  streamingText: string;
  sending: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** 多选态（FN-63） */
  multiSelect: boolean;
  selectedIds: UUID[];
  /** 最近一次错误：只存 code，UI 拿 code 查文案 key，不显示英文 message */
  lastError?: { code: string; message: string };
  summarizing: boolean;

  /* —— 生命周期 —— */
  attach(sessionId: UUID): Promise<void>;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  reset(): void;

  /* —— 发送 —— */
  sendMessage(sessionId: UUID, payload: SendPayload): Promise<void>;
  stop(): void;
  regenerate(messageId: UUID): Promise<void>;
  appendProactive(text: string): Promise<void>;

  /* —— 消息操作 —— */
  toggleFavorite(id: UUID): Promise<void>;
  removeMessage(id: UUID): Promise<void>;

  /* —— 多选 —— */
  setMultiSelect(on: boolean): void;
  toggleSelected(id: UUID): void;
  clearSelection(): void;
  deleteSelected(): Promise<void>;
  forwardSelected(targetSessionIds: readonly UUID[]): Promise<void>;
  mergeSelected(): Promise<void>;
  pat(targetMessageId?: UUID): Promise<void>;
}

/** 当前请求的取消句柄（不放进 state，避免被订阅者误序列化） */
let abortRef: AbortController | undefined;

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  streamingText: '',
  sending: false,
  loading: false,
  loadingMore: false,
  hasMore: true,
  multiSelect: false,
  selectedIds: [],
  summarizing: false,

  /* ============================================================
     生命周期
     ============================================================ */

  attach: async (sessionId) => {
    set({ loading: true, sessionId, messages: [], streamingText: '', lastError: undefined });
    const ui = useUiStore.getState();
    ui.setCurrentSession(sessionId);

    const sessionRes = await sessionRepo.get(sessionId);
    if (!sessionRes.ok || !sessionRes.value) {
      set({ loading: false, lastError: { code: 'DB_FAILED', message: '会话不存在' } });
      return;
    }
    const session = sessionRes.value;

    const personaRes = await personaRepo.get(session.personaId);
    const persona = personaRes.ok ? personaRes.value : undefined;

    const settings = useSettingsStore.getState().effectiveChat(session.settingsOverride);
    const page = await messageRepo.page(sessionId, { limit: Math.max(1, settings.loadRange) });
    const messages = page.ok ? page.value : [];

    set({
      session,
      persona,
      messages,
      loading: false,
      hasMore: messages.length >= Math.max(1, settings.loadRange),
    });
  },

  refresh: async () => {
    const { sessionId } = get();
    if (!sessionId) return;
    await get().attach(sessionId);
  },

  loadMore: async () => {
    const { sessionId, messages, loadingMore, hasMore } = get();
    if (!sessionId || loadingMore || !hasMore || messages.length === 0) return;

    set({ loadingMore: true });
    const settings = useSettingsStore.getState().effectiveChat(get().session?.settingsOverride);
    const oldest = messages[0]?.createdAt;
    const page = await messageRepo.page(sessionId, {
      limit: Math.max(1, settings.loadRange),
      before: oldest,
    });
    const older = page.ok ? page.value : [];
    set({
      messages: [...older, ...messages],
      loadingMore: false,
      hasMore: older.length >= Math.max(1, settings.loadRange),
    });
  },

  reset: () => {
    abortRef?.abort();
    abortRef = undefined;
    set({
      sessionId: undefined,
      session: undefined,
      persona: undefined,
      messages: [],
      streamingId: undefined,
      streamingText: '',
      sending: false,
      loading: false,
      hasMore: true,
      multiSelect: false,
      selectedIds: [],
      lastError: undefined,
    });
  },

  /* ============================================================
     发送主流程（§4.1）
     ============================================================ */

  sendMessage: async (sessionId, payload) => {
    const text = cleanText(payload.text ?? '');
    if (!text && (payload.attachments?.length ?? 0) === 0) return;

    const state = get();
    if (state.sending) return;

    const settings = useSettingsStore.getState().effectiveChat(state.session?.settingsOverride);
    const persona = state.persona;

    // ★ 提示词唯一出口：没有角色就走内置欣然，绝不「裸发」
    //   （Result 必须先判 ok——失败分支上没有 value 字段）
    const fallbackRes = persona ? undefined : await personaRepo.getXinran();
    const activePersona: PersonaCard | undefined =
      persona ?? (fallbackRes && fallbackRes.ok ? fallbackRes.value : undefined);
    if (!activePersona) {
      set({ lastError: { code: 'LLM_NO_PROVIDER', message: '没有可用的角色' } });
      snack.error('err.llmNoProvider');
      return;
    }

    const controller = new AbortController();
    abortRef = controller;
    set({ sending: true, lastError: undefined });

    try {
      /* ① 用户消息落库（status='sending'） */
      const userRes = await messageRepo.append({
        sessionId,
        role: 'user',
        content: text,
        status: 'sending',
        attachments: payload.attachments,
      });
      if (!userRes.ok) throw userRes.error;
      const userMsg = userRes.value;
      set((s) => ({ messages: [...s.messages, userMsg] }));

      /* ② 入站过滤 + 发送延迟（可取消） */
      const inbound = contentFilter.inbound(text);
      if (inbound !== text) {
        await messageRepo.setContent(userMsg.id, inbound);
        set((s) => ({
          messages: s.messages.map((m) => (m.id === userMsg.id ? { ...m, content: inbound } : m)),
        }));
      }
      if (settings.sendDelayMs > 0) {
        await sleepCancellable(settings.sendDelayMs, controller.signal);
      }
      await messageRepo.setStatus(userMsg.id, 'done');

      /* ③ 历史加载 → ④ 清洗与截断 */
      const historyRes = await messageRepo.page(sessionId, { limit: Math.max(1, settings.loadRange) });
      const history = cleanAndTruncate(historyRes.ok ? historyRes.value : [], settings);

      /* ⑤ 记忆检索 */
      const query = [inbound, ...history.slice(-4).map((m) => m.content)].join('\n');
      const hits = await retrieveForPrompt({
        query,
        scope: settings.memoryScope,
        sessionId,
        settings,
        personaId: activePersona.id,
      });

      /* ⑥ 提示词编译（唯一出口） */
      const built = personaCompiler.build({
        persona: activePersona,
        session: state.session,
        settings,
        history,
        userInput: inbound,
        memoryHits: hits,
        kind: 'chat',
      });

      /* ⑦ 占位 assistant 消息 → 流式写入 */
      const assistantRes = await messageRepo.append({
        sessionId,
        role: 'assistant',
        content: '',
        status: 'streaming',
      });
      if (!assistantRes.ok) throw assistantRes.error;
      const assistantMsg = assistantRes.value;
      set((s) => ({
        messages: [...s.messages, assistantMsg],
        streamingId: assistantMsg.id,
        streamingText: '',
      }));

      let acc = '';
      let lastPersist = 0;

      for await (const chunk of llmClient.stream({
        messages: built.messages,
        params: settings.params,
        signal: controller.signal,
      })) {
        if (!chunk.delta) continue;
        acc += chunk.delta;
        set({ streamingText: acc });

        // ★ 节流落库：刷新后最多丢最后 400ms 的内容，结束时会补一次全量
        const now = Date.now();
        if (now - lastPersist >= PERSIST_INTERVAL_MS) {
          lastPersist = now;
          void messageRepo.setContent(assistantMsg.id, acc);
        }
      }

      /* ⑧ 出站过滤 → 昵称守卫（只标注） → 自动分割 → 最终落库 */
      const outbound = contentFilter.outbound(acc);
      const violations = nicknameGuard.check(outbound, {
        origin: activePersona.origin,
        history: [...history, assistantMsg],
      });

      const parts = settings.autoSplit ? splitIntoMessages(outbound) : [outbound];
      const finalText = parts[0] ?? '';

      // ★ 只标注，不改写：违规信息单独写进 nicknameWarnings
      let warnings: string[] | undefined;
      if (violations.length > 0) {
        const draft: Message = { ...assistantMsg, content: finalText };
        nicknameGuard.annotate(draft, violations);
        warnings = draft.nicknameWarnings;
        log.info('persona', '昵称守卫命中', { types: violations.map((v) => v.type) }, 'XR-05');
      }

      await messageRepo.setStatus(assistantMsg.id, 'done');
      await messageRepo.setContent(assistantMsg.id, finalText);
      if (warnings && warnings.length > 0) {
        await messageRepo.setNicknameWarnings(assistantMsg.id, warnings);
      }

      /* ⑧′ ★★ 自动配表情（2026-10-04 加）
       *
       * 「自然融入」的四道收敛（详见 `proactive/stickerPicker.ts` 文件头）：
       *   有情绪线索 → 标签真的对得上 → 概率门槛 → 只配一张。
       * 匹配不到就**不配**（不是随便挑一张）。
       *
       * ★ 配在**第一条**（`finalText`）上，不是分割后的每一条 ——
       *   一次回复里贴好几张表情，等于把"表情"变成了装饰，
       *   而不是"说到某个情绪时顺带贴一下"。
       *
       * ★ 包在 try/catch 里，且**失败只是没有表情**：
       *   配图是锦上添花，绝不能因为读库失败把一条已经生成好的回复弄丢。
       */
      let stickerAtt: MessageAttachment | undefined;
      try {
        const picked = await pickStickerForText(finalText);
        if (picked) {
          stickerAtt = {
            id: newId(),
            kind: 'sticker',
            assetId: picked.assetId,
            mime: 'image/png',
            name: picked.description,
          };
          log.debug('persona', '给她配了一张表情', { description: picked.description }, 'FN-28');
        }
      } catch {
        /* 配表情失败不影响正文 */
      }

      const finalMsg: Message = {
        ...assistantMsg,
        content: finalText,
        status: 'done',
        tokenEstimate: estimateTokens(finalText),
        nicknameWarnings: warnings,
        ...(stickerAtt ? { attachments: [...(assistantMsg.attachments ?? []), stickerAtt] } : {}),
      };
      set((s) => ({
        messages: s.messages.map((m) => (m.id === assistantMsg.id ? finalMsg : m)),
        streamingId: undefined,
        streamingText: '',
        sending: false,
      }));

      /* ⑨ 自动分割的后续条：按 multiMessageDelayMs 逐条呈现 */
      if (parts.length > 1) {
        await emitSplitParts(sessionId, assistantMsg.id, parts.slice(1), settings, controller.signal);
      }

      /* ⑩ 会话统计与预览 */
      await sessionRepo.refreshPreview(sessionId, finalMsg);
      await sessionRepo.recountStats(sessionId);

      /* ⑪ 自动总结（PG-11 / FN-48） */
      void maybeAutoSummarize(sessionId, activePersona, settings).catch(() => undefined);
    } catch (e) {
      const err = toAppError(e);
      const aborted = isAbortError(e) || err.code === 'LLM_ABORT' || err.code === 'ABORTED';
      set({ sending: false, streamingId: undefined, streamingText: '' });

      if (aborted) {
        // ★ 用户主动停止：已生成的内容要保住，标为 done 而不是 failed
        const id = get().messages.find((m) => m.status === 'streaming')?.id;
        if (id) await messageRepo.setStatus(id, 'done');
        set((s) => ({
          messages: s.messages.map((m) => (m.status === 'streaming' ? { ...m, status: 'done' } : m)),
        }));
        return;
      }

      set({ lastError: { code: err.code, message: err.message } });
      log.error('llm', '发送失败', { code: err.code, message: err.message }, 'PG-16');
      snack.error(errorCopyKey(err.code));

      // 失败也要把 streaming 状态的消息标成 failed，避免刷新后一直是「发送中」
      const stuck = get().messages.find((m) => m.status === 'streaming');
      if (stuck) {
        await messageRepo.setStatus(stuck.id, 'failed', { code: err.code, message: err.message });
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === stuck.id
              ? { ...m, status: 'failed', errorInfo: { code: err.code, message: err.message } }
              : m,
          ),
        }));
      }
    } finally {
      abortRef = undefined;
    }
  },

  stop: () => {
    abortRef?.abort();
  },

  /**
   * 重新生成：删掉这条 assistant 消息，用同一条用户消息再走一次。
   * ★ 不复用上次的提示词——历史已经变了（少了一条 assistant），重新编译才对。
   */
  regenerate: async (messageId) => {
    const { sessionId, messages } = get();
    if (!sessionId) return;
    const index = messages.findIndex((m) => m.id === messageId);
    if (index < 0) return;

    const before = messages.slice(0, index).reverse().find((m) => m.role === 'user');
    if (!before) return;

    await messageRepo.remove(messageId);
    set((s) => ({ messages: s.messages.filter((m) => m.id !== messageId) }));
    await get().sendMessage(sessionId, { text: before.content });
  },

  /** ★ 主动消息落库（由 proactive 层触发，聊天页只负责渲染） */
  appendProactive: async (text) => {
    const { sessionId } = get();
    if (!sessionId || !text.trim()) return;
    const res = await messageRepo.append({
      sessionId,
      role: 'assistant',
      content: text.trim(),
      status: 'done',
      proactive: true,
    });
    if (!res.ok) return;
    set((s) => ({ messages: [...s.messages, res.value] }));
    await sessionRepo.refreshPreview(sessionId, res.value);
    await sessionRepo.recountStats(sessionId);
  },

  /* ============================================================
     消息操作
     ============================================================ */

  toggleFavorite: async (id) => {
    const target = get().messages.find((m) => m.id === id);
    const next = !(target?.favorite ?? false);
    const res = await messageRepo.setFavorite(id, next);
    if (!res.ok) {
      snack.error('err.dbFailed');
      return;
    }
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, favorite: next } : m)) }));
    snack.success(next ? 'ok.favorited' : 'ok.unfavorited');
  },

  removeMessage: async (id) => {
    const res = await messageRepo.remove(id);
    if (!res.ok) {
      snack.error('err.dbFailed');
      return;
    }
    set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
  },

  /* ============================================================
     多选（FN-63）
     ============================================================ */

  setMultiSelect: (on) => set({ multiSelect: on, selectedIds: on ? get().selectedIds : [] }),

  toggleSelected: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),

  clearSelection: () => set({ selectedIds: [] }),

  deleteSelected: async () => {
    const ids = [...get().selectedIds];
    if (ids.length === 0) return;
    const res = await messageRepo.removeMany(ids);
    if (!res.ok) {
      snack.error('err.dbFailed');
      return;
    }
    set((s) => ({
      messages: s.messages.filter((m) => !ids.includes(m.id)),
      selectedIds: [],
    }));
    snack.success('ok.deleted');
  },

  forwardSelected: async (targetSessionIds) => {
    const ids = [...get().selectedIds];
    if (ids.length === 0 || targetSessionIds.length === 0) return;
    let total = 0;
    for (const id of ids) {
      const res = await messageRepo.forward(id, targetSessionIds);
      if (res.ok) total += res.value;
    }
    set({ selectedIds: [], multiSelect: false });
    snack.success('ok.forwarded');
    log.info('chat', '转发完成', { count: ids.length, total }, 'FN-63');
  },

  /**
   * 合并转发（FN-63）：把选中的多条并成一条「合并消息」再转发到当前会话之外。
   * ★ 合并结果本身也是一条可溯源的消息——`mergedFrom` 记录了原始 id，
   *   详情页（PG-02）靠它还原每一条。
   */
  mergeSelected: async () => {
    const { selectedIds, sessionId, messages } = get();
    if (selectedIds.length === 0 || !sessionId) return;

    const picked = messages
      .filter((m) => selectedIds.includes(m.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (picked.length === 0) return;

    const mergedBody = picked
      .map((m) => `${m.role === 'user' ? '风' : '她'}：${m.content}`)
      .join('\n');
    const res = await messageRepo.append({
      sessionId,
      role: 'user',
      content: mergedBody,
      status: 'done',
      props: { merged: true, count: picked.length },
    });
    if (!res.ok) {
      snack.error('err.dbFailed');
      return;
    }
    const merged: Message = { ...res.value, mergedFrom: picked.map((m) => m.id) };
    await messageRepo.upsert(merged);

    set((s) => ({
      messages: [...s.messages.filter((m) => !selectedIds.includes(m.id)), merged],
      selectedIds: [],
      multiSelect: false,
    }));
    snack.success('ok.merged');
  },

  /**
   * 拍一拍（FN-27）：插入一条「拍了拍」提示消息。
   *
   * ★ 文案走 copy 表 `pat.message`，方向：**角色 → 用户**（与 PRD §667 一致）。
   *   即「{name} 拍了拍{suffix}」（name=角色名，suffix=接在动作后的宾语）。
   *   早先这里是硬编码「你拍了拍{name}{suffix}」，方向与 PRD / 文案表 / 设置提示
   *   三处相反（用户拍角色），是偏离需求的一方，已按 PRD 修正实现。
   *
   * ★ 落库的是**渲染后的文本**（它是消息内容，不是 UI 标签），
   *   后缀来自设置的 `patSuffix`，用户可改。
   */
  pat: async (targetMessageId) => {
    const { sessionId, persona } = get();
    if (!sessionId) return;
    const settings = useSettingsStore.getState().effectiveChat(get().session?.settingsOverride);
    const name = persona?.data.name ?? '欣然';
    // ★ 这里的 `|| '你的头'` 是**兜底，不是修复点**：
    //   `settings` 来自 `effectiveChat()`（`deepMerge(settings.chat, …)`），而
    //   `DEFAULT_CHAT_SETTINGS.patSuffix` **恒有值** ⇒ **本分支永不触发**。
    //   真正生效的默认值在 `src/constants/defaults.ts` 的 `patSuffix`（已同步为 `'你的头'`）。
    //   保留它只为"若将来 defaults 被改成空串"时不渲染出畸形句；**两处必须一致**。
    const suffix = settings.patSuffix || '你的头';

    const res = await messageRepo.append({
      sessionId,
      role: 'system',
      content: t('pat.message', { name, suffix }),
      status: 'done',
      // targetMessageId 记下来：完整版可以按它把涟漪画在那条消息上
      props: { pat: true, targetId: targetMessageId },
    });
    if (!res.ok) return;
    set((s) => ({ messages: [...s.messages, res.value] }));
  },
}));

export default useChatStore;

/* ============================================================
   辅助函数
   ============================================================ */

/**
 * 上下文清洗 + 截断（FN-04 / FN-13 / FN-15）。
 * 顺序：去空 → 去重 → 去 system → 合并连续同角色 → 截断到 contextCount → 限制 maxMessages。
 *
 * ★ 主动消息为什么要限流：她自己开口说的话如果无限堆积，
 *   会在上下文里挤掉用户真正说过的内容，导致她开始「和自己聊天」。
 */
export function cleanAndTruncate(messages: readonly Message[], settings: ChatSettings): Message[] {
  let list: Message[] = [...messages];

  if (settings.contextClean.removeEmpty) {
    list = list.filter((m) => m.content.trim().length > 0 || (m.attachments?.length ?? 0) > 0);
  }
  if (settings.contextClean.trimSystem) {
    list = list.filter((m) => m.role !== 'system' || m.proactive === true);
  }
  if (settings.contextClean.dedupe) {
    const seen = new Set<string>();
    list = list.filter((m) => {
      const key = `${m.role}:${m.content.trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (settings.contextClean.mergeConsecutive) {
    const merged: Message[] = [];
    for (const m of list) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) {
        merged[merged.length - 1] = { ...last, content: `${last.content}\n${m.content}` };
      } else {
        merged.push(m);
      }
    }
    list = merged;
  }

  // 主动消息限流：只保留最近 N 条
  let proactiveCount = 0;
  list = list.filter((m) => {
    if (!m.proactive) return true;
    proactiveCount += 1;
    return proactiveCount <= MAX_PROACTIVE_IN_CONTEXT;
  });

  if (settings.contextCount > 0 && list.length > settings.contextCount) {
    list = list.slice(-settings.contextCount);
  }
  if (settings.maxMessages > 0 && list.length > settings.maxMessages) {
    list = list.slice(-settings.maxMessages);
  }
  return list;
}

/** 自动分割的后续条目：按 multiMessageDelayMs 逐条出现（FN-46） */
async function emitSplitParts(
  sessionId: UUID,
  _firstId: UUID,
  parts: readonly string[],
  settings: ChatSettings,
  signal?: AbortSignal,
): Promise<void> {
  for (const part of parts) {
    if (signal?.aborted) return;
    if (settings.multiMessageDelayMs > 0) {
      await sleepCancellable(settings.multiMessageDelayMs, signal);
    }
    const res = await messageRepo.append({ sessionId, role: 'assistant', content: part, status: 'done' });
    if (res.ok) {
      useChatStore.setState((s) => ({ messages: [...s.messages, res.value] }));
    }
  }
  void _firstId;
}

/** 自动总结（PG-11 / FN-48）：消息数达到阈值就总结一次 */
async function maybeAutoSummarize(
  sessionId: UUID,
  persona: PersonaCard,
  settings: ChatSettings,
): Promise<void> {
  if (!settings.autoSummary.enabled) return;
  const threshold = Math.max(1, settings.autoSummary.threshold);

  const lastSummary = await messageRepo
    .page(sessionId, { limit: 500 })
    .then((res) =>
      res.ok ? [...res.value].reverse().find((m) => m.summaryOf !== undefined) : undefined,
    );

  const all = await messageRepo.page(sessionId, { limit: 500 });
  if (!all.ok) return;
  const since = lastSummary
    ? all.value.filter((m) => m.createdAt > (lastSummary.createdAt ?? ''))
    : all.value;

  if (since.length < threshold) return;

  useChatStore.setState({ summarizing: true });
  try {
    const entries = await memorySummarizer.summarize({
      persona,
      messages: since,
      range: { mode: 'count', count: since.length },
      settings,
    });
    if (entries.length === 0) return;
    await upsertMemories(entries, { sessionId, personaId: persona.id });
    // 打一条「已总结」的锚点消息，避免下次重复总结同一批
    await messageRepo.append({
      sessionId,
      role: 'system',
      content: '',
      status: 'done',
      props: {
        summaryOf: {
          from: since[0]?.createdAt ?? nowISO(),
          to: since[since.length - 1]?.createdAt ?? nowISO(),
          count: since.length,
        },
      },
    });
    snack.success('ok.memorySaved');
  } catch (e) {
    const err = toAppError(e);
    log.warn('memory', '自动总结失败', { code: err.code }, 'FN-48');
    // ★ 总结失败不打扰用户（主流程已经成功），只进日志
  } finally {
    useChatStore.setState({ summarizing: false });
  }
}

/** 错误码 → 文案 key（§6.2：面向用户只传文案 key，不传英文 message） */
export function errorCopyKey(code: string): 'err.llmFailed' | 'err.llmTimeout' | 'err.llmAuth' | 'err.llmNoProvider' | 'err.networkOffline' | 'err.unknown' {
  switch (code) {
    case 'LLM_TIMEOUT':
      return 'err.llmTimeout';
    case 'LLM_AUTH':
      return 'err.llmAuth';
    case 'LLM_NO_PROVIDER':
    case 'LLM_NO_MODEL':
      return 'err.llmNoProvider';
    case 'NETWORK_OFFLINE':
      return 'err.networkOffline';
    case 'LLM_BAD_RESPONSE':
    case 'LLM_CORS':
    case 'LLM_RATE_LIMIT':
      return 'err.llmFailed';
    default:
      return 'err.unknown';
  }
}

/** 会话预览文本（列表用，走 lib/text 的统一实现） */
export function previewOf(message: Message): string {
  return makePreview(message.content);
}

/** 新消息 id（转发/合并等场景需要预生成时用） */
export function nextMessageId(): UUID {
  return newId();
}

/** 抛出统一错误（供外部调用方复用错误码映射） */
export function chatError(code: string, message: string): AppError {
  return new AppError(code, message, undefined);
}
