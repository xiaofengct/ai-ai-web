import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import IosShareIcon from '@mui/icons-material/IosShare';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useSnack } from '@/hooks/useSnack';
import { feedbackRepo } from '@/db/repo/feedbackRepo';
import { formatTimeAware } from '@/lib/time';
import { log } from '@/store/logStore';
import {
  FEEDBACK_STATUSES,
  MAX_FEEDBACK_NOTE_LENGTH,
  type FeedbackItem,
  type FeedbackStatus,
} from '@/types/feedback';
import { ENV_FIELDS, envLabel, envValue } from './feedbackEnv';
import { fb, kindText, statusText } from './feedbackCopy';
import { exportFeedbackJson, exportFeedbackText, formatFeedbackItem, shareOrCopy } from './feedbackShare';

/**
 * ★ 反馈信箱（`/settings/feedback`，2026-10-04）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这是「管理」那一半：用户能查看、筛选、改状态、写备注、导出、删除
 * ═══════════════════════════════════════════════════════════════════════════
 * 另一半是设置页里的「我要反馈」提交入口（`FeedbackSection`）。
 *
 * ── 几个刻意的设计决定 ────────────────────────────────────────────────────
 *
 * ① **状态是用户自己标的，不是"系统已受理"**。
 *    这个应用没有服务端，没有任何人能受理它。所以四档状态写的是
 *    「没看过 / 看过了 / 已经处理 / 看了，不打算改」——
 *    全是**用户自己给自己的回执**，而不是假装有个客服在跟进。
 *    第一版起过的名字是「待处理 / 处理中 / 已完成」，那是**在骗自己**，已改。
 *
 * ② **`不打算改` 必须是独立一档**，不能并进「已处理」。
 *    并进去的意思就是"这事我解决了"，而实际是"这事我不做"。
 *    两者混在一起，回看时完全无法区分该不该再提。
 *
 * ③ **备注是给你自己留的**（不是给用户的回话通道 —— 没有回话通道）。
 *    所以 placeholder 是"给自己留一句，比如'下版修'"。
 *
 * ④ **导出两种格式**：`.txt` 给人看、直接粘进聊天窗口；`.json` 给机器看、
 *    留档或将来想导回去。两个按钮都点得动，不靠"用户应该选哪个"来省一个按钮。
 *
 * ⑤ **边界说明固定可见**（`fb.note.inboxScope`）：这个信箱看的是**这台设备**上的，
 *    不是所有人的。不说这句，用户会以为这里是"所有用户的反馈汇总"。
 */

type Filter = FeedbackStatus | 'all';

export function FeedbackInboxPage(): JSX.Element {
  const snack = useSnack();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<Filter>('all');
  /** 展开查看环境快照 / 写备注的条目 id */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** 备注草稿：id → 文本（未保存前只活在内存里） */
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<FeedbackItem | null>(null);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    const res = await feedbackRepo.listRecent(500);
    setItems(res.ok ? res.value : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const out = { bug: 0, idea: 0, content: 0, other: 0 };
    for (const it of items) out[it.kind] += 1;
    return out;
  }, [items]);

  const shown = useMemo(
    () => (filter === 'all' ? items : items.filter((it) => it.status === filter)),
    [items, filter],
  );

  const toggleExpand = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleStatus = useCallback(
    async (item: FeedbackItem, status: FeedbackStatus): Promise<void> => {
      const res = await feedbackRepo.setStatus(item.id, status);
      if (!res.ok) {
        snack.error('err.dbFailed');
        return;
      }
      await load();
    },
    [load, snack],
  );

  const handleSaveNote = useCallback(
    async (item: FeedbackItem): Promise<void> => {
      const draft = notes[item.id] ?? item.adminNote ?? '';
      const res = await feedbackRepo.setNote(item.id, draft);
      if (!res.ok) {
        snack.error('err.dbFailed');
        return;
      }
      snack.success('ok.feedbackNoteSaved');
      await load();
    },
    [notes, load, snack],
  );

  const handleCopy = useCallback(
    async (item: FeedbackItem): Promise<void> => {
      const outcome = await shareOrCopy(formatFeedbackItem(item), fb('fb.inbox.title'));
      if (outcome === 'failed') snack.error('err.feedbackCopyFailed');
      else snack.success('common.copied');
    },
    [snack],
  );

  const handleShare = useCallback(
    async (item: FeedbackItem): Promise<void> => {
      const outcome = await shareOrCopy(formatFeedbackItem(item), fb('fb.inbox.title'));
      if (outcome === 'failed') snack.error('err.feedbackShareFailed');
      else if (outcome === 'copied') snack.success('common.copied');
    },
    [snack],
  );

  const confirmDelete = useCallback(async (): Promise<void> => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    const res = await feedbackRepo.remove(target.id);
    if (!res.ok) {
      snack.error('err.dbFailed');
      return;
    }
    snack.success('ok.deleted');
    await load();
  }, [pendingDelete, load, snack]);

  const doClearAll = useCallback(async (): Promise<void> => {
    setConfirmClear(false);
    const res = await feedbackRepo.clear();
    if (!res.ok) {
      snack.error('err.dbFailed');
      return;
    }
    log.info('app', '反馈：本机全部清空');
    snack.success('ok.deleted');
    await load();
  }, [load, snack]);

  const handleExport = useCallback(
    (kind: 'text' | 'json'): void => {
      if (items.length === 0) {
        snack.warn('err.importEmpty');
        return;
      }
      const name = kind === 'text' ? exportFeedbackText(items) : exportFeedbackJson(items);
      if (name === null) {
        snack.warn('err.importEmpty');
        return;
      }
      snack.success('ok.exported');
    },
    [items, snack],
  );

  return (
    <Box sx={{ width: '100%', maxWidth: 880, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {fb('fb.inbox.title')}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {fb('fb.inbox.desc')}
        </Typography>
      </Stack>

      {/* —— 统计 + 导出 —— */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="caption" sx={{ opacity: 0.65 }}>
          {fb('fb.inbox.stat', stats)}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadOutlinedIcon />}
          onClick={() => handleExport('text')}
          sx={{ minHeight: 36 }}
        >
          {fb('fb.action.exportAll')}
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadOutlinedIcon />}
          onClick={() => handleExport('json')}
          sx={{ minHeight: 36 }}
        >
          {fb('fb.action.exportJson')}
        </Button>
      </Stack>

      {/* —— 筛选 —— */}
      <Box sx={{ mt: 1.5 }}>
        <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mb: 0.5 }}>
          {fb('fb.label.filterStatus')}
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={filter}
          onChange={(_e, next: Filter | null) => {
            if (next) setFilter(next);
          }}
          sx={{ flexWrap: 'wrap', gap: 0.5 }}
        >
          <ToggleButton value="all" sx={{ px: 1.5, minHeight: 34 }}>
            {fb('fb.label.all')}
          </ToggleButton>
          {FEEDBACK_STATUSES.map((s) => (
            <ToggleButton key={s} value={s} sx={{ px: 1.5, minHeight: 34 }}>
              {statusText(s)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      <Divider sx={{ my: 2 }} />

      {loading ? (
        <Stack alignItems="center" sx={{ py: 4 }}>
          <CircularProgress size={22} />
        </Stack>
      ) : null}

      {!loading && shown.length === 0 ? (
        <Typography variant="body2" sx={{ opacity: 0.65, py: 2 }}>
          {items.length === 0 ? fb('fb.empty.none') : fb('fb.empty.filtered')}
        </Typography>
      ) : null}

      {/* —— 列表 —— */}
      <Stack spacing={1.5}>
        {shown.map((item) => {
          const open = expanded.has(item.id);
          const noteDraft = notes[item.id] ?? item.adminNote ?? '';
          return (
            <Box
              key={item.id}
              sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 1.25 }}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                <Chip size="small" label={kindText(item.kind)} sx={{ height: 22 }} />
                <Chip
                  size="small"
                  variant="outlined"
                  label={statusText(item.status)}
                  color={item.status === 'new' ? 'warning' : 'default'}
                  sx={{ height: 22 }}
                />
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" sx={{ opacity: 0.5 }}>
                  {formatTimeAware(item.createdAt)}
                </Typography>
              </Stack>

              <Typography
                variant="body2"
                onClick={() => toggleExpand(item.id)}
                sx={{ mt: 0.75, whiteSpace: 'pre-wrap', cursor: 'pointer' }}
              >
                {item.content}
              </Typography>

              {item.contact ? (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.65 }}>
                  {`${fb('fb.label.contact')}：${item.contact}`}
                </Typography>
              ) : null}

              {/* —— 动作行 —— */}
              <Stack
                direction="row"
                spacing={0.5}
                alignItems="center"
                sx={{ mt: 1, flexWrap: 'wrap', rowGap: 0.5 }}
              >
                {item.status !== 'read' ? (
                  <Button size="small" variant="text" onClick={() => void handleStatus(item, 'read')} sx={{ minHeight: 34 }}>
                    {fb('fb.action.markRead')}
                  </Button>
                ) : null}
                {item.status !== 'resolved' ? (
                  <Button size="small" variant="text" onClick={() => void handleStatus(item, 'resolved')} sx={{ minHeight: 34 }}>
                    {fb('fb.action.markResolved')}
                  </Button>
                ) : null}
                {item.status !== 'wontfix' ? (
                  <Button size="small" variant="text" onClick={() => void handleStatus(item, 'wontfix')} sx={{ minHeight: 34 }}>
                    {fb('fb.action.markWontfix')}
                  </Button>
                ) : null}
                <Box sx={{ flex: 1 }} />
                <Tooltip title={fb('fb.action.copy')} arrow>
                  <IconButton size="small" onClick={() => void handleCopy(item)} aria-label={fb('fb.action.copy')}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={fb('fb.action.share')} arrow>
                  <IconButton size="small" onClick={() => void handleShare(item)} aria-label={fb('fb.action.share')}>
                    <IosShareIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={fb('fb.action.note')} arrow>
                  <Button size="small" variant="text" onClick={() => toggleExpand(item.id)} sx={{ minHeight: 34 }}>
                    {fb('fb.action.note')}
                  </Button>
                </Tooltip>
                <Tooltip title={fb('fb.action.delete')} arrow>
                  <IconButton
                    size="small"
                    onClick={() => setPendingDelete(item)}
                    aria-label={fb('fb.action.delete')}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>

              {/* —— 展开：环境快照 + 备注 —— */}
              <Collapse in={open}>
                <Box sx={{ mt: 1, pt: 1, borderTop: '1px dashed', borderColor: 'divider' }}>
                  <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mb: 0.5 }}>
                    {fb('fb.label.envTitle')}
                  </Typography>
                  {ENV_FIELDS.map((field) => {
                    const raw = item.env[field];
                    if (!raw) return null;
                    return (
                      <Typography
                        key={field}
                        variant="caption"
                        sx={{ display: 'block', fontFamily: 'monospace', opacity: 0.7, wordBreak: 'break-all' }}
                      >
                        {`${envLabel(field)}: ${envValue(field, raw)}`}
                      </Typography>
                    );
                  })}

                  <TextField
                    size="small"
                    fullWidth
                    multiline
                    minRows={2}
                    value={noteDraft}
                    placeholder={fb('fb.label.notePlaceholder')}
                    onChange={(e) =>
                      setNotes((prev) => ({ ...prev, [item.id]: e.target.value.slice(0, MAX_FEEDBACK_NOTE_LENGTH) }))
                    }
                    label={fb('fb.label.note')}
                    sx={{ mt: 1 }}
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => void handleSaveNote(item)}
                    sx={{ mt: 0.75, minHeight: 34 }}
                  >
                    {fb('fb.action.saveNote')}
                  </Button>
                </Box>
              </Collapse>
            </Box>
          );
        })}
      </Stack>

      {/* —— 清空 —— */}
      {items.length > 0 ? (
        <>
          <Divider sx={{ my: 2 }} />
          <Button
            size="small"
            color="error"
            variant="outlined"
            startIcon={<DeleteOutlineIcon />}
            onClick={() => setConfirmClear(true)}
            sx={{ minHeight: 36 }}
          >
            {fb('fb.action.clearAll')}
          </Button>
        </>
      ) : null}

      {/* ★ 边界说明固定可见：这个信箱是"这台设备"的，不是所有人的 */}
      <Alert severity="info" sx={{ mt: 2, py: 0.25 }}>
        <Typography variant="caption" sx={{ lineHeight: 1.7, display: 'block' }}>
          {(fb('fb.note.inboxScope') as string).split('\n').map((line) => (
            <span key={line}>
              {line}
              <br />
            </span>
          ))}
        </Typography>
      </Alert>

      <ConfirmDialog
        open={pendingDelete !== null}
        titleKey="confirm.deleteFeedback"
        confirmKey="common.delete"
        cancelKey="common.cancel"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={confirmClear}
        titleKey="confirm.clearFeedback"
        descKey="common.delete"
        confirmKey="common.delete"
        cancelKey="common.cancel"
        danger
        onConfirm={() => void doClearAll()}
        onCancel={() => setConfirmClear(false)}
      >
        <Typography variant="caption" sx={{ display: 'block', mt: 1, opacity: 0.7, lineHeight: 1.7 }}>
          {(fb('fb.note.clearWarn') as string).split('\n').map((line) => (
            <span key={line}>
              {line}
              <br />
            </span>
          ))}
        </Typography>
      </ConfirmDialog>
    </Box>
  );
}

export default FeedbackInboxPage;
