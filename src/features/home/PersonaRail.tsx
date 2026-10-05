import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import VerifiedIcon from '@mui/icons-material/Verified';
import { EmptyState } from '@/components/EmptyState';
import { BUILTIN_XINRAN } from '@/constants/buildMode';
import type { PersonaCard } from '@/types/persona';

/**
 * 角色横向轨（PG-15 的 v2 布局主元素，也复用于引导页第 2 步）。
 *
 * ★ 隐私红线（XR-06 / FN-52）：这里**不渲染任何角色立绘图片**，
 *   只用角色名首字做头像 —— 欣然的 `privacy.noImage = true`，
 *   任何角色都不在列表场景加载图像资源。
 */
export interface PersonaRailProps {
  personas: readonly PersonaCard[];
  currentId?: string;
  /** 选中回调（不传则只读展示） */
  onPick?: (card: PersonaCard) => void;
  dense?: boolean;
  /**
   * 列表是否**仍在读取中**（调用方传 `!personaStore.hydrated`）。
   *
   * ★ 为什么需要这个入参（同源缺陷的残留，独立验证发现的 P2）：
   *   `personas.length === 0` 有两种含义 —— 「还没读完」与「读完了确实没有」，
   *   而本组件只看长度就下结论。整页引导那层已经用 `hydrated` 把两者分开了，
   *   但**角色轨这一层没有**，于是过渡窗口里仍会渲染空态文案：
   *     - 内置版 → 「只有我一个」（**错**：欣然就在库里，只是还没读回来）
   *     - 不内置版 → 「还没有角色」（这句本身对，但也属抢答）
   *   独立验证实测该窗口：桌面 throttle=1x 约 25ms、**throttle=8x 约 245ms**（随 CPU 变慢而变长）。
   *   ⇒ 目标环境是手机，低端机上这个窗口会明显拉长，因此必须消除而不能等它自己过去。
   *
   * ★ 为什么默认 `false`（不传即"已读完"）：保持既有调用点的行为不变，
   *   只有明确知道自己在加载中的调用方才传 —— 避免把"忘传"变成"永远显示骨架"。
   */
  loading?: boolean;
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? Array.from(trimmed)[0] : '?';
}

export function PersonaRail({
  personas,
  currentId,
  onPick,
  dense = false,
  loading = false,
}: PersonaRailProps): JSX.Element {
  // ★ 过渡态：**还没读完** ≠ **确实没有**（理由与实测数据见 `PersonaRailProps.loading`）。
  //   此处渲染占位骨架而非任何文案 —— 宁可暂时空着，也不说一句与事实相反的话。
  //   高度取卡片实测高度（dense 78 / 普通 116），目的是让真卡片出现时**不产生布局跳动**；
  //   是近似值，不作为精确骨架。
  if (personas.length === 0 && loading) {
    return (
      <Box
        aria-busy="true"
        sx={{ display: 'flex', gap: 1.25, pb: 1, px: 0.25, overflow: 'hidden' }}
      >
        {[0, 1].map((i) => (
          <Skeleton
            key={i}
            variant="rounded"
            sx={{ flex: '0 0 auto', width: dense ? 104 : 132, height: dense ? 78 : 116, borderRadius: 3 }}
          />
        ))}
      </Box>
    );
  }

  if (personas.length === 0) {
    // ★ 两个版本的「空」不是同一件事：
    //   内置版 = 「只有我一个」（欣然在，别人没有）—— 口吻是人格注入的一部分，保留；
    //   不内置版 = **一个人都没有** ⇒ 沿用上面那句会变成假话（"只有我一个"？谁？）。
    //   ⇒ 按构建期开关分流（`constants/buildMode.ts`）。
    return <EmptyState descKey={BUILTIN_XINRAN ? 'empty.personas' : 'empty.personasSolo'} dense />;
  }

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.25,
        overflowX: 'auto',
        // 移动端横向滚动：留出内边距并隐藏滚动条
        pb: 1,
        px: 0.25,
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
      }}
    >
      {personas.map((card) => {
        const active = card.id === currentId;
        return (
          <Tooltip key={card.id} title={card.data.creator_notes ?? card.data.name} arrow>
            <Paper
              variant="outlined"
              onClick={() => onPick?.(card)}
              sx={{
                flex: '0 0 auto',
                width: dense ? 104 : 132,
                minHeight: 44,
                p: dense ? 1 : 1.25,
                cursor: onPick ? 'pointer' : 'default',
                borderRadius: 3,
                borderColor: active ? 'primary.main' : 'divider',
                borderWidth: active ? 2 : 1,
                bgcolor: active ? 'action.selected' : 'background.paper',
              }}
            >
              <Stack spacing={0.75} alignItems="center" textAlign="center">
                <Avatar sx={{ width: dense ? 36 : 44, height: dense ? 36 : 44, fontWeight: 700 }}>
                  {initialOf(card.data.name)}
                </Avatar>
                <Stack direction="row" spacing={0.25} alignItems="center">
                  <Typography variant="body2" noWrap sx={{ fontWeight: active ? 700 : 500, maxWidth: 92 }}>
                    {card.data.name}
                  </Typography>
                  {card.isBuiltin ? (
                    // 内置卡（欣然）：带标记，且不可删除
                    <VerifiedIcon sx={{ fontSize: 14, color: 'primary.main' }} />
                  ) : null}
                </Stack>
                {!dense ? (
                  // 标签是卡片数据（非文案表内容），没有就不占位
                  <Typography variant="caption" noWrap sx={{ opacity: 0.6, maxWidth: 108 }}>
                    {card.data.tags?.[0] ?? ''}
                  </Typography>
                ) : null}
              </Stack>
            </Paper>
          </Tooltip>
        );
      })}
    </Box>
  );
}

export default PersonaRail;
