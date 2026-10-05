import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useChatStore } from '@/store/chatStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { MessageAttachment } from '@/types/chat';
import type { UUID } from '@/types/common';

/**
 * 发送动作的 UI 层封装（架构文档 §2 `src/features/chat/useChatSend.ts`）。
 *
 * 只管「输入框状态 + 回车/换行语义 + 调用 store」，**不含任何请求逻辑**
 * （请求在 `chatStore.sendMessage()` 里，保证从别处触发发送时行为一致）。
 *
 * ★ FN-22：回车发送 / Shift+Enter 换行。
 *   判定里特意加了 `isComposing` —— 中文输入法**候选词确认那一下也是回车**，
 *   不判这个会在用户选词时就把半截句子发出去，这是中文 IM 最容易踩的坑。
 */

export interface UseChatSendResult {
  text: string;
  setText: (value: string) => void;
  attachments: MessageAttachment[];
  addAttachments: (items: readonly MessageAttachment[]) => void;
  removeAttachment: (id: UUID) => void;
  canSend: boolean;
  sending: boolean;
  send: () => Promise<void>;
  stop: () => void;
  /** 返回 true 表示按键已被处理（组件里就别再默认换行了） */
  onKeyDown: (event: KeyboardEvent<HTMLDivElement | HTMLTextAreaElement>) => boolean;
}

export function useChatSend(sessionId: string | undefined): UseChatSendResult {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);

  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stop);
  const sending = useChatStore((s) => s.sending);
  const sessionOverride = useChatStore((s) => s.session?.settingsOverride);

  const enterToSend = useSettingsStore((s) =>
    s.effectiveChat(sessionOverride).enterToSend,
  );

  // ★ 用 ref 读最新值：事件回调里闭包拿到的是旧值，会导致「回车发送了上一版文本」
  const textRef = useRef(text);
  textRef.current = text;
  const attachmentRef = useRef(attachments);
  attachmentRef.current = attachments;
  const enterToSendRef = useRef(enterToSend);
  enterToSendRef.current = enterToSend;

  const send = useCallback(async () => {
    if (!sessionId) return;
    const value = textRef.current.trim();
    if (!value && attachmentRef.current.length === 0) return;
    if (useChatStore.getState().sending) return;

    const payload = { text: value, attachments: [...attachmentRef.current] };
    setText('');
    setAttachments([]);
    await sendMessage(sessionId, payload);
  }, [sessionId, sendMessage]);

  const stop = useCallback(() => {
    stopStreaming();
  }, [stopStreaming]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement | HTMLTextAreaElement>): boolean => {
      if (event.key !== 'Enter') return false;

      // 输入法候选词确认中 → 交给输入法，不发送
      const native = event.nativeEvent as unknown as { isComposing?: boolean };
      if (native.isComposing) return false;

      const wantsSend = enterToSendRef.current ? !event.shiftKey : event.shiftKey;
      if (!wantsSend) return false;

      event.preventDefault();
      void send();
      return true;
    },
    [send],
  );

  const addAttachments = useCallback((items: readonly MessageAttachment[]) => {
    setAttachments((prev) => [...prev, ...items]);
  }, []);

  const removeAttachment = useCallback((id: UUID) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // 换会话时清空草稿（草稿不跨会话，避免把上一句带到新会话里）
  useEffect(() => {
    setText('');
    setAttachments([]);
  }, [sessionId]);

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !sending;

  return {
    text,
    setText,
    attachments,
    addAttachments,
    removeAttachment,
    canSend,
    sending,
    send,
    stop,
    onKeyDown,
  };
}

export default useChatSend;
