/**
 * 功能项 ID 枚举（架构文档 §6.1：功能项 ID 用字符串字面量联合）。
 *
 * 共 **141 项**，分组与 `docs/01-PRD-功能拆解.md` §6 完全一致：
 * PG 27 · SV 11 · FN 63 · PL 21 · EX 10 · XR 9。
 * 供 `constants/capabilities.ts` 与埋点日志（`LogEntry.featureId`）引用。
 */

export type PageFeatureId =
  | 'PG-01' | 'PG-02' | 'PG-03' | 'PG-04' | 'PG-05' | 'PG-06' | 'PG-07'
  | 'PG-08' | 'PG-09' | 'PG-10' | 'PG-11' | 'PG-12' | 'PG-13' | 'PG-14'
  | 'PG-15' | 'PG-16' | 'PG-17' | 'PG-18' | 'PG-19' | 'PG-20' | 'PG-21'
  | 'PG-22' | 'PG-23' | 'PG-24' | 'PG-25' | 'PG-26' | 'PG-27';

export type ServiceFeatureId =
  | 'SV-01' | 'SV-02' | 'SV-03' | 'SV-04' | 'SV-05' | 'SV-06'
  | 'SV-07' | 'SV-08' | 'SV-09' | 'SV-10' | 'SV-11';

export type SettingFeatureId =
  | 'FN-01' | 'FN-02' | 'FN-03' | 'FN-04' | 'FN-05' | 'FN-06' | 'FN-07'
  | 'FN-08' | 'FN-09' | 'FN-10' | 'FN-11' | 'FN-12' | 'FN-13' | 'FN-14'
  | 'FN-15' | 'FN-16' | 'FN-17' | 'FN-18' | 'FN-19' | 'FN-20' | 'FN-21'
  | 'FN-22' | 'FN-23' | 'FN-24' | 'FN-25' | 'FN-26' | 'FN-27' | 'FN-28'
  | 'FN-29' | 'FN-30' | 'FN-31' | 'FN-32' | 'FN-33' | 'FN-34' | 'FN-35'
  | 'FN-36' | 'FN-37' | 'FN-38' | 'FN-39' | 'FN-40' | 'FN-41' | 'FN-42'
  | 'FN-43' | 'FN-44' | 'FN-45' | 'FN-46' | 'FN-47' | 'FN-48' | 'FN-49'
  | 'FN-50' | 'FN-51' | 'FN-52' | 'FN-53' | 'FN-54' | 'FN-55' | 'FN-56'
  | 'FN-57' | 'FN-58' | 'FN-59' | 'FN-60' | 'FN-61' | 'FN-62' | 'FN-63';

export type PlatformFeatureId =
  | 'PL-01' | 'PL-02' | 'PL-03' | 'PL-04' | 'PL-05' | 'PL-06' | 'PL-07'
  | 'PL-08' | 'PL-09' | 'PL-10' | 'PL-11' | 'PL-12' | 'PL-13' | 'PL-14'
  | 'PL-15' | 'PL-16' | 'PL-17' | 'PL-18' | 'PL-19' | 'PL-20' | 'PL-21';

export type DistillFeatureId =
  | 'EX-01' | 'EX-02' | 'EX-03' | 'EX-04' | 'EX-05'
  | 'EX-06' | 'EX-07' | 'EX-08' | 'EX-09' | 'EX-10';

export type XinranFeatureId =
  | 'XR-01' | 'XR-02' | 'XR-03' | 'XR-04' | 'XR-05'
  | 'XR-06' | 'XR-07' | 'XR-08' | 'XR-09';

/** 全量功能项 ID 联合 */
export type FeatureId =
  | PageFeatureId
  | ServiceFeatureId
  | SettingFeatureId
  | PlatformFeatureId
  | DistillFeatureId
  | XinranFeatureId;

/** 全量 ID 列表（顺序稳定，便于遍历与自检） */
export const ALL_FEATURE_IDS: readonly FeatureId[] = [
  'PG-01', 'PG-02', 'PG-03', 'PG-04', 'PG-05', 'PG-06', 'PG-07', 'PG-08', 'PG-09',
  'PG-10', 'PG-11', 'PG-12', 'PG-13', 'PG-14', 'PG-15', 'PG-16', 'PG-17', 'PG-18',
  'PG-19', 'PG-20', 'PG-21', 'PG-22', 'PG-23', 'PG-24', 'PG-25', 'PG-26', 'PG-27',
  'SV-01', 'SV-02', 'SV-03', 'SV-04', 'SV-05', 'SV-06', 'SV-07', 'SV-08', 'SV-09',
  'SV-10', 'SV-11',
  'FN-01', 'FN-02', 'FN-03', 'FN-04', 'FN-05', 'FN-06', 'FN-07', 'FN-08', 'FN-09',
  'FN-10', 'FN-11', 'FN-12', 'FN-13', 'FN-14', 'FN-15', 'FN-16', 'FN-17', 'FN-18',
  'FN-19', 'FN-20', 'FN-21', 'FN-22', 'FN-23', 'FN-24', 'FN-25', 'FN-26', 'FN-27',
  'FN-28', 'FN-29', 'FN-30', 'FN-31', 'FN-32', 'FN-33', 'FN-34', 'FN-35', 'FN-36',
  'FN-37', 'FN-38', 'FN-39', 'FN-40', 'FN-41', 'FN-42', 'FN-43', 'FN-44', 'FN-45',
  'FN-46', 'FN-47', 'FN-48', 'FN-49', 'FN-50', 'FN-51', 'FN-52', 'FN-53', 'FN-54',
  'FN-55', 'FN-56', 'FN-57', 'FN-58', 'FN-59', 'FN-60', 'FN-61', 'FN-62', 'FN-63',
  'PL-01', 'PL-02', 'PL-03', 'PL-04', 'PL-05', 'PL-06', 'PL-07', 'PL-08', 'PL-09',
  'PL-10', 'PL-11', 'PL-12', 'PL-13', 'PL-14', 'PL-15', 'PL-16', 'PL-17', 'PL-18',
  'PL-19', 'PL-20', 'PL-21',
  'EX-01', 'EX-02', 'EX-03', 'EX-04', 'EX-05', 'EX-06', 'EX-07', 'EX-08', 'EX-09',
  'EX-10',
  'XR-01', 'XR-02', 'XR-03', 'XR-04', 'XR-05', 'XR-06', 'XR-07', 'XR-08', 'XR-09',
] as const;

/** 分组 ID 列表 */
export const PAGE_FEATURE_IDS: readonly PageFeatureId[] = ALL_FEATURE_IDS.filter((id) =>
  id.startsWith('PG-'),
) as readonly PageFeatureId[];
export const SERVICE_FEATURE_IDS: readonly ServiceFeatureId[] = ALL_FEATURE_IDS.filter((id) =>
  id.startsWith('SV-'),
) as readonly ServiceFeatureId[];
export const SETTING_FEATURE_IDS: readonly SettingFeatureId[] = ALL_FEATURE_IDS.filter((id) =>
  id.startsWith('FN-'),
) as readonly SettingFeatureId[];
export const PLATFORM_FEATURE_IDS: readonly PlatformFeatureId[] = ALL_FEATURE_IDS.filter((id) =>
  id.startsWith('PL-'),
) as readonly PlatformFeatureId[];
export const DISTILL_FEATURE_IDS: readonly DistillFeatureId[] = ALL_FEATURE_IDS.filter((id) =>
  id.startsWith('EX-'),
) as readonly DistillFeatureId[];
export const XINRAN_FEATURE_IDS: readonly XinranFeatureId[] = ALL_FEATURE_IDS.filter((id) =>
  id.startsWith('XR-'),
) as readonly XinranFeatureId[];

/** 功能项总数（PRD §10.1 = 141） */
export const TOTAL_FEATURE_COUNT = 141;
