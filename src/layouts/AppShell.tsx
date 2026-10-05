import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import useMediaQuery from '@mui/material/useMediaQuery';
import useTheme from '@mui/material/styles/useTheme';
import { AppDrawer } from './AppDrawer';
import { FloatingLayer } from './FloatingLayer';
import { MobileTabs } from './MobileTabs';
import { SideNav } from './SideNav';
import { TopBar } from './TopBar';
import { t } from '@/copy';
import { useUiStore } from '@/store/uiStore';

/**
 * ★ 主框架（架构文档 §2 `layouts/AppShell.tsx`）：TopBar + SideNav + Outlet + FloatingLayer。
 *
 * 响应式策略（决策 A8）：
 * - `md` 以上（桌面）：左侧常驻 SideNav（宽 240），无底部 Tab；
 * - `md` 以下（移动）：侧栏收进抽屉（由 TopBar 的菜单键打开），底部显示 4 个 Tab，
 *   触控目标统一 ≥44px（见 MobileTabs / TopBar 的 `minHeight: 44`）；
 * - 桌面专属形态（多面板、桌宠）由各自页面/FloatingLayer 自行在窄屏隐藏。
 */

/** Web Locks 的最小类型（TS 的 lib.dom 版本较旧时不会自带 LockManager） */
interface MinimalLock {
  name?: string;
  mode?: string;
}

interface MinimalLockManager {
  request(
    name: string,
    options: { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: MinimalLock | null) => Promise<unknown>,
  ): Promise<unknown>;
}

function getLockManager(): MinimalLockManager | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as unknown as { locks?: MinimalLockManager }).locks;
}

/**
 * ★ 多标签页（决策 A9）：用 `navigator.locks` 选出唯一的「写者」标签页。
 * 抢不到锁的标签页进入只读状态并在顶部给出提示，避免多标签页并发写 Dexie。
 */
export function useLeaderTab(): { readOnly: boolean } {
  const [readOnly, setReadOnly] = useState<boolean>(false);

  useEffect(() => {
    const locks = getLockManager();
    // 不支持 Web Locks（Safari 部分版本）时按主标签页处理，避免误伤正常使用
    if (!locks) return undefined;

    const controller = new AbortController();
    void locks
      .request(
        'ai-ai-db-writer',
        { mode: 'exclusive', ifAvailable: true, signal: controller.signal },
        (lock) => {
          if (!lock) {
            setReadOnly(true);
            return Promise.resolve();
          }
          setReadOnly(false);
          // 持有锁直到卸载： promises 在 abort 时 resolve → 释放锁 → 其它标签页接手
          return new Promise<void>((resolve) => {
            if (controller.signal.aborted) {
              resolve();
              return;
            }
            controller.signal.addEventListener('abort', () => resolve(), { once: true });
          });
        },
      )
      .catch(() => {
        /* 抢锁失败按「只读」处理最安全，但这里不改变 UI，避免误报 */
      });

    return () => controller.abort();
  }, []);

  return { readOnly };
}

/** 只读标签页提示条（决策 A9：非主标签页只读，写操作请回主标签页） */
function ReadOnlyBanner(): JSX.Element {
  return (
    <Tooltip title={t('alt.broadcastChannel')} arrow>
      <Alert severity="info" variant="outlined" sx={{ borderRadius: 0, borderWidth: '0 0 1px 0' }}>
        <AlertTitle sx={{ fontSize: 14, fontWeight: 600 }}>{t('common.disabled')}</AlertTitle>
        <Box component="span" sx={{ fontSize: 12, opacity: 0.8 }}>
          {t('tip.readOnlyTab')}
        </Box>
      </Alert>
    </Tooltip>
  );
}

export function AppShell(): JSX.Element {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const drawerOpen = useUiStore((s) => s.drawerOpen);
  const setDrawerOpen = useUiStore((s) => s.setDrawerOpen);
  const { readOnly } = useLeaderTab();

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
        color: 'text.primary',
      }}
    >
      <TopBar showMenu={isMobile} onMenu={() => setDrawerOpen(!drawerOpen)} />

      {readOnly ? <ReadOnlyBanner /> : null}

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 桌面端常驻侧栏；移动端改为抽屉 */}
        {!isMobile ? (
          <SideNav variant="permanent" />
        ) : (
          <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        )}

        <Box
          component="main"
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            // 移动端给底部 Tab 留位（含手势条安全区）
            // ★ 用 CSS 变量而不是写死 `56px`：变量在 `global.css` 是单一真源，
            //   与 `--ai-ai-tabs-h`（MobileTabs 自身高度）配套，避免两处各写一个数。
            pb: isMobile ? 'calc(var(--ai-ai-tabs-h) + var(--ai-ai-safe-bottom))' : 0,
          }}
        >
          <Outlet />
        </Box>
      </Box>

      {isMobile ? <MobileTabs /> : null}

      {/* ★ 应用内浮层容器（悬浮窗的降级位，SV-01/SV-04） */}
      <FloatingLayer />
    </Box>
  );
}

export default AppShell;
