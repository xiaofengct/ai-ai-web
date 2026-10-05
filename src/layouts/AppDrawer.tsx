import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import { SideNav, SIDE_NAV_WIDTH } from './SideNav';
import { t } from '@/copy';

/**
 * 移动端抽屉容器（架构文档 §2 `layouts/AppDrawer.tsx`、决策 A8）。
 *
 * - `variant="temporary"` + `keepMounted`：移动端常见做法，保留滚动位置且省一次挂载开销；
 * - 点击导航项后立即关闭（由 `SideNav.onNavigate` 回调）。
 */
export interface AppDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function AppDrawer({ open, onClose }: AppDrawerProps): JSX.Element {
  return (
    <Drawer
      anchor="left"
      open={open}
      onClose={onClose}
      variant="temporary"
      ModalProps={{ keepMounted: true }}
      PaperProps={{
        sx: {
          width: SIDE_NAV_WIDTH,
          // 抽屉内容不被 iOS 底部安全区裁掉
          pb: 'var(--ai-ai-safe-bottom)',
        },
      }}
    >
      {/* 关闭按钮单独放在导航列表外，避免和列表项抢焦点 */}
      <IconButton
        aria-label={t('common.close')}
        onClick={onClose}
        sx={{ position: 'absolute', top: 8, right: 8, width: 44, height: 44, zIndex: 1 }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
      <SideNav onNavigate={onClose} />
    </Drawer>
  );
}

export default AppDrawer;

/** 供 AppShell 复用同一宽度常量（避免两处魔法数字不一致） */
export { SIDE_NAV_WIDTH };
