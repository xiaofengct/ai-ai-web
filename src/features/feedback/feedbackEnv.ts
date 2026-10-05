import { Capacitor } from '@capacitor/core';
import { BUILD_FLAVOR } from '@/constants/buildMode';
import type { FeedbackEnv } from '@/types/feedback';
import { fb, type FeedbackTextKey } from './feedbackCopy';

/**
 * ★ 提交反馈时自动采集的**环境快照**（2026-10-04）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么只采这些、为什么一个身份字段都没有
 * ═══════════════════════════════════════════════════════════════════════════
 * 反馈里最常见的一句是"它坏了"，而"它"是什么环境下的几乎永远缺失 ——
 * 于是每一条都要来回问一遍。这六个字段的目的就是把那一轮问话省掉。
 *
 * ★ **不采集任何身份信息**：没有设备 ID、没有 IMEI、没有账号、没有 IP。
 *   全部取值都来自"运行环境本来就公开的信息"（版本号、平台、UA、视口、语言）。
 *   这条不是技术限制，是**刻意的设计**：反馈通道不该因为"方便排查"
 *   而顺手把一个设备指纹收集器做出来。
 *   ⇒ 界面上（`fb.form.envNote`）也如实告诉用户会带什么。
 *
 * ★ `userAgent` 是唯一偏长、且理论上可能带偏信息的字段，
 *   所以：① 界面明说会带上它；② 导出成文本时**放在最后**并单独成段，
 *   用户想删掉一整个自然段就行，不用在正文里找。
 *
 * ★ 取值**全部包在 try 里**：反馈功能本身**绝不能因为采集环境失败而挂掉**。
 *   拿不到的字段留空串，导出时那一行会被跳过（见 `feedbackShare.ts` 的 `envLines`）。
 *   一个"因为读不到屏幕尺寸所以提交失败"的反馈功能，是这个功能最大的笑话。
 */

/** 平台粗分类：android / ios / desktop / web */
function detectPlatform(): string {
  try {
    // Capacitor 在原生壳里能给出准确值；Web 端返回 'web'
    const p = Capacitor.getPlatform();
    if (p === 'android' || p === 'ios') return p;
  } catch {
    /* 落到下面的 UA 判断 */
  }
  try {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    // ★ 桌面端也标出来：同一个 bug 在手机和电脑上常常不是一个原因
    if (/Windows|Macintosh|Linux|X11/i.test(ua)) return 'desktop';
  } catch {
    /* 忽略 */
  }
  return 'web';
}

/** 安全取一个字符串（任何异常都降级为空串，绝不抛出） */
function safe(fn: () => string | undefined): string {
  try {
    return fn() ?? '';
  } catch {
    return '';
  }
}

/** 采集当前环境快照 */
export function collectEnv(): FeedbackEnv {
  const env: FeedbackEnv = {
    appVersion: safe(() => import.meta.env?.VITE_APP_VERSION ?? '0.1.0'),
    buildFlavor: safe(() => BUILD_FLAVOR),
    platform: safe(() => detectPlatform()),
    userAgent: safe(() => (typeof navigator === 'undefined' ? '' : navigator.userAgent)),
    locale: safe(() => (typeof navigator === 'undefined' ? '' : navigator.language)),
    viewport: safe(() =>
      typeof window === 'undefined' ? '' : `${window.innerWidth}x${window.innerHeight}`,
    ),
  };
  return env;
}

/**
 * 环境快照 → 中文字段名（导出文本 / 详情面板共用）。
 *
 * ★ 字段名走**文案表**（`fb.env.*`），不在这里硬写：
 *   它们是用户看得见的（提交前那一块、以及导出文本里的环境段落）。
 *   第一版硬写在常量里，`lint:copy` 的兜底扫描把 6 条全捞出来了。
 * ★ 空字段由调用方**直接跳过整行**，而不是产出「平台：（空）」——
 *   后者会让导出文本看起来像坏了。
 */
export const ENV_FIELDS: ReadonlyArray<keyof FeedbackEnv> = [
  'appVersion',
  'buildFlavor',
  'platform',
  'locale',
  'viewport',
  'userAgent',
];

/** 字段 → 显示名（找不到就回落成字段名本身，不抛错） */
export function envLabel(field: keyof FeedbackEnv): string {
  const map: Record<keyof FeedbackEnv, FeedbackTextKey> = {
    appVersion: 'fb.env.appVersion',
    buildFlavor: 'fb.env.buildFlavor',
    platform: 'fb.env.platform',
    locale: 'fb.env.locale',
    viewport: 'fb.env.viewport',
    userAgent: 'fb.env.userAgent',
  };
  const key = map[field];
  return key ? fb(key) : field;
}

/** 构建类型 → 人话（`BUILD_FLAVOR` 是开发标识符，直接给用户看不合适） */
export function flavorText(flavor: string): string {
  if (flavor === 'builtin-xinran') return fb('fb.flavor.builtin');
  if (flavor === 'standalone') return fb('fb.flavor.standalone');
  return flavor || '';
}

/** 环境快照一行值的显示：构建类型要翻译，其余原样 */
export function envValue(field: keyof FeedbackEnv, raw: string): string {
  return field === 'buildFlavor' ? flavorText(raw) : raw;
}
