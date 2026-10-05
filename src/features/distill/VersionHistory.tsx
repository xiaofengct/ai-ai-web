import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useSnack } from '@/hooks/useSnack';
import { useDistillStore } from '@/store/distillStore';
import { MAX_VERSIONS } from '@/constants/limits';
import { formatRelative } from '@/lib/time';
import { isRollbackSnapshot } from '@/distill/versioning';
import type { ArtifactVersion } from '@/types/distill';
import { dt } from '@/distill/copy';

/**
 * 版本历史 + 回滚（EX-09）—— **修订历史的入口就在这里**。
 *
 * ★ 入口位置：蒸馏作业详情页 `DistillJobDetailPage`（产物预览下方），
 *   和产物本身挨着，用户改完产物想「退回上一版」时不用去别处找。
 *
 * 能做四件事：
 * 1. **看这一版**（`预览`）—— 弹窗展示该版本快照的 memories.md / persona.md 原文；
 * 2. **退回这一版**（`回滚`）—— 二次确认，且内部会先自动存档（可逆）；
 * 3. **删掉这一版**（`删除`）—— 二次确认；**v1 是溯源基线，禁止删除**；
 * 4. **存一版**（手动存档）—— 改产物前先留个锚点。
 *
 * ★ 为什么预览是只读的：版本快照是**历史事实**，
 *   允许就地编辑会让「版本」这个概念失去意义（想改就改当前产物再存新版）。
 */

export interface VersionHistoryProps {
  versions: readonly ArtifactVersion[];
  currentVersion?: string;
}

export function VersionHistory({ versions, currentVersion }: VersionHistoryProps): JSX.Element {
  const snack = useSnack();
  const rollbackTo = useDistillStore((s) => s.rollbackTo);
  const removeVersion = useDistillStore((s) => s.removeVersion);
  const backupVersion = useDistillStore((s) => s.backupVersion);
  const busy = useDistillStore((s) => s.busy);

  const [rollbackTarget, setRollbackTarget] = useState<string | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<ArtifactVersion | undefined>(undefined);

  const doRollback = async (): Promise<void> => {
    if (!rollbackTarget) return;
    try {
      await rollbackTo(rollbackTarget);
      snack.success('ok.rollback');
    } catch {
      snack.error('err.dbFailed');
    } finally {
      setRollbackTarget(undefined);
    }
  };

  const doDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await removeVersion(deleteTarget);
      snack.success('ok.deleted');
    } catch {
      snack.error('err.dbFailed');
    } finally {
      setDeleteTarget(undefined);
    }
  };

  /** v1 是溯源基线：按钮直接置灰，而不是让用户点了再报错 */
  const isBaseline = (v: string): boolean => v === 'v1';

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {dt('distill.versions.title')}
        </Typography>
        <Button size="small" variant="outlined" disabled={busy} onClick={() => void backupVersion(dt('distill.versions.autoNote'))}>
          {dt('distill.versions.backup')}
        </Button>
      </Stack>

      <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mb: 1.5 }}>
        {dt('distill.versions.max', { n: MAX_VERSIONS })}
      </Typography>

      {versions.length === 0 ? (
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {dt('distill.versions.empty')}
        </Typography>
      ) : (
        <Stack spacing={1}>
          {versions.map((v) => {
            const isCurrent = v.version === currentVersion;
            return (
              <Stack
                key={`${v.version}-${v.createdAt}`}
                direction="row"
                alignItems="center"
                spacing={1}
                sx={{ borderBottom: '1px dashed', borderColor: 'divider', pb: 1 }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 120 }}>
                  {v.version}
                </Typography>
                {isCurrent ? (
                  <Chip size="small" color="primary" label={dt('distill.versions.current')} />
                ) : null}
                {isRollbackSnapshot(v.version) ? (
                  <Chip size="small" variant="outlined" label={dt('distill.versions.snapshot')} />
                ) : null}
                <Typography variant="caption" sx={{ opacity: 0.65, flex: 1 }}>
                  {formatRelative(v.createdAt)}
                  {v.note ? ` · ${v.note}` : ''}
                </Typography>

                <Button size="small" variant="text" onClick={() => setPreview(v)}>
                  {dt('distill.versions.preview')}
                </Button>
                <Button
                  size="small"
                  variant="text"
                  disabled={busy || isCurrent}
                  onClick={() => setRollbackTarget(v.version)}
                >
                  {dt('distill.versions.rollback')}
                </Button>
                <Button
                  size="small"
                  variant="text"
                  color="error"
                  disabled={busy || isBaseline(v.version)}
                  title={isBaseline(v.version) ? dt('distill.versions.deleteBlocked') : undefined}
                  onClick={() => setDeleteTarget(v.version)}
                >
                  {dt('distill.versions.delete')}
                </Button>
              </Stack>
            );
          })}
        </Stack>
      )}

      <Box sx={{ mt: 1.5 }}>
        <Typography variant="caption" sx={{ opacity: 0.6 }}>
          {dt('distill.versions.rollbackHint')}
        </Typography>
      </Box>

      {/* —— 预览某一版（只读） —— */}
      <Dialog open={Boolean(preview)} onClose={() => setPreview(undefined)} maxWidth="md" fullWidth>
        <DialogTitle>
          {preview ? dt('distill.versions.previewOf', { v: preview.version }) : ''}
        </DialogTitle>
        <DialogContent dividers>
          {preview ? (
            <Stack spacing={1.5}>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                  {dt('distill.versions.previewMemories')}
                </Typography>
                <Typography
                  variant="body2"
                  component="pre"
                  sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', m: 0, fontSize: 12, opacity: 0.85 }}
                >
                  {preview.snapshot.memoriesMd || '—'}
                </Typography>
              </Box>
              <Divider />
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                  {dt('distill.versions.previewPersona')}
                </Typography>
                <Typography
                  variant="body2"
                  component="pre"
                  sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', m: 0, fontSize: 12, opacity: 0.85 }}
                >
                  {preview.snapshot.personaMd || '—'}
                </Typography>
              </Box>
            </Stack>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(rollbackTarget)}
        titleKey="confirm.rollback"
        danger
        onCancel={() => setRollbackTarget(undefined)}
        onConfirm={() => void doRollback()}
      />

      {/* 删除确认：ConfirmDialog 的 title/desc 走全局 copy 表，
          蒸馏域自己的说明走 children（避免为一句提示再往全局表塞 key） */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        titleKey="confirm.deleteBackup"
        danger
        onCancel={() => setDeleteTarget(undefined)}
        onConfirm={() => void doDelete()}
      >
        <Typography variant="body2" sx={{ opacity: 0.8 }}>
          {dt('distill.versions.deleteHint')}
        </Typography>
      </ConfirmDialog>
    </Paper>
  );
}

export default VersionHistory;
