import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { EmptyState } from '@/components/EmptyState';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { MessageBubble } from './MessageBubble';
import { messageRepo } from '@/db/repo/messageRepo';
import { sessionRepo } from '@/db/repo/sessionRepo';
import { formatClock, formatDate } from '@/lib/time';
import { to } from '@/router/paths';
import { t } from '@/copy';
import type { ChatSession, Message } from '@/types/chat';

/**
 * 转发溯源详情（PG-02，`/forward/:id`）。
 *
 * ★ 一条消息可能有两种「来路」，这里都还原：
 * 1. `forwardedFrom` —— 单条转发，指向**原始会话 + 原始消息**；
 * 2. `mergedFrom`    —— 合并转发，指回**被并起来的那几条**（FN-63）。
 *
 * 两种都保留「跳回原处」的入口：跳过去时用 `state.highlight`，
 * 让用户落地就看到是哪一句（见 `ChatSearchPage` 的注释）。
 *
 * ★ 溯源是只读视图：这里不做任何删除 / 编辑，
 *   避免「在详情页误删，原会话里的消息也没了」这种连锁反应。
 */

export function ForwardedDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [self, setSelf] = useState<Message | undefined>(undefined);
  const [origin, setOrigin] = useState<Message | undefined>(undefined);
  const [originSession, setOriginSession] = useState<ChatSession | undefined>(undefined);
  const [merged, setMerged] = useState<Message[]>([]);
  const [targets, setTargets] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);

    void (async () => {
      const selfRes = await messageRepo.get(id);
      if (!alive) return;
      const current = selfRes.ok ? selfRes.value : undefined;
      setSelf(current);
      if (!current) {
        setLoading(false);
        return;
      }

      /* —— 单条转发：还原原始消息与它所在的会话 —— */
      if (current.forwardedFrom) {
        const [originRes, sessionRes] = await Promise.all([
          messageRepo.get(current.forwardedFrom.messageId),
          sessionRepo.get(current.forwardedFrom.sessionId),
        ]);
        if (!alive) return;
        if (originRes.ok) setOrigin(originRes.value);
        if (sessionRes.ok) setOriginSession(sessionRes.value);
      }

      /* —— 合并转发：把被并起来的几条全取出来 —— */
      if (current.mergedFrom && current.mergedFrom.length > 0) {
        const res = await messageRepo.getMany(current.mergedFrom);
        if (!alive) return;
        if (res.ok) {
          setMerged([...res.value].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
        }
      }

      /* —— 去向：这条还被转给了哪些会话 —— */
      const toIds = current.forwardedTo ?? [];
      if (toIds.length > 0) {
        const loaded: ChatSession[] = [];
        for (const sessionId of toIds) {
          const res = await sessionRepo.get(sessionId);
          if (!alive) return;
          if (res.ok && res.value) loaded.push(res.value);
        }
        setTargets(loaded);
      }

      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) return <LoadingOverlay open textKey="loading.default" inline />;

  if (!self) {
    return (
      <Box sx={{ p: 3 }}>
        <EmptyState descKey="empty.messages" />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 720, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
          {t('chat.forwardFrom')}
        </Typography>
        <Button size="small" variant="text" onClick={() => navigate(-1)}>
          {t('common.back')}
        </Button>
      </Stack>

      {/* —— 当前这条消息 —— */}
      <Paper variant="outlined" sx={{ p: 1, mb: 2 }}>
        <MessageBubble message={self} markdown />
      </Paper>

      {/* —— 原始出处 —— */}
      {origin || originSession ? (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75, opacity: 0.8 }}>
            {t('chat.originSession')}
          </Typography>
          <Paper variant="outlined" sx={{ p: 1.25 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              {originSession?.title ?? ''}
            </Typography>
            {origin ? (
              <>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {origin.content}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.55 }}>
                  {`${formatDate(origin.createdAt)} ${formatClock(origin.createdAt)}`}
                </Typography>
              </>
            ) : null}
            {originSession ? (
              <Stack direction="row" sx={{ mt: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() =>
                    navigate(to.chat(originSession.id), {
                      state: { highlight: origin?.id ?? self.id },
                    })
                  }
                >
                  {t('chat.jump')}
                </Button>
              </Stack>
            ) : null}
          </Paper>
        </Box>
      ) : null}

      {/* —— 合并转发的原始条目 —— */}
      {merged.length > 0 ? (
        <Box sx={{ mb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, opacity: 0.8 }}>
              {t('chat.mergedCount', { count: merged.length })}
            </Typography>
          </Stack>
          <Paper variant="outlined" sx={{ p: 1 }}>
            {merged.map((m) => (
              <Box key={m.id}>
                <MessageBubble message={m} markdown />
                <Divider />
              </Box>
            ))}
          </Paper>
        </Box>
      ) : null}

      {/* —— 去向 —— */}
      {targets.length > 0 ? (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75, opacity: 0.8 }}>
            {t('chat.targetSessions')}
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
            {targets.map((s) => (
              <Chip
                key={s.id}
                size="small"
                label={s.title}
                clickable
                onClick={() => navigate(to.chat(s.id))}
              />
            ))}
          </Stack>
        </Box>
      ) : null}

      <Typography variant="caption" sx={{ opacity: 0.55 }}>
        {t('chat.forwardedCount', { count: self.forwardedTo?.length ?? 0 })}
      </Typography>
    </Box>
  );
}

export default ForwardedDetailPage;
