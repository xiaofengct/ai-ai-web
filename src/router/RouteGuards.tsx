import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { EmptyState } from '@/components/EmptyState';
import { CapabilityGate } from '@/components/CapabilityGate';
import { SK } from '@/constants/storageKeys';
import { t } from '@/copy';
import { useSettingsStore } from '@/store/settingsStore';
import { log } from '@/store/logStore';
import { to } from './paths';

/**
 * ★ 路由守卫（架构文档 §2 `router/RouteGuards.tsx`）。
 *
 * 两条守卫规则：
 * 1. **首次启动强制走引导**（PG-07）：`RequireGuide` 挂在**主壳路由**上，
 *    除 `/guide` 自身外的所有页面在未完成引导时被重定向到 `/guide`；
 * 2. **未配置 Provider 时拦截聊天页**：`RequireProvider` 包在聊天相关路由外层，
 *    没有可用 Provider 时渲染「先去接一个模型」的引导面板（不是静默空白）。
 *
 * ★ localStorage 不可用时（隐私模式）一律**放行**：
 *   否则「读不到标记 → 跳引导 → 写不了标记 → 再跳」会形成死循环。
 */

/** 读取引导完成标记 */
export function isGuideDone(): boolean {
  try {
    return localStorage.getItem(SK.guide) === '1';
  } catch {
    return true;
  }
}

/** 写入引导完成标记（4 步走完后调用） */
export function markGuideDone(): void {
  try {
    localStorage.setItem(SK.guide, '1');
  } catch {
    /* 隐私模式下写不进去，本次会话内由 GuidePage 自己导航，不再重复跳转 */
  }
}

/** 重置引导（设置页「重新看一遍引导」用） */
export function resetGuide(): void {
  try {
    localStorage.removeItem(SK.guide);
  } catch {
    /* 忽略 */
  }
}

export interface GuardProps {
  children: ReactNode;
}

/**
 * 守卫 1：未完成引导 → 强制跳 `/guide`，并把来源路径塞进 state，
 * 让引导页最后一步可以直接回到用户原本想去的页面。
 */
export function RequireGuide({ children }: GuardProps): JSX.Element {
  const location = useLocation();
  const done = isGuideDone();

  if (!done && location.pathname !== '/guide') {
    log.info('guide', '未完成引导，重定向到引导页', { from: location.pathname }, 'PG-07');
    return <Navigate to="/guide" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return <>{children}</>;
}

/**
 * 当前是否已有可用 Provider（**响应式**：填好后立刻放行，不需要刷新页面）。
 * 判定标准：`baseUrl` 与 `model` 都有值 —— 本地推理服务可以没有 apiKey。
 */
export function useHasProvider(): boolean {
  return useSettingsStore((s) => {
    const list = s.settings.providers;
    const active = list.find((p) => p.id === s.settings.activeProviderId) ?? list[0];
    return Boolean(active && active.baseUrl.trim() !== '' && active.model.trim() !== '');
  });
}

/** Provider 缺失时的引导面板（承担责任式文案，见 `copy/xinran.ts` 的 err.*） */
function ProviderMissingHint(): JSX.Element {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: { xs: 2, md: 4 } }}>
      <Box sx={{ width: '100%', maxWidth: 560 }}>
        <EmptyState descKey="tip.providerMissing" icon={null} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="center" sx={{ mt: 1 }}>
          {/* 连接测试页（PG-18）能直接验证 Key 与连通性；用 Link 保持 SPA 导航 */}
          <CapabilityGate featureId="PG-18">
            <Button variant="contained" component={Link} to={to.settingsConnection()} sx={{ minHeight: 44 }}>
              {t('settings.group.model')}
            </Button>
          </CapabilityGate>
          <Button variant="outlined" component={Link} to={to.settings()} sx={{ minHeight: 44 }}>
            {t('nav.settings')}
          </Button>
        </Stack>
        <Typography variant="caption" sx={{ display: 'block', mt: 2, opacity: 0.6, textAlign: 'center' }}>
          {t('settings.hint.apiKey')}
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * 守卫 2：聊天页必须有 Provider 才能进。
 * 注意：**不重定向**，就地给出引导 —— 用户填完 Key 回到当前 URL 就能继续，
 * 避免重定向造成「返回后丢失上下文」的困惑。
 */
export function RequireProvider({ children }: GuardProps): JSX.Element {
  const ready = useHasProvider();
  if (!ready) return <ProviderMissingHint />;
  return <>{children}</>;
}

/** 组合守卫（给需要同时满足两条规则的场景预留） */
export function RequireReady({ children }: GuardProps): JSX.Element {
  return (
    <RequireGuide>
      <RequireProvider>{children}</RequireProvider>
    </RequireGuide>
  );
}

export default RequireGuide;
