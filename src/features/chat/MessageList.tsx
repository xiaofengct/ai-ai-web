import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { EmptyState } from '@/components/EmptyState';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { t, type CopyKey } from '@/copy';
import type { Message } from '@/types/chat';
import type { UUID } from '@/types/common';

/**
 * 消息流（架构文档 §2 `src/features/chat/MessageList.tsx`）。
 *
 * ★ 为什么不用 `VirtualList`：
 *   聊天列表是**底部锚定**的——新消息/流式增量要自动贴底，
 *   而虚拟列表的行高是估算的，贴底会在「行高突变」（图片、长 Markdown）时抖动。
 *   单会话一次只加载 `loadRange`（默认 30）条，量级不足以需要虚拟化；
 *   真正的海量场景由 `loadMore` 分段上翻解决。
 *
 * ★ 上翻加载：滚动到顶部 40px 内触发 `onLoadMore`，
 *   并在数据插入后**保持原来的滚动位置**（否则会跳到顶，用户会以为列表崩了）。
 */

export interface MessageListProps {
  messages: readonly Message[];
  streamingId?: UUID;
  streamingText: string;
  markdown: boolean;
  selectable: boolean;
  selectedIds: readonly UUID[];
  /** 从搜索结果跳转过来的高亮目标 */
  highlightedId?: UUID;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpenActions: (id: UUID) => void;
  onToggleSelect: (id: UUID) => void;
  emptyKey?: CopyKey;
  /** 是否显示「她在打字」（typingIndicator 设置项） */
  showTyping?: boolean;
}

const NEAR_BOTTOM_PX = 120;
const LOAD_MORE_PX = 40;

export function MessageList({
  messages,
  streamingId,
  streamingText,
  markdown,
  selectable,
  selectedIds,
  highlightedId,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpenActions,
  onToggleSelect,
  emptyKey = 'empty.messages',
  showTyping = true,
}: MessageListProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const anchorRef = useRef<{ height: number; top: number } | undefined>(undefined);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distanceToBottom <= NEAR_BOTTOM_PX;
    if (el.scrollTop <= LOAD_MORE_PX && hasMore && !loadingMore) {
      // 记录锚点：插入历史消息后按高度差恢复位置
      anchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore]);

  // 新消息 / 流式增量 → 贴底（仅在用户本来就贴底时）
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, streamingText]);

  // 上翻加载后恢复位置
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    const delta = el.scrollHeight - anchor.height;
    if (delta > 0) el.scrollTop = anchor.top + delta;
    anchorRef.current = undefined;
  }, [messages.length]);

  // 首次进入直接贴底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  if (messages.length === 0) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState descKey={emptyKey} />
      </Box>
    );
  }

  return (
    <Box
      ref={scrollRef}
      onScroll={handleScroll}
      sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', py: 1 }}
    >
      {hasMore ? (
        <Stack alignItems="center" sx={{ py: 1 }}>
          {loadingMore ? (
            <CircularProgress size={16} />
          ) : (
            <Typography
              variant="caption"
              sx={{ opacity: 0.5, cursor: 'pointer' }}
              onClick={onLoadMore}
            >
              {t('common.prev')}
            </Typography>
          )}
        </Stack>
      ) : (
        <Stack alignItems="center" sx={{ py: 1 }}>
          <Typography variant="caption" sx={{ opacity: 0.35 }}>
            {t('chat.noMore')}
          </Typography>
        </Stack>
      )}

      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          isStreaming={message.id === streamingId}
          streamingText={message.id === streamingId ? streamingText : undefined}
          markdown={markdown}
          selectable={selectable}
          selected={selectedIds.includes(message.id)}
          highlighted={message.id === highlightedId}
          onToggleSelect={onToggleSelect}
          onOpenActions={onOpenActions}
        />
      ))}

      {showTyping && streamingId && !streamingText ? <TypingIndicator variant="streaming" dense /> : null}
      {showTyping && !streamingId ? null : null}
    </Box>
  );
}

export default MessageList;
