import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { EmptyState } from '@/components/EmptyState';
import { SessionCard } from './SessionCard';
import { t } from '@/copy';
import type { ChatSession } from '@/types/chat';

/**
 * 会话列表（PG-14）。
 * 默认 200 条上限（见 `sessionRepo.listRecent`），不做虚拟滚动——
 * 超出这个量级时应该用首页搜索而不是硬滚动。
 */
export interface SessionListProps {
  sessions: readonly ChatSession[];
  loading: boolean;
  dense?: boolean;
  /** 角色名查询（由上层提供，避免列表里重复查库） */
  personaNameOf: (personaId: string) => string;
  onOpen: (session: ChatSession) => void;
  onArchive: (session: ChatSession) => void;
  onDelete: (session: ChatSession) => void;
  onNew: () => void;
}

export function SessionList({
  sessions,
  loading,
  dense = false,
  personaNameOf,
  onOpen,
  onArchive,
  onDelete,
  onNew,
}: SessionListProps): JSX.Element {
  if (loading) {
    return (
      <Box sx={{ py: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
        <CircularProgress size={24} />
        <Typography variant="caption" sx={{ opacity: 0.6 }}>
          {t('loading.default')}
        </Typography>
      </Box>
    );
  }

  if (sessions.length === 0) {
    return <EmptyState descKey="empty.sessions" actionKey="action.newSession" onAction={onNew} />;
  }

  return (
    <Stack spacing={dense ? 1 : 1.5}>
      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          personaLabel={personaNameOf(session.personaId)}
          dense={dense}
          onOpen={onOpen}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      ))}
    </Stack>
  );
}

export default SessionList;
