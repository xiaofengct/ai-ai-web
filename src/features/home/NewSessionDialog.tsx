import { useEffect, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { PersonaRail } from './PersonaRail';
import { usePersonaStore } from '@/store/personaStore';
import { useUiStore } from '@/store/uiStore';
import { useSnack } from '@/hooks/useSnack';
import { sessionRepo } from '@/db/repo/sessionRepo';
import { t } from '@/copy';
import type { ChatSession } from '@/types/chat';
import type { UUID } from '@/types/common';

/**
 * 新建会话弹窗（PG-14 / FN-07）。
 *
 * - 标题默认取角色名（用户可改）；
 * - 角色用 `PersonaRail` 横向选择（不渲染任何立绘，见 XR-06）；
 * - 主动消息默认 `inheritFromPrev = true`（FN-07：新建会话继承上一个会话的设置）；
 * - 创建成功后把新会话记为「当前会话」，供聊天页恢复阅读位置。
 */
export interface NewSessionDialogProps {
  open: boolean;
  /** 预选角色（不传则用当前角色） */
  personaId?: UUID;
  onClose: () => void;
  onCreated?: (session: ChatSession) => void;
}

export function NewSessionDialog({
  open,
  personaId,
  onClose,
  onCreated,
}: NewSessionDialogProps): JSX.Element {
  const personas = usePersonaStore((s) => s.personas);
  /** 读库完成没有 —— 未完成时 `personas` 为空是"还不知道"，不是"没有角色" */
  const personasHydrated = usePersonaStore((s) => s.hydrated);
  const currentPersonaId = usePersonaStore((s) => s.currentId);
  const setCurrentPersona = useUiStore((s) => s.setCurrentPersona);
  const snack = useSnack();

  const [title, setTitle] = useState<string>('');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const selectedPersona = useMemo(
    () => personas.find((p) => p.id === selectedPersonaId),
    [personas, selectedPersonaId],
  );

  // 每次打开都按「当前选择」重置，避免上一次输入残留
  useEffect(() => {
    if (!open) return;
    const pid = personaId ?? currentPersonaId ?? personas[0]?.id ?? '';
    setSelectedPersonaId(pid);
    setTitle(personas.find((p) => p.id === pid)?.data.name ?? '');
    setSubmitting(false);
  }, [open, personaId, currentPersonaId, personas]);

  const handleCreate = async (): Promise<void> => {
    // ★ 原实现是 `if (!selectedPersonaId) return;` —— **静默返回**：
    //   用户点了「创建」，什么都没发生、也没有任何提示（"点了没反应"）。
    //   这在**不内置欣然版**里是必踩路径：首启没有任何角色，
    //   若从别处（快捷入口 / 引导页）打开本弹窗，就会撞上这个静默分支。
    //   ⇒ 改为**明确告知缺什么**（XR-04：不给静默缺失）。
    if (!selectedPersonaId) {
      snack.error('err.noPersonaToChat');
      return;
    }
    setSubmitting(true);

    const res = await sessionRepo.create({
      title: title.trim() || selectedPersona?.data.name || t('session.unnamed'),
      personaId: selectedPersonaId,
      // FN-07：默认继承上一个会话的主动消息设置
      proactive: { enabled: false, inheritFromPrev: true },
    });

    setSubmitting(false);

    if (!res.ok) {
      snack.error('err.dbFailed');
      return;
    }

    setCurrentPersona(selectedPersonaId);
    onCreated?.(res.value);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('action.newSession')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            autoFocus
            label={t('session.titleField')}
            placeholder={t('session.unnamed')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
          />
          <PersonaRail
            personas={personas}
            currentId={selectedPersonaId}
            loading={!personasHydrated}
            onPick={(card) => {
              setSelectedPersonaId(card.id);
              // 角色切换时把标题同步为该角色名（用户已手改则保留）
              if (title.trim() === '' || personas.some((p) => p.data.name === title)) {
                setTitle(card.data.name);
              }
            }}
          />
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {t('settings.hint.proactiveInterval')}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit" sx={{ minHeight: 44 }}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          disabled={submitting || selectedPersonaId === ''}
          onClick={() => void handleCreate()}
          sx={{ minHeight: 44 }}
        >
          {t('common.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default NewSessionDialog;
