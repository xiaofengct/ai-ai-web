import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { sessionRepo } from '@/db/repo/sessionRepo';
import { useChatStore } from '@/store/chatStore';
import { t } from '@/copy';
import type { ChatSession } from '@/types/chat';
import type { UUID } from '@/types/common';

/**
 * 转发目标选择（FN-63 / PG-02）。
 *
 * ★ 为什么先把目标写进 `selectedIds` 再调 `forwardSelected`：
 *   转发是「多选」语义下的批量动作，store 只暴露了一个入口，
 *   这里复用它而不是再造一个单条转发的分支——**两条路径的行为必须一致**
 *   （都会写 `forwardedFrom` / `forwardedTo`，详情页才能溯源）。
 */

export interface ForwardDialogProps {
  open: boolean;
  onClose: () => void;
  /** 要转发的消息 id */
  messageIds: readonly UUID[];
  /** 当前会话（不允许转发给自己） */
  currentSessionId?: UUID;
}

export function ForwardDialog({
  open,
  onClose,
  messageIds,
  currentSessionId,
}: ForwardDialogProps): JSX.Element {
  const forwardSelected = useChatStore((s) => s.forwardSelected);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [picked, setPicked] = useState<UUID[]>([]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const res = await sessionRepo.listRecent({ limit: 100 });
      if (!alive) return;
      setSessions(res.ok ? res.value : []);
      setPicked([]);
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  const targets = sessions.filter((s) => s.id !== currentSessionId);

  const toggle = (id: UUID): void => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const confirm = (): void => {
    if (picked.length === 0) return;
    // 复用多选入口，保证单条与多条转发走同一条链路
    useChatStore.setState({ selectedIds: [...messageIds] });
    void forwardSelected(picked);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('chat.forward')}</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {targets.length === 0 ? (
          <Typography variant="body2" sx={{ p: 2, opacity: 0.6 }}>
            {t('empty.sessions')}
          </Typography>
        ) : (
          <List dense>
            {targets.map((session) => {
              const checked = picked.includes(session.id);
              return (
                <ListItemButton key={session.id} onClick={() => toggle(session.id)}>
                  <ListItemIcon>
                    <Checkbox edge="start" checked={checked} disableRipple />
                  </ListItemIcon>
                  <ListItemText
                    primary={session.title}
                    secondary={session.lastMessagePreview}
                    primaryTypographyProps={{ noWrap: true }}
                    secondaryTypographyProps={{ noWrap: true }}
                  />
                </ListItemButton>
              );
            })}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Stack direction="row" spacing={1} sx={{ px: 2, pb: 1 }}>
          <Button size="small" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={picked.length === 0 || messageIds.length === 0}
            onClick={confirm}
          >
            {t('common.confirm')}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}

export default ForwardDialog;
