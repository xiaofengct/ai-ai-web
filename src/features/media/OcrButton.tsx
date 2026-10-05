import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DocumentScannerIcon from '@mui/icons-material/DocumentScanner';
import { useUiStore } from '@/store/uiStore';
import { useSnack } from '@/hooks/useSnack';
import { t } from '@/copy';
import { ocrAsset, ocrSupported } from './ocr';
import type { UUID } from '@/types/common';

/**
 * 读图按钮（PG-06 / FN-25）。
 *
 * ★ 三条约定：
 * 1. tesseract 是**重资源**，只在点击时加载——所以识别前先给一个 loading；
 * 2. **失败必须给降级提示**（验收要点⑧）：`chat.ocrFallback` 是欣然口吻的兜底，
 *    不能让按钮点了之后静悄悄；
 * 3. 结果不自动写库，交给调用方（预览页展示 / 聊天页作为附件 ocrText 回填）。
 */

export interface OcrButtonProps {
  /** blobs 表里的资产 id */
  assetId: UUID;
  /** 识别成功回调（拿到清洗后的文本） */
  onResult?: (text: string) => void;
  disabled?: boolean;
}

export function OcrButton({ assetId, onResult, disabled = false }: OcrButtonProps): JSX.Element {
  const snack = useSnack();
  const showLoading = useUiStore((s) => s.showLoading);
  const hideLoading = useUiStore((s) => s.hideLoading);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | undefined>(undefined);

  const run = async (): Promise<void> => {
    if (busy) return;

    if (!ocrSupported()) {
      snack.error('chat.ocrFallback');
      return;
    }

    setBusy(true);
    setText(undefined);
    showLoading('loading.ocr');
    try {
      const result = await ocrAsset(assetId);
      setText(result.text);
      onResult?.(result.text);
      if (!result.text) {
        // 识别成功但一个字都没有：也算降级，别报成功
        snack.error('chat.ocrFallback');
      }
    } catch {
      // ★ 统一降级口吻：不甩锅给用户，也不暴露英文堆栈
      snack.error('chat.ocrFallback');
    } finally {
      hideLoading();
      setBusy(false);
    }
  };

  return (
    <Stack spacing={0.75}>
      <Tooltip title={t('chat.ocrHint')}>
        <span>
          <Button
            size="small"
            variant="outlined"
            startIcon={
              busy ? <CircularProgress size={14} color="inherit" /> : <DocumentScannerIcon />
            }
            disabled={disabled || busy}
            onClick={() => void run()}
          >
            {t('chat.ocr')}
          </Button>
        </span>
      </Tooltip>

      {text ? (
        <Box
          sx={{
            maxHeight: 160,
            overflowY: 'auto',
            p: 1,
            borderRadius: 1,
            bgcolor: 'action.hover',
          }}
        >
          <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {text}
          </Typography>
        </Box>
      ) : null}
    </Stack>
  );
}

export default OcrButton;
