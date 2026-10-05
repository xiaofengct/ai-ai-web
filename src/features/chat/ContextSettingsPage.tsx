import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { NumberField } from '@/components/NumberField';
import { PromptPreview } from '@/components/PromptPreview';
import { SettingRow } from '@/components/SettingRow';
import { EmptyState } from '@/components/EmptyState';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { useSessionSettings } from './useSessionSettings';
import { personaCompiler } from '@/persona/PersonaCompiler';
import { retrieveForPrompt } from '@/memory/retrieve';
import { personaRepo } from '@/db/repo/personaRepo';
import { messageRepo } from '@/db/repo/messageRepo';
import { CONTEXT_RESERVE, DEFAULT_CONTEXT_WINDOW } from '@/constants/limits';
import { to } from '@/router/paths';
import { t, type CopyKey } from '@/copy';
import type { MemoryScope } from '@/types/memory';
import type { PersonaCard } from '@/types/persona';
import type { PromptSegmentId } from '@/types/prompt';

/**
 * 上下文设置（PG-10，会话级 `/chat/:id/context`）。
 *
 * ★ 验收要点④：**改任何一项，右侧提示词预览实时变化**。
 *   所以这里拿的是「真实 Pipeline」的结果——
 *   `messageRepo.page()` 取历史 → `retrieveForPrompt()` 检索记忆 → `personaCompiler.build()` 装配，
 *   和发送时走的是同一条路（唯一出口原则），不存在「预览和实际不一致」。
 *
 * ★ 逐段开关的落点：`injectControl.extras[段id]`。
 *   `constraints` 段对欣然是**强制开启**的（`isSegmentEnabled` 里写死），
 *   所以即使这里把它关掉，编译器也会强制带回——这是设计意图，不是 bug。
 */

/** 记忆范围三档 → 文案 key */
const SCOPE_KEYS: Record<MemoryScope, CopyKey> = {
  session: 'settings.scope.session',
  global: 'settings.scope.global',
  range: 'settings.scope.range',
};

export function ContextSettingsPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { session, effective, patch, resetToGlobal, loading } = useSessionSettings(id);

  const [persona, setPersona] = useState<PersonaCard | undefined>(undefined);
  const [preview, setPreview] = useState<ReturnType<typeof personaCompiler.build> | undefined>(undefined);
  const [building, setBuilding] = useState(false);

  /* —— 角色：会话指定的角色取不到时退回内置欣然（预览页不该因为缺角色就空着） —— */
  useEffect(() => {
    if (!session) {
      setPersona(undefined);
      return;
    }
    let alive = true;
    void (async () => {
      const res = await personaRepo.get(session.personaId);
      const found = res.ok ? res.value : undefined;
      const fallback = found ? undefined : await personaRepo.getXinran();
      if (!alive) return;
      setPersona(found ?? (fallback && fallback.ok ? fallback.value : undefined));
    })();
    return () => {
      alive = false;
    };
  }, [session]);

  /* —— 实时提示词预览 —— */
  useEffect(() => {
    if (!session || !persona) return;
    let alive = true;
    setBuilding(true);

    void (async () => {
      const historyRes = await messageRepo.page(session.id, {
        limit: Math.max(1, effective.loadRange),
      });
      const history = historyRes.ok ? historyRes.value : [];
      const query = history.slice(-4).map((m) => m.content).join('\n');
      const hits = await retrieveForPrompt({
        query,
        scope: effective.memoryScope,
        sessionId: session.id,
        settings: effective,
        personaId: persona.id,
      });
      if (!alive) return;

      const built = personaCompiler.build({
        persona,
        session,
        settings: effective,
        history,
        userInput: '',
        memoryHits: hits,
        kind: 'chat',
      });
      if (!alive) return;
      setPreview(built);
      setBuilding(false);
    })();

    return () => {
      alive = false;
    };
  }, [session, persona, effective]);

  const onToggleSegment = useCallback(
    (segmentId: PromptSegmentId, enabled: boolean) => {
      void patch({ injectControl: { extras: { [segmentId]: enabled } } });
    },
    [patch],
  );

  const budget = useMemo(
    () => Math.max(512, DEFAULT_CONTEXT_WINDOW - effective.params.maxTokens - CONTEXT_RESERVE),
    [effective.params.maxTokens],
  );

  if (loading) return <LoadingOverlay open textKey="loading.default" inline />;
  if (!session) {
    return (
      <Box sx={{ p: 3 }}>
        <EmptyState descKey="empty.sessions" />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 900, mx: 'auto', pb: 6 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
          {t('chat.contextTitle')}
        </Typography>
        <Button size="small" variant="text" onClick={() => void resetToGlobal()}>
          {t('common.reset')}
        </Button>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
        {/* ——————————————— 左：设置项 ——————————————— */}
        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          <Section titleKey="settings.group.context">
            <SettingRow labelKey="settings.hint.contextCount" featureId="FN-05">
              <NumberField
                value={effective.contextCount}
                onChange={(v) => void patch({ contextCount: v })}
                min={1}
                max={200}
                step={1}
                presets={[10, 20, 40, 80]}
                suffix="条"
                width={120}
              />
            </SettingRow>

            <SettingRow labelKey="settings.hint.maxMessages" featureId="FN-15">
              <NumberField
                value={effective.maxMessages}
                onChange={(v) => void patch({ maxMessages: v })}
                min={1}
                max={20000}
                step={1}
                presets={[1000, 5000, 20000]}
                suffix="条"
                width={130}
              />
            </SettingRow>

            <SettingRow labelKey="settings.hint.loadRange" featureId="FN-13" divider={false}>
              <NumberField
                value={effective.loadRange}
                onChange={(v) => void patch({ loadRange: v })}
                min={10}
                max={500}
                step={10}
                presets={[30, 50, 100]}
                suffix="条"
                width={120}
              />
            </SettingRow>
          </Section>

          <Section titleKey="settings.hint.contextClean">
            <SettingRow labelKey="settings.clean.removeEmpty" hintKey="settings.hint.contextClean" nested>
              <Switch
                checked={effective.contextClean.removeEmpty}
                onChange={(e) => void patch({ contextClean: { removeEmpty: e.target.checked } })}
                inputProps={{ 'aria-label': t('settings.clean.removeEmpty') }}
              />
            </SettingRow>
            <SettingRow labelKey="settings.clean.dedupe" nested>
              <Switch
                checked={effective.contextClean.dedupe}
                onChange={(e) => void patch({ contextClean: { dedupe: e.target.checked } })}
                inputProps={{ 'aria-label': t('settings.clean.dedupe') }}
              />
            </SettingRow>
            <SettingRow labelKey="settings.clean.trimSystem" nested>
              <Switch
                checked={effective.contextClean.trimSystem}
                onChange={(e) => void patch({ contextClean: { trimSystem: e.target.checked } })}
                inputProps={{ 'aria-label': t('settings.clean.trimSystem') }}
              />
            </SettingRow>
            <SettingRow labelKey="settings.clean.mergeConsecutive" nested divider={false}>
              <Switch
                checked={effective.contextClean.mergeConsecutive}
                onChange={(e) => void patch({ contextClean: { mergeConsecutive: e.target.checked } })}
                inputProps={{ 'aria-label': t('settings.clean.mergeConsecutive') }}
              />
            </SettingRow>
          </Section>

          <Section titleKey="settings.hint.injectControl">
            <SettingRow labelKey="settings.inject.system" hintKey="settings.hint.injectControl" featureId="FN-30">
              <Switch
                checked={effective.injectControl.system}
                onChange={(e) => void patch({ injectControl: { system: e.target.checked } })}
                inputProps={{ 'aria-label': t('settings.inject.system') }}
              />
            </SettingRow>
            <SettingRow labelKey="settings.inject.worldBook" featureId="FN-30">
              <Switch
                checked={effective.injectControl.worldBook}
                onChange={(e) => void patch({ injectControl: { worldBook: e.target.checked } })}
                inputProps={{ 'aria-label': t('settings.inject.worldBook') }}
              />
            </SettingRow>
            <SettingRow labelKey="settings.inject.memory" featureId="FN-56">
              <Switch
                checked={effective.injectControl.memory}
                onChange={(e) => void patch({ injectControl: { memory: e.target.checked } })}
                inputProps={{ 'aria-label': t('settings.inject.memory') }}
              />
            </SettingRow>
            <SettingRow labelKey="settings.inject.jailbreak" featureId="FN-30" divider={false}>
              <Switch
                checked={effective.injectControl.jailbreak}
                onChange={(e) => void patch({ injectControl: { jailbreak: e.target.checked } })}
                inputProps={{ 'aria-label': t('settings.inject.jailbreak') }}
              />
            </SettingRow>
          </Section>

          <Section titleKey="settings.group.memory">
            <SettingRow labelKey="settings.hint.timeAware">
              <Switch
                checked={effective.timeAware}
                onChange={(e) => void patch({ timeAware: e.target.checked })}
                inputProps={{ 'aria-label': t('settings.hint.timeAware') }}
              />
            </SettingRow>

            <SettingRow labelKey="settings.hint.memoryScope">
              <TextField
                select
                size="small"
                value={effective.memoryScope}
                onChange={(e) => void patch({ memoryScope: e.target.value as MemoryScope })}
                sx={{ width: 160 }}
                inputProps={{ 'aria-label': t('settings.hint.memoryScope') }}
              >
                {(Object.keys(SCOPE_KEYS) as MemoryScope[]).map((scope) => (
                  <MenuItem key={scope} value={scope}>
                    {t(SCOPE_KEYS[scope])}
                  </MenuItem>
                ))}
              </TextField>
            </SettingRow>

            <SettingRow labelKey="settings.hint.memoryThreshold">
              <NumberField
                value={effective.memoryScoreThreshold}
                onChange={(v) => void patch({ memoryScoreThreshold: v })}
                min={0}
                max={1}
                step={0.05}
                width={110}
              />
            </SettingRow>

            <SettingRow labelKey="settings.memory.full" divider={false}>
              <Switch
                checked={effective.provideFullMemory}
                onChange={(e) => void patch({ provideFullMemory: e.target.checked })}
                inputProps={{ 'aria-label': t('settings.memory.full') }}
              />
            </SettingRow>
          </Section>

          <Section titleKey="settings.hint.promptConstraints">
            <TextField
              multiline
              minRows={3}
              size="small"
              fullWidth
              value={effective.promptConstraints}
              onChange={(e) => void patch({ promptConstraints: e.target.value })}
              placeholder={t('settings.hint.promptConstraints')}
              inputProps={{ 'aria-label': t('settings.hint.promptConstraints') }}
            />
            <Typography variant="caption" sx={{ display: 'block', opacity: 0.6, py: 1 }}>
              {t('settings.hint.promptConstraints')}
            </Typography>
          </Section>
        </Box>

        {/* ——————————————— 右：实时提示词预览 ——————————————— */}
        <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5, opacity: 0.8 }}>
            {t('chat.promptTitle')}
          </Typography>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="caption" sx={{ display: 'block', opacity: 0.6, mb: 1 }}>
              {`${t('chat.tokenBudget')} ${preview?.tokenEstimate ?? 0} / ${budget}`}
            </Typography>

            {preview ? (
              <PromptPreview
                segments={preview.segments}
                totalTokens={preview.tokenEstimate}
                budget={budget}
                warnings={preview.warnings}
                editable
                onToggle={onToggleSegment}
                defaultExpanded={false}
              />
            ) : (
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                {building ? t('loading.default') : t('ui.segmentEmpty')}
              </Typography>
            )}
          </Paper>

          <Divider sx={{ my: 2 }} />

          <Stack direction="row" spacing={1}>
            <Button size="small" variant="text" href={to.chat(session.id)}>
              {t('common.back')}
            </Button>
            <Button size="small" variant="text" href={to.chatSettings(session.id)}>
              {t('chat.settings')}
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}

/** 分组容器（与 ChatSettingsPage 同款，局部定义避免跨页耦合） */
function Section({ titleKey, children }: { titleKey: CopyKey; children: ReactNode }): JSX.Element {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5, opacity: 0.8 }}>
        {t(titleKey)}
      </Typography>
      <Paper variant="outlined" sx={{ px: 1.5, py: 0.5 }}>
        {children}
      </Paper>
    </Box>
  );
}

export default ContextSettingsPage;
