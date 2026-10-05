import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { FileDropZone } from '@/components/FileDropZone';
import { importFiles, previewFiles, type ImportResult } from '@/persona/importer';
import { copyKeyForError } from '@/backup/bundle';
import { useSnack } from '@/hooks/useSnack';
import { AppError, toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { t } from '@/copy';
import { pl, plv } from './personaCopy';
import type { PersonaCard } from '@/types/persona';
import type { ImportReport } from '@/types/backup';

/**
 * ★ 一键导入人设（FN-02）。
 *
 * 支持：原应用变体 A/B 的 JSON、单卡裸 JSON、zip（内嵌卡 + 表情包 + Live2D + 主题）。
 * ★ 失败口径：**单文件失败不影响其它文件**，每一条都给出具体原因（`ImportReport.items`）。
 *
 * 两阶段：先预览（只解析不落库）→ 用户点「导入」才真正写库，避免误拖一堆文件进去。
 */

export interface PersonaImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** 导入完成回调（调用方据此刷新列表） */
  onImported?: (result: ImportResult) => void;
}

export function PersonaImportDialog({ open, onClose, onImported }: PersonaImportDialogProps): JSX.Element {
  const snack = useSnack();
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<PersonaCard[]>([]);
  const [report, setReport] = useState<ImportReport | undefined>(undefined);
  const [extra, setExtra] = useState<{ stickers: number; live2d: number; theme: boolean }>({
    stickers: 0,
    live2d: 0,
    theme: false,
  });
  const [busy, setBusy] = useState<boolean>(false);

  // 关闭后清空状态，下次打开是干净的一屏
  useEffect(() => {
    if (open) return;
    setFiles([]);
    setPreview([]);
    setReport(undefined);
    setExtra({ stickers: 0, live2d: 0, theme: false });
    setBusy(false);
  }, [open]);

  const handleFiles = useCallback(
    (picked: File[]) => {
      setFiles(picked);
      setReport(undefined);
      void (async () => {
        try {
          // 预览阶段忽略失败：正式导入时才逐条报原因
          const cards = await previewFiles(picked);
          setPreview(cards);
        } catch (e) {
          log.warn('persona', '预览人设文件失败', toAppError(e), 'FN-02');
          setPreview([]);
        }
      })();
    },
    [],
  );

  const handleError = useCallback(
    (err: AppError) => {
      snack.error(copyKeyForError(err.code));
      log.warn('persona', '选择人设文件被拒', err, 'FN-02');
    },
    [snack],
  );

  const handleImport = useCallback(async (): Promise<void> => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const result = await importFiles(files);
      setReport(result.report);
      setPreview(result.cards);
      setExtra({
        stickers: result.stickerPackIds.length,
        live2d: result.live2dIds.length,
        theme: result.theme !== undefined,
      });
      snack.success('ok.imported');
      onImported?.(result);
    } catch (e) {
      const err = toAppError(e, 'IMPORT_INVALID');
      snack.error(copyKeyForError(err.code));
      log.warn('persona', '导入人设失败', err, 'FN-02');
    } finally {
      setBusy(false);
    }
  }, [files, onImported, snack]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{pl('label.importTitle')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ opacity: 0.8, mb: 1.5, whiteSpace: 'pre-wrap' }}>
          {pl('label.importDesc')}
        </Typography>

        <FileDropZone
          acceptExt={['json', 'zip']}
          multiple
          disabled={busy}
          onFiles={handleFiles}
          onError={handleError}
        />

        {files.length > 0 ? (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              {`${files.length} · ${plv('label.importSuccess', { n: preview.length })}`}
            </Typography>
          </Box>
        ) : null}

        {report ? (
          <Box sx={{ mt: 2 }}>
            <Divider sx={{ mb: 1.5 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {pl('label.importReport')}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: 'wrap', rowGap: 0.5 }}>
              <Typography variant="caption" sx={{ opacity: 0.8 }}>
                {plv('label.importSuccess', { n: report.success })}
              </Typography>
              {report.failed > 0 ? (
                <Typography variant="caption" color="error">
                  {plv('label.importFailed', { n: report.failed })}
                </Typography>
              ) : null}
              {extra.stickers > 0 ? (
                <Typography variant="caption" sx={{ opacity: 0.8 }}>
                  {plv('label.importStickers', { n: extra.stickers })}
                </Typography>
              ) : null}
              {extra.live2d > 0 ? (
                <Typography variant="caption" sx={{ opacity: 0.8 }}>
                  {plv('label.importLive2D', { n: extra.live2d })}
                </Typography>
              ) : null}
            </Stack>

            <List dense sx={{ mt: 1 }}>
              {report.items.map((item) => (
                <ListItem key={`${item.name}-${item.ok}`} disablePadding sx={{ alignItems: 'flex-start' }}>
                  <ListItemText
                    primary={item.name}
                    secondary={item.ok ? undefined : `${pl('label.importReason')}：${item.reason ?? '-'}`}
                    primaryTypographyProps={{ variant: 'body2', sx: { wordBreak: 'break-all' } }}
                    secondaryTypographyProps={{ variant: 'caption', color: 'error' }}
                  />
                </ListItem>
              ))}
            </List>

            {extra.theme ? (
              <Alert severity="info" variant="outlined" sx={{ mt: 1 }}>
                {pl('label.importTheme')}
              </Alert>
            ) : null}
          </Box>
        ) : null}

        {report && report.success === 0 ? (
          <Alert severity="warning" variant="outlined" sx={{ mt: 1.5 }}>
            {pl('label.importNone')}
          </Alert>
        ) : null}
      </DialogContent>

      <DialogActions>
        {busy ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
        <Button onClick={onClose} color="inherit" sx={{ minHeight: 44 }}>
          {t('common.close')}
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleImport()}
          disabled={busy || files.length === 0}
          sx={{ minHeight: 44 }}
        >
          {t('common.import')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default PersonaImportDialog;
