import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import BackHandIcon from '@mui/icons-material/BackHand';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import CallMergeIcon from '@mui/icons-material/CallMerge';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import ForwardIcon from '@mui/icons-material/Forward';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useNavigate } from 'react-router-dom';
import { copyText } from '@/lib/download';
import { useSnack } from '@/hooks/useSnack';
import { useChatStore } from '@/store/chatStore';
import { to } from '@/router/paths';
import { t } from '@/copy';
import type { Message } from '@/types/chat';

/**
 * 消息长按 / 点击后的操作菜单（FN-27 拍一拍 / FN-32 收藏 / FN-63 转发与合并）。
 *
 * ★ 「复制」用的是 `lib/download.copyText()` 的剪贴板封装（带 execCommand 兜底），
 *   而不是直接用 `navigator.clipboard` —— 后者在非 HTTPS / 无权限时会静默失败。
 */

export interface MessageActionsProps {
  message: Message;
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  /** 需要选目标会话时回调（由 ChatPage 打开 ForwardDialog） */
  onRequestForward?: (message: Message) => void;
  /**
   * 把这条消息存成记忆（由 ChatPage 接 `usePersonaMemoryEntry`）。
   * ★ 为什么是回调而不是在这里直接写库：落库后的 reindex、toast、编辑器挂载
   *   都由那个 hook 统一负责，这里只负责「用户点了这一项」。
   */
  onSaveAsMemory?: (message: Message) => void;
}

export function MessageActions({
  message,
  anchorEl,
  open,
  onClose,
  onRequestForward,
  onSaveAsMemory,
}: MessageActionsProps): JSX.Element {
  const snack = useSnack();
  const toggleFavorite = useChatStore((s) => s.toggleFavorite);
  const removeMessage = useChatStore((s) => s.removeMessage);
  const regenerate = useChatStore((s) => s.regenerate);
  const pat = useChatStore((s) => s.pat);
  const mergeSelected = useChatStore((s) => s.mergeSelected);
  const setMultiSelect = useChatStore((s) => s.setMultiSelect);
  const toggleSelected = useChatStore((s) => s.toggleSelected);
  const navigate = useNavigate();

  const close = (fn?: () => void): void => {
    onClose();
    fn?.();
  };

  return (
    <Menu anchorEl={anchorEl} open={open} onClose={onClose} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
      <MenuItem
        onClick={() =>
          close(() => {
            void copyText(message.content).then((done) => {
              snack.show(done ? 'common.copied' : 'err.unknown');
            });
          })
        }
      >
        <ListItemIcon>
          <ContentCopyIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary={t('chat.copy')} />
      </MenuItem>

      <MenuItem
        onClick={() =>
          close(() => {
            void toggleFavorite(message.id);
          })
        }
      >
        <ListItemIcon>
          {message.favorite ? (
            <FavoriteIcon fontSize="small" color="primary" />
          ) : (
            <FavoriteBorderIcon fontSize="small" />
          )}
        </ListItemIcon>
        <ListItemText primary={t(message.favorite ? 'chat.unfavorite' : 'chat.favorite')} />
      </MenuItem>

      {message.role === 'assistant' ? (
        <MenuItem
          onClick={() =>
            close(() => {
              void regenerate(message.id);
            })
          }
        >
          <ListItemIcon>
            <RefreshIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('chat.regenerate')} />
        </MenuItem>
      ) : null}

      {/* 全屏文本（PG-22）：长回复在气泡里挤成一条，放大了才好读 */}
      <MenuItem
        onClick={() =>
          close(() => {
            navigate(to.text(message.id));
          })
        }
      >
        <ListItemIcon>
          <OpenInFullIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary={t('chat.textTitle')} />
      </MenuItem>

      <MenuItem
        onClick={() =>
          close(() => {
            onRequestForward?.(message);
          })
        }
      >
        <ListItemIcon>
          <ForwardIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary={t('chat.forward')} />
      </MenuItem>

      {/* 合并转发：把这条作为「合并」的起点（多选里也能用） */}
      <MenuItem
        onClick={() =>
          close(() => {
            setMultiSelect(true);
            toggleSelected(message.id);
            void mergeSelected();
          })
        }
      >
        <ListItemIcon>
          <CallMergeIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary={t('chat.merge')} />
      </MenuItem>

      <MenuItem
        onClick={() =>
          close(() => {
            void pat(message.id);
          })
        }
      >
        <ListItemIcon>
          <BackHandIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary={t('chat.pat')} />
      </MenuItem>

      {/* 存成记忆（FN-56）：把这一句直接沉淀进记忆库，存完打开编辑器让你补标签 */}
      <MenuItem
        onClick={() =>
          close(() => {
            onSaveAsMemory?.(message);
          })
        }
      >
        <ListItemIcon>
          <BookmarkAddIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary={t('chat.saveAsMemory')} />
      </MenuItem>

      <MenuItem
        onClick={() =>
          close(() => {
            void removeMessage(message.id);
          })
        }
      >
        <ListItemIcon>
          <DeleteOutlineIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText primary={t('common.delete')} />
      </MenuItem>
    </Menu>
  );
}

/** 气泡右下角的快捷收藏按钮（多选模式下隐藏） */
export function QuickFavoriteButton({ message }: { message: Message }): JSX.Element {
  const toggleFavorite = useChatStore((s) => s.toggleFavorite);
  return (
    <IconButton
      size="small"
      onClick={(e) => {
        e.stopPropagation();
        void toggleFavorite(message.id);
      }}
      aria-label={t(message.favorite ? 'chat.unfavorite' : 'chat.favorite')}
    >
      {message.favorite ? (
        <FavoriteIcon fontSize="small" color="primary" />
      ) : (
        <FavoriteBorderIcon fontSize="small" />
      )}
    </IconButton>
  );
}

export default MessageActions;
