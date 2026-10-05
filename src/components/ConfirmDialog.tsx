import { useCallback, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { t, type CopyKey, type CopyVars } from '@/copy';

/**
 * 二次确认弹窗（文生图 FN-33、重置主题 FN-61、退出确认 FN-16 降级、删除等）。
 * ★ props 只接受 `CopyKey`，不接受中文字符串（架构文档 §6.8 组件防线）。
 */
export interface ConfirmDialogProps {
  open: boolean;
  titleKey: CopyKey;
  titleVars?: CopyVars;
  /** 说明文案 key；不传则只显示标题 */
  descKey?: CopyKey;
  descVars?: CopyVars;
  confirmKey?: CopyKey;
  cancelKey?: CopyKey;
  /** 危险操作（删除）时确认按钮用 error 色 */
  danger?: boolean;
  /** 额外内容（如文生图的 prompt 预览、成本预估） */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
  /** 是否禁用确认（如必须勾选后才可确认） */
  confirmDisabled?: boolean;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg';
}

export function ConfirmDialog({
  open,
  titleKey,
  titleVars,
  descKey,
  descVars,
  confirmKey = 'common.confirm',
  cancelKey = 'common.cancel',
  danger = false,
  children,
  onConfirm,
  onCancel,
  confirmDisabled = false,
  maxWidth = 'xs',
}: ConfirmDialogProps) {
  const handleConfirm = useCallback(() => onConfirm(), [onConfirm]);

  return (
    <Dialog open={open} onClose={onCancel} maxWidth={maxWidth} fullWidth>
      <DialogTitle>{t(titleKey, titleVars)}</DialogTitle>
      <DialogContent>
        {descKey ? (
          <DialogContentText component="div" sx={{ whiteSpace: 'pre-wrap' }}>
            {t(descKey, descVars)}
          </DialogContentText>
        ) : null}
        {children}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} color="inherit">
          {t(cancelKey)}
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color={danger ? 'error' : 'primary'}
          disabled={confirmDisabled}
        >
          {t(confirmKey)}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ConfirmDialog;
