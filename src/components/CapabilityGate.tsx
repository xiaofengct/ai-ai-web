import { cloneElement, type ReactElement } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { getCapability } from '@/constants/capabilities';
import { t, type CopyKey } from '@/copy';

/**
 * ★★ 能力闸门（架构文档 §6.10、D5）。
 *
 * - `level='full'`        → 原样渲染；
 * - `partial/alternative`  → 渲染但带说明 Tooltip（原因 + 替代方案）；
 * - `unavailable`          → `disabled` + 置灰 + Tooltip（原因 + 替代方案）。
 *
 * 目的：16 项不可实现功能**不允许静默缺失**，必须在 UI 上给出显式说明（PRD §11）。
 */
export interface CapabilityGateProps {
  /** 'PG-01' | 'FN-50' ... */
  featureId: string;
  children: ReactElement;
  /** 不可实现时隐藏（而不是置灰）——用于「入口本身没意义」的场景 */
  hideWhenUnavailable?: boolean;
  /** 部分实现时是否也置灰（默认否，因为部分实现仍可用） */
  disableWhenPartial?: boolean;
}

export function CapabilityGate({
  featureId,
  children,
  hideWhenUnavailable = false,
  disableWhenPartial = false,
}: CapabilityGateProps) {
  const meta = getCapability(featureId);

  // 未收录的 ID 视为完全可用，避免误置灰
  if (!meta || meta.level === 'full') return children;

  const unavailable = meta.level === 'unavailable';
  const disabled = unavailable || disableWhenPartial;

  if (unavailable && hideWhenUnavailable) return null;

  const altKey = meta.alternative as CopyKey | undefined;

  const tip = (
    <Box sx={{ maxWidth: 320, p: 0.5 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        {unavailable ? t('gate.unavailable') : t('gate.partial')}
        <Box component="span" sx={{ ml: 1, opacity: 0.7, fontWeight: 400 }}>
          {featureId}
        </Box>
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
        {t('gate.reasonPrefix')}
        {/* ★ 141 条归口后 meta.reason 是 CopyKey，必须走 t()（漏了会显示 raw key，编译照过） */}
        {t(meta.reason)}
      </Typography>
      {altKey ? (
        <Typography variant="body2" sx={{ mt: 0.75, whiteSpace: 'pre-wrap' }}>
          {t('gate.altPrefix')}
          {t(altKey)}
        </Typography>
      ) : null}
      {meta.note ? (
        <Typography variant="caption" sx={{ mt: 0.75, display: 'block', opacity: 0.8 }}>
          {t(meta.note)}
        </Typography>
      ) : null}
    </Box>
  );

  const child = disabled
    ? (cloneElement(children as ReactElement<{ disabled?: boolean }>, { disabled: true }) as ReactElement)
    : children;

  return (
    <Tooltip title={tip} placement="top" arrow>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          // ★ 置灰：不可实现项一眼可辨
          ...(unavailable ? { opacity: 0.45, filter: 'saturate(0.4)' } : null),
          ...(disabled ? { cursor: 'not-allowed' } : null),
        }}
        aria-disabled={disabled || undefined}
      >
        {child}
      </Box>
    </Tooltip>
  );
}

export default CapabilityGate;
