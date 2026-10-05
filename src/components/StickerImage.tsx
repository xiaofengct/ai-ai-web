import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { blobRepo } from '@/db/repo/blobRepo';
import type { StickerItem } from '@/types/media';

/**
 * ★★ 表情图（通用组件，2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么要有这么一个"小"组件
 * ═══════════════════════════════════════════════════════════════════════════
 * 在此之前，聊天页的 `StickerPicker` 与 `MessageBubble` **都只渲染一行文字** ——
 * 表情包根本没有以图的形式出现过。原因很实在：内置占位包只有 12 条描述，
 * 一条真图都没有（`PLACEHOLDER_STICKERS` 里只有 `description` 与 `fileName`）。
 * 于是"表情"退化成了"文字标签"。
 *
 * 打通图片链路之后，**"怎么把一张表情显示出来"这件事出现在至少三处**：
 *   · 聊天输入框的表情面板（`StickerPicker`）
 *   · 聊天气泡里的表情消息（`MessageBubble`）
 *   · 朋友圈动态里配的表情（`MomentsPage`）
 * ⇒ 抽成一个组件，而不是在三个地方各写一遍 `<img>` + 各自的加载/失败处理。
 *   三份实现必然漂移：某天给其中一处加了失败兜底，另两处还是白框。
 *
 * ── 两条来源，同一套 DOM（这是本组件的核心）─────────────────────────────
 *   · `assetId`   → 走 `blobRepo.getObjectURL()` 拿 blob URL，**必须 revoke**
 *   · `remoteUrl` → 直接用 `<img src>`，**不需要也不该 revoke**
 *   两条路在调用方看来是同一个东西，差异全部收在这里。
 *
 * ── 三种状态都要有明确视觉（不能留白框）────────────────────────────────
 *   加载中 → 半透明占位块
 *   失败   → **显示文字标签**（`description`），而不是一个破图图标
 *   成功   → 图片
 *
 * ★ 「失败退化成文字」是刻意的：表情包在语义上是"一个情绪标签",
 *   图挂了但标签还在，对话依然读得通；而一个破图图标是纯噪音。
 *   这也复用了本项目既有的做法（旧版 `StickerPicker` 的 textOnly 分支就是这个思路）。
 */
export interface StickerImageProps {
  item: StickerItem;
  /** 边长（px）。表情建议 96~128，气泡里可以再小一点 */
  size?: number;
  /** 失败时是否显示文字标签（默认显示） */
  showLabelOnError?: boolean;
  onClick?: () => void;
}

type LoadState = 'loading' | 'ok' | 'failed';

export function StickerImage({
  item,
  size = 96,
  showLabelOnError = true,
  onClick,
}: StickerImageProps): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let alive = true;
    let created: string | null = null;
    setState('loading');
    setUrl(null);

    // ① 本地图：assetId → objectURL（**必须在卸载时 revoke**，否则内存一直挂着）
    if (item.assetId) {
      void (async () => {
        const res = await blobRepo.getObjectURL(item.assetId as string);
        if (!alive) return;
        if (!res.ok || !res.value) {
          setState('failed');
          return;
        }
        created = res.value;
        setUrl(res.value);
      })();
      return () => {
        alive = false;
        if (created) URL.revokeObjectURL(created);
      };
    }

    // ② 远程图：直接用链接。★ **不 revoke** —— 它不是 objectURL
    if (item.remoteUrl) {
      setUrl(item.remoteUrl);
      return () => {
        alive = false;
      };
    }

    // ③ 两者都没有（旧版占位包条目）⇒ 直接进失败态，退化成文字
    setState('failed');
    return () => {
      alive = false;
    };
  }, [item.assetId, item.remoteUrl]);

  const boxSx = {
    width: size,
    height: size,
    borderRadius: 1.5,
    border: 1,
    borderColor: 'divider',
    bgcolor: 'action.hover',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
    ...(onClick ? { cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } } : null),
  } as const;

  if (state === 'failed' || !url) {
    if (!showLabelOnError) {
      // 连兜底标签都不给 ⇒ 干脆不占位（调用方负责说明为什么空）
      return <></>;
    }
    return (
      <Box sx={boxSx} onClick={onClick} role={onClick ? 'button' : undefined}>
        <Typography
          variant="caption"
          align="center"
          sx={{ px: 0.5, lineHeight: 1.25, wordBreak: 'break-all', opacity: 0.75 }}
        >
          {item.description || item.fileName}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ ...boxSx, position: 'relative' }} onClick={onClick}>
      {state === 'loading' ? (
        <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'action.hover' }} aria-hidden />
      ) : null}
      <Box
        component="img"
        src={url}
        alt={item.description || item.fileName}
        loading="lazy"
        onLoad={() => setState('ok')}
        onError={() => setState('failed')}
        sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
      />
    </Box>
  );
}

export default StickerImage;
