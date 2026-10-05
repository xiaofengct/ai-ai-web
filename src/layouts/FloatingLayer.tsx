import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';
import useTheme from '@mui/material/styles/useTheme';
import { appEmitter } from '@/lib/emitter';
import { useSettingsStore } from '@/store/settingsStore';
import { useSnack } from '@/hooks/useSnack';
import { log } from '@/store/logStore';

/**
 * ★ 应用内浮层容器（架构文档 §2 `layouts/FloatingLayer.tsx`）。
 *
 * 原生的悬浮窗 / 桌宠在浏览器里不可实现（PL-05 / SV-01 / SV-04），
 * 降级为**应用内浮层**：只在本页面之上绘制，切走即暂停。
 * 本容器承载两类浮层：
 * 1. **后台补偿提示**（D6 / SV-06）：页面从隐藏恢复时补一条 `tip.backgroundResume`；
 * 2. **桌宠挂载位**（SV-04 / FN-37 / FN-41）：`appearance.petMode` 打开且页面可见时挂载，
 *    页面隐藏立刻卸载，不在后台跑动画。
 *
 * 注：**退出二次确认放在 TopBar**（FN-16 / FN-20 的 Web 替代实现在那里，
 * 见 `TopBar.tsx`），避免两个组件各弹一次同一个弹窗。
 */

type OverlayComponent = ComponentType<Record<string, unknown>>;

/**
 * 桌宠浮层（T12 提供）：模块尚未接入时静默降级为「不渲染」，
 * 不允许因为增强能力缺失影响主流程。
 */
const PetOverlay = lazy(async (): Promise<{ default: OverlayComponent }> => {
  try {
    const mod = await import('@/features/pet/PetOverlay');
    const candidate =
      mod.default ?? (mod as unknown as { PetOverlay?: OverlayComponent }).PetOverlay;
    return { default: candidate ?? (() => null) };
  } catch (e) {
    log.warn('overlay', '桌宠浮层尚未接入，已降级', String(e), 'SV-04');
    return { default: () => null };
  }
});

export function FloatingLayer(): JSX.Element {
  const theme = useTheme();
  // ★ 决策 A8：桌宠属于桌面专属形态，窄屏（手机）直接不挂载，不去挤占小屏空间
  const isNarrow = useMediaQuery(theme.breakpoints.down('sm'));
  const petMode = useSettingsStore((s) => s.settings.appearance.petMode);
  const snack = useSnack();
  const [docVisible, setDocVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  );

  // ① 后台补偿提示：页面隐藏期间丢失的主动消息 tick（D6）
  useEffect(
    () =>
      appEmitter.on('app:resume', ({ missedTicks }) => {
        if (missedTicks > 0) snack.info('tip.backgroundResume');
      }),
    [snack],
  );

  // ② 页面隐藏即暂停浮层（SV-04 的降级约定：后台不跑动画）
  useEffect(() => {
    const onChange = (): void => setDocVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return (
    <>
      {petMode && docVisible && !isNarrow ? (
        <Suspense fallback={null}>
          <Box className="ai-ai-floating" sx={{ inset: 'auto 16px 80px auto' }}>
            <PetOverlay />
          </Box>
        </Suspense>
      ) : null}
    </>
  );
}

export default FloatingLayer;
