import { useCallback } from 'react';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * ★ 设置项里那些「PRD 有这一项，但 `ChatSettings` 没有专属字段」的开关
 *   （如 FN-01 聊天统计、FN-32 收藏、FN-44 合并、FN-35 更新说明）。
 *
 * 落点统一放 `AppSettings.advanced: Record<string, unknown>`：
 * - 不污染 `ChatSettings` / `AppearanceSettings` 的 schema（避免迁移成本）；
 * - key 直接用功能项 ID（'FN-01'），诊断/开发者页按同一套 ID 索引，好排查；
 * - `settingsStore.patch()` 走 `deepMerge`，只改一个 key 不会清掉其它 key。
 */

/** 布尔开关：读 `advanced[id]`，缺省用 `fallback` */
export function useAdvancedFlag(id: string, fallback = false): [boolean, (next: boolean) => void] {
  const raw = useSettingsStore((s) => s.settings.advanced[id]);
  const patch = useSettingsStore((s) => s.patch);

  const set = useCallback(
    (next: boolean) => {
      patch({ advanced: { [id]: next } });
    },
    [id, patch],
  );

  return [typeof raw === 'boolean' ? raw : fallback, set];
}

/** 数值开关：读 `advanced[id]`，缺省用 `fallback` */
export function useAdvancedNumber(id: string, fallback: number): [number, (next: number) => void] {
  const raw = useSettingsStore((s) => s.settings.advanced[id]);
  const patch = useSettingsStore((s) => s.patch);

  const set = useCallback(
    (next: number) => {
      patch({ advanced: { [id]: next } });
    },
    [id, patch],
  );

  return [typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback, set];
}

/** 字符串开关：读 `advanced[id]`，缺省用 `fallback` */
export function useAdvancedText(id: string, fallback = ''): [string, (next: string) => void] {
  const raw = useSettingsStore((s) => s.settings.advanced[id]);
  const patch = useSettingsStore((s) => s.patch);

  const set = useCallback(
    (next: string) => {
      patch({ advanced: { [id]: next } });
    },
    [id, patch],
  );

  return [typeof raw === 'string' ? raw : fallback, set];
}

/** 字符串数组（如请求头列表、导入规则） */
export function useAdvancedList(id: string): [string[], (next: string[]) => void] {
  const raw = useSettingsStore((s) => s.settings.advanced[id]);
  const patch = useSettingsStore((s) => s.patch);

  const set = useCallback(
    (next: string[]) => {
      patch({ advanced: { [id]: next } });
    },
    [id, patch],
  );

  return [Array.isArray(raw) ? (raw.filter((x) => typeof x === 'string') as string[]) : [], set];
}

/** 功能项 ID → 默认值一览表（开发者页自检与「恢复默认」用） */
export const ADVANCED_FLAG_DEFAULTS: Readonly<Record<string, boolean | number | string>> = {
  'FN-01': true,
  'FN-32': true,
  'FN-35': true,
  'FN-36': 20_000,
  'FN-44': true,
  'FN-53': false,
  'FN-54': false,
  'telemetry.enabled': false,
};
