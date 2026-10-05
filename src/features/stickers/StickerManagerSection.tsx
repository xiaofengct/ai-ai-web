import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import CloudDownloadOutlinedIcon from '@mui/icons-material/CloudDownloadOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SearchIcon from '@mui/icons-material/Search';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { StickerImage } from '@/components/StickerImage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useSnack } from '@/hooks/useSnack';
import { blobRepo } from '@/db/repo/blobRepo';
import { stickerRepo } from '@/db/repo/stickerRepo';
import { webSearchImages } from '@/llm/webSearch';
import { toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { extractUrls } from '@/lib/text';
import type { StickerItem, StickerPack } from '@/types/media';
import {
  importStickersFromFiles,
  addRemoteStickers,
  MAX_STICKER_BYTES,
  MAX_STICKER_COUNT,
  type StickerImportSkipReason,
} from './stickerImport';
import {
  screenStickerUrls,
  validateManualUrl,
  REJECT_REASON_TEXT,
  NO_IMAGE_PROVIDER_TEXT,
  type StickerSearchCandidate,
  type StickerCandidateReject,
} from './stickerSearch';
import { importSkipText, stickerErrorText, vs as sl2, type StickerTextKey } from './stickersCopy';

/**
 * ★★ 表情包管理（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 一个页面收三件事
 * ═══════════════════════════════════════════════════════════════════════════
 *   ① **看**：已导入的包与条目（图片网格，不再是一行行文字 Chip）
 *   ② **导入**：本地文件（多张图片 / zip）
 *   ③ **联网搜索**：搜关键词拉候选图 + 粘贴图片链接
 *
 * ── 用户明确要求说明的四件事，在界面上的落点 ───────────────────────────
 *
 * | 要求 | 落点 |
 * |---|---|
 * | **加载** | 每块区域独立 loading（导入显示进度文案、搜索显示 spinner），互不阻塞 |
 * | **失败** | **分类提示**：超大小/格式不对/解压失败/写库失败/不是图片直链…各有各的话与解法 |
 * | **内容安全** | 搜索结果的**来源域名可见** + 被剔除项**可展开查看原因** + 必须用户逐张点选 |
 * | **边界如实说明** | 页面底部固定一段"能做到 / 做不到"，见 `stickersCopy.ts` 的 `note.limits` |
 *
 * ── 为什么"被剔除的"也要给用户看（而不是静默丢掉）────────────────────────
 *   静默丢弃会让用户困惑："我搜了 30 张怎么只有 5 张？"
 *   而把原因摊开（"22 张不是图片直链"）既解释清楚，也**让安全策略可被审视** ——
 *   一条不透明的过滤规则，出了误伤没人能发现。
 */
type Tab = 'mine' | 'search';

export function StickerManagerSection(): JSX.Element {
  const snack = useSnack();
  const [tab, setTab] = useState<Tab>('mine');

  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [importing, setImporting] = useState<boolean>(false);
  const [lastReport, setLastReport] = useState<string[]>([]);
  const [showRejected, setShowRejected] = useState<boolean>(false);
  const [pendingDeletePack, setPendingDeletePack] = useState<StickerPack | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // —— 联网搜索 ——
  const [query, setQuery] = useState<string>('');
  const [searching, setSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string>('');
  const [noImageProvider, setNoImageProvider] = useState<boolean>(false);
  const [candidates, setCandidates] = useState<StickerSearchCandidate[]>([]);
  const [rejected, setRejected] = useState<Array<{ url: string; reason: StickerCandidateReject }>>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [manualUrl, setManualUrl] = useState<string>('');
  const [manualError, setManualError] = useState<string>('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    const res = await stickerRepo.list();
    setPacks(res.ok ? res.value : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allItems = useMemo(() => packs.flatMap((p) => p.items.map((it) => ({ pack: p, item: it }))), [packs]);
  const withImage = useMemo(
    () => allItems.filter((x) => Boolean(x.item.assetId) || Boolean(x.item.remoteUrl)),
    [allItems],
  );

  /** 导入：把报告翻译成人话（分类，不是一句"导入失败"） */
  const handleImport = useCallback(
    async (files: FileList): Promise<void> => {
      setImporting(true);
      setLastReport([]);
      try {
        const report = await importStickersFromFiles(Array.from(files));
        const lines: string[] = [];
        if (report.added > 0) lines.push(sl2('sk.imported', { count: report.added }));
        if (report.skipped.length > 0) {
          // ★ 按**原因**聚合计数，而不是逐文件列 200 行 —— 用户要的是"哪类问题有几张"
          const byReason = new Map<StickerImportSkipReason, number>();
          for (const s of report.skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
          for (const [reason, count] of byReason) {
            lines.push(`${importSkipText(reason)}（${count} 张）`);
          }
        }
        if (lines.length === 0) lines.push(sl2('err.nothingToImport'));
        setLastReport(lines);
        if (report.added > 0) snack.success('ok.saved');
        else snack.warn('err.importEmpty');
        await load();
      } catch (e) {
        setLastReport([stickerErrorText(toAppError(e, 'DB_FAILED').code)]);
        snack.error('err.unknown');
        log.warn('app', '表情包导入异常', String(e));
      } finally {
        setImporting(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [load, snack],
  );

  const handleSearch = useCallback(async (): Promise<void> => {
    const q = query.trim();
    if (q === '') return;
    setSearching(true);
    setSearchError('');
    setNoImageProvider(false);
    setCandidates([]);
    setRejected([]);
    setPicked(new Set());
    try {
      const outcome = await webSearchImages(q);
      if (!outcome.supportsImages) {
        setNoImageProvider(true);
        return;
      }
      const screened = screenStickerUrls(outcome.urls, q);
      setCandidates(screened.candidates);
      setRejected(screened.rejected);
      if (screened.candidates.length === 0) setSearchError(sl2('err.searchNoImage'));
    } catch (e) {
      // ★ 失败**分类**：CORS / 没配 Key / 超时 各有各的解法
      const err = toAppError(e, 'LLM_BAD_RESPONSE');
      setSearchError(stickerErrorText(err.code));
      log.warn('app', '表情包搜索失败', { code: err.code }, 'FN-45');
    } finally {
      setSearching(false);
    }
  }, [query]);

  const togglePick = useCallback((url: string): void => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  /** 把选中的候选加进"联网搜来的"包 */
  const handleAddPicked = useCallback(async (): Promise<void> => {
    if (picked.size === 0) return;
    const chosen = candidates.filter((c) => picked.has(c.url));
    const rep = await addRemoteStickers(chosen.map((c) => ({ url: c.url, description: c.description })));
    if (rep.added > 0) {
      snack.success('ok.saved');
      setCandidates((prev) => prev.filter((c) => !picked.has(c.url)));
      setPicked(new Set());
      await load();
    } else {
      snack.error('err.unknown');
    }
  }, [picked, candidates, load, snack]);

  /** 手动粘贴链接 */
  const handleAddManual = useCallback(async (): Promise<void> => {
    setManualError('');
    // ★ 用户可能整段粘进来（含说明文字）⇒ 先从中抠出 URL，而不是要求他精确到字符
    const urls = extractUrls(manualUrl);
    const target = urls[0] ?? manualUrl.trim();
    const check = validateManualUrl(target);
    if (!check.ok) {
      setManualError(REJECT_REASON_TEXT[check.reason]);
      return;
    }
    const rep = await addRemoteStickers([{ url: check.url, description: query.trim() || '表情' }]);
    if (rep.added > 0) {
      snack.success('ok.saved');
      setManualUrl('');
      await load();
    } else {
      snack.error('err.unknown');
    }
  }, [manualUrl, query, load, snack]);

  const confirmDeletePack = useCallback(async (): Promise<void> => {
    if (!pendingDeletePack) return;
    const target = pendingDeletePack;
    setPendingDeletePack(null);
    const res = await stickerRepo.remove(target.id);
    if (!res.ok) {
      snack.error('err.dbFailed');
      return;
    }
    // ★ 顺手清 blob：本包的图片路径都带 `stickers/<packId>/` 前缀
    //   （导入时就是这么写的），按前缀整批删，不留孤儿
    await blobRepo.removeByPrefix(`stickers/${target.id}/`);
    snack.success('ok.deleted');
    await load();
  }, [pendingDeletePack, load, snack]);

  return (
    <Box>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={tab}
        onChange={(_e, next: Tab | null) => {
          if (next) setTab(next);
        }}
        sx={{ mb: 1.5 }}
      >
        <ToggleButton value="mine" sx={{ px: 1.75, minHeight: 36 }}>
          {sl2('tab.mine')}
        </ToggleButton>
        <ToggleButton value="search" sx={{ px: 1.75, minHeight: 36 }}>
          {sl2('tab.search')}
        </ToggleButton>
      </ToggleButtonGroup>

      {/* ══════════════ 我的表情 ══════════════ */}
      {tab === 'mine' ? (
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1, mb: 1 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={importing ? <CircularProgress size={14} /> : <UploadFileOutlinedIcon />}
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              sx={{ minHeight: 40 }}
            >
              {importing ? sl2('ui.importing') : sl2('ui.import')}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.zip,application/zip"
              multiple
              hidden
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) void handleImport(files);
              }}
            />
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {sl2('hint.importShape', { mb: MAX_STICKER_BYTES / 1024 / 1024, max: MAX_STICKER_COUNT })}
            </Typography>
          </Stack>

          {lastReport.length > 0 ? (
            <Alert severity={lastReport[0].startsWith('已') ? 'success' : 'warning'} sx={{ mb: 1.5, py: 0.25 }}>
              {lastReport.map((l) => (
                <Typography key={l} variant="caption" sx={{ display: 'block' }}>
                  {l}
                </Typography>
              ))}
            </Alert>
          ) : null}

          {loading ? (
            <Stack alignItems="center" sx={{ py: 3 }}>
              <CircularProgress size={20} />
            </Stack>
          ) : null}

          {!loading && allItems.length === 0 ? (
            <Typography variant="body2" sx={{ opacity: 0.65, py: 2 }}>
              {sl2('empty.packs')}
            </Typography>
          ) : null}

          {!loading && allItems.length > 0 && withImage.length === 0 ? (
            <Alert severity="info" sx={{ mb: 1.5 }}>
              {sl2('note.noImageYet')}
            </Alert>
          ) : null}

          {/* 图片网格 */}
          {withImage.length > 0 ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
                gap: 1,
              }}
            >
              {withImage.map(({ pack, item }) => (
                <Tooltip key={`${pack.id}-${item.fileName}`} title={item.description} arrow>
                  <Box>
                    <StickerImage item={item} size={76} />
                  </Box>
                </Tooltip>
              ))}
            </Box>
          ) : null}

          {/* 包列表（管理：删除/计数） */}
          {!loading && packs.length > 0 ? (
            <Box sx={{ mt: 2 }}>
              <Divider sx={{ mb: 1 }} />
              <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mb: 0.75 }}>
                {sl2('label.packs')}
              </Typography>
              <Stack spacing={0.75}>
                {packs.map((p) => (
                  <Stack key={p.id} direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={p.name} sx={{ maxWidth: 200 }} />
                    <Typography variant="caption" sx={{ opacity: 0.6 }}>
                      {sl2('label.packCount', { count: p.items.length })}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Tooltip title={sl2('ui.deletePack')} arrow>
                      <IconButton
                        size="small"
                        onClick={() => setPendingDeletePack(p)}
                        aria-label={sl2('ui.deletePack')}
                        sx={{ minWidth: 40, minHeight: 40 }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                ))}
              </Stack>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {/* ══════════════ 联网搜索 ══════════════ */}
      {tab === 'search' ? (
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <TextField
              size="small"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={sl2('sk.searchPlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSearch();
              }}
              sx={{ minWidth: 160, flex: '1 1 160px' }}
            />
            <Button
              variant="contained"
              size="small"
              startIcon={searching ? <CircularProgress size={14} color="inherit" /> : <SearchIcon />}
              disabled={searching || query.trim() === ''}
              onClick={() => void handleSearch()}
              sx={{ minHeight: 40 }}
            >
              {searching ? sl2('ui.searching') : sl2('sk.search')}
            </Button>
            <Button
              variant="text"
              size="small"
              disabled={picked.size === 0}
              onClick={() => void handleAddPicked()}
              sx={{ minHeight: 40 }}
            >
              {sl2('ui.addPicked', { count: picked.size })}
            </Button>
          </Stack>

          {/* 这家服务不提供图片 ⇒ 明确说清，并引导到粘贴链接 */}
          {noImageProvider ? (
            <Alert severity="info" sx={{ mt: 1.5 }}>
              {NO_IMAGE_PROVIDER_TEXT}
            </Alert>
          ) : null}

          {searchError !== '' ? (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              {searchError}
            </Alert>
          ) : null}

          {searching ? (
            <Stack alignItems="center" spacing={1} sx={{ py: 3 }}>
              <CircularProgress size={22} />
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                {sl2('ui.searchingHint')}
              </Typography>
            </Stack>
          ) : null}

          {/* 候选网格：点击 = 选中（打勾边框） */}
          {candidates.length > 0 ? (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mb: 0.75 }}>
                {sl2('label.candidates', { count: candidates.length })}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))',
                  gap: 1,
                }}
              >
                {candidates.map((c) => {
                  const isPicked = picked.has(c.url);
                  return (
                    <Box key={c.url}>
                      <Box
                        onClick={() => togglePick(c.url)}
                        role="button"
                        aria-pressed={isPicked}
                        sx={{
                          position: 'relative',
                          borderRadius: 1.5,
                          outline: isPicked ? '2px solid' : 'none',
                          outlineColor: 'primary.main',
                          outlineOffset: 2,
                          cursor: 'pointer',
                        }}
                      >
                        <StickerImage
                          item={{ description: c.description, fileName: c.url, remoteUrl: c.url, source: 'remote' }}
                          size={84}
                        />
                      </Box>
                      {/* ★ 来源域名可见 —— 内容安全的一部分：
                          用户能看到"这张来自哪个站"，而不是只看到一个不知来源的图 */}
                      <Typography
                        variant="caption"
                        sx={{
                          display: 'block',
                          opacity: 0.55,
                          fontSize: 10,
                          mt: 0.25,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.host}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ) : null}

          {/* 被剔除的（不静默丢弃，可展开看原因） */}
          {rejected.length > 0 ? (
            <Box sx={{ mt: 1.5 }}>
              <Button size="small" variant="text" onClick={() => setShowRejected((v) => !v)} sx={{ minHeight: 36 }}>
                {sl2('ui.showRejected', { count: rejected.length })}
              </Button>
              <Collapse in={showRejected}>
                <Stack spacing={0.25} sx={{ pl: 1 }}>
                  {rejected.slice(0, 30).map((r, i) => (
                    <Typography key={`${r.url}-${i}`} variant="caption" sx={{ opacity: 0.6, display: 'block' }}>
                      {`· ${REJECT_REASON_TEXT[r.reason]}：${r.url.slice(0, 70)}`}
                    </Typography>
                  ))}
                </Stack>
              </Collapse>
            </Box>
          ) : null}

          {/* 手动粘贴链接 —— 唯一永远可用的路 */}
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" sx={{ opacity: 0.65, display: 'block', mb: 0.75 }}>
            {sl2('label.manualUrl')}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <TextField
              size="small"
              value={manualUrl}
              onChange={(e) => {
                setManualUrl(e.target.value);
                if (manualError !== '') setManualError('');
              }}
              placeholder="https://…/cat.png"
              error={manualError !== ''}
              helperText={manualError}
              sx={{ minWidth: 200, flex: '1 1 200px' }}
            />
            <Button
              variant="outlined"
              size="small"
              startIcon={<CloudDownloadOutlinedIcon />}
              onClick={() => void handleAddManual()}
              sx={{ minHeight: 40 }}
            >
              {sl2('ui.addManual')}
            </Button>
          </Stack>
        </Box>
      ) : null}

      {/* ══════════════ 边界说明（固定可见，不藏在帮助里）══════════════ */}
      <Divider sx={{ my: 2 }} />
      <Typography variant="caption" sx={{ display: 'block', opacity: 0.62, lineHeight: 1.6 }}>
        {(sl2('note.limits') as string).split('\n').map((line) => (
          <span key={line}>
            {line}
            <br />
          </span>
        ))}
      </Typography>

      <ConfirmDialog
        open={pendingDeletePack !== null}
        titleKey="confirm.deleteStickerPack"
        confirmKey="common.delete"
        cancelKey="common.cancel"
        danger
        onConfirm={() => void confirmDeletePack()}
        onCancel={() => setPendingDeletePack(null)}
      />
    </Box>
  );
}

export default StickerManagerSection;

/** 文案 key 再导出（供聊天页的表情面板复用同一张表） */
export type { StickerTextKey };
/** 条目类型再导出，省得调用方从两处引 */
export type { StickerItem };
