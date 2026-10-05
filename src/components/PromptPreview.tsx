import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { copyText } from '@/lib/download';
import { t } from '@/copy';
import { TokenBadge } from './TokenBadge';
import type { PromptSegment, PromptSegmentId } from '@/types/prompt';

/**
 * 提示词预览（PG-10 上下文设置 / PG-19 开发者页）：
 * 逐段展示 12 段内容、开关与 token 占用；修改后应实时变化。
 *
 * ★ 说明：这里的开关只影响**预览**，真正的注入控制落在
 *   `ChatSettings.injectControl`（FN-30），由 PersonaCompiler 消费。
 */
export interface PromptPreviewProps {
  segments: readonly PromptSegment[];
  /** 总 token（不传则由 segments 累加） */
  totalTokens?: number;
  /** token 预算（超过时告警） */
  budget?: number;
  warnings?: readonly string[];
  /** 逐段开关变化回调 */
  onToggle?: (id: PromptSegmentId, enabled: boolean) => void;
  /** 是否允许开关（只读预览时 false） */
  editable?: boolean;
  /** 默认展开的段（不传则全部折叠标题） */
  defaultExpanded?: boolean;
}

export function PromptPreview({
  segments,
  totalTokens,
  budget,
  warnings,
  onToggle,
  editable = false,
  defaultExpanded = false,
}: PromptPreviewProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    defaultExpanded ? Object.fromEntries(segments.map((s) => [s.id, true])) : {},
  );

  const total = useMemo(
    () => totalTokens ?? segments.reduce((sum, s) => sum + (s.enabled ? s.tokenEstimate : 0), 0),
    [segments, totalTokens],
  );

  const fullText = useMemo(
    () => segments.filter((s) => s.enabled).map((s) => `## ${s.label}\n${s.content}`).join('\n\n'),
    [segments],
  );

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {t('ui.promptPreview')}
        </Typography>
        <TokenBadge value={total} budget={budget} />
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t('ui.copyPrompt')} arrow>
          <IconButton size="small" onClick={() => void copyText(fullText)}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {warnings && warnings.length > 0 ? (
        <Stack direction="row" spacing={0.5} sx={{ mb: 1, flexWrap: 'wrap', gap: 0.5 }}>
          {warnings.map((w) => (
            <Chip key={w} size="small" color="warning" variant="outlined" label={w} />
          ))}
        </Stack>
      ) : null}

      <Stack spacing={0.5}>
        {[...segments]
          .sort((a, b) => a.order - b.order)
          .map((seg) => {
            const open = expanded[seg.id] ?? false;
            return (
              <Paper key={seg.id} variant="outlined" sx={{ p: 1, opacity: seg.enabled ? 1 : 0.5 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <IconButton
                    size="small"
                    onClick={() => setExpanded((prev) => ({ ...prev, [seg.id]: !open }))}
                    aria-label={t('ui.expand')}
                  >
                    <ExpandMoreIcon
                      fontSize="small"
                      sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }}
                    />
                  </IconButton>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {seg.label}
                  </Typography>
                  <Chip size="small" label={seg.id} sx={{ fontFamily: 'monospace', fontSize: 11 }} />
                  <TokenBadge value={seg.tokenEstimate} />
                  {seg.truncated ? (
                    <Chip size="small" color="warning" variant="outlined" label={t('ui.segmentTruncated')} />
                  ) : null}
                  <Box sx={{ flex: 1 }} />
                  {editable ? (
                    <Switch
                      size="small"
                      checked={seg.enabled}
                      onChange={(e) => onToggle?.(seg.id, e.target.checked)}
                    />
                  ) : (
                    <Chip
                      size="small"
                      variant="outlined"
                      color={seg.enabled ? 'primary' : 'default'}
                      label={seg.enabled ? t('ui.segmentInjected') : t('ui.segmentNotInjected')}
                    />
                  )}
                </Stack>
                <Collapse in={open} unmountOnExit>
                  <Typography
                    component="pre"
                    sx={{
                      mt: 1,
                      p: 1,
                      m: 0,
                      fontSize: 12,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      fontFamily: 'monospace',
                      maxHeight: 320,
                      overflow: 'auto',
                    }}
                  >
                    {seg.content || t('ui.segmentEmpty')}
                  </Typography>
                </Collapse>
              </Paper>
            );
          })}
      </Stack>
    </Paper>
  );
}

export default PromptPreview;
