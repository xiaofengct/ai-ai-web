import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { CapabilityGate } from '@/components/CapabilityGate';
import { useSnack } from '@/hooks/useSnack';
import { getCapability } from '@/constants/capabilities';
import { t } from '@/copy';
import { log } from '@/store/logStore';
import type { CapabilityLevel } from '@/types/common';

/**
 * 模块权限清单页（PG-25 的降级实现）。
 *
 * ★★ 与原生「模块可申请系统权限」的差距（能力表 PG-25 = partial）：
 *   网页**只能授予浏览器内的能力**（存储 / 网络 / 通知 / 剪贴板 / 麦克风…），
 *   跟手机的系统权限**不是一回事**。差异必须写在页面上（`alt.browserPermission`），
 *   不能让用户以为勾一下就能拿到系统级权限。
 *
 * ★ 每一项的中文原因与替代方案**直接复用能力表** `CAPABILITIES[featureId]`，
 *   不在这里另写一套解释（避免两处说法不一致）。
 */

export type ModuleCapabilityId =
  | 'network'
  | 'microphone'
  | 'camera'
  | 'bluetooth'
  | 'overlay'
  | 'screenRead'
  | 'autostart'
  | 'alarm'
  | 'background'
  | 'filesystem'
  | 'vibrate'
  | 'notify'
  | 'sandboxJs'
  | 'ocr'
  | 'clipboard'
  | 'deviceManage'
  | 'scanCode';

export interface ModuleCapability {
  id: ModuleCapabilityId;
  /** 英文技术名（`src/features/**` 受 lint:copy 扫描，界面词不写中文） */
  label: string;
  /** 对应能力表的 ID；为 undefined 时只显示通用说明 */
  featureId?: string;
  level: CapabilityLevel;
  /** 是否建议默认授予（只影响 UI 提示，不构成真实授权） */
  defaultGrant: boolean;
}

/**
 * 浏览器可授予的能力清单。
 * `featureId` 有值时：中文原因 / 替代方案直接取能力表；
 * 没有值时（如剪贴板这种「浏览器有但没有精确对应项」的）只给通用说明。
 *
 * ★ 收录标准：**「模块向浏览器申请、且存在对应 Web API 概念」的能力**。
 *   按这个标准刻意排除三类，不属于遗漏：
 *   1. `SV-09 / SV-10 / SV-11`（保活 / 开机 / 后台常驻的系统级能力）——
 *      不是模块可申请项，且 `background`（PL-10）已覆盖其 Web 侧可做的部分；
 *   2. `PL-21`（<外部加固壳> 加固壳）——Android 打包期概念，不构成运行时权限；
 *   3. `PL-14 / PL-15 / PL-17 / PL-20`——属于应用自身的实现选型，不对外授予。
 */
export const MODULE_CAPABILITIES: readonly ModuleCapability[] = [
  { id: 'network', label: 'net.fetch', featureId: 'PL-01', level: 'full', defaultGrant: true },
  { id: 'microphone', label: 'media.microphone', featureId: 'PL-02', level: 'full', defaultGrant: false },
  { id: 'camera', label: 'media.camera', featureId: 'PL-03', level: 'full', defaultGrant: false },
  { id: 'notify', label: 'notification.post', featureId: 'PL-13', level: 'full', defaultGrant: false },
  { id: 'sandboxJs', label: 'sandbox.runJs', featureId: 'PL-16', level: 'partial', defaultGrant: true },
  { id: 'alarm', label: 'timer.precise', featureId: 'PL-09', level: 'partial', defaultGrant: false },
  { id: 'background', label: 'background.resident', featureId: 'PL-10', level: 'partial', defaultGrant: false },
  { id: 'filesystem', label: 'fs.pickFiles', featureId: 'PL-11', level: 'partial', defaultGrant: false },
  { id: 'vibrate', label: 'device.vibrate', featureId: 'PL-12', level: 'partial', defaultGrant: true },
  { id: 'ocr', label: 'vision.ocr', featureId: 'PL-18', level: 'partial', defaultGrant: false },
  { id: 'clipboard', label: 'clipboard.write', featureId: undefined, level: 'full', defaultGrant: true },
  { id: 'bluetooth', label: 'bluetooth.gatt', featureId: 'PL-04', level: 'unavailable', defaultGrant: false },
  { id: 'overlay', label: 'window.overlay', featureId: 'PL-05', level: 'unavailable', defaultGrant: false },
  { id: 'screenRead', label: 'screen.capture', featureId: 'PL-06', level: 'unavailable', defaultGrant: false },
  { id: 'autostart', label: 'boot.autostart', featureId: 'PL-08', level: 'unavailable', defaultGrant: false },
  { id: 'deviceManage', label: 'device.manage', featureId: 'PL-07', level: 'unavailable', defaultGrant: false },
  { id: 'scanCode', label: 'media.scanCode', featureId: 'PL-19', level: 'unavailable', defaultGrant: false },
];

/* ============================================================
   模块注册表（与 ModuleWebPage 共用）
   ============================================================ */

/** 模块注册表落 localStorage 的键前缀 */
export const MODULE_STORE_PREFIX = 'ai-ai.module.v1.';

export interface ModuleRegistryEntry {
  id: string;
  name: string;
  url: string;
  granted: ModuleCapabilityId[];
  createdAt: string;
}

/** 读模块注册表 */
export function readModuleEntry(id: string, fallbackUrl?: string): ModuleRegistryEntry {
  const base: ModuleRegistryEntry = {
    id,
    name: id,
    url: fallbackUrl ?? '',
    granted: [],
    createdAt: new Date().toISOString(),
  };
  if (typeof localStorage === 'undefined') return base;
  try {
    const raw = localStorage.getItem(`${MODULE_STORE_PREFIX}${id}`);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<ModuleRegistryEntry>;
    return {
      id,
      name: parsed.name ?? id,
      url: parsed.url ?? fallbackUrl ?? '',
      granted: Array.isArray(parsed.granted) ? (parsed.granted as ModuleCapabilityId[]) : [],
      createdAt: parsed.createdAt ?? base.createdAt,
    };
  } catch {
    return base;
  }
}

/** 写模块注册表 */
export function writeModuleEntry(entry: ModuleRegistryEntry): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${MODULE_STORE_PREFIX}${entry.id}`, JSON.stringify(entry));
  } catch {
    /* 忽略 */
  }
}

/** 能力等级 → Chip 颜色 */
function levelColor(level: CapabilityLevel): 'success' | 'warning' | 'info' | 'error' {
  switch (level) {
    case 'full':
      return 'success';
    case 'partial':
      return 'warning';
    case 'alternative':
      return 'info';
    default:
      return 'error';
  }
}

export default function ModulePermissionPage(): JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const snack = useSnack();
  const stored = useMemo(() => readModuleEntry(id), [id]);

  const [granted, setGranted] = useState<ModuleCapabilityId[]>(() =>
    stored.granted.length > 0
      ? stored.granted
      : MODULE_CAPABILITIES.filter((c) => c.defaultGrant).map((c) => c.id),
  );

  useEffect(() => {
    setGranted(
      stored.granted.length > 0
        ? stored.granted
        : MODULE_CAPABILITIES.filter((c) => c.defaultGrant).map((c) => c.id),
    );
  }, [stored.granted]);

  const toggle = useCallback((capabilityId: ModuleCapabilityId, next: boolean) => {
    setGranted((prev) => {
      const has = prev.includes(capabilityId);
      if (next && !has) return [...prev, capabilityId];
      if (!next && has) return prev.filter((x) => x !== capabilityId);
      return prev;
    });
  }, []);

  const handleSave = useCallback(() => {
    const entry: ModuleRegistryEntry = { ...stored, id, granted };
    writeModuleEntry(entry);
    log.info('module', 'update module permissions', { id, granted }, 'PG-25');
    snack.success('ok.saved');
  }, [stored, id, granted, snack]);

  const handleReset = useCallback(() => {
    setGranted(MODULE_CAPABILITIES.filter((c) => c.defaultGrant).map((c) => c.id));
  }, []);

  return (
    <Box sx={{ width: '100%', maxWidth: 760, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 2 }}>
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        {`permissions · ${id || '-'}`}
      </Typography>

      {/* ★ PG-25 = partial：只能授予浏览器内能力，与系统权限不是一回事 */}
      <CapabilityGate featureId="PG-25">
        <Typography variant="caption" sx={{ display: 'block', mb: 2, opacity: 0.75 }}>
          {t('alt.browserPermission')}
        </Typography>
      </CapabilityGate>

      <Stack spacing={0.5}>
        {MODULE_CAPABILITIES.map((capability) => {
          const meta = capability.featureId ? getCapability(capability.featureId) : undefined;
          const unavailable = capability.level === 'unavailable';
          const on = granted.includes(capability.id);

          return (
            <Stack
              key={capability.id}
              direction="row"
              spacing={1}
              alignItems="flex-start"
              sx={{
                px: 1.25,
                py: 1,
                borderRadius: 2,
                border: 1,
                borderColor: 'divider',
                opacity: unavailable ? 0.55 : 1,
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {capability.label}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={levelColor(capability.level)}
                    label={unavailable ? t('gate.unavailable') : capability.level}
                  />
                  {capability.featureId ? (
                    <Chip size="small" variant="outlined" label={capability.featureId} />
                  ) : null}
                </Stack>

                {/* 中文原因 / 替代方案直接复用能力表，不另写一套 */}
                {meta ? (
                  <>
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.8 }}>
                      {`${t('gate.reasonPrefix')}${t(meta.reason)}`}
                    </Typography>
                    {meta.alternative ? (
                      <Typography variant="caption" sx={{ display: 'block', opacity: 0.8 }}>
                        {`${t('gate.altPrefix')}${t(meta.alternative)}`}
                      </Typography>
                    ) : null}
                  </>
                ) : (
                  <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.8 }}>
                    {`browser API only; user gesture required. ${t('alt.workerSandbox')}`}
                  </Typography>
                )}
              </Box>

              <Switch
                checked={on && !unavailable}
                disabled={unavailable}
                onChange={(event) => toggle(capability.id, event.target.checked)}
                inputProps={{ 'aria-label': capability.id }}
              />
            </Stack>
          );
        })}
      </Stack>

      <Divider sx={{ my: 2 }} />

      <Stack direction="row" spacing={1}>
        <Button variant="contained" onClick={handleSave} sx={{ minHeight: 44 }}>
          {t('common.save')}
        </Button>
        <Button variant="text" onClick={handleReset} sx={{ minHeight: 44 }}>
          {t('common.reset')}
        </Button>
      </Stack>
    </Box>
  );
}
