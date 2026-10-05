import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { t } from '@/copy';

/**
 * 输入状态指示（FN-20）。
 *
 * ★ 为什么不用 MUI 的 Skeleton：这里要的是「她在打字」的呼吸感，
 *   三个点的错峰动画比骨架屏更像人。动画写在 `theme/global.css` 的 `.ai-ai-breathe`，
 *   并且在 `prefers-reduced-motion` 下自动停（无障碍）。
 */
export interface TypingIndicatorProps {
  /** 覆盖默认文案（默认走 copy 表） */
  variant?: 'typing' | 'streaming' | 'summarizing';
  dense?: boolean;
}

const COPY_BY_VARIANT = {
  typing: 'chat.typing',
  streaming: 'loading.streaming',
  summarizing: 'chat.summarizing',
} as const;

export function TypingIndicator({ variant = 'typing', dense = false }: TypingIndicatorProps): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ px: dense ? 1 : 2, py: 0.75 }}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1.25,
          py: 0.75,
          borderRadius: 3,
          bgcolor: 'action.hover',
        }}
      >
        {[0, 1, 2].map((i) => (
          <Box
            key={i}
            className="ai-ai-breathe"
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              bgcolor: 'primary.main',
              opacity: 0.75,
              animationDelay: `${i * 0.18}s`,
            }}
          />
        ))}
      </Box>
      <Typography variant="caption" sx={{ opacity: 0.6 }}>
        {t(COPY_BY_VARIANT[variant])}
      </Typography>
    </Stack>
  );
}

export default TypingIndicator;
