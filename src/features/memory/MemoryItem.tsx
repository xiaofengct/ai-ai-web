import { useCallback } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { CapabilityGate } from '@/components/CapabilityGate';
import { formatAgo } from '@/lib/time';
import { t } from '@/copy';
import { ml } from './memoryCopy';
import type { MemoryEntry } from '@/types/memory';

/**
 * 记忆条目（FN-56 列表 / FN-57 得分展示）。
 *
 * ★ 得分口径：默认 BM25 关键词相关性（0~1），**不是语义相似度**——
 *   这一条用 `alt.bm25Score` 的文案挂在 Tooltip 上讲清楚，避免用户误读。
 */

export interface MemoryItemProps {
  entry: MemoryEntry;
  selected?: boolean;
  onToggleSelect?: (entry: MemoryEntry) => void;
  onEdit?: (entry: MemoryEntry) => void;
  onDelete?: (entry: MemoryEntry) => void;
  dense?: boolean;
}

export function MemoryItem({
  entry,
  selected = false,
  onToggleSelect,
  onEdit,
  onDelete,
  dense = false,
}: MemoryItemProps): JSX.Element {
  const handleToggle = useCallback(() => onToggleSelect?.(entry), [entry, onToggleSelect]);
  const handleEdit = useCallback(() => onEdit?.(entry), [entry, onEdit]);
  const handleDelete = useCallback(() => onDelete?.(entry), [entry, onDelete]);

  const score = Number.isFinite(entry.score) ? entry.score : 0;
  const tags = (entry.tags ?? []).filter(Boolean);

  return (
    <Card
      variant="outlined"
      sx={{ bgcolor: selected ? 'action.selected' : undefined, borderColor: selected ? 'primary.main' : undefined }}
    >
      <CardContent sx={{ p: dense ? 1.25 : 1.75 }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          {onToggleSelect ? (
            <Checkbox
              checked={selected}
              onChange={handleToggle}
              sx={{ mt: -0.5, minWidth: 44, minHeight: 44 }}
              inputProps={{ 'aria-label': ml('label.memoryContent') }}
            />
          ) : null}

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {entry.content}
            </Typography>

            {tags.length > 0 ? (
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.75, flexWrap: 'wrap', rowGap: 0.5 }}>
                {tags.map((tag) => (
                  <Chip key={tag} size="small" label={tag} sx={{ fontFamily: 'monospace' }} />
                ))}
              </Stack>
            ) : null}

            <Stack direction="row" spacing={1.25} sx={{ mt: 0.75, flexWrap: 'wrap', rowGap: 0.25 }}>
              {/* ★ 得分展示 + 口径说明（FN-57） */}
              <Tooltip title={t('alt.bm25Score')} arrow>
                <Typography
                  variant="caption"
                  sx={{ fontFamily: 'monospace', opacity: 0.85, cursor: 'help' }}
                >
                  {`${ml('label.memoryScore')} ${score.toFixed(2)}`}
                </Typography>
              </Tooltip>
              {entry.weight ? (
                <Typography variant="caption" sx={{ fontFamily: 'monospace', opacity: 0.7 }}>
                  {`${ml('label.memoryWeight')} ${entry.weight}`}
                </Typography>
              ) : null}
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                {formatAgo(entry.timeRef ?? entry.updatedAt)}
              </Typography>
              {entry.correction && entry.correction.length > 0 ? (
                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                  {`${ml('label.memoryCorrection')} ${entry.correction.length}`}
                </Typography>
              ) : null}
            </Stack>
          </Box>

          <Stack direction="row" spacing={0.5}>
            {onEdit ? (
              <Tooltip title={t('common.edit')} arrow>
                <IconButton size="small" onClick={handleEdit} sx={{ minWidth: 44, minHeight: 44 }} aria-label={t('common.edit')}>
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            {onDelete ? (
              <CapabilityGate featureId="FN-56">
                <IconButton
                  size="small"
                  onClick={handleDelete}
                  sx={{ minWidth: 44, minHeight: 44 }}
                  aria-label={t('common.delete')}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </CapabilityGate>
            ) : null}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default MemoryItem;
