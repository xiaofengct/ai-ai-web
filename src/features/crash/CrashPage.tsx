import { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExploreOffIcon from '@mui/icons-material/ExploreOff';
import { copyText } from '@/lib/download';
import { redact, type AppError } from '@/lib/errors';
import { useLogStore } from '@/store/logStore';
import { useSnack } from '@/hooks/useSnack';
import { SK } from '@/constants/storageKeys';
import { t } from '@/copy';

/**
 * 崩溃页（PG-27）。三种出场方式：
 * 1. 任意组件抛错 → `ErrorBoundary` 的 fallback（`App.tsx` 里接入），带完整错误对象；
 * 2. 路由级 `errorElement`（`router/index.tsx`）；
 * 3. 未匹配路由 `*` → `variant='notFound'`，不显示堆栈。
 *
 * 三个动作：**复制日志**（睁一只眼的排查入口）/ **重新加载** / **安全模式重载**
 * （安全模式 = 清掉 UI 与主题快照后重载，规避脏状态导致的循环崩溃；业务数据一概不动）。
 */
export type CrashVariant = 'crash' | 'notFound';

export interface CrashPageProps {
  /** 捕获到的错误（ErrorBoundary / errorElement 传入） */
  error?: AppError;
  /** crash = 组件崩溃；notFound = 路由未匹配 */
  variant?: CrashVariant;
  /** 重试回调（错误边界的 reset） */
  onRetry?: () => void;
}

/** 安全模式：只清 UI/主题快照，**保留会话与记忆** */
function reloadInSafeMode(): void {
  try {
    localStorage.removeItem(SK.ui);
    localStorage.removeItem(SK.theme);
  } catch {
    /* 隐私模式下不可写，忽略 */
  }
  window.location.reload();
}

export function CrashPage({ error, variant = 'crash', onRetry }: CrashPageProps): JSX.Element {
  const snack = useSnack();
  const [copied, setCopied] = useState<boolean>(false);
  const isNotFound = variant === 'notFound';

  /** 复制日志：日志流已过 redact，导出前再兜一层 */
  const handleCopyLogs = useCallback(async (): Promise<void> => {
    const jsonl = redact(useLogStore.getState().exportJSONL());
    const detail = error ? JSON.stringify(redact(error.toJSON()), null, 2) : '';
    const okDone = await copyText(detail ? `${jsonl}\n${detail}` : jsonl);
    setCopied(okDone);
    // ★ 复制成功/失败要给各自的文案：原来走 snack.raw() 会被恒译成「好了」，失败也报成功（B-03）
    if (okDone) snack.success('common.copied');
    else snack.error('err.unknown');
  }, [error, snack]);

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: { xs: 2, md: 4 }, minHeight: '60dvh' }}>
      <Paper variant="outlined" sx={{ p: 3, maxWidth: 620, width: '100%', borderRadius: 3 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ color: isNotFound ? 'text.secondary' : 'error.main', display: 'flex' }}>
              {isNotFound ? <ExploreOffIcon /> : <ErrorOutlineIcon />}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {t(isNotFound ? 'app.title' : 'crash.title')}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.8 }}>
                {t(isNotFound ? 'empty.search' : 'crash.desc')}
              </Typography>
            </Box>
          </Stack>

          {error && !isNotFound ? (
            <Paper
              variant="outlined"
              sx={{
                p: 1.5,
                bgcolor: 'action.hover',
                fontFamily: 'monospace',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {`${String(redact(error.code))} · ${String(redact(error.message))}\n${String(redact(error.at))}`}
            </Paper>
          ) : null}

          <Divider />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} flexWrap="wrap">
            <Button variant="contained" onClick={() => window.location.reload()} sx={{ minHeight: 44 }}>
              {t('crash.reload')}
            </Button>
            <Button variant="outlined" onClick={reloadInSafeMode} sx={{ minHeight: 44 }}>
              {t('crash.safeMode')}
            </Button>
            <Button variant="text" onClick={() => void handleCopyLogs()} sx={{ minHeight: 44 }}>
              {t('crash.copyLogs')}
            </Button>
            {onRetry ? (
              <Button variant="text" onClick={onRetry} sx={{ minHeight: 44 }}>
                {t('common.retry')}
              </Button>
            ) : null}
            {/* 用原生 <a> 而不是路由跳转：崩溃页可能在 RouterProvider 之外出现 */}
            <Button variant="text" component="a" href="/" sx={{ minHeight: 44 }}>
              {t('common.back')}
            </Button>
          </Stack>

          {copied ? (
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {t('common.copied')}
            </Typography>
          ) : null}
        </Stack>
      </Paper>
    </Box>
  );
}

export default CrashPage;
