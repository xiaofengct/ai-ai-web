import { createElement, Fragment, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { memoryRepo } from '@/db/repo/memoryRepo';
import { memoryRetriever } from '@/memory/retrieve';
import { usePersonaStore } from '@/store/personaStore';
import { useChatStore } from '@/store/chatStore';
import { useSnack } from '@/hooks/useSnack';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { to } from '@/router/paths';
import { MemoryEditorPage } from '@/features/memory/MemoryEditorPage';
import type { MemoryEditorPageProps } from '@/features/memory/MemoryEditorPage';
import { PersonaEditorPage } from './PersonaEditorPage';
import type { MemoryEntry } from '@/types/memory';
import type { UUID } from '@/types/common';

/**
 * ★ 聊天内的「人设 / 记忆」就地入口（T10 补充，配合 T08 的长按菜单）。
 *
 * 为什么要有这个 hook：
 * 人设编辑器和记忆编辑器都是**弹窗形态的页**（27 条路由里没有独立人设页），
 * 聊天页想在长按菜单里就地打开它们，就得自己管一份开关状态。
 * 把状态和两个弹窗收在一个 hook 里，调用方只需要两行：
 *
 * ```tsx
 * const pm = usePersonaMemoryEntry();
 * // …菜单项 onClick={() => pm.openPersona(session.personaId)}
 * {pm.host}
 * ```
 *
 * ★ `host` 必须在 JSX 里渲染一次（放在页面末尾即可），否则弹窗不会挂载。
 *
 * 实现说明：本文件刻意保持 `.ts`（不用 `.tsx`），所以弹窗用 `createElement` 构造；
 * 调用方拿到的 `host` 就是一个普通 `ReactElement`，直接 `{pm.host}` 渲染。
 */

/** 打开记忆编辑器的参数 */
export interface OpenMemoryInput {
  /** 直接定位到某条记忆；不传 = 新增 */
  memoryId?: UUID;
  /** 新增时归属的会话 */
  sessionId?: UUID;
  /** 新增时归属的角色 */
  personaId?: UUID;
}

/** 把一条消息存成记忆的参数 */
export interface SaveAsMemoryInput {
  /** 记忆正文；会 trim，为空直接失败并提示 */
  content: string;
  sessionId?: UUID;
  personaId?: UUID;
  tags?: string[];
  /** 来源消息 id（便于日后回溯这条记忆是哪句话来的） */
  sourceMessageId?: UUID;
  /** 存完是否立刻打开编辑器让你再改一遍（默认 false：就地存完就完事） */
  thenEdit?: boolean;
}

export interface PersonaMemoryEntryApi {
  /** 打开角色设定（不传 id 时用当前角色） */
  openPersona: (personaId?: UUID) => void;
  /** 打开记忆编辑器（可带 memoryId 直接定位） */
  openMemory: (input?: OpenMemoryInput) => void;
  /** 把一段内容（通常是一条消息）存成记忆；返回落库后的条目，失败返回 undefined */
  saveAsMemory: (input: SaveAsMemoryInput) => Promise<MemoryEntry | undefined>;
  /** 跳到记忆库总览（/memories） */
  openMemoryList: () => void;
  /** ★ 必须在 JSX 里渲染一次，否则弹窗不挂载 */
  host: ReactElement;
}

export function usePersonaMemoryEntry(): PersonaMemoryEntryApi {
  const navigate = useNavigate();
  const snack = useSnack();
  const reloadPersonas = usePersonaStore((s) => s.reload);
  const currentPersonaId = usePersonaStore((s) => s.currentId);
  // ★ 归属兜底：调用方不传 sessionId / personaId 时，从「当前正在聊的会话 / 当前角色」取，
  //   这样聊天页的菜单项不用把 session 一路透传下来
  const currentSessionId = useChatStore((s) => s.sessionId);

  const [personaOpen, setPersonaOpen] = useState<boolean>(false);
  const [personaId, setPersonaId] = useState<UUID | null>(null);
  const [memoryOpen, setMemoryOpen] = useState<boolean>(false);
  const [memoryEditId, setMemoryEditId] = useState<UUID | null>(null);
  const [memoryOwner, setMemoryOwner] = useState<{ sessionId?: UUID; personaId?: UUID }>({});

  const openPersona = useCallback(
    (id?: UUID): void => {
      setPersonaId(id ?? currentPersonaId ?? null);
      setPersonaOpen(true);
    },
    [currentPersonaId],
  );

  const openMemory = useCallback(
    (input: OpenMemoryInput = {}): void => {
      setMemoryEditId(input.memoryId ?? null);
      setMemoryOwner({
        sessionId: input.sessionId ?? currentSessionId,
        personaId: input.personaId ?? currentPersonaId,
      });
      setMemoryOpen(true);
    },
    [currentPersonaId, currentSessionId],
  );

  const openMemoryList = useCallback((): void => {
    navigate(to.memories());
  }, [navigate]);

  const saveAsMemory = useCallback(
    async (input: SaveAsMemoryInput): Promise<MemoryEntry | undefined> => {
      const content = input.content.trim();
      if (!content) {
        snack.error('err.importInvalid');
        return undefined;
      }
      try {
        const res = await memoryRepo.create({
          content,
          tags: input.tags ?? [],
          sessionId: input.sessionId ?? currentSessionId,
          personaId: input.personaId ?? currentPersonaId,
          score: 0.8,
          sourceMessageIds: input.sourceMessageId ? [input.sourceMessageId] : undefined,
          timeRef: nowISO(),
        });
        if (!res.ok) throw res.error;

        // ★ 记忆变了 → 索引失效并重算独特性得分，否则下次检索还在用旧语料
        memoryRetriever.invalidate();
        void memoryRetriever.reindex(res.value).catch(() => undefined);

        snack.success('ok.memorySaved');
        log.info('memory', 'message saved as memory', { id: res.value.id }, 'FN-56');

        if (input.thenEdit) {
          setMemoryEditId(res.value.id);
          setMemoryOwner({
            sessionId: input.sessionId ?? currentSessionId,
            personaId: input.personaId ?? currentPersonaId,
          });
          setMemoryOpen(true);
        }
        return res.value;
      } catch (e) {
        const appErr = toAppError(e, 'DB_FAILED');
        snack.error('err.dbFailed');
        log.warn('memory', 'save message as memory failed', appErr, 'FN-56');
        return undefined;
      }
    },
    [currentPersonaId, currentSessionId, snack],
  );

  const host: ReactElement = createElement(
    Fragment,
    null,
    // 角色设定编辑器（欣然的文生图/立绘入口在里面被隐藏，XR-06）
    createElement(PersonaEditorPage, {
      open: personaOpen,
      personaId: personaId,
      onClose: () => setPersonaOpen(false),
      onSaved: () => {
        void reloadPersonas();
      },
    }),
    // 记忆编辑器：带 memoryId 直接定位，不带就是新增（归属信息从 memoryOwner 带进去）
    createElement<MemoryEditorPageProps>(MemoryEditorPage, {
      open: memoryOpen,
      memoryId: memoryEditId,
      sessionId: memoryOwner.sessionId,
      personaId: memoryOwner.personaId,
      onClose: () => setMemoryOpen(false),
      onSaved: () => {
        setMemoryOwner({});
      },
    }),
  );

  return { openPersona, openMemory, saveAsMemory, openMemoryList, host };
}

export default usePersonaMemoryEntry;

/** 记忆正文上限：太长的话检索时 BM25 会被废话稀释 */
const MEMORY_DRAFT_LIMIT = 500;

/** URL scheme 前缀：这些「xxx:」不是说话人，不能当前缀剥掉，否则链接会被削坏 */
const URL_SCHEME = /^(?:https?|ftp|file|mailto|tel|data|blob)$/i;

/**
 * 便捷：给一条消息生成默认记忆内容。
 *
 * 只做两件事：
 * 1. 剥掉行首的说话人前缀（「欣然：」「我：」），避免把说话人也记进记忆正文；
 *    ★ 但 URL scheme（`https:` / `mailto:`…）不算说话人，必须跳过——
 *      否则一条分享链接会被削成 `//example.com/...`。
 * 2. 截断到 500 字，超了补省略号，让人知道这条记忆是截过的。
 */
export function draftMemoryContent(raw: string): string {
  const text = (raw ?? '').trim();
  const match = /^([^:：\n]{1,12})[:：]\s*/.exec(text);
  const body = match && !URL_SCHEME.test(match[1]) ? text.slice(match[0].length).trim() : text;
  return body.length > MEMORY_DRAFT_LIMIT ? `${body.slice(0, MEMORY_DRAFT_LIMIT)}…` : body;
}

/** 生成一个新记忆 id（调用方需要在落库前先拿到 id 时用） */
export function newMemoryId(): UUID {
  return newId();
}
