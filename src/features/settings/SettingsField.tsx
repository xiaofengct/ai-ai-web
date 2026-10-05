import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { SettingRow } from '@/components/SettingRow';
import { t, type CopyKey } from '@/copy';
import { sl, type SettingsTextKey } from './settingsCopy';

/**
 * 设置项字段容器（在 `components/SettingRow` 之上补一层「本地补充文案」能力）。
 *
 * ★ 为什么还要包一层：`SettingRow` 的 `labelKey` / `hintKey` 只接受 `CopyKey`
 *   （架构文档 §6.8 的组件防线），而 63 个设置项里有一批条目名尚未收录进
 *   `src/copy/xinran.ts`（T09 不改动 `src/copy/`）。
 *   这里统一把「文案总表 key」与「设置域补充表 key」二选一透传进去。
 *
 * ★★ 2026-10-04 重构：**不再自己渲染 hint 与 Divider**（原先这两件事被实现了两遍）。
 *   原实现是：把 hint 交给本组件自己渲染一行 caption，同时给 `SettingRow` 传
 *   `divider={false}` 抑制它的分割线，再在本组件末尾自己画一条 `<Divider />`。
 *   后果：
 *     ① 「字段说明」这一个概念在两层各有一套实现（`hintCopyKey` 走 SettingRow、
 *        `hintKey` 走本组件），换 key 类型就会换渲染路径 —— 极易改漏；
 *     ② 每个字段后面都无条件跟一条分割线，**包括每节的最后一条**
 *        （10 个 Section 共 204 个字段 ⇒ 204 条线 + 一条节尾多余线），
 *        这是设置页显得"繁琐"的主要视觉来源。
 *   ⇒ 现在：hint 一律透传给 `SettingRow`（它统一渲染一次），
 *     分隔线改为**只在相邻字段之间**出现（用 `:not(:last-child)` 的 border），
 *     节尾不再有多余线。
 */
export interface SettingsFieldProps {
  /** 条目名（设置域补充表 key） */
  labelKey?: SettingsTextKey;
  /** 条目名（文案总表 key，优先于 labelKey） */
  labelCopyKey?: CopyKey;
  /** 说明（设置域补充表 key） */
  hintKey?: SettingsTextKey;
  /** 说明（文案总表 key，优先于 hintKey） */
  hintCopyKey?: CopyKey;
  /** 功能项 ID：传入后自动套 `<CapabilityGate>`，不可实现项置灰并给原因 */
  featureId?: string;
  /** 不可实现时隐藏整行 */
  hideWhenUnavailable?: boolean;
  /** 嵌套行（缩进） */
  nested?: boolean;
  children: ReactNode;
}

export function SettingsField({
  labelKey,
  labelCopyKey,
  hintKey,
  hintCopyKey,
  featureId,
  hideWhenUnavailable = false,
  nested = false,
  children,
}: SettingsFieldProps): JSX.Element {
  const label = labelCopyKey ? t(labelCopyKey) : labelKey ? sl(labelKey) : '';
  // 说明只解析成字符串，渲染交给 SettingRow（唯一渲染方）。
  // 优先取总表 key；总表没有才用设置域补充表。
  const hint = hintCopyKey ? t(hintCopyKey) : hintKey ? sl(hintKey) : '';

  return (
    <Box
      sx={{
        // 分隔线只在**相邻字段之间**：`:not(:last-child)` 让节尾不留残线
        '&:not(:last-child)': { borderBottom: 1, borderColor: 'divider' },
      }}
    >
      <SettingRow
        labelText={label}
        {...(hint ? { hintText: hint } : {})}
        {...(featureId ? { featureId } : {})}
        hideWhenUnavailable={hideWhenUnavailable}
        nested={nested}
        divider={false}
      >
        {children}
      </SettingRow>
    </Box>
  );
}

export default SettingsField;
