import { useEffect, useState } from 'react';
import { useProactiveStore } from '@/store/proactiveStore';

/**
 * 页面可见性监听（架构文档 §2 `hooks/useVisibility.ts`）。
 *
 * 这是**后台降级的基础**（D6 / SV-06 / FN-18）：
 * - 可见 → 完整调度（30s tick）
 * - 隐藏 → Web Worker 心跳（5min，粗粒度）+ Notification
 * - 恢复 → 计算 missedTicks，UI 补发提示
 */
export function useVisibility(): boolean {
  const [visible, setVisible] = useState<boolean>(
    typeof document === 'undefined' ? true : !document.hidden,
  );
  const setVisibleStore = useProactiveStore((s) => s.setVisible);

  useEffect(() => {
    const onChange = () => {
      const v = !document.hidden;
      setVisible(v);
      // 同步到 store：store 内部会做 missedTicks 补偿
      setVisibleStore(v);
    };
    document.addEventListener('visibilitychange', onChange);
    // 首次挂载也同步一次，避免 SSR/首帧状态不一致
    onChange();
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [setVisibleStore]);

  return visible;
}

export default useVisibility;
