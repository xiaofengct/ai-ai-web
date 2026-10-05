import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { NumberField } from '@/components/NumberField';
import { SettingRow } from '@/components/SettingRow';
import { EmptyState } from '@/components/EmptyState';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { useSessionSettings } from './useSessionSettings';
import { to } from '@/router/paths';
import { t, type CopyKey } from '@/copy';

/**
 * 聊天设置（PG-09，会话级 `/chat/:id/settings`）。
 *
 * ★ 与全局设置页（T09 `ChatSection`）的分工：
 *   - 这里写的是**本会话覆盖**，改完立刻对当前会话生效；
 *   - 全局默认值在「设置」页改，没被覆盖的项会跟着全局走；
 *   - 「跟随全局」按钮 = 清空覆盖（不是把值清零）。
 *
 * ★ 所有文案走 copy 表，所有不可实现项走 `<SettingRow featureId>` 的闸门，
 *   页面里不写死任何降级判断（FN-21 Markdown / FN-22 回车发送 / FN-25 发图）。
 */

export function ChatSettingsPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { session, effective, patch, resetToGlobal, overridden, loading } = useSessionSettings(id);

  if (loading) return <LoadingOverlay open textKey="loading.default" inline />;
  if (!session) {
    return (
      <Box sx={{ p: 3 }}>
        <EmptyState descKey="empty.sessions" />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 720, mx: 'auto', pb: 6 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
          {t('chat.settings')}
        </Typography>
        {/* 没有覆盖时「跟随全局」没有意义（本来就在跟着），直接置灰 */}
        <Button size="small" variant="text" disabled={!overridden} onClick={() => void resetToGlobal()}>
          {t('common.reset')}
        </Button>
      </Stack>

      <Typography variant="caption" sx={{ display: 'block', opacity: 0.6, mb: 1.5 }}>
        {session.title}
      </Typography>

      {/* ——————————————— 输入与渲染 ——————————————— */}
      <Section titleKey="settings.group.chat">
        <SettingRow labelKey="settings.hint.markdown" featureId="FN-21">
          <Switch
            checked={effective.enableMarkdown}
            onChange={(e) => void patch({ enableMarkdown: e.target.checked })}
            inputProps={{ 'aria-label': t('settings.hint.markdown') }}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.enterToSend" featureId="FN-22">
          <Switch
            checked={effective.enterToSend}
            onChange={(e) => void patch({ enterToSend: e.target.checked })}
            inputProps={{ 'aria-label': t('settings.hint.enterToSend') }}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.typingIndicator">
          <Switch
            checked={effective.typingIndicator}
            onChange={(e) => void patch({ typingIndicator: e.target.checked })}
            inputProps={{ 'aria-label': t('settings.hint.typingIndicator') }}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.sendDelay">
          <NumberField
            value={effective.sendDelayMs}
            onChange={(v) => void patch({ sendDelayMs: v })}
            min={0}
            max={5000}
            step={100}
            suffix="ms"
            width={120}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.multiDelay">
          <NumberField
            value={effective.multiMessageDelayMs}
            onChange={(v) => void patch({ multiMessageDelayMs: v })}
            min={0}
            max={5000}
            step={100}
            suffix="ms"
            width={120}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.autoSplit">
          <Switch
            checked={effective.autoSplit}
            onChange={(e) => void patch({ autoSplit: e.target.checked })}
            inputProps={{ 'aria-label': t('settings.hint.autoSplit') }}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.mediaImmediate" featureId="FN-25">
          <Switch
            checked={effective.mediaImmediateSend}
            onChange={(e) => void patch({ mediaImmediateSend: e.target.checked })}
            inputProps={{ 'aria-label': t('settings.hint.mediaImmediate') }}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.contentFilter">
          <Switch
            checked={effective.contentFilter.enabled}
            onChange={(e) => void patch({ contentFilter: { enabled: e.target.checked } })}
            inputProps={{ 'aria-label': t('settings.hint.contentFilter') }}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.patSuffix" divider={false}>
          <TextField
            size="small"
            value={effective.patSuffix}
            onChange={(e) => void patch({ patSuffix: e.target.value })}
            placeholder={t('settings.hint.patSuffix')}
            sx={{ width: 160 }}
            inputProps={{ 'aria-label': t('settings.hint.patSuffix') }}
          />
        </SettingRow>
      </Section>

      {/* ——————————————— 生成参数 ——————————————— */}
      <Section titleKey="settings.group.model">
        <SettingRow labelKey="settings.hint.params">
          <NumberField
            value={effective.params.temperature}
            onChange={(v) => void patch({ params: { temperature: v } })}
            min={0}
            max={2}
            step={0.1}
            presets={[0.6, 0.8, 1, 1.2]}
            width={120}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.maxMessages" divider={false}>
          <NumberField
            value={effective.params.maxTokens}
            onChange={(v) => void patch({ params: { maxTokens: v } })}
            min={256}
            max={32768}
            step={256}
            presets={[1024, 2048, 4096, 8192]}
            suffix="tok"
            width={130}
          />
        </SettingRow>
      </Section>

      {/* ——————————————— 自动总结 ——————————————— */}
      <Section titleKey="settings.group.memory">
        <SettingRow labelKey="settings.hint.autoSummary">
          <Switch
            checked={effective.autoSummary.enabled}
            onChange={(e) => void patch({ autoSummary: { enabled: e.target.checked } })}
            inputProps={{ 'aria-label': t('settings.hint.autoSummary') }}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.memoryThreshold" divider={false}>
          <NumberField
            value={effective.autoSummary.threshold}
            onChange={(v) => void patch({ autoSummary: { threshold: v } })}
            min={2}
            max={500}
            step={2}
            presets={[20, 40, 80]}
            suffix="条"
            width={120}
          />
        </SettingRow>
      </Section>

      {/* ——————————————— 主动消息 ——————————————— */}
      <Section titleKey="settings.group.proactive">
        <SettingRow labelKey="common.enabled">
          <Switch
            checked={effective.proactive.enabled}
            onChange={(e) => void patch({ proactive: { enabled: e.target.checked } })}
            inputProps={{ 'aria-label': t('common.enabled') }}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.proactiveInterval">
          <NumberField
            value={effective.proactive.intervalMin}
            onChange={(v) => void patch({ proactive: { intervalMin: v } })}
            min={1}
            max={1440}
            step={5}
            suffix="分"
            width={120}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.idleTimeout">
          <NumberField
            value={effective.proactive.idleTimeoutMin}
            onChange={(v) => void patch({ proactive: { idleTimeoutMin: v } })}
            min={1}
            max={1440}
            step={5}
            suffix="分"
            width={120}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.allDay">
          <Switch
            checked={effective.proactive.allDay}
            onChange={(e) => void patch({ proactive: { allDay: e.target.checked } })}
            inputProps={{ 'aria-label': t('settings.hint.allDay') }}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.dynamic" divider={false}>
          <Switch
            checked={effective.proactive.dynamic}
            onChange={(e) => void patch({ proactive: { dynamic: e.target.checked } })}
            inputProps={{ 'aria-label': t('settings.hint.dynamic') }}
          />
        </SettingRow>
      </Section>

      {/* ——————————————— 后台 ——————————————— */}
      <Section titleKey="settings.group.advanced">
        <SettingRow labelKey="settings.hint.windowMinimized">
          <Switch
            checked={effective.backgroundMessage}
            onChange={(e) => void patch({ backgroundMessage: e.target.checked })}
            inputProps={{ 'aria-label': t('settings.hint.windowMinimized') }}
          />
        </SettingRow>

        <SettingRow labelKey="settings.hint.windowMinimized" divider={false}>
          <Switch
            checked={effective.backgroundToast}
            onChange={(e) => void patch({ backgroundToast: e.target.checked })}
            inputProps={{ 'aria-label': t('settings.hint.windowMinimized') }}
          />
        </SettingRow>
      </Section>

      <Divider sx={{ my: 2 }} />

      <Stack direction="row" spacing={1}>
        <Button size="small" variant="outlined" href={to.chat(session.id)}>
          {t('common.back')}
        </Button>
        <Button size="small" variant="text" href={to.chatContext(session.id)}>
          {t('chat.context')}
        </Button>
      </Stack>
    </Box>
  );
}

/** 分组容器：标题 + 卡片 */
function Section({ titleKey, children }: { titleKey: CopyKey; children: ReactNode }): JSX.Element {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5, opacity: 0.8 }}>
        {t(titleKey)}
      </Typography>
      <Paper variant="outlined" sx={{ px: 1.5 }}>
        {children}
      </Paper>
    </Box>
  );
}

export default ChatSettingsPage;
