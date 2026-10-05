import { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { NumberField } from '@/components/NumberField';
import { SettingsField } from '../SettingsField';
import { sl } from '../settingsCopy';
import { useAdvancedFlag, useAdvancedNumber } from '../useAdvancedFlags';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { useSnack } from '@/hooks/useSnack';
import { t } from '@/copy';
import type { AppearanceSettings } from '@/types/settings';

/**
 * 外观分组（FN-37 ~ FN-43 / FN-52 ~ FN-54 / FN-61，另含 PG-15 的布局开关）。
 *
 * ★ 主题相关的写入全部走 `settingsStore.setAppearance`：
 *   它会同步 `ai-ai.theme.v1` 快照（首屏防闪烁）并发 `theme:changed` 事件。
 */
export function AppearanceSection(): JSX.Element {
  const snack = useSnack();
  const appearance = useSettingsStore((s) => s.settings.appearance);
  const setAppearance = useSettingsStore((s) => s.setAppearance);
  const resetTheme = useSettingsStore((s) => s.resetTheme);
  const setHomeLayout = useUiStore((s) => s.setHomeLayout);

  /** FN-53 / FN-54 立绘增强（默认关：体积与性能代价大） */
  const [live2dEnabled, setLive2dEnabled] = useAdvancedFlag('FN-53', false);
  const [petPortraitEnabled, setPetPortraitEnabled] = useAdvancedFlag('FN-54', false);
  /** FN-52 立绘透明度 */
  const [portraitOpacity, setPortraitOpacity] = useAdvancedNumber('FN-52.opacity', 1);

  const [pendingReset, setPendingReset] = useState<boolean>(false);
  const [pendingClearPortrait, setPendingClearPortrait] = useState<boolean>(false);

  const handleDarkMode = useCallback(
    (next: AppearanceSettings['darkMode']): void => {
      setAppearance({ darkMode: next });
    },
    [setAppearance],
  );

  /** FN-61 重置主题：清空自定义色板 + resetThemeToken 自增（store 内部完成） */
  const handleResetTheme = useCallback((): void => {
    resetTheme();
    setPendingReset(false);
    snack.success('ok.themeReset');
  }, [resetTheme, snack]);

  /** FN-39 清除立绘：只清引用，blobs 保留（可恢复） */
  const handleClearPortrait = useCallback((): void => {
    setAppearance({ portraitClear: true });
    setPendingClearPortrait(false);
    snack.success('ok.portraitCleared');
  }, [setAppearance, snack]);

  /** PG-15 布局切换：UI 快照与设置项同步（与 HomePage 同一个开关） */
  const handleLayout = useCallback(
    (next: 'v1' | 'v2'): void => {
      setHomeLayout(next);
      setAppearance({ homeLayout: next });
    },
    [setHomeLayout, setAppearance],
  );

  return (
    <Box>
      {/* —— FN-38 深色模式 —— */}
      <SettingsField labelKey="label.darkMode" hintCopyKey="settings.hint.darkMode" featureId="FN-38">
        <TextField
          select
          size="small"
          value={appearance.darkMode}
          onChange={(e) => handleDarkMode(e.target.value as AppearanceSettings['darkMode'])}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="system">{sl('mode.system')}</MenuItem>
          <MenuItem value="light">{sl('mode.light')}</MenuItem>
          <MenuItem value="dark">{sl('mode.dark')}</MenuItem>
        </TextField>
      </SettingsField>

      {/* —— FN-40 全局灰度 —— */}
      <SettingsField labelKey="label.grayscale" hintCopyKey="settings.hint.grayscale" featureId="FN-40">
        <Switch
          checked={appearance.grayscale}
          onChange={(e) => setAppearance({ grayscale: e.target.checked })}
        />
      </SettingsField>

      {/* —— FN-42 病娇语气（partial：只是调味层，Layer0 永远优先） —— */}
      <SettingsField labelKey="label.yandere" hintCopyKey="settings.hint.yandere" featureId="FN-42">
        <Switch
          checked={appearance.yandereMode}
          onChange={(e) => setAppearance({ yandereMode: e.target.checked })}
        />
      </SettingsField>

      {/* —— FN-37 桌宠模式（partial：无法跨应用悬浮） —— */}
      <SettingsField labelKey="label.petMode" hintCopyKey="settings.hint.petMode" featureId="FN-37">
        <Switch
          checked={appearance.petMode}
          onChange={(e) => setAppearance({ petMode: e.target.checked })}
        />
      </SettingsField>

      {/* —— FN-41 状态值 —— */}
      <SettingsField labelKey="label.petLife" hintCopyKey="settings.hint.petLife" featureId="FN-41">
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 220 }}>
          <Slider
            value={appearance.petLife}
            onChange={(_e, v) => setAppearance({ petLife: Array.isArray(v) ? v[0] : v })}
            min={0}
            max={100}
            step={1}
            size="small"
            sx={{ width: 140 }}
          />
          <NumberField
            value={appearance.petLife}
            onChange={(v) => setAppearance({ petLife: v })}
            min={0}
            max={100}
            width={84}
          />
        </Stack>
      </SettingsField>

      {/* —— FN-43 窗口最小化 · 等级见能力表 capabilities.ts，此处不复制 —— */}
      <SettingsField labelKey="label.windowMinimized" hintCopyKey="settings.hint.windowMinimized" featureId="FN-43">
        <Switch
          checked={appearance.windowMinimized}
          onChange={(e) => setAppearance({ windowMinimized: e.target.checked })}
        />
      </SettingsField>

      {/* —— PG-15 首页布局（partial：两个 Activity 合成一个页面切布局） —— */}
      <SettingsField labelKey="label.homeLayout" hintCopyKey="settings.hint.homeLayout" featureId="PG-15">
        <TextField
          select
          size="small"
          value={appearance.homeLayout}
          onChange={(e) => handleLayout(e.target.value as 'v1' | 'v2')}
          sx={{ minWidth: 100 }}
        >
          <MenuItem value="v1">v1</MenuItem>
          <MenuItem value="v2">v2</MenuItem>
        </TextField>
      </SettingsField>

      {/* —— FN-52 角色立绘 —— */}
      <SettingsField labelKey="label.portrait" hintKey="hint.portrait" featureId="FN-52">
        <Tooltip title={`${Math.round(portraitOpacity * 100)}%`} arrow>
          <Box sx={{ width: 180 }}>
            <Slider
              value={portraitOpacity}
              onChange={(_e, v) => setPortraitOpacity(Array.isArray(v) ? v[0] : v)}
              min={0.2}
              max={1}
              step={0.05}
              size="small"
            />
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {sl('label.portraitOpacity')}
            </Typography>
          </Box>
        </Tooltip>
      </SettingsField>

      {/* —— FN-53 Live2D · 等级见能力表 capabilities.ts，此处不复制 —— */}
      <SettingsField labelKey="label.live2d" hintKey="hint.live2d" featureId="FN-53">
        <Switch checked={live2dEnabled} onChange={(e) => setLive2dEnabled(e.target.checked)} />
      </SettingsField>

      {/* —— FN-54 立绘画桌宠 · 等级见能力表 capabilities.ts，此处不复制 —— */}
      <SettingsField labelKey="label.petPortrait" hintKey="hint.petPortrait" featureId="FN-54">
        <Switch
          checked={petPortraitEnabled}
          onChange={(e) => setPetPortraitEnabled(e.target.checked)}
          disabled={!appearance.petMode}
        />
      </SettingsField>

      {/* —— FN-39 清除立绘（动作） —— */}
      <SettingsField labelKey="label.clearPortrait" hintKey="hint.clearPortrait" featureId="FN-39">
        <Button
          variant="outlined"
          color="inherit"
          onClick={() => setPendingClearPortrait(true)}
          sx={{ minHeight: 44 }}
        >
          {sl('ui.clear')}
        </Button>
      </SettingsField>

      {/* —— FN-61 重置主题（动作 + 二次确认） —— */}
      <SettingsField labelKey="label.resetTheme" hintCopyKey="settings.hint.resetTheme" featureId="FN-61">
        <Button
          variant="outlined"
          color="inherit"
          onClick={() => setPendingReset(true)}
          sx={{ minHeight: 44 }}
        >
          {t('common.reset')}
        </Button>
      </SettingsField>

      <ConfirmDialog
        open={pendingReset}
        titleKey="confirm.resetTheme"
        confirmKey="common.reset"
        cancelKey="common.cancel"
        danger
        onConfirm={handleResetTheme}
        onCancel={() => setPendingReset(false)}
      />
      <ConfirmDialog
        open={pendingClearPortrait}
        titleKey="confirm.clearPortrait"
        confirmKey="common.clear"
        cancelKey="common.cancel"
        danger
        onConfirm={handleClearPortrait}
        onCancel={() => setPendingClearPortrait(false)}
      />
    </Box>
  );
}

export default AppearanceSection;
