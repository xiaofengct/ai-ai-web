import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { EmptyState } from '@/components/EmptyState';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { MarkdownView } from '@/components/MarkdownView';
import { useUiStore } from '@/store/uiStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSnack } from '@/hooks/useSnack';
import { messageRepo } from '@/db/repo/messageRepo';
import { formatClock, formatDate } from '@/lib/time';
import { t } from '@/copy';
import type { Message } from '@/types/chat';

/**
 * 全屏文本（PG-22，全屏页：路由里不套 AppShell）。
 *
 * ★ 为什么单独做一个页而不是在气泡里展开：
 *   长回复（尤其是 Markdown 表格 / 代码块）在气泡里会被 `maxWidth: 82%` 和
 *   行内换行规则压得很难读；全屏页给的是**读者模式**——字号可调、宽度铺满、可复制。
 *
 * ★ 字号存 `uiStore.readerFontSize`（持久化），
 *   下次打开还是上次调的那个大小——阅读偏好不该每次重设。
 */

const MIN_FONT = 12;
const MAX_FONT = 28;

export function TextFullScreenPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const snack = useSnack();

  const fontSize = useUiStore((s) => s.readerFontSize);
  const setReaderFontSize = useUiStore((s) => s.setReaderFontSize);
  const markdown = useSettingsStore((s) => s.settings.chat.enableMarkdown);

  const [message, setMessage] = useState<Message | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      const res = await messageRepo.get(id);
      if (!alive) return;
      if (res.ok) setMessage(res.value);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const copy = async (): Promise<void> => {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message.content);
      snack.success('common.copied');
    } catch {
      // 剪贴板在非安全上下文 / 无权限时会失败，给个明确反馈而不是静默
      snack.error('err.unknown');
    }
  };

  if (loading) return <LoadingOverlay open textKey="loading.default" inline />;

  if (!message) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState descKey="empty.messages" />
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* —— 顶栏 —— */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
            {t('chat.textTitle')}
          </Typography>
          <Typography variant="caption" noWrap sx={{ opacity: 0.55 }}>
            {`${formatDate(message.createdAt)} ${formatClock(message.createdAt)}`}
          </Typography>
        </Box>

        <Tooltip title={t('chat.copy')}>
          <IconButton size="small" onClick={() => void copy()} aria-label={t('chat.copy')}>
            <ContentCopyIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title={t('common.close')}>
          <IconButton size="small" onClick={() => navigate(-1)} aria-label={t('common.close')}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* —— 正文 —— */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: { xs: 2, sm: 4 }, py: 2 }}>
        {markdown ? (
          <MarkdownView content={message.content} enabled />
        ) : (
          <Typography sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize }}>
            {message.content}
          </Typography>
        )}
      </Box>

      {/* —— 字号调节 —— */}
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}
      >
        <Typography variant="caption" sx={{ opacity: 0.7, whiteSpace: 'nowrap' }}>
          {t('chat.readerFont')}
        </Typography>
        <Slider
          size="small"
          value={fontSize}
          min={MIN_FONT}
          max={MAX_FONT}
          step={1}
          onChange={(_e, value) => setReaderFontSize(Array.isArray(value) ? (value[0] ?? fontSize) : value)}
          sx={{ flex: 1 }}
          aria-label={t('chat.readerFont')}
        />
        <Typography variant="caption" sx={{ opacity: 0.7, minWidth: 36, textAlign: 'right' }}>
          {String(fontSize)}
        </Typography>
      </Stack>
    </Box>
  );
}

export default TextFullScreenPage;
