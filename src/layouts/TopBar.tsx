import { useLocation } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeIcon from '@mui/icons-material/LightModeOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { t } from '@/copy';
import { resolveTitleKey } from '@/router/paths';

/**
 * 顶栏（架构文档 §2 `layouts/TopBar.tsx`）：标题 / Logo（双击 = 退出确认）/ 主题切换。
 *
 * - **标题**由当前 pathname 反查 `router/paths.ts` 的 `resolveTitleKey`，走文案表；
 * - **双击 Logo** 是 FN-16「返回键退出」的 Web 降级：发 `app:exit-request` 事件，
 *   由 FloatingLayer 弹出二次确认（`beforeunload` 不允许自定义文案，只能走应用内确认）。
 */

const TOUCH_TARGET = 44;

export interface TopBarProps {
  /** 是否显示菜单键（移动端） */
  showMenu?: boolean;
  onMenu?: () => void;
}

export function TopBar({ showMenu = false, onMenu }: TopBarProps): JSX.Element {
  const location = useLocation();
  const darkMode = useSettingsStore((s) => s.settings.appearance.darkMode);
  const setAppearance = useSettingsStore((s) => s.setAppearance);
  const requestExitConfirm = useUiStore((s) => s.requestExitConfirm);
  const titleKey = resolveTitleKey(location.pathname);
  /** 当前不是深色 → 下次切成深色；已经是深色 → 切回浅色 */
  const switchToDark = darkMode !== 'dark';

  return (
    <>
      <AppBar
        position="sticky"
        color="default"
        elevation={0}
        sx={{
          // ★ 高度 = 内容高度 + 状态栏安全区；`pt` 把内容推到状态栏下方。
          //   不这么做的话，targetSdk 35 的强制 edge-to-edge（Android 15+）
          //   会让顶栏被系统状态栏压住 —— 真机截图里「设置」标题与时间/电量重叠。
          //   变量与兜底值定义见 `theme/global.css` 的 `--ai-ai-safe-top`。
          height: 'calc(var(--ai-ai-topbar-h) + var(--ai-ai-safe-top))',
          pt: 'var(--ai-ai-safe-top)',
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Toolbar variant="dense" sx={{ minHeight: 'var(--ai-ai-topbar-h)', gap: 1 }}>
          {showMenu ? (
            <IconButton
              edge="start"
              // ★ aria-label 不显示在界面上，但会被读屏念出来 ⇒ 按 §6.5.3 的 a11y 判据是 A 档，必须走文案
              aria-label={t('ui.aria.menu')}
              onClick={onMenu}
              sx={{ width: TOUCH_TARGET, height: TOUCH_TARGET }}
            >
              <MenuIcon />
            </IconButton>
          ) : null}

          {/* ★ 双击 = 退出确认（FN-16 的 Web 降级） */}
          <Tooltip title={t('alt.exitConfirm')} arrow>
            <Stack
              direction="row"
              spacing={1}
              alignItems="baseline"
              onDoubleClick={() => requestExitConfirm(true)}
              sx={{ cursor: 'pointer', userSelect: 'none', minWidth: 0 }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                {t('app.title')}
              </Typography>
              <Typography
                variant="body2"
                sx={{ opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {t(titleKey)}
              </Typography>
            </Stack>
          </Tooltip>

          <Box sx={{ flex: 1 }} />

          <Tooltip title={t('settings.hint.darkMode')} arrow>
            <IconButton
              // ★ 同上：读屏会念。旁边的 Tooltip 早就走了 t()，aria-label 没有——同一个文件里两套标准
              aria-label={t('ui.aria.toggleTheme')}
              onClick={() => setAppearance({ darkMode: switchToDark ? 'dark' : 'light' })}
              sx={{ width: TOUCH_TARGET, height: TOUCH_TARGET }}
            >
              {darkMode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      {/*
        ★ 退出确认对话框**不再渲染在这里**（2026-10-04 重构）。
          原先是本组件的局部 state + 局部对话框，同时却又往 `appEmitter` 广播
          `app:exit-request`（注释说交给 FloatingLayer，实际全仓无人监听 = 死事件）。
          现在统一由 `layouts/ExitConfirm.tsx` 渲染，状态在 `uiStore.exitConfirmOpen`；
          本组件只负责"双击 Logo → 请求打开"。这样 Android 返回键也能复用同一个确认框。
      */}
    </>
  );
}

export default TopBar;
