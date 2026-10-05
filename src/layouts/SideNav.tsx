import type { ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import PsychologyAltIcon from '@mui/icons-material/PsychologyAlt';
import ScienceIcon from '@mui/icons-material/Science';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import { CapabilityGate } from '@/components/CapabilityGate';
import { NAV_ITEMS, ROUTE, isActivePath } from '@/router/paths';
import { t, type CopyKey } from '@/copy';

/**
 * 侧边导航（架构文档 §2 `layouts/SideNav.tsx`）：会话列表入口 / 记忆 / 蒸馏 / 设置。
 *
 * 两种用法：
 * - `<SideNav variant="permanent" />`：桌面端常驻（AppShell 直接渲染）；
 * - `<SideNav onNavigate={closeDrawer} />`：移动端塞进 AppDrawer。
 */

export const SIDE_NAV_WIDTH = 240;

/** 导航图标（按 labelKey 映射，避免 paths 层依赖 UI） */
const NAV_ICON: Partial<Record<CopyKey, ReactElement>> = {
  'nav.home': <ChatBubbleOutlineIcon fontSize="small" />,
  'nav.memories': <PsychologyAltIcon fontSize="small" />,
  'nav.distill': <ScienceIcon fontSize="small" />,
  'nav.settings': <SettingsIcon fontSize="small" />,
};

export interface SideNavProps {
  /** permanent = 桌面常驻；省略则渲染为抽屉内的普通列表 */
  variant?: 'permanent';
  /** 点击后回调（移动端用于关闭抽屉） */
  onNavigate?: () => void;
}

export function SideNav({ variant, onNavigate }: SideNavProps): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();

  const list = (
    <List dense sx={{ py: 1 }}>
      {NAV_ITEMS.map((item) => {
        const active = isActivePath(location.pathname, item.path);
        return (
          <ListItem key={item.path} disablePadding sx={{ px: 1, pb: 0.5 }}>
            <ListItemButton
              selected={active}
              onClick={() => {
                navigate(item.path);
                onNavigate?.();
              }}
              // 触控目标 ≥44px（决策 A8）
              sx={{ minHeight: 44, borderRadius: 2, gap: 1 }}
            >
              <ListItemIcon sx={{ minWidth: 32, color: active ? 'primary.main' : 'inherit' }}>
                {NAV_ICON[item.labelKey] ?? <ChatBubbleOutlineIcon fontSize="small" />}
              </ListItemIcon>
              <ListItemText
                primary={t(item.labelKey)}
                primaryTypographyProps={{ fontSize: 14, fontWeight: active ? 600 : 400 }}
              />
            </ListItemButton>
          </ListItem>
        );
      })}
    </List>
  );

  const content = (
    <Box sx={{ width: SIDE_NAV_WIDTH, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2, py: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {t('app.title')}
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.6 }}>
          {t('app.subtitle')}
        </Typography>
      </Box>
      <Divider />
      {list}
      <Box sx={{ flex: 1 }} />
      <Divider />
      {/* 桥接（PG-23）：原生不可实现 → 网页版只剩「手动导入」的等价路径，入口明示置灰原因 */}
      <Box sx={{ p: 1.5 }}>
        <CapabilityGate featureId="PG-23">
          <SideNavLinkButton />
        </CapabilityGate>
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, px: 1, opacity: 0.5 }}>
          {t('settings.hint.bridge')}
        </Typography>
      </Box>
    </Box>
  );

  if (variant === 'permanent') {
    return (
      <Drawer
        variant="permanent"
        open
        sx={{
          width: SIDE_NAV_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: SIDE_NAV_WIDTH,
            boxSizing: 'border-box',
            borderRight: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          },
        }}
      >
        {content}
      </Drawer>
    );
  }

  return content;
}

/** 桥接页入口（PG-23 的降级形态） */
function SideNavLinkButton(): JSX.Element {
  const navigate = useNavigate();
  return (
    <ListItemButton sx={{ minHeight: 44, borderRadius: 2, gap: 1 }} onClick={() => navigate(ROUTE.settingsBridge)}>
      <ListItemIcon sx={{ minWidth: 32 }}>
        <CloudSyncIcon fontSize="small" />
      </ListItemIcon>
      <ListItemText primary={t('settings.group.advanced')} primaryTypographyProps={{ fontSize: 14 }} />
    </ListItemButton>
  );
}

export default SideNav;
