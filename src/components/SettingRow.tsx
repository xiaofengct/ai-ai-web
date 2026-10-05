import type { ReactElement, ReactNode } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { t, type CopyKey } from '@/copy';
import { CapabilityGate } from './CapabilityGate';

/**
 * 设置行容器（架构文档 §2）：label + 控制 + 说明 + CapabilityGate 集成。
 *
 * ★ 用法：
 * ```tsx
 * <SettingRow labelKey="settings.hint.contextCount" featureId="FN-05">
 *   <NumberField value={n} onChange={setN} />
 * </SettingRow>
 * ```
 * - `label`：设置项名称（由调用方给**字面量**是不允许的，这里收 `labelKey`；
 *   若确有非文案表的专有名词，用 `labelText` 并注明原因）
 * - `hintKey`：设置项说明（走 `settings.hint.*`）
 * - `featureId`：传入后自动套 `<CapabilityGate>`，不可实现项置灰并给原因
 */
export interface SettingRowProps {
  /** 设置项名称（文案 key） */
  labelKey?: CopyKey;
  /** 设置项名称（非文案表的专有名词，谨慎使用） */
  labelText?: string;
  /** 说明文案 key（settings.hint.*） */
  hintKey?: CopyKey;
  /**
   * 说明文案（已解析的字符串）。
   *
   * ★ 为什么新增：设置域有一批说明只在 `features/settings/settingsCopy.ts`（不进总表），
   *   原先由 `SettingsField` 自己再渲染一行 caption 来补 —— 于是同一个 hint 机制
   *   在两层各实现一遍（`SettingsField` 传 `divider={false}` 抑制本组件的分割线，
   *   再自己画一条）。多一个入参就能把两处合并成一处，也让「谁负责渲染」有唯一答案。
   */
  hintText?: string;
  /** 功能项 ID，传入后自动做能力闸门 */
  featureId?: string;
  children: ReactNode;
  /** 不可实现时隐藏整行 */
  hideWhenUnavailable?: boolean;
  /** 是否显示分隔线 */
  divider?: boolean;
  /** 嵌套行（缩进，用于分组内的子项） */
  nested?: boolean;
}

export function SettingRow({
  labelKey,
  labelText,
  hintKey,
  hintText,
  featureId,
  children,
  hideWhenUnavailable = false,
  divider = true,
  nested = false,
}: SettingRowProps) {
  const label = labelKey ? t(labelKey) : (labelText ?? '');
  // 两个来源二选一；`hintKey` 优先（总表是权威文案）
  const hint = hintKey ? t(hintKey) : (hintText ?? '');
  const control = featureId ? (
    <CapabilityGate featureId={featureId} hideWhenUnavailable={hideWhenUnavailable}>
      {children as ReactElement}
    </CapabilityGate>
  ) : (
    children
  );

  return (
    <Box
      data-feature-id={featureId}
      sx={{ ...(nested ? { pl: 2, borderLeft: '2px solid', borderColor: 'divider' } : null) }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          py: 1.125,
          minHeight: 48,
          // ★★ 防「标签被压成一字一行」（2026-10-04，真机截图暴露的同类塌方）
          //
          //   现象：`ModelSection` 的「去它家看看」那一行，控件里有个超宽元素
          //   （一整句话当 Chip 标签），于是标签被挤到只剩 1 字宽，
          //   中文逐字换行 ⇒ 竖排。**与分组标题那次是同一类错误，只是发生在行上**。
          //
          //   根因：控件容器原为 `flexShrink: 0`（不该被压缩，这是对的），
          //   而标签是 `flex: 0 1 auto` —— 控件一旦宽过整行，标签就只能被压到 0。
          //
          //   修法：**允许换行**。标签用 `flex: '1 1 auto'`（基准尺寸=自身内容宽），
          //   行开 `flexWrap: 'wrap'` ⇒ 两者放不下时，**控件整体换到第二行**，
          //   标签保住完整宽度。放得下时标签仍会 `grow` 撑满，既有布局不受影响。
          //   这比"给控件加 maxWidth"更稳：不猜宽度、不裁剪控件内容。
          flexWrap: 'wrap',
          columnGap: 1.5,
          rowGap: 0.75,
        }}
      >
        <Typography
          variant="body2"
          sx={{
            fontWeight: 500,
            // `minWidth: 0` 允许超长标签自身换行（而不是把控件顶出容器）；
            // `flex: '1 1 auto'` 让它在放得下时撑满、放不下时先让控件换行。
            minWidth: 0,
            flex: '1 1 auto',
          }}
        >
          {label}
        </Typography>
        {/* 控件不被压缩：宁可它换行，也不让它压扁标签 */}
        <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', maxWidth: '100%' }}>{control}</Box>
      </Stack>
      {/*
        ★ 说明只渲染**一次**（2026-10-04 重构）：
          原先这里除下面这行 caption 外，还额外渲染一个 `HelpOutlineIcon` + Tooltip，
          内容与 caption 完全相同 ⇒ 同一句话在屏幕上出现两遍。
          且 tooltip 依赖 hover，**在触屏（本应用的主要形态）上根本唤不出来**，
          等于给移动端用户留了一个唤不出、又占位的装饰图标。
          ⇒ 去掉图标，保留可见的 caption（它对触屏和无障碍都更友好）。
      */}
      {hint ? (
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.62, pb: divider ? 0.75 : 1, pr: 6 }}>
          {hint}
        </Typography>
      ) : null}
      {divider ? <Divider /> : null}
    </Box>
  );
}

export default SettingRow;
