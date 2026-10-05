import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import CameraswitchIcon from '@mui/icons-material/Cameraswitch';
import CloseIcon from '@mui/icons-material/Close';
import ReplayIcon from '@mui/icons-material/Replay';
import { t } from '@/copy';
import { captureFrame, useCamera, type CameraErrorKind } from './useCamera';

/**
 * ★★ 拍照对话框（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 交互流程（用户明确要求写清楚）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ```
 * 点输入框的 📷
 *   → 对话框全屏打开，**此刻才申请相机权限**（不是应用启动时）
 *   → 取流成功：实时预览
 *        ├─ 点「拍下这一张」→ 定格成照片 → 进入复核
 *        ├─ 点「翻转」→ 前后摄像头切换
 *        └─ 点「×」/ 返回 → 关掉，**不产生任何附件**
 *   → 复核界面（这是在对话框**内部**完成的，不另开页面）
 *        ├─ 「用这张」→ 把照片交给输入框，成为待发附件
 *        ├─ 「重拍」→ 回到实时预览
 *        └─ 「×」→ 关掉，丢弃这张
 * ```
 *
 * ── ★ 复核界面为什么重要（这是 `<input capture>` 做不到的事）──────────────
 * 用 `<input type="file" capture>` 也能调起系统相机，但**照片直接就是最终结果** ——
 * 用户拍糊了、拍歪了，只能发出去或者整个重来。原生相机 App 之所以都有
 * "重拍/使用"，就是因为**拍一张照片必然有废片**。
 * ⇒ 要提供这个能力，就必须自建预览（`getUserMedia`），而不是借系统相机。
 *   这也是本模块选择自建而非引入库的**首要原因**（详见 `useCamera.ts` 文件头）。
 *
 * ── 三个刻意的交互决定 ──────────────────────────────────────────────────
 *
 * **① 拍完立刻停掉相机（`enabled: open && !shot`）。**
 *   复核时相机不该继续开着 —— 一方面省电，另一方面**摄像头指示灯灭掉**
 *   能让用户确信"现在没在拍"。等点「重拍」再重新取流。
 *   代价是重拍多等约 200ms，这个代价换来的是明确的状态可见性，值得。
 *
 * **② 照片在对话框内复核，不发出去就不进输入框。**
 *   点「×」直接丢弃，不会在输入框里留下一个需要用户手动删的附件。
 *   "取消了但还得自己清理"是很烦人的体验。
 *
 * **③ 桌面端不做特殊分支。**
 *   `getUserMedia` 在桌面浏览器上取的是**网络摄像头**，同一套代码直接能用；
 *   没有摄像头的机器会走 `noCamera` 分支，文案里已经引导到「发图」按钮。
 *   ⇒ 各端差异全部收在**错误文案**里，而不是收在代码分支里 ——
 *     代码分支会让"桌面端"变成一条很少被测试到的路径。
 */
export interface CameraDialogProps {
  open: boolean;
  onClose: () => void;
  /** 确认使用这张照片（父组件负责写 blob 与挂附件） */
  onCapture: (blob: Blob) => Promise<void> | void;
}

/** 失败分类 → 文案（**六条各自不同**，理由见 `useCamera.ts` 的注释） */
function failureText(kind: CameraErrorKind): string {
  switch (kind) {
    case 'denied':
      return t('chat.cameraErrDenied');
    case 'noCamera':
      return t('chat.cameraErrNoDevice');
    case 'inUse':
      return t('chat.cameraErrInUse');
    case 'insecure':
      return t('chat.cameraErrInsecure');
    case 'unsupported':
      return t('chat.cameraErrUnsupported');
    default:
      return t('chat.cameraErrFailed');
  }
}

export function CameraDialog({ open, onClose, onCapture }: CameraDialogProps): JSX.Element {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  const [shot, setShot] = useState<Blob | null>(null);
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captureError, setCaptureError] = useState('');

  /**
   * ★ `enabled` 里带上 `!shot`：拍照后立刻停流（决定 ①，理由见文件头）。
   *   重拍时 `shot` 变 null ⇒ `enabled` 变 true ⇒ effect 重新取流。
   */
  const { videoRef, status, failure, facing, flip, retry } = useCamera(open && shot === null);

  /** 关掉 / 重拍时释放预览 URL（否则每拍一张泄漏一个 blob URL） */
  const releaseShotUrl = useCallback((): void => {
    setShotUrl((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
  }, []);

  // 对话框关闭 ⇒ 清空这次的所有中间状态（下次打开是干净的）
  useEffect(() => {
    if (open) return;
    releaseShotUrl();
    setShot(null);
    setCaptureError('');
    setBusy(false);
  }, [open, releaseShotUrl]);

  // 卸载兜底（对话框被父组件整体卸载时）
  useEffect(
    () => () => {
      releaseShotUrl();
    },
    [releaseShotUrl],
  );

  const handleShutter = useCallback(async (): Promise<void> => {
    const video = videoRef.current;
    if (!video) return;
    setCaptureError('');
    setBusy(true);
    try {
      // ★ 前置摄像头镜像（所见即所得），后置不镜像 —— 与预览的显示保持一致
      const blob = await captureFrame(video, { mirror: facing === 'user' });
      setShot(blob);
      setShotUrl(URL.createObjectURL(blob));
    } catch (e) {
      setCaptureError(
        e instanceof Error && e.message.includes('尺寸为 0')
          ? t('chat.cameraStarting')
          : t('chat.cameraErrFailed'),
      );
    } finally {
      setBusy(false);
    }
  }, [videoRef, facing]);

  const handleRetake = useCallback((): void => {
    releaseShotUrl();
    setShot(null);
    setCaptureError('');
  }, [releaseShotUrl]);

  const handleUse = useCallback(async (): Promise<void> => {
    if (!shot) return;
    setBusy(true);
    try {
      await onCapture(shot);
      // ★ 成功后由父组件决定关不关；这里主动清掉本地状态，
      //   避免"关掉再打开还挂着上一张"。
      releaseShotUrl();
      setShot(null);
      onClose();
    } finally {
      setBusy(false);
    }
  }, [shot, onCapture, onClose, releaseShotUrl]);

  /** 预览视频的镜像样式：前置摄像头镜像显示（像照镜子），与抓帧一致 */
  const videoSx = useMemo(
    () => ({
      width: '100%',
      maxHeight: fullScreen ? '60vh' : '52vh',
      objectFit: 'cover' as const,
      bgcolor: '#000',
      transform: facing === 'user' ? 'scaleX(-1)' : 'none',
      borderRadius: 1,
      display: 'block',
      // 复核态把视频隐藏但**留在 DOM 里**：卸载再挂载会让 videoRef 短暂为 null，
      // 反而引入时序问题（effect 在挂载前跑，拿不到元素）。
      ...(shot ? { visibility: 'hidden' as const, height: 0 } : null),
    }),
    [facing, fullScreen, shot],
  );

  const showError = status === 'error' && failure;

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1 }}>{shot ? t('chat.cameraShotReady') : t('chat.camera')}</Box>
        <IconButton onClick={onClose} aria-label={t('common.close')} sx={{ minWidth: 44, minHeight: 44 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ bgcolor: 'background.default' }}>
        {/* ——— 失败：分类说明 + 重试 + 替代路径 ——— */}
        {showError ? (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            {failureText(failure.kind)}
          </Alert>
        ) : null}

        {/* ——— 取流中 ——— */}
        {status === 'starting' && !shot ? (
          <Stack alignItems="center" spacing={1} sx={{ py: 5 }}>
            <CircularProgress size={24} />
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              {t('chat.cameraStarting')}
            </Typography>
          </Stack>
        ) : null}

        {/*
          ★★ 视频元素：这三个属性缺一不可（这是检索 `react-webcam` 源码得到的**关键适配点**）
            · `playsInline` —— 不加，移动端 WebView 会切到**全屏原生播放器**
              （表现："一点拍照就跳出去一个黑屏界面"）
            · `muted`      —— 不加，自动播放策略会拦下播放（用户看到纯黑预览）
            · `autoPlay`   —— 同上，配合 muted 才能自动开始
        */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={videoSx as React.CSSProperties}
        />

        {/* ——— 复核：照片预览 ——— */}
        {shotUrl ? (
          <Box
            component="img"
            src={shotUrl}
            alt={t('chat.cameraShotReady')}
            sx={{
              width: '100%',
              maxHeight: fullScreen ? '60vh' : '52vh',
              objectFit: 'contain',
              bgcolor: '#000',
              borderRadius: 1,
              display: 'block',
            }}
          />
        ) : null}

        {captureError !== '' ? (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            {captureError}
          </Alert>
        ) : null}
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1.25, justifyContent: 'center' }}>
        {/* —— 复核态：重拍 / 用这张 —— */}
        {shot ? (
          <Stack direction="row" spacing={1.5} sx={{ width: '100%', justifyContent: 'center' }}>
            <Button
              variant="outlined"
              startIcon={<ReplayIcon />}
              onClick={handleRetake}
              disabled={busy}
              sx={{ minHeight: 44 }}
            >
              {t('chat.cameraRetake')}
            </Button>
            <Button
              variant="contained"
              onClick={() => void handleUse()}
              disabled={busy}
              sx={{ minHeight: 44 }}
            >
              {t('chat.cameraUse')}
            </Button>
          </Stack>
        ) : (
          /* —— 预览态：翻转 / 快门 —— */
          <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%', justifyContent: 'center' }}>
            <IconButton
              onClick={flip}
              disabled={status !== 'live'}
              aria-label={t('chat.cameraFlip')}
              sx={{ minWidth: 48, minHeight: 48 }}
            >
              <CameraswitchIcon />
            </IconButton>

            {/*
              快门：从"拍照"这个动作的通用形状出发，用大号圆形按钮（与系统相机一致）。
              ★ 尺寸 64px 是拇指操作的舒适下限，比 Material 默认的 48px 更大 ——
                拍照是**单手快速操作**，按不准的代价是拍糊或没拍到。
            */}
            <Button
              onClick={() => void handleShutter()}
              disabled={status !== 'live' || busy}
              aria-label={t('chat.cameraShutter')}
              sx={{
                minWidth: 0,
                width: 64,
                height: 64,
                borderRadius: '50%',
                border: 3,
                borderColor: 'primary.main',
                bgcolor: 'primary.main',
                '&:hover': { bgcolor: 'primary.dark' },
                '&.Mui-disabled': { bgcolor: 'action.disabledBackground', borderColor: 'action.disabled' },
              }}
            >
              {busy ? <CircularProgress size={20} color="inherit" /> : null}
            </Button>

            <IconButton
              onClick={retry}
              disabled={status === 'starting'}
              aria-label={t('chat.cameraRetry')}
              sx={{ minWidth: 48, minHeight: 48, visibility: showError ? 'visible' : 'hidden' }}
            >
              <ReplayIcon />
            </IconButton>
          </Stack>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default CameraDialog;
