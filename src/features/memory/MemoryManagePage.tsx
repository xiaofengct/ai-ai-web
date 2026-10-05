import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SummarizeOutlinedIcon from '@mui/icons-material/SummarizeOutlined';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { SearchBar } from '@/components/SearchBar';
import { memoryRepo } from '@/db/repo/memoryRepo';
import { downloadJSON } from '@/lib/download';
import { useSnack } from '@/hooks/useSnack';
import { log } from '@/store/logStore';
import { useNavigate } from 'react-router-dom';
import { to } from '@/router/paths';
import { t } from '@/copy';
import { sl } from '@/features/settings/settingsCopy';
import { ml, mlv } from './memoryCopy';
import { MemoryItem } from './MemoryItem';
import { SummaryScopeDialog } from './SummaryScopeDialog';
import type { MemoryEntry } from '@/types/memory';
import type { UUID } from '@/types/common';

/**
 * 记忆库管理（PG-12 / FN-56 / FN-57）。
 *
 * 三件事必须都好用：
 * 1. **标签过滤**（多值索引 `memories[*tags]`）；
 * 2. **关键词搜索**（`memoryRepo.search`，BM25 之外的兜底；命中后仍按得分排序）；
 * 3. **展示得分**（FN-57，并在 Tooltip 里讲清「这是相关性，不是语义相似度」）。
 *
 * 另提供：多选删除、导出、以及「总结一段对话」（PG-11 / FN-48）的入口。
 */

export function MemoryManagePage(): JSX.Element {
  const navigate = useNavigate();
  const snack = useSnack();

  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [keyword, setKeyword] = useState<string>('');
  const [activeTag, setActiveTag] = useState<string>('');
  const [minScore, setMinScore] = useState<number>(0);
  const [selected, setSelected] = useState<Set<UUID>>(new Set<UUID>());
  const [summaryOpen, setSummaryOpen] = useState<boolean>(false);
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    const [tagRes, listRes] = await Promise.all([
      memoryRepo.allTags(),
      keyword.trim() ? memoryRepo.search(keyword.trim(), 500) : memoryRepo.list(),
    ]);
    setTags(tagRes.ok ? tagRes.value : []);
    setEntries(listRes.ok ? listRes.value : []);
    if (!listRes.ok) log.warn('memory', 'load memories failed', listRes.error, 'FN-56');
    setLoading(false);
  }, [keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 客户端再过一遍标签与得分（搜索与列表统一口径） */
  const visible = useMemo<MemoryEntry[]>(() => {
    return entries
      .filter((e) => (activeTag ? (e.tags ?? []).includes(activeTag) : true))
      .filter((e) => (Number.isFinite(e.score) ? e.score : 0) >= minScore)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [activeTag, entries, minScore]);

  const toggle = useCallback((entry: MemoryEntry): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.add(entry.id);
      return next;
    });
  }, []);

  const allSelected = visible.length > 0 && visible.every((e) => selected.has(e.id));

  const toggleAll = useCallback((): void => {
    setSelected((prev) => {
      if (visible.length > 0 && visible.every((e) => prev.has(e.id))) return new Set<UUID>();
      return new Set<UUID>(visible.map((e) => e.id));
    });
  }, [visible]);

  const handleDeleteSelected = useCallback(async (): Promise<void> => {
    const ids = [...selected];
    if (ids.length === 0) {
      setDeleteOpen(false);
      return;
    }
    const res = await memoryRepo.removeMany(ids);
    setDeleteOpen(false);
    if (!res.ok) {
      snack.error('err.dbFailed');
      log.warn('memory', 'delete memory failed', res.error, 'FN-56');
      return;
    }
    setSelected(new Set<UUID>());
    snack.success('ok.deleted');
    await load();
  }, [load, selected, snack]);

  const handleDeleteOne = useCallback(
    async (entry: MemoryEntry): Promise<void> => {
      setSelected(new Set<UUID>([entry.id]));
      setDeleteOpen(true);
    },
    [],
  );

  const handleExport = useCallback((): void => {
    if (visible.length === 0) {
      snack.info('common.done');
      return;
    }
    downloadJSON(visible, `memories-${Date.now()}.json`);
    snack.success('ok.exported');
  }, [snack, visible]);

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2.5 }, maxWidth: 960, mx: 'auto' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {ml('page.memory.title')}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.7 }}>
            {mlv('label.memoryCount', { n: visible.length })}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<SummarizeOutlinedIcon />}
          onClick={() => setSummaryOpen(true)}
          sx={{ minHeight: 44 }}
        >
          {ml('label.summaryTitle')}
        </Button>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate(to.memoryEdit('new'))}
          sx={{ minHeight: 44 }}
        >
          {ml('page.memoryEditor.new')}
        </Button>
      </Stack>

      <Typography variant="body2" sx={{ opacity: 0.8, mb: 2, whiteSpace: 'pre-wrap' }}>
        {ml('page.memory.desc')}
      </Typography>

      <SearchBar value={keyword} onChange={setKeyword} placeholder={t('common.search')} />

      {/* —— 标签过滤（FN-56）—— */}
      {tags.length > 0 ? (
        <Stack direction="row" spacing={0.5} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 0.75, alignItems: 'center' }}>
          <Typography variant="caption" sx={{ opacity: 0.7, mr: 0.5 }}>
            {ml('label.memoryFilterTag')}
          </Typography>
          <Chip
            size="small"
            label={ml('label.memoryAllTags')}
            color={activeTag ? 'default' : 'primary'}
            onClick={() => setActiveTag('')}
            sx={{ minHeight: 32 }}
          />
          {tags.map((tag) => (
            <Chip
              key={tag}
              size="small"
              label={tag}
              color={activeTag === tag ? 'primary' : 'default'}
              onClick={() => setActiveTag(activeTag === tag ? '' : tag)}
              sx={{ minHeight: 32, fontFamily: 'monospace' }}
            />
          ))}
        </Stack>
      ) : null}

      {/* —— 得分门槛（FN-57）—— */}
      <Box sx={{ mt: 1.5, px: 1 }}>
        <Typography variant="caption" sx={{ opacity: 0.7 }}>
          {`${ml('label.memoryMinScore')} · ${minScore.toFixed(2)}`}
        </Typography>
        <Slider
          value={minScore}
          onChange={(_, v) => setMinScore(Array.isArray(v) ? (v[0] ?? 0) : v)}
          min={0}
          max={1}
          step={0.05}
          size="small"
          aria-label={ml('label.memoryMinScore')}
        />
      </Box>

      <Divider sx={{ my: 2 }} />

      {/* —— 批量操作 —— */}
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
        <Button size="small" onClick={toggleAll} disabled={visible.length === 0} sx={{ minHeight: 44 }}>
          {allSelected ? t('common.deselectAll') : t('common.selectAll')}
        </Button>
        <Button
          size="small"
          color="error"
          startIcon={<DeleteOutlineIcon />}
          disabled={selected.size === 0}
          onClick={() => setDeleteOpen(true)}
          sx={{ minHeight: 44 }}
        >
          {`${t('common.delete')}${selected.size > 0 ? ` (${selected.size})` : ''}`}
        </Button>
        <Button size="small" onClick={handleExport} disabled={visible.length === 0} sx={{ minHeight: 44 }}>
          {t('common.export')}
        </Button>
      </Stack>

      {loading ? (
        <Typography variant="body2" sx={{ opacity: 0.7 }}>
          {t('loading.default')}
        </Typography>
      ) : visible.length === 0 && activeTag === '' && minScore === 0 ? (
        <EmptyState descKey="empty.memories" />
      ) : visible.length === 0 ? (
        // ★ 有记忆但被过滤条件挡住了：说明是条件太紧，不是我没记住
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            {ml('label.memoryNothing')}
          </Typography>
          <Button
            size="small"
            sx={{ mt: 1.5, minHeight: 44 }}
            onClick={() => {
              setActiveTag('');
              setMinScore(0);
              setKeyword('');
            }}
          >
            {t('common.reset')}
          </Button>
        </Box>
      ) : null}

      {!loading && visible.length > 0 ? (
        <Stack spacing={1.25}>
          {visible.map((entry) => (
            <MemoryItem
              key={entry.id}
              entry={entry}
              selected={selected.has(entry.id)}
              onToggleSelect={toggle}
              onEdit={(e) => navigate(to.memoryEdit(e.id))}
              onDelete={(e) => void handleDeleteOne(e)}
            />
          ))}
        </Stack>
      ) : null}

      <SummaryScopeDialog
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        onDone={() => void load()}
      />

      <ConfirmDialog
        open={deleteOpen}
        titleKey="confirm.deleteMemory"
        confirmKey="common.delete"
        danger
        onConfirm={() => void handleDeleteSelected()}
        onCancel={() => {
          setDeleteOpen(false);
          setSelected(new Set<UUID>());
        }}
      />

      {/* 设置域已有的说明复用，避免重复造文案 */}
      <Typography variant="caption" sx={{ display: 'block', mt: 2, opacity: 0.6 }}>
        {sl('hint.memoryLib')}
      </Typography>
    </Box>
  );
}

export default MemoryManagePage;
