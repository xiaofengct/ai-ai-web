import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import UploadOutlinedIcon from '@mui/icons-material/UploadOutlined';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { downloadPersona, downloadPersonas } from '@/persona/exporter';
import { usePersonaStore } from '@/store/personaStore';
import { useSnack } from '@/hooks/useSnack';
import { toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { t } from '@/copy';
import { pl, plv } from './personaCopy';
import { PersonaCardView } from './PersonaCardView';
import { PersonaEditorPage } from './PersonaEditorPage';
import { PersonaImportDialog } from './PersonaImportDialog';
import type { PersonaCard } from '@/types/persona';
import type { UUID } from '@/types/common';

/**
 * 角色列表（架构文档 §2 `features/persona/PersonaListPage.tsx`）。
 *
 * ★ 形态说明（偏离与理由）：27 条路由里**没有独立的人设页**（`router/paths.ts` 的 `ROUTE` 是唯一真源），
 *   所以这里做成 **fullScreen Dialog 形态的「页」**：窄屏铺满、宽屏居中大弹窗，
 *   由首页 / 设置页按需打开。这样既不破坏「27 条路由」的验收口径，人设管理又是完整可达的。
 *
 * 排序永远把欣然放第一（XR-08，由 `personaRepo.listAll()` 保证）。
 */

export interface PersonaListPageProps {
  open: boolean;
  onClose: () => void;
}

export function PersonaListPage({ open, onClose }: PersonaListPageProps): JSX.Element {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  const snack = useSnack();

  const personas = usePersonaStore((s) => s.personas);
  const reload = usePersonaStore((s) => s.reload);
  const removePersona = usePersonaStore((s) => s.remove);

  const [importOpen, setImportOpen] = useState<boolean>(false);
  const [editorId, setEditorId] = useState<UUID | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<PersonaCard | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  const handleImported = useCallback(() => {
    void reload();
  }, [reload]);

  const handleDelete = useCallback(
    async (card: PersonaCard): Promise<void> => {
      try {
        await removePersona(card.id);
        snack.success('ok.deleted');
      } catch (e) {
        const err = toAppError(e, 'DB_FAILED');
        // 内置卡被 repo 拒绝：直接告诉用户这是我自己，删不掉（XR-08）
        snack.error(err.code === 'PRIVACY_BLOCK' ? 'err.privacyBlock' : 'err.dbFailed');
        log.warn('persona', '删除角色失败', err, 'XR-08');
      }
      setPendingDelete(undefined);
    },
    [removePersona, snack],
  );

  const handleExportAll = useCallback(() => {
    if (personas.length === 0) {
      snack.info('common.done');
      return;
    }
    downloadPersonas(personas);
    snack.success('ok.exported');
  }, [personas, snack]);

  return (
    <>
      <Dialog open={open} onClose={onClose} fullScreen={narrow} maxWidth="md" fullWidth>
        <DialogTitle sx={{ pr: 6 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {pl('page.persona.title')}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                {plv('label.personaCount', { n: personas.length })}
              </Typography>
            </Box>
            <IconButton onClick={onClose} aria-label={t('common.close')} sx={{ minWidth: 44, minHeight: 44 }}>
              <CloseIcon />
            </IconButton>
          </Stack>
        </DialogTitle>

        <DialogContent dividers>
          <Typography variant="body2" sx={{ opacity: 0.8, mb: 2, whiteSpace: 'pre-wrap' }}>
            {pl('page.persona.desc')}
          </Typography>

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, mb: 2 }}>
            <Button
              variant="outlined"
              startIcon={<UploadOutlinedIcon />}
              onClick={() => setImportOpen(true)}
              sx={{ minHeight: 44 }}
            >
              {t('common.import')}
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setEditorId(null)}
              sx={{ minHeight: 44 }}
            >
              {pl('page.personaEditor.new')}
            </Button>
            <Tooltip title={t('common.export')} arrow>
              <Button
                variant="text"
                startIcon={<FileDownloadOutlinedIcon />}
                onClick={handleExportAll}
                sx={{ minHeight: 44 }}
              >
                {t('common.export')}
              </Button>
            </Tooltip>
          </Stack>

          <Divider sx={{ mb: 2 }} />

          {personas.length === 0 ? (
            <EmptyState descKey="empty.personas" />
          ) : (
            <Stack spacing={1.5}>
              {personas.map((card) => (
                <PersonaCardView
                  key={card.id}
                  card={card}
                  onEdit={(c) => setEditorId(c.id)}
                  onDelete={(c) => setPendingDelete(c)}
                  onExport={(c) => {
                    downloadPersona(c);
                    snack.success('ok.exported');
                  }}
                />
              ))}
            </Stack>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose} sx={{ minHeight: 44 }}>
            {t('common.close')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 导入（FN-02） */}
      <PersonaImportDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={handleImported} />

      {/* 编辑 / 新建（FN-51/52/55） */}
      <PersonaEditorPage
        open={editorId !== undefined}
        personaId={editorId ?? null}
        onClose={() => setEditorId(undefined)}
        onSaved={handleImported}
      />

      {/* 删除二次确认（内置卡走不到这里，repo 会直接拒绝） */}
      <ConfirmDialog
        open={pendingDelete !== undefined}
        titleKey="confirm.deletePersona"
        confirmKey="common.delete"
        danger
        onConfirm={() => {
          if (pendingDelete) void handleDelete(pendingDelete);
        }}
        onCancel={() => setPendingDelete(undefined)}
      />
    </>
  );
}

export default PersonaListPage;
