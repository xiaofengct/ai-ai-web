import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

/**
 * 设置域「信息条」（浅底 + 圆角 + 说明文字）。
 *
 * ★ 为什么抽出来：同一段配方
 *   `Paper variant="outlined" + 浅底 + caption + 可选 chips`
 *   原先在 4 个地方各抄了一遍（`ProactiveSection` / `VoiceSection` /
 *   `AdvancedSection` / `BridgeSettingsPage`），间距、圆角、字号各写各的
 *   （`p:1.25` 与 `p:1.5` 混用、`opacity` 0.75/0.8/0.85 三种）。
 *   抽成一个组件后，这四处**结构、间距、底色、字号取同一值**，
 *   未来微调只需改这一个文件。
 *
 * ★ 只做展示，不承担闸门职责：能力闸门仍由 `SettingsField` → `CapabilityGate` 负责。
 */
export interface SettingsNoticeProps {
  /** 主说明文字 */
  children: ReactNode;
  /** 说明下方的附加内容（如能力 chips、按钮），可选 */
  extra?: ReactNode;
}

export function SettingsNotice({ children, extra }: SettingsNoticeProps): JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, bgcolor: 'action.hover' }}>
      <Typography variant="caption" sx={{ display: 'block', opacity: 0.85 }}>
        {children}
      </Typography>
      {extra ? <Box sx={{ mt: 0.75 }}>{extra}</Box> : null}
    </Paper>
  );
}

export default SettingsNotice;
