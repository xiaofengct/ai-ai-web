import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { assertFileSize, filterByExt, pickFiles, pickDirectory, supportsFsAccess } from '@/lib/file';
import { AppError } from '@/lib/errors';
import { t } from '@/copy';

/**
 * 拖放 + 选择文件（FN-02 一键导入 / EX-02~06 原材料上传）。
 *
 * PL-11 降级：`showOpenFilePicker` / `showDirectoryPicker` 只有 Chromium 系支持，
 * 其它浏览器退化为传统 `<input type="file">`；目录选择不支持时提示用户改用多选。
 */
export interface FileDropZoneProps {
  onFiles: (files: File[]) => void;
  /** 接受的后缀名（不含点）；不传则不限 */
  acceptExt?: readonly string[];
  multiple?: boolean;
  /** 允许选目录（Chromium only） */
  allowDirectory?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
  /** 自定义提示内容 */
  children?: ReactNode;
  /** 单文件体积上限（字节） */
  maxSize?: number;
  /** 出错回调（文案由调用方走 copy） */
  onError?: (err: AppError) => void;
}

export function FileDropZone({
  onFiles,
  acceptExt,
  multiple = true,
  allowDirectory = false,
  disabled = false,
  children,
  maxSize,
  onError,
}: FileDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const handleFiles = useCallback(
    (list: File[]) => {
      try {
        let files = acceptExt && acceptExt.length > 0 ? filterByExt(list, acceptExt) : list;
        if (!multiple) files = files.slice(0, 1);
        for (const f of files) assertFileSize(f, maxSize);
        if (files.length === 0) {
          onError?.(new AppError('IMPORT_INVALID', t('ui.noMatchedFile')));
          return;
        }
        onFiles(files);
      } catch (e) {
        onError?.(e instanceof AppError ? e : new AppError('IMPORT_INVALID', String(e)));
      }
    },
    [acceptExt, maxSize, multiple, onError, onFiles],
  );

  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) handleFiles(files);
  };

  const openPicker = async () => {
    try {
      const files = await pickFiles({
        multiple,
        ...(acceptExt && acceptExt.length > 0
          ? {
              accept: {
                description: t('ui.materialFiles'),
                accept: { 'application/octet-stream': [...acceptExt] },
              },
            }
          : {}),
      });
      if (files.length > 0) handleFiles(files);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      onError?.(e instanceof AppError ? e : new AppError('IMPORT_INVALID', String(e)));
    }
  };

  const openDir = async () => {
    const files = await pickDirectory();
    if (files === null) {
      onError?.(
        new AppError('CAPABILITY_UNAVAILABLE', t('ui.dirUnsupported')),
      );
      return;
    }
    if (files.length > 0) handleFiles(files);
  };

  return (
    <Box
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      sx={{
        border: '2px dashed',
        borderColor: dragging ? 'primary.main' : 'divider',
        borderRadius: 2,
        bgcolor: dragging ? 'action.hover' : 'transparent',
        transition: 'all 160ms',
        p: 2,
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
      onClick={() => {
        if (!disabled) void openPicker();
      }}
    >
      {children ?? (
        <Typography variant="body2" sx={{ opacity: 0.75 }}>
          {t('ui.dropHere')}
        </Typography>
      )}
      <Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 1.5 }}>
        <Button
          size="small"
          variant="outlined"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            void openPicker();
          }}
        >
          {multiple ? t('ui.pickFilesMulti') : t('ui.pickFiles')}
        </Button>
        {allowDirectory ? (
          <Button
            size="small"
            variant="text"
            disabled={disabled || !supportsFsAccess()}
            onClick={(e) => {
              e.stopPropagation();
              void openDir();
            }}
            title={supportsFsAccess() ? '' : t('ui.dirUnsupported')}
          >
            {t('ui.pickFolder')}
          </Button>
        ) : null}
      </Stack>
    </Box>
  );
}

export default FileDropZone;
