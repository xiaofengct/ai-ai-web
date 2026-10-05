import type { ReactElement } from 'react';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Paper from '@mui/material/Paper';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined';
import PsychologyAltIcon from '@mui/icons-material/PsychologyAlt';
import ScienceIcon from '@mui/icons-material/Science';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import { MOBILE_TABS } from '@/router/paths';
import { useUiStore, type MobileTab } from '@/store/uiStore';
import { t } from '@/copy';

/**
 * 移动端底部 Tab（架构文档 §2 `layouts/MobileTabs.tsx`、决策 A8）。
 *
 * - 五项：`MOBILE_TABS` 与 `uiStore.mobileTab` 的联合类型一一对应；
 * - **双向同步**：点 Tab 跳转；从侧栏/其它入口跳转后，底部高亮自动跟随路由；
 * - 触控目标 ≥44px，并适配 iOS 底部安全区。
 *
 * ★ 2026-10-04 由四项加到五项（新增「朋友圈」）。
 *   5 项是底部导航的**建议上限**，当前正好压线 —— 再加一级入口就该改设计
 *   （收进「更多」菜单），而不是继续往这一行塞。
 *   为此把每项的 `minWidth` 从 60 降到 56，给五等分留出余量；
 *   窄屏（320px）下 5×56 = 280px 仍放得下。
 */

const TAB_ICON: Record<MobileTab, ReactElement> = {
  home: <ChatBubbleOutlineIcon fontSize="small" />,
  moments: <PhotoLibraryOutlinedIcon fontSize="small" />,
  memories: <PsychologyAltIcon fontSize="small" />,
  distill: <ScienceIcon fontSize="small" />,
  settings: <SettingsIcon fontSize="small" />,
};

export function MobileTabs(): JSX.Element {
  const tab = useUiStore((s) => s.mobileTab);
  const setMobileTab = useUiStore((s) => s.setMobileTab);
  const navigate = useNavigate();
  const location = useLocation();

  // 路由 → Tab：用户从别处跳到子页面时，底部高亮仍然正确
  useEffect(() => {
    const hit = MOBILE_TABS.find((item) =>
      item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path),
    );
    if (hit && hit.tab !== tab) setMobileTab(hit.tab);
  }, [location.pathname, tab, setMobileTab]);

  return (
    <Paper
      elevation={3}
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        borderTop: 1,
        borderColor: 'divider',
        // ★ 用变量而非 `env()` 直写：`--ai-ai-safe-bottom` 在 `global.css` 统一给了
        //   兜底值 `0px`（`env()` 在桌面浏览器取不到值是空，会让整条声明失效）。
        pb: 'var(--ai-ai-safe-bottom)',
      }}
    >
      <BottomNavigation
        value={tab}
        showLabels
        onChange={(_event, next: MobileTab) => {
          setMobileTab(next);
          const target = MOBILE_TABS.find((item) => item.tab === next);
          if (target) navigate(target.path);
        }}
        sx={{ height: 56 }}
      >
        {MOBILE_TABS.map((item) => (
          <BottomNavigationAction
            key={item.tab}
            value={item.tab}
            label={t(item.labelKey)}
            icon={TAB_ICON[item.tab]}
            sx={{
              minWidth: 56,
              // ★ 触控目标 ≥44px
              minHeight: 44,
              py: 0.5,
              '& .MuiBottomNavigationAction-label': { fontSize: 11, mt: '2px' },
            }}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}

export default MobileTabs;
