import { useEffect } from 'react';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import { t } from '@/copy';
import { useUiStore } from '@/store/uiStore';

/**
 * 全局 Snackbar 宿主（架构文档 §2）。
 * ★ 所有提示都从这里出，文案**只走 CopyKey**（`copy/xinran.ts`）。
 */
export function SnackbarHost() {
  const snacks = useUiStore((s) => s.snacks);
  const dismissSnack = useUiStore((s) => s.dismissSnack);

  // 页面卸载时清空队列，避免残留定时器
  useEffect(
    () => () => {
      useUiStore.setState({ snacks: [] });
    },
    [],
  );

  if (snacks.length === 0) return null;

  return (
    <Stack
      sx={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 24,
        zIndex: (theme) => theme.zIndex.snackbar,
        gap: 1,
        width: 'min(92vw, 460px)',
      }}
    >
      {snacks.slice(-3).map((snack, index) => (
        <Snackbar
          key={snack.id}
          open
          // 多条时错开一点，避免完全重叠
          sx={{ position: 'relative', bottom: index * 4, pointerEvents: 'auto' }}
          autoHideDuration={snack.durationMs ?? 3000}
          onClose={(_event, reason) => {
            if (reason === 'clickaway') return;
            dismissSnack(snack.id);
          }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert
            severity={snack.severity === 'default' ? 'info' : snack.severity}
            variant="filled"
            onClose={() => dismissSnack(snack.id)}
            sx={{ width: '100%' }}
          >
            {t(snack.key, snack.vars)}
          </Alert>
        </Snackbar>
      ))}
    </Stack>
  );
}

export default SnackbarHost;
