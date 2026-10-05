import { useCallback } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import VerifiedIcon from '@mui/icons-material/Verified';
import { CapabilityGate } from '@/components/CapabilityGate';
import { formatAgo } from '@/lib/time';
import { t } from '@/copy';
import { pl } from './personaCopy';
import type { PersonaCard } from '@/types/persona';

/**
 * 角色卡展示（架构文档 §2 `features/persona/PersonaCardView.tsx`）。
 *
 * ★ 隐私红线 XR-06：**任何角色都不渲染立绘/头像图片**，只用名字首字做字符头像。
 *   欣然（`isBuiltin`）额外显示「我不生成自己的图」的说明，删不掉也不能改隐私。
 */

export interface PersonaCardViewProps {
  card: PersonaCard;
  /** 紧凑模式（列表内嵌时用） */
  dense?: boolean;
  onEdit?: (card: PersonaCard) => void;
  onDelete?: (card: PersonaCard) => void;
  onExport?: (card: PersonaCard) => void;
  selected?: boolean;
}

/** 名字首字（中文取第一字，英文取首字母大写） */
function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 1).toUpperCase();
}

export function PersonaCardView({
  card,
  dense = false,
  onEdit,
  onDelete,
  onExport,
  selected = false,
}: PersonaCardViewProps): JSX.Element {
  const builtin = card.isBuiltin === true || card.origin === 'xinran';
  const name = card.data.name?.trim() || 'unnamed';
  const tags = (card.data.tags ?? []).filter(Boolean).slice(0, 6);

  const handleEdit = useCallback(() => onEdit?.(card), [card, onEdit]);
  const handleDelete = useCallback(() => onDelete?.(card), [card, onDelete]);
  const handleExport = useCallback(() => onExport?.(card), [card, onExport]);

  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: selected ? 'primary.main' : undefined,
        bgcolor: selected ? 'action.selected' : undefined,
      }}
    >
      <CardContent sx={{ p: dense ? 1.5 : 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          {/* ★ 字符头像：不渲染任何图片（XR-06） */}
          <Avatar
            sx={{
              width: dense ? 36 : 44,
              height: dense ? 36 : 44,
              bgcolor: builtin ? 'primary.main' : 'action.selected',
              fontSize: dense ? 16 : 18,
              fontWeight: 700,
            }}
          >
            {initialOf(name)}
          </Avatar>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
              <Typography variant={dense ? 'subtitle1' : 'h6'} sx={{ fontWeight: 700, wordBreak: 'break-all' }}>
                {name}
              </Typography>
              {builtin ? (
                <Tooltip title={t('tip.privacyNoImage')} arrow>
                  <Chip
                    size="small"
                    icon={<VerifiedIcon />}
                    label={pl('origin.xinran')}
                    color="primary"
                    variant="outlined"
                  />
                </Tooltip>
              ) : (
                <Chip size="small" variant="outlined" label={pl('origin.external')} />
              )}
            </Stack>

            {card.data.description?.trim() ? (
              <Typography variant="body2" sx={{ opacity: 0.8, mt: 0.5, whiteSpace: 'pre-wrap' }}>
                {card.data.description}
              </Typography>
            ) : null}

            {tags.length > 0 ? (
              <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
                {tags.map((tag) => (
                  <Chip key={tag} size="small" label={tag} sx={{ fontFamily: 'monospace' }} />
                ))}
              </Stack>
            ) : null}

            <Typography variant="caption" sx={{ display: 'block', mt: 1, opacity: 0.6 }}>
              {`${pl('label.personaUpdated')} · ${formatAgo(card.updatedAt)}`}
            </Typography>
          </Box>

          <Stack direction="row" spacing={0.5}>
            {onEdit ? (
              <Tooltip title={t('common.edit')} arrow>
                <IconButton size="small" onClick={handleEdit} sx={{ minWidth: 44, minHeight: 44 }} aria-label={t('common.edit')}>
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            {onExport ? (
              <Tooltip title={t('common.export')} arrow>
                <IconButton size="small" onClick={handleExport} sx={{ minWidth: 44, minHeight: 44 }} aria-label={t('common.export')}>
                  <FileDownloadOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            {onDelete ? (
              // ★ 内置卡（欣然）删不掉：入口置灰并说明原因（XR-08）
              builtin ? (
                <CapabilityGate featureId="XR-08">
                  <IconButton size="small" disabled sx={{ minWidth: 44, minHeight: 44 }} aria-label={t('common.delete')}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </CapabilityGate>
              ) : (
                <Tooltip title={t('common.delete')} arrow>
                  <IconButton
                    size="small"
                    onClick={handleDelete}
                    sx={{ minWidth: 44, minHeight: 44 }}
                    aria-label={t('common.delete')}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )
            ) : null}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default PersonaCardView;
