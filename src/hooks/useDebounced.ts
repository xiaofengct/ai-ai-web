import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_DEBOUNCE_MS } from '@/constants/limits';

/**
 * 防抖（搜索框、设置保存）。
 *
 * - `useDebounced(value, delay)`：值防抖；
 * - `useDebouncedCallback(fn, delay)`：回调防抖（返回的函数引用稳定，可直接塞进 onChange）。
 */
export function useDebounced<T>(value: T, delay = DEFAULT_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delay = DEFAULT_DEBOUNCE_MS,
): (...args: A) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timerRef = useRef<number | undefined>(undefined);

  const debounced = useMemo(
    () =>
      (...args: A): void => {
        if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => fnRef.current(...args), delay);
      },
    [delay],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return debounced;
}

/** 节流（滚动加载更多用） */
export function useThrottledCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  interval = 200,
): (...args: A) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const lastRef = useRef(0);

  return useMemo(
    () =>
      (...args: A): void => {
        const now = Date.now();
        if (now - lastRef.current >= interval) {
          lastRef.current = now;
          fnRef.current(...args);
        }
      },
    [interval],
  );
}

export default useDebounced;
