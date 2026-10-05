import { useEffect, useRef, useState } from 'react';
import { useProactiveStore } from '@/store/proactiveStore';

/**
 * 空闲计时（FN-09 停用超时 / SV-06 主动消息）。
 *
 * 规则：鼠标移动、键盘、输入、触摸、滚动、可见性恢复都会重置计时；
 * 超过 timeoutMin 分钟没有活动 → `idle = true`，此时主动消息停止发送。
 */
export function useIdle(timeoutMin = 30, enabled = true): { idle: boolean; lastActiveAt: number } {
  const [idle, setIdle] = useState(false);
  const [lastActiveAt, setLastActiveAt] = useState(() => Date.now());
  const timerRef = useRef<number | undefined>(undefined);
  const markActive = useProactiveStore((s) => s.markActive);

  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return undefined;
    }

    const timeoutMs = timeoutMin * 60_000;

    const reset = () => {
      setLastActiveAt(Date.now());
      setIdle(false);
      markActive();
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setIdle(true), timeoutMs);
    };

    const events: (keyof WindowEventMap)[] = [
      'mousemove',
      'mousedown',
      'keydown',
      'wheel',
      'touchstart',
      'pointerdown',
      'focus',
    ];
    for (const e of events) window.addEventListener(e, reset, { passive: true });
    document.addEventListener('visibilitychange', reset);
    reset();

    return () => {
      for (const e of events) window.removeEventListener(e, reset);
      document.removeEventListener('visibilitychange', reset);
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    };
  }, [timeoutMin, enabled, markActive]);

  return { idle, lastActiveAt };
}

export default useIdle;
