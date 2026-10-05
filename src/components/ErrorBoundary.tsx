import { Component, type ErrorInfo, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { t } from '@/copy';
import { copyText } from '@/lib/download';
import { useLogStore } from '@/store/logStore';
import { AppError, toAppError } from '@/lib/errors';

/**
 * ★ 错误边界（PG-27 崩溃页的基础设施）。
 *
 * - 捕获渲染期错误，降级到崩溃视图（默认内置；T07 可用 `fallback` 换成 CrashPage）；
 * - 支持「重载」与「安全模式重载」（安全模式 = 清掉 UI 快照后重载，规避脏状态导致的循环崩溃）；
 * - 错误同时写入日志流（脱敏后）。
 */
export interface ErrorBoundaryProps {
  children: ReactNode;
  /** 自定义崩溃视图（T07 的 CrashPage 用） */
  fallback?: (error: AppError, reset: () => void) => ReactNode;
  /**作用域标记（便于定位是哪个区块崩了） */
  scope?: string;
  /** 错误上报回调 */
  onError?: (error: AppError, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: AppError | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toAppError(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const appError = toAppError(error);
    useLogStore.getState().push(
      'error',
      'ui',
      `${t('ui.renderError')}${this.props.scope ? `（${this.props.scope}）` : ''}`,
      { message: appError.message, componentStack: info.componentStack },
    );
    this.props.onError?.(appError, info);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  private readonly reload = (): void => {
    window.location.reload();
  };

  private readonly reloadSafeMode = (): void => {
    // 安全模式：清掉可能与崩溃相关的 UI/主题快照，保留业务数据（会话/记忆）
    try {
      localStorage.removeItem('ai-ai.ui.v1');
      localStorage.removeItem('ai-ai.theme.v1');
    } catch {
      /* 忽略 */
    }
    window.location.reload();
  };

  private readonly copyLogs = async (): Promise<void> => {
    await copyText(useLogStore.getState().exportJSONL());
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
        <Paper sx={{ p: 3, maxWidth: 560, width: '100%' }} variant="outlined">
          <Typography variant="h6" sx={{ mb: 1 }}>
            {t('crash.title')}
          </Typography>
          <Typography variant="body2" sx={{ mb: 2, opacity: 0.85 }}>
            {t('crash.desc')}
          </Typography>
          <Paper
            variant="outlined"
            sx={{ p: 1.5, mb: 2, bgcolor: 'action.hover', fontFamily: 'monospace', fontSize: 12 }}
          >
            {error.code} · {error.message}
          </Paper>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="contained" onClick={this.reload}>
              {t('crash.reload')}
            </Button>
            <Button variant="outlined" onClick={this.reloadSafeMode}>
              {t('crash.safeMode')}
            </Button>
            <Button variant="text" onClick={() => void this.copyLogs()}>
              {t('crash.copyLogs')}
            </Button>
          </Box>
        </Paper>
      </Box>
    );
  }
}

export default ErrorBoundary;
