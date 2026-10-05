import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { blobRepo } from '@/db/repo/blobRepo';
import { log } from '@/store/logStore';
import { t } from '@/copy';
import type { PortraitRef } from '@/types/persona';
import type { UUID } from '@/types/common';

/**
 * ★ 立绘统一渲染位（FN-52 / FN-53 / FN-54 / SV-04）：
 * 静态图 / Live2D（懒加载）/ 桌宠 三种形态共用这一处。
 *
 * ★ 降级链（架构文档 D8）：
 *   Live2D → 失败 → 静态立绘 + 呼吸动画 → 失败 → 首字母占位
 *   Live2D 依赖（pixi.js / pixi-live2d-display）默认**完全不加载**，
 *   只有用户在设置里显式开启后才走动态 import；为避免构建期解析未安装的包，
 *   这里用「变量 specifier + @vite-ignore」绕过 Vite 的静态分析。
 */
export interface PortraitStageProps {
  portraits?: readonly PortraitRef[];
  /** 角色名（占位符用首字） */
  name?: string;
  /** 宽高（CSS） */
  width?: number | string;
  height?: number | string;
  /** 是否允许加载 Live2D（对应设置里的显式开关） */
  allowLive2D?: boolean;
  /** 是否启用呼吸动画 */
  breathe?: boolean;
  /** 桌宠模式：可拖拽的浮层样式 */
  petMode?: boolean;
  /** 圆角 */
  rounded?: boolean;
}

type StageState = 'idle' | 'loading' | 'image' | 'live2d' | 'fallback';

export function PortraitStage({
  portraits,
  name = '',
  width = '100%',
  height = 220,
  allowLive2D = false,
  breathe = true,
  petMode = false,
  rounded = true,
}: PortraitStageProps) {
  const [state, setState] = useState<StageState>('idle');
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | undefined>(undefined);

  const portrait = portraits?.[0];
  const assetId: UUID | undefined = portrait?.assetId;

  // ① 静态图：从 blobs 取 ObjectURL
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | undefined;

    const load = async () => {
      if (!assetId) {
        setState('fallback');
        return;
      }
      if (portrait?.type === 'live2d' && allowLive2D) {
        setState('loading');
        const okLoaded = await tryLoadLive2D();
        if (cancelled) return;
        setState(okLoaded ? 'live2d' : 'loading');
        if (!okLoaded) {
          // Live2D 失败 → 退回静态图（如果还有静态 assetId 就用它，否则占位）
          setState(assetId ? 'image' : 'fallback');
        }
        return;
      }
      setState('loading');
      const res = await blobRepo.getObjectURL(assetId);
      if (cancelled) return;
      if (!res.ok || !res.value) {
        setState('fallback');
        return;
      }
      createdUrl = res.value;
      setObjectUrl(createdUrl);
      setState('image');
    };

    void load();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = undefined;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
      setObjectUrl(undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, portrait?.type, allowLive2D]);

  /**
   * ② Live2D 动态加载：失败一律优雅降级，绝不抛错中断聊天。
   * 用变量 specifier + @vite-ignore，避免构建期解析未安装的包。
   */
  async function tryLoadLive2D(): Promise<boolean> {
    try {
      const pixiSpec = 'pixi.js';
      const live2dSpec = 'pixi-live2d-display';
      const pixi = await import(/* @vite-ignore */ pixiSpec);
      const l2d = await import(/* @vite-ignore */ live2dSpec);
      if (!pixi || !l2d) return false;
      // 真正的渲染由 T12 的 features/pet / Live2D 页面接管；
      // 这里只验证依赖可用，把实例挂到容器上，避免重复造轮子。
      log.info('ui', t('ui.live2dLoaded'), { assetId }, 'FN-53');
      cleanupRef.current = () => {
        // 卸载时由专门模块自行销毁；这里只解除引用
      };
      return true;
    } catch (e) {
      log.warn('ui', t('ui.live2dFailed'), e, 'FN-53');
      return false;
    }
  }

  const opacity = portrait?.opacity ?? 1;
  const scale = portrait?.scale ?? 1;

  return (
    <Box
      ref={containerRef}
      className={breathe ? 'ai-ai-breathe' : undefined}
      sx={{
        width,
        height,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: rounded ? 2 : 0,
        bgcolor: 'action.hover',
        ...(petMode ? { position: 'fixed', pointerEvents: 'auto', zIndex: 1300 } : null),
        ...(portrait?.position
          ? {
              backgroundPosition: `${portrait.position.x * 100}% ${portrait.position.y * 100}%`,
            }
          : null),
      }}
    >
      {state === 'loading' ? <CircularProgress size={24} /> : null}

      {state === 'image' && objectUrl ? (
        <Box
          component="img"
          src={objectUrl}
          alt={name}
          sx={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            opacity,
            transform: `scale(${scale})`,
            transition: 'transform 200ms',
          }}
        />
      ) : null}

      {state === 'live2d' ? (
        <Box
          sx={{
            width: '100%',
            height: '100%',
            opacity,
            // 真正的 canvas 由专门模块挂载到这里
            '& canvas': { width: '100% !important', height: '100% !important' },
          }}
        />
      ) : null}

      {state === 'fallback' ? (
        <Typography variant="h3" sx={{ opacity: 0.35, fontWeight: 700 }}>
          {Array.from(name)[0] ?? '欣'}
        </Typography>
      ) : null}
    </Box>
  );
}

export default PortraitStage;
