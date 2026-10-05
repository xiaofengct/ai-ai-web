import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import BarChartIcon from '@mui/icons-material/BarChart';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import SearchIcon from '@mui/icons-material/Search';
import SettingsIcon from '@mui/icons-material/Settings';
import TuneIcon from '@mui/icons-material/Tune';
import { useLiveSession } from '@/hooks/useLiveSession';
import { usePersonaMemoryEntry, draftMemoryContent } from '@/features/persona/usePersonaMemoryEntry';
import { useChatStore } from '@/store/chatStore';
import { useSettingsStore } from '@/store/settingsStore';
import { MessageList } from './MessageList';
import { Composer, SelectionBar } from './Composer';
import { MessageActions } from './MessageActions';
import { ForwardDialog } from './ForwardDialog';
import { useChatSend } from './useChatSend';
import { PatRipple } from './PatRipple';
import { TypingIndicator } from './TypingIndicator';
import { to } from '@/router/paths';
import { t } from '@/copy';
import type { Message } from '@/types/chat';
import type { UUID } from '@/types/common';

/**
 * 主聊天页（PG-16）。
 *
 * 组成：会话工具条 + 消息流 + 输入区 + 三个浮层（操作菜单 / 转发 / 拍一拍涟漪）。
 *
 * ★ 状态归属：消息数据一律从 `chatStore` 读，**不在页面里缓存一份**——
 *   否则主动消息到达（proactive 层直接写 store）时页面会看不到。
 *
 * ★ 主动消息在这里只做「渲染」：生成与投递都在 `useLiveSession` 里订阅
 *   `proactiveEvents` 完成（调度逻辑由 `src/proactive/*` 负责，本页不碰）。
 */

export interface ChatPageProps {
  /** 预留：从别处内嵌聊天时可直接传 sessionId */
  sessionId?: string;
}

export function ChatPage(props: ChatPageProps): JSX.Element {
  const params = useParams<{ id: string }>();
  const sessionId = props.sessionId ?? params.id;
  const navigate = useNavigate();
  const location = useLocation();

  const live = useLiveSession(sessionId);
  // ★ 人设 / 记忆的就地入口（T10 的 hook）：host 必须在 JSX 末尾渲染一次，否则弹窗不挂载
  const personaMemory = usePersonaMemoryEntry();

  const summarizing = useChatStore((s) => s.summarizing);
  const multiSelect = useChatStore((s) => s.multiSelect);
  const selectedIds = useChatStore((s) => s.selectedIds);
  const setMultiSelect = useChatStore((s) => s.setMultiSelect);
  const toggleSelected = useChatStore((s) => s.toggleSelected);
  const clearSelection = useChatStore((s) => s.clearSelection);
  const deleteSelected = useChatStore((s) => s.deleteSelected);
  const mergeSelected = useChatStore((s) => s.mergeSelected);
  const loadMore = useChatStore((s) => s.loadMore);
  const loadingMore = useChatStore((s) => s.loadingMore);
  const hasMore = useChatStore((s) => s.hasMore);

  const settings = useSettingsStore((s) => s.effectiveChat(live.session?.settingsOverride));

  const [menuTarget, setMenuTarget] = useState<{ id: UUID; anchor: HTMLElement } | undefined>(undefined);
  const [forwardTarget, setForwardTarget] = useState<Message | undefined>(undefined);
  const [patToken, setPatToken] = useState(0);

  // 从搜索结果跳转过来：location.state.highlight 指定要高亮的消息
  const highlightedId = (location.state as { highlight?: UUID } | null)?.highlight;

  // 离开页面时退出多选，避免把选中态带到别的会话
  useEffect(() => {
    return () => {
      useChatStore.getState().clearSelection();
    };
  }, [sessionId]);

  const openActions = (id: UUID): void => {
    // 多选模式下点击 = 勾选，不弹菜单
    if (useChatStore.getState().multiSelect) {
      toggleSelected(id);
      return;
    }
    const el = document.getElementById(`msg-anchor-${id}`) ?? document.body;
    setMenuTarget({ id, anchor: el });
  };

  const menuMessage = menuTarget
    ? live.messages.find((m) => m.id === menuTarget.id)
    : undefined;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* —— 工具条 —— */}
      <Stack
        direction="row"
        spacing={0.25}
        alignItems="center"
        sx={{ px: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
            {live.persona?.data.name ?? t('chat.title')}
          </Typography>
          <Typography variant="caption" noWrap sx={{ opacity: 0.55 }}>
            {live.session?.title ?? ''}
          </Typography>
        </Box>

        <Tooltip title={t('chat.searchInChat')}>
          <IconButton size="small" onClick={() => sessionId && navigate(to.chatSearch(sessionId))}>
            <SearchIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('chat.stats')}>
          <IconButton size="small" onClick={() => sessionId && navigate(to.chatStats(sessionId))}>
            <BarChartIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('chat.context')}>
          <IconButton size="small" onClick={() => sessionId && navigate(to.chatContext(sessionId))}>
            <TuneIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('chat.settings')}>
          <IconButton size="small" onClick={() => sessionId && navigate(to.chatSettings(sessionId))}>
            <SettingsIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={multiSelect ? t('chat.exitSelect') : t('chat.select')}>
          <IconButton
            size="small"
            color={multiSelect ? 'primary' : 'default'}
            onClick={() => {
              setMultiSelect(!multiSelect);
              if (multiSelect) clearSelection();
            }}
          >
            <CheckBoxIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* —— 消息流 —— */}
      <MessageList
        messages={live.messages}
        streamingId={live.streamingId}
        streamingText={live.streamingText}
        markdown={settings.enableMarkdown}
        selectable={multiSelect}
        selectedIds={selectedIds}
        highlightedId={highlightedId}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={() => void loadMore()}
        onOpenActions={openActions}
        onToggleSelect={toggleSelected}
        showTyping={settings.typingIndicator}
      />

      {summarizing ? <TypingIndicator variant="summarizing" dense /> : null}

      {/* —— 多选操作条 / 输入区 —— */}
      {multiSelect ? (
        <SelectionBar
          count={selectedIds.length}
          onDelete={() => void deleteSelected()}
          onMerge={() => void mergeSelected()}
          onExit={() => {
            setMultiSelect(false);
            clearSelection();
          }}
        />
      ) : (
        <ChatComposerHost
          sessionId={sessionId}
          onPatted={() => setPatToken((n) => n + 1)}
        />
      )}

      {/* —— 浮层 —— */}
      <Box sx={{ position: 'relative' }}>
        <PatRipple token={patToken} />
      </Box>

      {menuTarget && menuMessage ? (
        <MessageActions
          message={menuMessage}
          anchorEl={menuTarget.anchor}
          open
          onClose={() => setMenuTarget(undefined)}
          onRequestForward={(m) => {
            setMenuTarget(undefined);
            setForwardTarget(m);
          }}
          onSaveAsMemory={(m) => {
            // ★ 去掉「欣然：」这类说话人前缀，别把前缀也记进记忆正文
            void personaMemory.saveAsMemory({
              content: draftMemoryContent(m.content),
              sourceMessageId: m.id,
              thenEdit: true,
            });
          }}
        />
      ) : null}

      {forwardTarget ? (
        <ForwardDialog
          open
          onClose={() => setForwardTarget(undefined)}
          messageIds={[forwardTarget.id]}
          currentSessionId={sessionId}
        />
      ) : null}

      {/* 人设 / 记忆编辑弹窗（由 usePersonaMemoryEntry 提供，必须渲染一次） */}
      {personaMemory.host}
    </Box>
  );
}

/**
 * 输入区宿主：单独抽一层是为了让 `useChatSend` 的订阅范围收窄——
 * 输入框每敲一个字都会 re-render，如果放在 ChatPage 里会连消息流一起重渲染。
 */
function ChatComposerHost({
  sessionId,
  onPatted,
}: {
  sessionId?: string;
  /** 拍一拍已落库 → 通知外层播放涟漪 */
  onPatted: () => void;
}): JSX.Element {
  const chat = useChatSend(sessionId);
  const pat = useChatStore((s) => s.pat);
  const mergeSelected = useChatStore((s) => s.mergeSelected);
  const setMultiSelect = useChatStore((s) => s.setMultiSelect);

  return (
    <Composer
      value={chat.text}
      onChange={chat.setText}
      onSend={() => void chat.send()}
      onStop={chat.stop}
      onKeyDown={chat.onKeyDown}
      sending={chat.sending}
      canSend={chat.canSend}
      attachments={chat.attachments}
      onAddAttachments={chat.addAttachments}
      onRemoveAttachment={chat.removeAttachment}
      onPat={() => {
        setMultiSelect(false);
        void pat().then(onPatted);
      }}
      onMerge={() => {
        setMultiSelect(true);
        void mergeSelected();
      }}
    />
  );
}

export default ChatPage;
