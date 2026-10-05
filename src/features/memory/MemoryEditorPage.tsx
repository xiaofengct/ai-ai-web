import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import { useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { memoryRepo } from '@/db/repo/memoryRepo';
import { memoryRetriever } from '@/memory/retrieve';
import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { useSnack } from '@/hooks/useSnack';
import { toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { to } from '@/router/paths';
import { t } from '@/copy';
import { ml } from './memoryCopy';
import type { MemoryEntry } from '@/types/memory';
import type { UUID } from '@/types/common';

/**
 * 记忆编辑（PG-13）。
 *
 * ★ 两种形态（同一份表单，不重复造）：
 * 1. **路由页** `/memories/:id/edit`（`id === 'new'` 为新增）——`<MemoryEditorPage />` 不传 props，
 *    自己从 `useParams()` 取 id，保存后跳回列表；
 * 2. **就地弹窗**——传 `{ open, memoryId, onClose, onSaved }`，用于「聊到一半发现她记错了，当场改」
 *    （见 `features/persona/usePersonaMemoryEntry.ts`）。
 */

export interface MemoryEditorPageProps {
  /** 弹窗模式下必传；不传则视为路由页 */
  open?: boolean;
  /** null / undefined = 新增 */
  memoryId?: UUID | null;
  /** 新增时归属的会话（弹窗从聊天里打开时用得上） */
  sessionId?: UUID;
  /** 新增时归属的角色 */
  personaId?: UUID;
  onClose?: () => void;
  onSaved?: () => void;
}

interface FormState {
  content: string;
  tagsText: string;
  score: string;
  weight: string;
  timeRef: string;
}

const EMPTY_FORM: FormState = { content: '', tagsText: '', score: '0.5', weight: '', timeRef: '' };

/** ISO → `datetime-local`（本地时区） */
function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function MemoryEditorPage(props: MemoryEditorPageProps = {}): JSX.Element {
  const { open, memoryId, sessionId: ownerSessionId, personaId: ownerPersonaId, onClose, onSaved } = props;
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const snack = useSnack();

  // ★ 形态判定：传了 open 就是弹窗；否则从路由参数取 id
  const dialogMode = open !== undefined;
  const routeId = params.id ?? '';
  const rawId = dialogMode ? memoryId || 'new' : routeId;
  const isNew = rawId === 'new' || rawId.length === 0;

  const [entry, setEntry] = useState<MemoryEntry | undefined>(undefined);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [missing, setMissing] = useState<boolean>(false);
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  useEffect(() => {
    // 弹窗模式：关着的时候不查库，省一次 IO
    if (dialogMode && open !== true) return;
    if (isNew) {
      setEntry(undefined);
      setForm(EMPTY_FORM);
      setMissing(false);
      return;
    }
    void (async () => {
      const res = await memoryRepo.get(rawId);
      if (!res.ok || !res.value) {
        setMissing(true);
        log.warn('memory', 'memory not found', res.ok ? undefined : res.error, 'PG-13');
        return;
      }
      setEntry(res.value);
      setForm({
        content: res.value.content,
        tagsText: (res.value.tags ?? []).join(', '),
        score: String(res.value.score ?? 0),
        weight: res.value.weight === undefined ? '' : String(res.value.weight),
        timeRef: toLocalInput(res.value.timeRef),
      });
    })();
  }, [dialogMode, isNew, open, rawId]);

  const closeAfterSave = useCallback((): void => {
    if (dialogMode) {
      onSaved?.();
      onClose?.();
      return;
    }
    navigate(to.memories());
  }, [dialogMode, navigate, onClose, onSaved]);

  const handleSave = useCallback(async (): Promise<void> => {
    const content = form.content.trim();
    if (!content) {
      snack.error('err.importInvalid');
      return;
    }
    setBusy(true);
    try {
      const now = nowISO();
      const next: MemoryEntry = {
        id: entry?.id ?? newId(),
        // ★ 新增时把调用方带进来的归属记上，否则这条记忆会变成「无主语料」，检索时归不到会话/角色
        sessionId: entry?.sessionId ?? ownerSessionId,
        personaId: entry?.personaId ?? ownerPersonaId,
        content,
        tags: form.tagsText
          .split(/[,，、\n]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        score: Math.min(1, Math.max(0, Number(form.score) || 0)),
        weight: form.weight.trim() ? Number(form.weight) : entry?.weight,
        sourceMessageIds: entry?.sourceMessageIds,
        timeRef: fromLocalInput(form.timeRef) ?? entry?.timeRef ?? now,
        createdAt: entry?.createdAt ?? now,
        updatedAt: now,
        correction: entry?.correction,
      };
      const res = await memoryRepo.upsert(next);
      if (!res.ok) throw res.error;

      // ★ 记忆变了 → 检索索引失效并重算这一条的独特性得分
      memoryRetriever.invalidate();
      void memoryRetriever.reindex(next).catch(() => undefined);

      snack.success('ok.memorySaved');
      closeAfterSave();
    } catch (e) {
      const err = toAppError(e, 'DB_FAILED');
      snack.error('err.dbFailed');
      log.warn('memory', 'save memory failed', err, 'PG-13');
    } finally {
      setBusy(false);
    }
  }, [closeAfterSave, entry, form, ownerPersonaId, ownerSessionId, snack]);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!entry) return;
    const res = await memoryRepo.remove(entry.id);
    setDeleteOpen(false);
    if (!res.ok) {
      snack.error('err.dbFailed');
      return;
    }
    memoryRetriever.invalidate();
    snack.success('ok.deleted');
    closeAfterSave();
  }, [closeAfterSave, entry, snack]);

  /** 表单主体：两种形态共用，不重复写一遍 */
  const formBody: JSX.Element = missing ? (
    <EmptyState descKey="empty.memories" actionKey="common.back" onAction={() => (dialogMode ? onClose?.() : navigate(to.memories()))} />
  ) : (
    <Stack spacing={2}>
      <TextField
        label={ml('label.memoryContent')}
        value={form.content}
        onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
        multiline
        minRows={4}
        fullWidth
        size="small"
        disabled={busy}
        autoFocus={isNew}
      />
      <TextField
        label={ml('label.memoryTags')}
        value={form.tagsText}
        onChange={(e) => setForm((prev) => ({ ...prev, tagsText: e.target.value }))}
        fullWidth
        size="small"
        disabled={busy}
        helperText={ml('label.memoryTags')}
      />
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1.5 }}>
        <TextField
          label={ml('label.memoryScore')}
          value={form.score}
          onChange={(e) => setForm((prev) => ({ ...prev, score: e.target.value }))}
          type="number"
          size="small"
          inputProps={{ min: 0, max: 1, step: 0.05 }}
          sx={{ minWidth: 140 }}
          disabled={busy}
          helperText={ml('hint.memoryScore')}
        />
        <TextField
          label={ml('label.memoryWeight')}
          value={form.weight}
          onChange={(e) => setForm((prev) => ({ ...prev, weight: e.target.value }))}
          type="number"
          size="small"
          inputProps={{ step: 0.1 }}
          sx={{ minWidth: 140 }}
          disabled={busy}
          helperText={ml('hint.memoryWeight')}
        />
        <TextField
          label={ml('label.memoryTimeRef')}
          value={form.timeRef}
          onChange={(e) => setForm((prev) => ({ ...prev, timeRef: e.target.value }))}
          type="datetime-local"
          size="small"
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 220 }}
          disabled={busy}
          helperText={ml('hint.memoryTimeRef')}
        />
      </Stack>
    </Stack>
  );

  const actions: JSX.Element = (
    <Stack direction="row" spacing={1} sx={{ mt: 3, flexWrap: 'wrap', rowGap: 1 }}>
      <Button variant="contained" onClick={() => void handleSave()} disabled={busy} sx={{ minHeight: 44 }}>
        {t('common.save')}
      </Button>
      <Button
        variant="text"
        onClick={() => (dialogMode ? onClose?.() : navigate(to.memories()))}
        sx={{ minHeight: 44 }}
      >
        {t('common.cancel')}
      </Button>
      {!isNew && !missing ? (
        <Button
          variant="text"
          color="error"
          onClick={() => setDeleteOpen(true)}
          disabled={busy}
          sx={{ minHeight: 44 }}
        >
          {t('common.delete')}
        </Button>
      ) : null}
    </Stack>
  );

  const confirmNode: JSX.Element = (
    <ConfirmDialog
      open={deleteOpen}
      titleKey="confirm.deleteMemory"
      confirmKey="common.delete"
      danger
      onConfirm={() => void handleDelete()}
      onCancel={() => setDeleteOpen(false)}
    />
  );

  /* —— 弹窗形态：就地编辑，不离开当前页面 —— */
  if (dialogMode) {
    return (
      <>
        <Dialog open={open === true} onClose={() => onClose?.()} fullScreen={narrow} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ pr: 6 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Box sx={{ flex: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {isNew ? ml('page.memoryEditor.new') : ml('page.memoryEditor.title')}
                </Typography>
              </Box>
              <IconButton onClick={() => onClose?.()} aria-label={t('common.close')} sx={{ minWidth: 44, minHeight: 44 }}>
                <CloseIcon />
              </IconButton>
            </Stack>
          </DialogTitle>
          <DialogContent dividers>{formBody}</DialogContent>
          <DialogActions sx={{ px: 2, py: 1.5, flexWrap: 'wrap', rowGap: 1 }}>{actions}</DialogActions>
        </Dialog>
        {confirmNode}
      </>
    );
  }

  /* —— 路由页形态 —— */
  return (
    <Box sx={{ p: { xs: 1.5, sm: 2.5 }, maxWidth: 720, mx: 'auto' }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
        {isNew ? ml('page.memoryEditor.new') : ml('page.memoryEditor.title')}
      </Typography>
      {formBody}
      {actions}
      {confirmNode}
    </Box>
  );
}

export default MemoryEditorPage;
