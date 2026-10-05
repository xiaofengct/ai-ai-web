import { useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { EmptyState } from '@/components/EmptyState';
import { NumberField } from '@/components/NumberField';
import { SettingsField } from '../SettingsField';
import { sl } from '../settingsCopy';
import { useSettingsStore } from '@/store/settingsStore';
import { useMemoryStore } from '@/store/memoryStore';
import { to } from '@/router/paths';
import { t } from '@/copy';
import type { MemoryScope } from '@/types/memory';

/**
 * 记忆分组（FN-28 / FN-29 / FN-48 / FN-56 / FN-57）。
 *
 * ★ FN-57 的得分口径必须讲清楚：默认走 BM25 关键词检索，
 *   得分是**相关性分数**而不是语义相似度（能力表 `partial` 的原因），
 *   想要语义相似度得再接 embedding（PL-15，默认关闭）。
 */
export function MemorySection(): JSX.Element {
  const chat = useSettingsStore((s) => s.settings.chat);
  const setChat = useSettingsStore((s) => s.setChat);

  const entries = useMemoryStore((s) => s.entries);
  const reload = useMemoryStore((s) => s.reload);

  useEffect(() => {
    void reload('global');
  }, [reload]);

  /** 按当前 scope 统计可见条数（只读展示，不做过滤逻辑） */
  const visibleCount = useMemo(() => {
    if (chat.memoryScope === 'global') return entries.length;
    return entries.length;
  }, [entries.length, chat.memoryScope]);

  const handleScope = useCallback(
    (next: MemoryScope): void => {
      setChat({ memoryScope: next });
    },
    [setChat],
  );

  return (
    <Box>
      {/* —— FN-56 记忆库入口 —— */}
      <SettingsField labelKey="label.memoryLib" hintKey="hint.memoryLib" featureId="FN-56">
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip size="small" variant="outlined" label={`${sl('ui.total')} ${visibleCount}`} />
          <Button
            size="small"
            variant="outlined"
            component={Link}
            to={to.memories()}
            sx={{ minHeight: 44 }}
          >
            {sl('ui.goPage')}
          </Button>
        </Stack>
      </SettingsField>

      {/* —— FN-29 提供范围记忆 —— */}
      <SettingsField labelKey="label.memoryScope" hintCopyKey="settings.hint.memoryScope" featureId="FN-29">
        <TextField
          select
          size="small"
          value={chat.memoryScope}
          onChange={(e) => handleScope(e.target.value as MemoryScope)}
          sx={{ minWidth: 130 }}
        >
          {/* 三个范围选项走文案总表的 settings.scope.*（与聊天内上下文页同一套 key） */}
          <MenuItem value="session">{t('settings.scope.session')}</MenuItem>
          <MenuItem value="global">{t('settings.scope.global')}</MenuItem>
          <MenuItem value="range">{t('settings.scope.range')}</MenuItem>
        </TextField>
      </SettingsField>

      {/* —— FN-57 得分门槛 —— */}
      <SettingsField labelKey="label.memoryThreshold" hintCopyKey="settings.hint.memoryThreshold" featureId="FN-57">
        <Tooltip title={`${chat.memoryScoreThreshold.toFixed(2)}`} arrow>
          <Box sx={{ width: 180 }}>
            <Slider
              value={chat.memoryScoreThreshold}
              onChange={(_e, v) => setChat({ memoryScoreThreshold: Array.isArray(v) ? v[0] : v })}
              min={0}
              max={1}
              step={0.05}
              size="small"
            />
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {sl('ui.estimate')}
            </Typography>
          </Box>
        </Tooltip>
      </SettingsField>

      {/* —— FN-28 提供完整记忆库（partial：必然被截断） —— */}
      <SettingsField labelCopyKey="settings.memory.full" hintKey="hint.fullMemory" featureId="FN-28">
        <Switch
          checked={chat.provideFullMemory}
          onChange={(e) => setChat({ provideFullMemory: e.target.checked })}
        />
      </SettingsField>

      {/* —— FN-48 自动总结 —— */}
      <SettingsField labelKey="label.autoSummary" hintCopyKey="settings.hint.autoSummary" featureId="FN-48">
        <Switch
          checked={chat.autoSummary.enabled}
          onChange={(e) => setChat({ autoSummary: { enabled: e.target.checked } })}
        />
      </SettingsField>
      <SettingsField labelKey="label.summaryThreshold" hintKey="hint.summaryThreshold" nested featureId="FN-48">
        <NumberField
          value={chat.autoSummary.threshold}
          onChange={(v) => setChat({ autoSummary: { threshold: v } })}
          min={5}
          max={1000}
          step={5}
          presets={[20, 40, 80, 160]}
          disabled={!chat.autoSummary.enabled}
          width={110}
        />
      </SettingsField>

      {entries.length === 0 ? (
        <Box sx={{ py: 1.5 }}>
          <EmptyState descKey="empty.memories" dense />
        </Box>
      ) : null}
    </Box>
  );
}

export default MemorySection;
