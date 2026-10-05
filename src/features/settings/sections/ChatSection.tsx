import { useCallback } from 'react';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import { NumberField } from '@/components/NumberField';
import { SettingsField } from '../SettingsField';
import { sl } from '../settingsCopy';
import { useAdvancedFlag } from '../useAdvancedFlags';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * 聊天分组（FN-01 / FN-12 / FN-16 / FN-17 / FN-21~24 / FN-27 / FN-32 / FN-44 / FN-46 / FN-60 / FN-63）。
 *
 * ★ FN-16「双击返回键退出」在能力表里是 `unavailable`：
 *   这里**必须**保留控件并交给 `<CapabilityGate>` 置灰（PRD §11 不允许静默缺失），
 *   降级动作（关页面前二次确认）由 `backgroundExitConfirm` 承担。
 */
export function ChatSection(): JSX.Element {
  const chat = useSettingsStore((s) => s.settings.chat);
  const setChat = useSettingsStore((s) => s.setChat);
  const setAppearance = useSettingsStore((s) => s.setAppearance);
  const multiSelect = useSettingsStore((s) => s.settings.appearance.multiSelect);

  /** FN-01 / FN-32 / FN-44：PRD 有这一项，但没有专属字段 → 落 `settings.advanced` */
  const [chatStats, setChatStats] = useAdvancedFlag('FN-01', true);
  const [favoriteEnabled, setFavoriteEnabled] = useAdvancedFlag('FN-32', true);
  const [mergeEnabled, setMergeEnabled] = useAdvancedFlag('FN-44', true);

  /** 词表：一行一个词 */
  const wordsText = chat.contentFilter.words.join('\n');
  const handleWords = useCallback(
    (text: string): void => {
      const words = text
        .split('\n')
        .map((w) => w.trim())
        .filter((w) => w !== '');
      setChat({ contentFilter: { words } });
    },
    [setChat],
  );

  return (
    <Box>
      {/* —— FN-21 启用 Markdown —— */}
      <SettingsField labelKey="label.markdown" hintCopyKey="settings.hint.markdown" featureId="FN-21">
        <Switch
          checked={chat.enableMarkdown}
          onChange={(e) => setChat({ enableMarkdown: e.target.checked })}
        />
      </SettingsField>

      {/* —— FN-22 回车发送 —— */}
      <SettingsField labelKey="label.enterToSend" hintCopyKey="settings.hint.enterToSend" featureId="FN-22">
        <Switch
          checked={chat.enterToSend}
          onChange={(e) => setChat({ enterToSend: e.target.checked })}
        />
      </SettingsField>

      {/* —— FN-23 图片视频立即发送 —— */}
      <SettingsField labelKey="label.mediaImmediate" hintCopyKey="settings.hint.mediaImmediate" featureId="FN-23">
        <Switch
          checked={chat.mediaImmediateSend}
          onChange={(e) => setChat({ mediaImmediateSend: e.target.checked })}
        />
      </SettingsField>

      {/* —— FN-46 自动分割 —— */}
      <SettingsField labelKey="label.autoSplit" hintCopyKey="settings.hint.autoSplit" featureId="FN-46">
        <Switch checked={chat.autoSplit} onChange={(e) => setChat({ autoSplit: e.target.checked })} />
      </SettingsField>

      {/* —— FN-24 多条消息延时 —— */}
      <SettingsField labelKey="label.multiDelay" hintCopyKey="settings.hint.multiDelay" featureId="FN-24">
        <NumberField
          value={chat.multiMessageDelayMs}
          onChange={(v) => setChat({ multiMessageDelayMs: v })}
          min={0}
          max={10_000}
          step={100}
          presets={[0, 400, 800, 1500]}
          width={110}
        />
      </SettingsField>

      {/* —— FN-17 发送延时 —— */}
      <SettingsField labelKey="label.sendDelay" hintCopyKey="settings.hint.sendDelay" featureId="FN-17">
        <NumberField
          value={chat.sendDelayMs}
          onChange={(v) => setChat({ sendDelayMs: v })}
          min={0}
          max={10_000}
          step={50}
          presets={[0, 150, 300, 800]}
          width={110}
        />
      </SettingsField>

      {/* —— FN-60 输入状态 —— */}
      <SettingsField labelKey="label.typingIndicator" hintCopyKey="settings.hint.typingIndicator" featureId="FN-60">
        <Switch
          checked={chat.typingIndicator}
          onChange={(e) => setChat({ typingIndicator: e.target.checked })}
        />
      </SettingsField>

      {/* —— FN-27 拍一拍后缀 —— */}
      <SettingsField labelKey="label.patSuffix" hintCopyKey="settings.hint.patSuffix" featureId="FN-27">
        <TextField
          size="small"
          value={chat.patSuffix}
          onChange={(e) => setChat({ patSuffix: e.target.value })}
          sx={{ width: 160 }}
        />
      </SettingsField>

      {/* —— FN-12 内容过滤 —— */}
      <SettingsField labelKey="label.contentFilter" hintCopyKey="settings.hint.contentFilter" featureId="FN-12">
        <Switch
          checked={chat.contentFilter.enabled}
          onChange={(e) => setChat({ contentFilter: { enabled: e.target.checked } })}
        />
      </SettingsField>
      <SettingsField labelKey="label.contentFilterWords" nested featureId="FN-12">
        <TextField
          size="small"
          multiline
          minRows={2}
          maxRows={6}
          value={wordsText}
          onChange={(e) => handleWords(e.target.value)}
          disabled={!chat.contentFilter.enabled}
          sx={{ width: 220 }}
        />
      </SettingsField>
      <SettingsField labelKey="label.contentFilterMode" nested featureId="FN-12">
        <TextField
          select
          size="small"
          value={chat.contentFilter.mode}
          onChange={(e) =>
            setChat({ contentFilter: { mode: e.target.value as 'replace' | 'truncate' } })
          }
          disabled={!chat.contentFilter.enabled}
          sx={{ minWidth: 120 }}
        >
          <MenuItem value="replace">{sl('filter.mode.replace')}</MenuItem>
          <MenuItem value="truncate">{sl('filter.mode.truncate')}</MenuItem>
        </TextField>
      </SettingsField>

      {/* —— FN-63 消息多选 —— */}
      <SettingsField labelKey="label.multiSelect" hintKey="hint.multiSelect" featureId="FN-63">
        <Switch
          checked={multiSelect}
          onChange={(e) => setAppearance({ multiSelect: e.target.checked })}
        />
      </SettingsField>

      {/* —— FN-01 聊天统计 —— */}
      <SettingsField labelKey="label.chatStats" hintKey="hint.chatStats" featureId="FN-01">
        <Switch checked={chatStats} onChange={(e) => setChatStats(e.target.checked)} />
      </SettingsField>

      {/* —— FN-32 收藏 —— */}
      <SettingsField labelKey="label.favorite" hintKey="hint.favorite" featureId="FN-32">
        <Switch checked={favoriteEnabled} onChange={(e) => setFavoriteEnabled(e.target.checked)} />
      </SettingsField>

      {/* —— FN-44 聊天记录合并 —— */}
      <SettingsField labelKey="label.mergeSessions" hintKey="hint.mergeSessions" featureId="FN-44">
        <Switch checked={mergeEnabled} onChange={(e) => setMergeEnabled(e.target.checked)} />
      </SettingsField>

      {/* —— FN-16 双击返回键退出（unavailable → 置灰 + 原因） —— */}
      <SettingsField labelKey="label.doubleBackExit" hintKey="hint.doubleBackExit" featureId="FN-16">
        <Stack direction="row" spacing={1} alignItems="center">
          <Switch checked={chat.doubleBackExit} onChange={(e) => setChat({ doubleBackExit: e.target.checked })} />
        </Stack>
      </SettingsField>
    </Box>
  );
}

export default ChatSection;
