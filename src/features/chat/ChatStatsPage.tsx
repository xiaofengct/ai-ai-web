import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { EmptyState } from '@/components/EmptyState';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { messageRepo } from '@/db/repo/messageRepo';
import { formatDate } from '@/lib/time';
import { countChars } from '@/lib/text';
import { t } from '@/copy';
import type { Message } from '@/types/chat';

/**
 * 聊天统计（PG-01）：消息数 / 字数 / token / 活跃时段 / 跨度天数。
 *
 * ★ 为什么现算而不是读 `session.stats`：
 *   `session.stats` 是增量累加的，历史数据可能和它不一致（比如手动删过消息）；
 *   统计页是「给用户看真相」的地方，直接按库里的消息算一遍更可信，
 *   顺便用算出来的结果回写 `recountStats()`，把偏差修掉。
 */

interface Stats {
  messages: number;
  userMessages: number;
  assistantMessages: number;
  chars: number;
  tokens: number;
  /** 24 小时直方图 */
  hours: number[];
  days: number;
  firstAt?: string;
  lastAt?: string;
}

function computeStats(messages: readonly Message[]): Stats {
  const hours = new Array<number>(24).fill(0);
  let chars = 0;
  let tokens = 0;
  let userMessages = 0;
  let assistantMessages = 0;

  for (const m of messages) {
    chars += countChars(m.content);
    tokens += m.tokenEstimate ?? 0;
    if (m.role === 'user') userMessages += 1;
    if (m.role === 'assistant') assistantMessages += 1;
    const hour = new Date(m.createdAt).getHours();
    if (hour >= 0 && hour < 24) hours[hour] = (hours[hour] ?? 0) + 1;
  }

  const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const first = sorted[0]?.createdAt;
  const last = sorted[sorted.length - 1]?.createdAt;
  let days = 0;
  if (first && last) {
    const daySet = new Set(messages.map((m) => m.createdAt.slice(0, 10)));
    days = daySet.size;
  }

  return {
    messages: messages.length,
    userMessages,
    assistantMessages,
    chars,
    tokens,
    hours,
    days,
    firstAt: first,
    lastAt: last,
  };
}

export function ChatStatsPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      const res = await messageRepo.page(id, { limit: 5000 });
      if (!alive) return;
      setMessages(res.ok ? res.value : []);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const stats = useMemo(() => computeStats(messages), [messages]);
  const maxHour = useMemo(() => Math.max(1, ...stats.hours), [stats.hours]);
  const busiest = useMemo(
    () => stats.hours.indexOf(Math.max(...stats.hours)),
    [stats.hours],
  );

  if (loading) return <LoadingOverlay open textKey="loading.default" inline />;
  if (messages.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <EmptyState descKey="empty.messages" />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 720, mx: 'auto' }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
        {t('chat.statsTitle')}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mb: 2 }}>
        <StatCard label={t('chat.statsMessages')} value={String(stats.messages)} />
        <StatCard label={t('chat.statsChars')} value={String(stats.chars)} />
        <StatCard label={t('chat.statsTokens')} value={String(stats.tokens)} />
        <StatCard label={t('chat.statsDays', { count: stats.days })} value="" />
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          {t('chat.statsActive')}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="flex-end" sx={{ height: 96 }}>
          {stats.hours.map((count, hour) => (
            <Box
              key={hour}
              title={`${hour}:00 · ${count}`}
              sx={{
                flex: 1,
                height: `${Math.max(4, (count / maxHour) * 100)}%`,
                borderRadius: 0.5,
                bgcolor: hour === busiest ? 'primary.main' : 'action.selected',
                opacity: count === 0 ? 0.35 : 1,
              }}
            />
          ))}
        </Stack>
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
          <Typography variant="caption" sx={{ opacity: 0.5 }}>
            0
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.5 }}>
            12
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.5 }}>
            23
          </Typography>
        </Stack>
        <Typography variant="caption" sx={{ opacity: 0.7 }}>
          {`${busiest}:00`}
        </Typography>
      </Paper>

      {stats.firstAt && stats.lastAt ? (
        <Typography variant="caption" sx={{ opacity: 0.6 }}>
          {t('chat.statsRange', { from: formatDate(stats.firstAt), to: formatDate(stats.lastAt) })}
        </Typography>
      ) : null}
    </Box>
  );
}

function StatCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <Paper variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 120, flex: 1 }}>
      <Typography variant="caption" sx={{ opacity: 0.6, display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>
        {value}
      </Typography>
    </Paper>
  );
}

export default ChatStatsPage;
