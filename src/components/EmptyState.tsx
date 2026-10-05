import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { t, type CopyKey, type CopyVars } from '@/copy';

/**
 * 空状态（架构文档 §6.8 组件防线）：props 只接受 `CopyKey`，走欣然文案。
 */
export interface EmptyStateProps {
  /** 主文案 key（如 'empty.sessions'） */
  descKey: CopyKey;
  descVars?: CopyVars;
  /** 标题（同样走文案 key，可选） */
  titleKey?: CopyKey;
  /** 图标/插画 */
  icon?: ReactNode;
  /** 操作按钮（文案 key） */
  actionKey?: CopyKey;
  onAction?: () => void;
  /** 紧凑模式（列表内嵌时用） */
  dense?: boolean;
}

export function EmptyState({
  descKey,
  descVars,
  titleKey,
  icon,
  actionKey,
  onAction,
  dense = false,
}: EmptyStateProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 1,
        py: dense ? 3 : 8,
        px: 2,
        opacity: 0.95,
      }}
    >
      {icon ? (
        <Box sx={{ fontSize: dense ? 32 : 48, lineHeight: 1, opacity: 0.6 }}>{icon}</Box>
      ) : null}
      {titleKey ? (
        <Typography variant={dense ? 'subtitle1' : 'h6'} sx={{ fontWeight: 600 }}>
          {t(titleKey)}
        </Typography>
      ) : null}
      <Typography variant="body2" sx={{ opacity: 0.8, maxWidth: 420, whiteSpace: 'pre-wrap' }}>
        {t(descKey, descVars)}
      </Typography>
      {actionKey && onAction ? (
        <Button variant="outlined" size="small" sx={{ mt: 1 }} onClick={onAction}>
          {t(actionKey)}
        </Button>
      ) : null}
    </Box>
  );
}

export default EmptyState;
