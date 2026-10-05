import { useCallback, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';

import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { t, type CopyKey } from '@/copy';
import { sl, type SettingsTextKey } from './settingsCopy';

/**
 * 设置分组卡片（PG-17）。
 *
 * ★ 移动端适配（决策 A8）：长设置页**分组折叠**，触控目标 ≥44px。
 *   桌面端默认展开（一眼看全），窄屏默认收起（避免无限滚动找不着）。
 *
 * 标题一律走 `copy/xinran.ts` 的 `settings.group.*`；
 * 分组说明走本域补充表 `settingsCopy.ts`（避免改动 `src/copy/`）。
 *
 * ★★ 2026-10-04 重构：**移除标题右侧的能力编号**（`featureId` 入参整体删掉）。
 *
 *   原实现在标题右侧渲染一串能力 ID（如 `FN-11 / FN-25 / FN-33 / FN-45 / FN-49 / FN-50 / FN-51`，
 *   最长的 54 字符），注释写明的用途是「便于自检」。它造成两个问题：
 *
 *   ① **布局塌方（真机截图可证）**：标题那侧写的是 `flex: 1, minWidth: 0`，
 *      而编号那侧的 `<Typography>` 既没有 `flexShrink: 0` 也没有 `whiteSpace: nowrap`
 *      ⇒ 长编号抢走整行宽度，标题被压到**最小内容宽度**，
 *      中文就变成一字一行 —— 「模型」「聊天」「上下文」在手机上被排成竖排。
 *   ② **对用户零价值**：能力编号是内部审计口径，用户看不懂也不需要。
 *
 *   ★ 能力审计**不受影响**：它靠的是每个设置行上的 `data-feature-id`
 *     （见 `components/SettingRow.tsx`），那是 DOM 属性、不占视觉空间。
 *     真要按分组核对，用 `data-section-id` 即可。
 */
export interface SettingsSectionCardProps {
  /** 分组标识（model / chat / ...），用于 React key、折叠状态与 `data-section-id` */
  id: string;
  /** 标题文案 key（settings.group.*） */
  titleKey: CopyKey;
  /** 分组说明（设置域补充文案 key） */
  descKey?: SettingsTextKey;
  /**
   * 视觉权重。
   * - `primary`：核心分组（如「模型」），标题稍大且用主色强调；
   * - `default`：常规分组；
   * - `subtle`：低频分组（高级/关于），标题降级为次要色，视觉上明显轻于常规项。
   * ★ 信息层级的表达方式：**用权重与位置，而不是再加一层标题** ——
   *   用户要的是"一眼看出该先看哪块"，不是更多的字。
   */
  emphasis?: 'primary' | 'default' | 'subtle';
  /** 是否默认展开（不传：宽屏展开、窄屏收起） */
  defaultOpen?: boolean;
  children: ReactNode;
}

/** 是否为窄屏（与决策 A8 的 44px 触控口径配套） */
function isNarrow(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 600px)').matches;
}

export function SettingsSectionCard({
  id,
  titleKey,
  descKey,
  emphasis = 'default',
  defaultOpen,
  children,
}: SettingsSectionCardProps): JSX.Element {
  const [open, setOpen] = useState<boolean>(() => defaultOpen ?? !isNarrow());
  const toggle = useCallback(() => setOpen((prev) => !prev), []);
  const subtle = emphasis === 'subtle';
  const primary = emphasis === 'primary';

  return (
    <Box
      data-section-id={id}
      sx={{
        // ★ 去掉每卡一圈的描边：改用「纸面底色 + 圆角」区分层次。
        //   浅色下 page #F7F7F8 / paper #FFFFFF，深色下 #161A22 / #1E232D，
        //   对比虽轻但足够分段，且不再有「满屏都是框」的观感。
        bgcolor: 'background.paper',
        borderRadius: 3,
        overflow: 'hidden',
      }}
    >
      {/* ★ 触控目标 ≥44px */}
      <Stack
        component="button"
        type="button"
        onClick={toggle}
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          width: '100%',
          minHeight: 52,
          px: { xs: 2, md: 2.5 },
          py: 1,
          border: 0,
          bgcolor: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
          '&:hover': { bgcolor: 'action.hover' },
        }}
        aria-expanded={open}
        aria-controls={`settings-section-${id}`}
      >
        <Typography
          variant={primary ? 'subtitle1' : 'body1'}
          sx={{
            fontWeight: primary ? 700 : 600,
            // ★ 关键：标题占据剩余空间且允许收缩；不再有右侧的长编号与它争宽
            flex: 1,
            minWidth: 0,
            color: subtle ? 'text.secondary' : 'text.primary',
          }}
        >
          {t(titleKey)}
        </Typography>
        <ExpandMoreIcon
          fontSize="small"
          sx={{
            flexShrink: 0,
            opacity: subtle ? 0.5 : 0.7,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 160ms',
          }}
        />
      </Stack>

      <Collapse in={open} unmountOnExit>
        <Box id={`settings-section-${id}`} sx={{ px: { xs: 2, md: 2.5 }, pb: 1.5 }}>
          {/* 说明放在折叠内容里：收起时每节只剩干净的一行标题，
              长列表的扫描效率明显更高（原先说明挂在标题下方，收起也占一行） */}
          {descKey ? (
            <Typography variant="caption" sx={{ display: 'block', opacity: 0.62, pb: 1.5 }}>
              {sl(descKey)}
            </Typography>
          ) : null}
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}

export default SettingsSectionCard;
