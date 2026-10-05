import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { XINRAN_GREETINGS, XINRAN_NAME, t } from '@/copy';
import { useUiStore } from '@/store/uiStore';
import { useVisibility } from '@/hooks/useVisibility';
import { PET_FACE, PetLife, clampLife, usePetLife } from './PetLife';

/**
 * ★ 桌宠浮层（SV-04 / FN-37 / FN-54 的降级实现）。
 *
 * ★★ 为什么是「应用内浮层」而不是真桌宠：
 *   浏览器没有 `SYSTEM_ALERT_WINDOW`，无法跨应用悬浮（PL-05），
 *   所以只能在**本页面之上**绘制，切走即暂停——这一点在 UI 上必须明示（见下面的降级说明）。
 *   替代方案文案走 `alt.floatingWindow`，不自己编。
 *
 * 行为：
 * - 可拖拽（指针事件，兼容鼠标与触摸），位置落 `uiStore.petPosition`（归一化坐标，跨刷新保留）；
 * - 点击 → 生命值 +，随机冒一句欣然的欢迎语（文案从 `copy/xinran.ts` 的 `XINRAN_GREETINGS` 取，
 *   **不在这里写台词**）；
 * - 页面隐藏即暂停：不跑计时、不跑动画（由 `FloatingLayer` 卸载 + 本组件内部双重保证）。
 */

/** 桌宠尺寸（px） */
const PET_SIZE = 76;
/** 拖拽吸附到边缘的内边距 */
const EDGE_PADDING = 8;

interface Point {
  x: number;
  y: number;
}

function pickGreeting(): string {
  if (XINRAN_GREETINGS.length === 0) return XINRAN_NAME;
  const index = Math.floor(Math.random() * XINRAN_GREETINGS.length);
  return XINRAN_GREETINGS[index] ?? XINRAN_NAME;
}

export default function PetOverlay(): JSX.Element | null {
  const visible = useVisibility();
  const petPosition = useUiStore((s) => s.petPosition);
  const setPetPosition = useUiStore((s) => s.setPetPosition);
  const { life, stage, interact } = usePetLife();

  const [bubble, setBubble] = useState<string>('');
  /** 归一化坐标（0~1，相对视口） */
  const [pos, setPos] = useState<Point>(() => ({ x: petPosition.x, y: petPosition.y }));
  /** 拖拽会话：起点 + 起点时的位置 */
  const dragRef = useRef<{ startX: number; startY: number; origin: Point } | null>(null);
  const [dragging, setDragging] = useState<boolean>(false);
  const bubbleTimer = useRef<number | undefined>(undefined);

  // 外部（设置页）改了位置时同步
  useEffect(() => {
    setPos({ x: petPosition.x, y: petPosition.y });
  }, [petPosition.x, petPosition.y]);

  // 卸载时清掉气泡计时器
  useEffect(
    () => () => {
      if (bubbleTimer.current !== undefined) window.clearTimeout(bubbleTimer.current);
    },
    [],
  );

  const showBubble = useCallback((text: string) => {
    setBubble(text);
    if (bubbleTimer.current !== undefined) window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(''), 3200);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragRef.current = { startX: event.clientX, startY: event.clientY, origin: pos };
      setDragging(true);
      (event.currentTarget as HTMLDivElement).setPointerCapture?.(event.pointerId);
    },
    [pos],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const width = window.innerWidth || 1;
      const height = window.innerHeight || 1;
      const dx = (event.clientX - drag.startX) / width;
      const dy = (event.clientY - drag.startY) / height;
      const next: Point = {
        x: Math.min(1, Math.max(0, drag.origin.x + dx)),
        y: Math.min(1, Math.max(0, drag.origin.y + dy)),
      };
      setPos(next);
    },
    [],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragging(false);
      (event.currentTarget as HTMLDivElement).releasePointerCapture?.(event.pointerId);
      // 拖拽结束才落库，避免拖动过程中每帧写 localStorage
      setPetPosition(pos.x, pos.y);
    },
    [pos.x, pos.y, setPetPosition],
  );

  /** 点击（非拖拽）→ 互动 */
  const onClick = useCallback(() => {
    if (dragRef.current) return;
    interact('tap');
    showBubble(pickGreeting());
  }, [interact, showBubble]);

  // ★ 页面隐藏即暂停：FloatingLayer 会卸载，这里再兜一层，避免被单独挂载时后台跑动画
  if (!visible) return null;

  const left = `calc(${pos.x * 100}% - ${PET_SIZE / 2}px)`;
  const top = `calc(${pos.y * 100}% - ${PET_SIZE / 2}px)`;

  return (
    <Box
      sx={{
        position: 'fixed',
        left,
        top,
        // 夹在视口内：极端比例下也不会跑出屏幕
        transform: `translate(${EDGE_PADDING}px, 0)`,
        zIndex: 1301,
        touchAction: 'none',
        userSelect: 'none',
        cursor: dragging ? 'grabbing' : 'grab',
      }}
    >
      {/* 气泡：欣然的话（文案来自 copy 层） */}
      {bubble ? (
        <Paper
          elevation={4}
          sx={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            mb: 1,
            px: 1.25,
            py: 0.75,
            maxWidth: 220,
            borderRadius: 2,
          }}
        >
          <Typography variant="body2">{bubble}</Typography>
        </Paper>
      ) : null}

      <Tooltip title={t('alt.floatingWindow')} arrow>
        <Paper
          elevation={6}
          // 呼吸动画走 global.css 的 .ai-ai-breathe（自带 prefers-reduced-motion 降级）
          className="ai-ai-breathe"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={onClick}
          sx={{
            width: PET_SIZE,
            height: PET_SIZE,
            borderRadius: '50%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.25,
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1 }}>
            {XINRAN_NAME.slice(0, 1)}
          </Typography>
          <Typography variant="caption" sx={{ lineHeight: 1, opacity: 0.8 }}>
            {PET_FACE[stage]}
          </Typography>
        </Paper>
      </Tooltip>

      {/* 生命值条：只读展示，数值由 usePetLife 统一管理 */}
      <Box sx={{ mt: 0.5, width: PET_SIZE }}>
        <PetLife value={clampLife(life)} showValue={false} dense />
      </Box>

      {/* ★ 降级明示：这是应用内浮层，不是系统悬浮窗（PL-05 不可实现） */}
      <Typography
        variant="caption"
        sx={{ display: 'block', mt: 0.5, textAlign: 'center', opacity: 0.55, fontSize: 10 }}
      >
        {t('alt.layoutCollapse')}
      </Typography>
    </Box>
  );
}
