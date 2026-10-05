import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import FavoriteIcon from '@mui/icons-material/Favorite';
import { EmptyState } from '@/components/EmptyState';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { MessageBubble } from '@/features/chat/MessageBubble';
import { messageRepo } from '@/db/repo/messageRepo';
import { sessionRepo } from '@/db/repo/sessionRepo';
import { useSnack } from '@/hooks/useSnack';
import { formatClock, formatDate } from '@/lib/time';
import { to } from '@/router/paths';
import { t } from '@/copy';
import type { ChatSession, Message } from '@/types/chat';

/**
 * 收藏夹（PG-08 / FN-32）。
 *
 * ★ 为什么按会话分组：
 *   同一句话脱离上下文会变得很难懂（「我也是」——什么也是？）。
 *   分组 + 「跳到那里」能让用户**回到当时的对话里**再看一遍，
 *   这比单纯堆一个收藏列表有用得多。
 *
 * ★ 取消收藏后立刻从列表移除：收藏夹是「结果视图」，
 *   留着一条已经不收藏的记录只会让人以为按钮坏了。
 */

export function FavoritesPage(): JSX.Element {
  const navigate = useNavigate();

  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [favRes, sessionRes] = await Promise.all([
      messageRepo.listFavorites(),
      sessionRepo.listRecent({ includeArchived: true }),
    ]);
    setMessages(favRes.ok ? favRes.value : []);
    setSessions(sessionRes.ok ? sessionRes.value : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const titleOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sessions) map.set(s.id, s.title);
    return map;
  }, [sessions]);

  /** 按会话分组（保持收藏时间倒序） */
  const groups = useMemo(() => {
    const map = new Map<string, Message[]>();
    for (const m of messages) {
      const list = map.get(m.sessionId);
      if (list) list.push(m);
      else map.set(m.sessionId, [m]);
    }
    return [...map.entries()];
  }, [messages]);

  if (loading) return <LoadingOverlay open textKey="loading.default" inline />;

  if (messages.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <EmptyState descKey="empty.favorites" />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 760, mx: 'auto', pb: 6 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
        {t('chat.favTitle')}
      </Typography>

      <Stack spacing={2}>
        {groups.map(([sessionId, list]) => (
          <Paper key={sessionId} variant="outlined" sx={{ p: 1.25 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap>
                {titleOf.get(sessionId) ?? ''}
              </Typography>
              <Button
                size="small"
                variant="text"
                onClick={() => navigate(to.chat(sessionId))}
              >
                {t('chat.jump')}
              </Button>
            </Stack>

            <Divider sx={{ mb: 0.5 }} />

            {list.map((m) => (
              <Box key={m.id}>
                <MessageBubble
                  message={m}
                  markdown
                  onOpenActions={(id) => navigate(to.text(id))}
                />
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 1.5 }}>
                  <Typography variant="caption" sx={{ opacity: 0.55, flex: 1 }}>
                    {`${formatDate(m.createdAt)} ${formatClock(m.createdAt)}`}
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() =>
                      navigate(to.chat(m.sessionId), { state: { highlight: m.id } })
                    }
                  >
                    {t('chat.jump')}
                  </Button>
                  <UnfavoriteButton messageId={m.id} onDone={() => void load()} />
                </Stack>
              </Box>
            ))}
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}

/**
 * 取消收藏按钮。
 * ★ 为什么不用 `MessageActions.QuickFavoriteButton`：那个按钮写的是 `chatStore` 的消息数组，
 *   而收藏夹**不在那个会话里**——写进 store 不会反映到本页列表。
 *   这里直接写库再重载，保证「取消后立刻消失」。
 */
function UnfavoriteButton({
  messageId,
  onDone,
}: {
  messageId: string;
  onDone: () => void;
}): JSX.Element {
  const snack = useSnack();
  return (
    <Tooltip title={t('chat.unfavorite')}>
      <IconButton
        size="small"
        aria-label={t('chat.unfavorite')}
        onClick={async () => {
          const res = await messageRepo.setFavorite(messageId, false);
          if (!res.ok) {
            snack.error('err.dbFailed');
            return;
          }
          snack.success('ok.unfavorited');
          onDone();
        }}
      >
        <FavoriteIcon fontSize="small" color="primary" />
      </IconButton>
    </Tooltip>
  );
}

export default FavoritesPage;
