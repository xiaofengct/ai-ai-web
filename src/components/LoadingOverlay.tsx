import Backdrop from '@mui/material/Backdrop';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { t, type CopyKey, type CopyVars } from '@/copy';

/**
 * 加载遮罩（架构文档 §6.8 组件防线）：文案只接受 `CopyKey`。
 */
export interface LoadingOverlayProps {
  open: boolean;
  /** 文案 key，如 'loading.thinking' / 'loading.distilling' */
  textKey?: CopyKey;
  textVars?: CopyVars;
  /** 进度（0~1）；不传则显示不确定态圆环 */
  progress?: number;
  /** 局部遮罩（只盖住父容器） */
  inline?: boolean;
}

export function LoadingOverlay({
  open,
  textKey = 'loading.default',
  textVars,
  progress,
  inline = false,
}: LoadingOverlayProps) {
  return (
    <Backdrop
      open={open}
      sx={{
        zIndex: (theme) => theme.zIndex.drawer + 1,
        color: '#fff',
        flexDirection: 'column',
        gap: 2,
        // 局部遮罩时改为绝对定位，跟随父容器
        ...(inline ? { position: 'absolute', borderRadius: 2 } : null),
      }}
    >
      <CircularProgress
        color="inherit"
        {...(progress === undefined ? {} : { variant: 'determinate', value: Math.round(progress * 100) })}
      />
      <Typography variant="body2">{t(textKey, textVars)}</Typography>
      {progress !== undefined ? (
        <Box component="span" sx={{ fontSize: 12, opacity: 0.75 }}>
          {Math.round(progress * 100)}%
        </Box>
      ) : null}
    </Backdrop>
  );
}

export default LoadingOverlay;
