import { useRef, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * 虚拟滚动封装（@tanstack/react-virtual）。
 * 消息流可达数万条（FN-13 加载范围 + FN-36 最大条数），必须虚拟化。
 *
 * @param estimateSize 预估行高（消息流建议给 88，允许动态测量）
 * @param reversed     是否「贴底」模式（聊天流需要 newest at bottom）
 */
export interface VirtualListProps<T> {
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  estimateSize?: number;
  height: number | string;
  overscan?: number;
  /** 变化时的 key（用于让 virtualizer 重新测量） */
  itemKey?: (item: T, index: number) => string;
  /** 滚动到顶部时触发（加载更多历史） */
  onReachStart?: () => void;
  /** 滚动到底部时触发 */
  onReachEnd?: () => void;
  empty?: ReactNode;
}

export function VirtualList<T>({
  items,
  renderItem,
  estimateSize = 88,
  height,
  overscan = 8,
  itemKey,
  onReachStart,
  onReachEnd,
  empty,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
    ...(itemKey ? { getItemKey: (index: number) => itemKey(items[index], index) } : {}),
  });

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <Box
      ref={parentRef}
      sx={{ height, overflow: 'auto', position: 'relative' }}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (onReachStart && el.scrollTop <= 8) onReachStart();
        if (onReachEnd && el.scrollHeight - el.scrollTop - el.clientHeight <= 8) onReachEnd();
      }}
    >
      {items.length === 0 && empty ? (
        empty
      ) : (
        <Box sx={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualItems.map((vi) => (
            <Box
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {renderItem(items[vi.index], vi.index)}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

export default VirtualList;
