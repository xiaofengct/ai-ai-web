import { useState } from 'react';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { formatRelative } from '@/lib/time';
import { t } from '@/copy';
import type { ChatSession } from '@/types/chat';

/**
 * 会话卡片（PG-14 首页列表项）。
 *
 * - 展示：标题、最后一条预览、相对时间、角色名、消息数；
 * - 操作：点击进聊天；右上角菜单提供「打开 / 删掉」（文案一律走 copy 表）；
 * - 触控目标 ≥44px（决策 A8）。
 */
export interface SessionCardProps {
  session: ChatSession;
  /** 角色名（由上层传入，避免每张卡片各自查库） */
  personaLabel?: string;
  dense?: boolean;
  onOpen: (session: ChatSession) => void;
  /** 归档（PG-14 要求的入口之一） */
  onArchive: (session: ChatSession) => void;
  onDelete: (session: ChatSession) => void;
}

export function SessionCard({
  session,
  personaLabel,
  dense = false,
  onOpen,
  onArchive,
  onDelete,
}: SessionCardProps): JSX.Element {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      {/*
        ★ `component="div"`：CardActionArea 默认是 `<button>`，而右上角「更多」是
        IconButton（也是 `<button>`）——`<button>` 套 `<button>` 是非法 DOM 嵌套，
        React 会报 validateDOMNesting，读屏与键盘焦点也会错乱。
        改成 div 后 MUI ButtonBase 会自动补 `role="button"` + `tabIndex=0`，
        并继续接管回车/空格触发点击，可访问性不掉。
      */}
      <CardActionArea component="div" onClick={() => onOpen(session)} sx={{ px: 1.5, py: dense ? 1 : 1.5 }}>
        <Stack spacing={0.5}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}
              noWrap
            >
              {session.title}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.6, whiteSpace: 'nowrap' }}>
              {formatRelative(session.updatedAt)}
            </Typography>
            <IconButton
              size="small"
              aria-label={t('common.more')}
              sx={{ width: 44, height: 44, ml: -1 }}
              onClick={(e) => {
                // ★ 阻止冒泡：不让菜单点击穿透到卡片的「打开会话」
                e.stopPropagation();
                e.preventDefault();
                setAnchorEl(e.currentTarget);
              }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Stack>

          <Typography
            variant="body2"
            sx={{
              opacity: 0.72,
              display: '-webkit-box',
              WebkitLineClamp: dense ? 1 : 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              minHeight: dense ? 0 : 40,
            }}
          >
            {session.lastMessagePreview ?? t('empty.messages')}
          </Typography>

          <Stack direction="row" spacing={1} alignItems="center">
            {personaLabel ? <Chip size="small" label={personaLabel} variant="outlined" /> : null}
            <Chip
              size="small"
              variant="outlined"
              label={`${session.stats?.messageCount ?? 0}`}
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            />
            {session.archived ? (
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                {t('common.disabled')}
              </Typography>
            ) : null}
          </Stack>
        </Stack>
      </CardActionArea>

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem
          sx={{ minHeight: 44 }}
          onClick={() => {
            setAnchorEl(null);
            onOpen(session);
          }}
        >
          {t('common.open')}
        </MenuItem>
        <MenuItem
          sx={{ minHeight: 44 }}
          onClick={() => {
            setAnchorEl(null);
            onArchive(session);
          }}
        >
          {t('action.archive')}
        </MenuItem>
        <MenuItem
          sx={{ minHeight: 44 }}
          onClick={() => {
            setAnchorEl(null);
            onDelete(session);
          }}
        >
          {t('common.delete')}
        </MenuItem>
      </Menu>
    </Card>
  );
}

export default SessionCard;
