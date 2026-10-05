import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import CloseIcon from '@mui/icons-material/Close';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { EmptyState } from '@/components/EmptyState';
import { OcrButton } from './OcrButton';
import { blobRepo } from '@/db/repo/blobRepo';
import { formatBytes } from '@/lib/file';
import { log } from '@/store/logStore';
import { t } from '@/copy';
import type { BlobRecord } from '@/types/media';

/**
 * 图片预览（PG-06，全屏页：路由里不套 AppShell）。
 *
 * ★ 三条要点：
 * 1. **ObjectURL 必须回收**：`URL.createObjectURL` 不 revoke 会把整张图一直挂在内存里，
 *    预览几张大图就能吃掉几百 MB，所以卸载时统一 revoke；
 * 2. 缩放/拖拽交给 `react-zoom-pan-pinch`（双指缩放、拖拽、双击复位都自带），
 *    这里只补三个按钮：放大 / 缩小 / 复位（验收要点⑧「可缩放」）；
 * 3. OCR 按钮在 tesseract 加载失败时给降级提示，见 `OcrButton`。
 */

export function ImagePreviewPage(): JSX.Element {
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();

  const [url, setUrl] = useState<string | undefined>(undefined);
  const [record, setRecord] = useState<BlobRecord | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!assetId) return;
    let alive = true;
    let created: string | undefined;

    void (async () => {
      const res = await blobRepo.getObjectURL(assetId);
      if (!alive) {
        if (res.ok && res.value) URL.revokeObjectURL(res.value);
        return;
      }
      if (!res.ok || !res.value) {
        setFailed(true);
        log.warn('media', 'image asset missing', { assetId }, 'PG-06');
        return;
      }
      created = res.value;
      setUrl(res.value);

      // 元信息（体积 / 类型）单独读，失败不影响看图
      const bytesRes = await blobRepo.get(assetId);
      if (alive && bytesRes.ok && bytesRes.value) setRecord(bytesRes.value);
    })();

    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [assetId]);

  if (failed || !url) {
    return (
      <Box
        sx={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 2,
        }}
      >
        <Stack spacing={1.5} alignItems="center">
          <EmptyState descKey="empty.selection" />
          <Button variant="outlined" size="small" onClick={() => navigate(-1)}>
            {t('common.back')}
          </Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      {/* —— 顶栏 —— */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
            {t('chat.previewTitle')}
          </Typography>
          {record ? (
            <Typography variant="caption" noWrap sx={{ opacity: 0.55 }}>
              {`${record.mime} · ${formatBytes(record.size)}`}
            </Typography>
          ) : null}
        </Box>

        <OcrButton assetId={assetId ?? ''} />

        <Tooltip title={t('common.close')}>
          <IconButton size="small" onClick={() => navigate(-1)} aria-label={t('common.close')}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* —— 画布 —— */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        <TransformWrapper
          initialScale={1}
          minScale={0.5}
          maxScale={8}
          doubleClick={{ mode: 'reset' }}
          wheel={{ step: 0.15 }}
        >
          {({ zoomIn, zoomOut, resetTransform }) => (
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <TransformComponent
                wrapperStyle={{ width: '100%', height: '100%', flex: 1 }}
                contentStyle={{ width: '100%', height: '100%' }}
              >
                <Box
                  component="img"
                  src={url}
                  alt={t('chat.previewTitle')}
                  sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              </TransformComponent>

              {/* —— 缩放控制条 —— */}
              <Stack
                direction="row"
                spacing={1}
                justifyContent="center"
                alignItems="center"
                sx={{ py: 1 }}
              >
                <Tooltip title={t('common.prev')}>
                  <IconButton size="small" onClick={() => zoomOut()} aria-label={t('common.prev')}>
                    <ZoomOutIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('chat.zoomReset')}>
                  <IconButton
                    size="small"
                    onClick={() => resetTransform()}
                    aria-label={t('chat.zoomReset')}
                  >
                    <RestartAltIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('common.next')}>
                  <IconButton size="small" onClick={() => zoomIn()} aria-label={t('common.next')}>
                    <ZoomInIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>
          )}
        </TransformWrapper>
      </Box>
    </Box>
  );
}

export default ImagePreviewPage;
