import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined';
import { useNavigate } from 'react-router-dom';
import { feedbackRepo } from '@/db/repo/feedbackRepo';
import { to } from '@/router/paths';
import { formatRelative } from '@/lib/time';
import type { FeedbackItem } from '@/types/feedback';
import { FeedbackDialog } from './FeedbackDialog';
import { fb, statusText } from './feedbackCopy';

/**
 * ★ 设置页的「反馈与建议」分区（2026-10-04）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这个分区只有两个职责
 * ═══════════════════════════════════════════════════════════════════════════
 *   ① **入口**：一个「我要反馈」按钮，打开提交对话框；
 *   ② **回执**：列出最近几条，让用户知道"我交过的东西还在"，
 *      以及每条现在是什么状态（没看过 / 看过了 / 已处理 / 不打算改）。
 *
 * ★ 完整的查看与管理（筛选、改状态、写备注、导出全部）在**独立页面**
 *   （`/settings/feedback`，即"反馈信箱"）。为什么不都塞在这个分区里：
 *   设置页的分区是**一行行配置项**，把一张带筛选器的列表塞进去，
 *   会让这一屏的高度完全不可控 —— 而设置页此前已经因为布局塌方返工过一次
 *   （见 `SettingsPage.tsx` 文件头）。⇒ 入口在这里，列表去独立页。
 *
 * ★ 这里**不做**未读角标的"红点焦虑"设计：只在一个 Chip 里写"有 N 条没看"。
 *   应用没有服务端，这些反馈**永远不会被任何人自动读到**，
 *   用红点催用户去看自己写给自己的东西，是没有意义的。
 */

/** 设置页里最多列几条（完整列表在信箱页） */
const PREVIEW_LIMIT = 3;

export function FeedbackSection(): JSX.Element {
  const navigate = useNavigate();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [unread, setUnread] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    const [listRes, unreadRes] = await Promise.all([
      feedbackRepo.listRecent(PREVIEW_LIMIT),
      feedbackRepo.countNew(),
    ]);
    setItems(listRes.ok ? listRes.value : []);
    setUnread(unreadRes.ok ? unreadRes.value : 0);
    const countRes = await feedbackRepo.count();
    setTotal(countRes.ok ? countRes.value : 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Button
          variant="contained"
          size="small"
          startIcon={<RateReviewOutlinedIcon />}
          onClick={() => setDialogOpen(true)}
          sx={{ minHeight: 40 }}
        >
          {fb('fb.action.write')}
        </Button>
        {unread > 0 ? (
          <Chip size="small" color="warning" variant="outlined" label={fb('fb.label.unread', { count: unread })} />
        ) : null}
        {total > 0 ? (
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {fb('fb.label.count', { count: total })}
          </Typography>
        ) : null}
      </Stack>

      {loading ? (
        <Stack alignItems="center" sx={{ py: 2 }}>
          <CircularProgress size={18} />
        </Stack>
      ) : null}

      {/* —— 最近几条（回执性质，不是完整列表）—— */}
      {!loading && items.length > 0 ? (
        <Stack spacing={0.75} sx={{ mt: 1.5 }}>
          {items.map((it) => (
            <Stack
              key={it.id}
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ borderLeft: '2px solid', borderColor: 'divider', pl: 1 }}
            >
              <Typography
                variant="caption"
                sx={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  opacity: 0.8,
                }}
              >
                {it.content}
              </Typography>
              <Chip size="small" variant="outlined" label={statusText(it.status)} sx={{ height: 20 }} />
              <Typography variant="caption" sx={{ opacity: 0.5, whiteSpace: 'nowrap' }}>
                {formatRelative(it.createdAt)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      ) : null}

      {!loading && items.length === 0 ? (
        <Typography variant="body2" sx={{ opacity: 0.65, py: 1.5 }}>
          {fb('fb.empty.none')}
        </Typography>
      ) : null}

      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        <Button
          variant="text"
          size="small"
          onClick={() => navigate(to.settingsFeedback())}
          sx={{ minHeight: 36 }}
        >
          {fb('fb.action.openInbox')}
        </Button>
      </Stack>

      {/* ★ 边界说明固定可见（口径同 `stickersCopy.ts` 的 `note.limits`） */}
      <Alert severity="info" sx={{ mt: 1.5, py: 0.25 }}>
        <Typography variant="caption" sx={{ lineHeight: 1.7, display: 'block' }}>
          {(fb('fb.note.local') as string).split('\n').map((line) => (
            <span key={line}>
              {line}
              <br />
            </span>
          ))}
        </Typography>
      </Alert>

      <FeedbackDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          void load();
        }}
        onSubmitted={() => void load()}
      />
    </Box>
  );
}

export default FeedbackSection;
