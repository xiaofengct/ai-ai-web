import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { t } from '@/copy';

/**
 * 拍一拍的涟漪反馈（FN-27）。
 *
 * ★ 为什么是「一次性组件」而不是常驻动画：
 *   拍一拍是一次性动作，动画播完就该彻底消失（否则每次重渲染都会再播一遍）。
 *   这里用 `key` 自增触发重挂载，配合 `global.css` 的 `.ai-ai-pat-ripple` 播一次即止。
 */

export interface PatRippleProps {
  /** 每次自增即触发一次新的涟漪 */
  token: number;
  /** 涟漪中心的文案（默认走 copy 表的 pat.message） */
  text?: string;
  /** 播放时长（ms） */
  durationMs?: number;
  onDone?: () => void;
}

export function PatRipple({ token, text, durationMs = 900, onDone }: PatRippleProps): JSX.Element | null {
  const [alive, setAlive] = useState(false);

  useEffect(() => {
    if (token <= 0) return;
    setAlive(true);
    const timer = setTimeout(() => {
      setAlive(false);
      onDone?.();
    }, durationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, durationMs]);

  if (!alive) return null;

  return (
    <Box
      className="ai-ai-pat-ripple"
      key={token}
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1,
          borderRadius: 999,
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          fontWeight: 700,
          boxShadow: 3,
        }}
      >
        {text ?? t('chat.pat')}
      </Box>
    </Box>
  );
}

export default PatRipple;
