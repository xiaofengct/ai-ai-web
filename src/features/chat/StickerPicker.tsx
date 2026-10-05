import { useCallback, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import { StickerImage } from '@/components/StickerImage';
import { stickerRepo } from '@/db/repo/stickerRepo';
import { webSearchImages } from '@/llm/webSearch';
import { toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { t } from '@/copy';
import { addRemoteStickers } from '@/features/stickers/stickerImport';
import { screenStickerUrls, type StickerSearchCandidate } from '@/features/stickers/stickerSearch';
import { stickerErrorText, vs } from '@/features/stickers/stickersCopy';
import type { StickerItem } from '@/types/media';

/**
 * ★★ 表情面板（FN-28，2026-10-04 重构）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 改了什么，为什么
 * ═══════════════════════════════════════════════════════════════════════════
 * 旧版把表情渲染成一行行 **文字 Chip** —— 因为内置占位包只有 `description`、
 * 一条真图都没有，于是"表情"退化成了"文字标签"。现在打通了图片链路
 * （`StickerImage` + `blobRepo`），面板改成**图片网格**。
 *
 * ★ 但**文字兜底保留**：旧占位包的 12 条至今仍是纯文字（没有图）。
 *   把它们直接隐藏，等于用户导入新包之前面板一片空白 —— 比显示文字更糟。
 *   ⇒ 有图的走网格，没图的走下面的纯文字区，两块同时存在。
 *
 * ── 用户要求说明的三件事，在这里的落点 ─────────────────────────────────
 * | 要求 | 落点 |
 * |---|---|
 * | **加载** | 打开面板时读库显示 spinner；搜索时显示"正在搜"+ spinner |
 * | **失败** | 分两类：读库失败（本地存储）、搜索失败（无 Key / 跨域 / 超时 / 没图） |
 * | **内容安全** | 搜索结果**显示来源域名** + 逐张点选 + "收录"动作写明会把链接存进来 |
 *
 * ── 为什么把"联网找"放进面板（而不是只在设置里）────────────────────────
 *   用户是在**聊天过程中**才想起"想发个表情"的。此时让他先跳去设置页
 *   再回来，中间聊天上下文就断了。
 *   ⇒ 面板里给一个搜索入口，搜到的直接可发（也顺手入库）。
 *     设置页那份是"管理"（删包、看全部），两处职责不同、都要有。
 */
export interface StickerPickerProps {
  open: boolean;
  onClose: () => void;
  /** 选中一个有图的表情 */
  onPickSticker: (item: StickerItem) => void;
  /** 选中一个无图的表情（把描述当文本插入） */
  onPickText: (text: string) => void;
}

export function StickerPicker({
  open,
  onClose,
  onPickSticker,
  onPickText,
}: StickerPickerProps): JSX.Element {
  const [items, setItems] = useState<StickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [candidates, setCandidates] = useState<StickerSearchCandidate[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError('');
    const res = await stickerRepo.allItems();
    if (res.ok) setItems(res.value);
    else {
      setItems([]);
      setLoadError(stickerErrorText('DB_FAILED'));
    }
    setLoading(false);
  }, []);

  // ★ 每次打开都重读：用户可能刚在设置页导入了新表情，
  //   缓存住就会出现"刚导入的怎么不在这里"。
  useEffect(() => {
    if (!open) return;
    void load();
    // 关掉时清掉上一次的搜索结果 —— 下次打开不该还挂着旧关键词的结果
    setCandidates([]);
    setSearchError('');
    setQuery('');
  }, [open, load]);

  const withImage = useMemo(
    () => items.filter((i) => Boolean(i.assetId) || Boolean(i.remoteUrl)),
    [items],
  );
  const textOnly = useMemo(() => items.filter((i) => !i.assetId && !i.remoteUrl), [items]);

  const handleSearch = useCallback(async (): Promise<void> => {
    const q = query.trim();
    if (q === '') return;
    setSearching(true);
    setSearchError('');
    setCandidates([]);
    try {
      const outcome = await webSearchImages(q, { topK: 12 });
      if (!outcome.supportsImages) {
        setSearchError(vs('err.searchNoImage'));
        return;
      }
      const screened = screenStickerUrls(outcome.urls, q, 18);
      setCandidates(screened.candidates);
      if (screened.candidates.length === 0) setSearchError(vs('err.searchNoImage'));
    } catch (e) {
      const err = toAppError(e, 'LLM_BAD_RESPONSE');
      setSearchError(stickerErrorText(err.code));
      log.warn('app', '聊天面板搜表情失败', { code: err.code }, 'FN-45');
    } finally {
      setSearching(false);
    }
  }, [query]);

  /**
   * 收下并**直接发出去**。
   * ★ 为什么不只是入库：用户点搜索结果时的意图是"发这张"，
   *   不是"把它加进我的收藏"。入库是副作用（顺手完成），发送才是主目的。
   *   ⇒ 一次点击完成两件事，而不是"先收下、再回面板里找它、再点一次"。
   */
  const handleUseCandidate = useCallback(
    async (c: StickerSearchCandidate): Promise<void> => {
      setSaving(true);
      try {
        const rep = await addRemoteStickers([{ url: c.url, description: c.description }]);
        if (rep.added > 0) {
          onPickSticker({ description: c.description, fileName: c.fileName ?? c.url, remoteUrl: c.url, source: 'remote' });
          onClose();
        } else {
          setSearchError(vs('err.stickerDbFailed'));
        }
      } finally {
        setSaving(false);
      }
    },
    [onPickSticker, onClose],
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ pb: 1 }}>{t('chat.sticker')}</DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Stack alignItems="center" sx={{ py: 3 }}>
            <CircularProgress size={20} />
          </Stack>
        ) : null}

        {loadError !== '' ? (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            {loadError}
          </Alert>
        ) : null}

        {!loading && items.length === 0 ? (
          <Typography variant="body2" sx={{ opacity: 0.6, py: 2 }}>
            {t('empty.stickers')}
          </Typography>
        ) : null}

        {/* —— 有图的表情：网格 —— */}
        {withImage.length > 0 ? (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
              gap: 1,
            }}
          >
            {withImage.map((item) => (
              <Box key={`${item.fileName}-${item.assetId ?? item.remoteUrl}`}>
                <StickerImage
                  item={item}
                  size={64}
                  onClick={() => {
                    onPickSticker(item);
                    onClose();
                  }}
                />
              </Box>
            ))}
          </Box>
        ) : null}

        {/* —— 无图的表情：文字兜底（旧占位包就有 12 条这种）—— */}
        {textOnly.length > 0 ? (
          <Box sx={{ mt: withImage.length > 0 ? 2 : 0 }}>
            {withImage.length > 0 ? (
              <Typography variant="caption" sx={{ opacity: 0.5, display: 'block', mb: 0.5 }}>
                {vs('note.noImageYet')}
              </Typography>
            ) : null}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {textOnly.map((item) => (
                <Box
                  key={`text-${item.fileName}`}
                  onClick={() => {
                    onPickText(item.description);
                    onClose();
                  }}
                  role="button"
                  sx={{
                    px: 1,
                    py: 0.25,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    fontSize: 12,
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  {item.description}
                </Box>
              ))}
            </Box>
          </Box>
        ) : null}

        {/* ══════════ 联网找 ══════════ */}
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" spacing={0.75} alignItems="center">
          <TextField
            size="small"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={vs('sk.searchPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSearch();
            }}
            sx={{ flex: 1, minWidth: 0 }}
          />
          <Button
            size="small"
            variant="outlined"
            startIcon={searching ? <CircularProgress size={13} color="inherit" /> : <SearchIcon />}
            disabled={searching || query.trim() === ''}
            onClick={() => void handleSearch()}
            sx={{ minHeight: 40, flexShrink: 0 }}
          >
            {searching ? vs('ui.searching') : vs('sk.search')}
          </Button>
        </Stack>

        {searchError !== '' ? (
          <Alert severity="info" sx={{ mt: 1, py: 0.25 }}>
            <Typography variant="caption">{searchError}</Typography>
          </Alert>
        ) : null}

        {searching ? (
          <Typography variant="caption" sx={{ display: 'block', mt: 1, opacity: 0.6 }}>
            {vs('ui.searchingHint')}
          </Typography>
        ) : null}

        {candidates.length > 0 ? (
          <Box sx={{ mt: 1.25 }}>
            <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mb: 0.5 }}>
              {vs('label.candidates', { count: candidates.length })}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
                gap: 1,
              }}
            >
              {candidates.map((c) => (
                <Box key={c.url}>
                  {/* 点一下 = 收下并发送（理由见 handleUseCandidate） */}
                  <StickerImage
                    item={{ description: c.description, fileName: c.url, remoteUrl: c.url, source: 'remote' }}
                    size={64}
                    onClick={() => {
                      if (!saving) void handleUseCandidate(c);
                    }}
                  />
                  {/* ★ 来源域名可见 —— 内容安全的一部分 */}
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      opacity: 0.5,
                      fontSize: 9,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.host}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        ) : null}
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1, justifyContent: 'space-between' }}>
        <Typography variant="caption" sx={{ opacity: 0.55 }}>
          {vs('hint.panelNote')}
        </Typography>
        <Button size="small" onClick={onClose} sx={{ minHeight: 36 }}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default StickerPicker;
