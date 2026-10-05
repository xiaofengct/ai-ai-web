import { useCallback } from 'react';
import type { CopyKey, CopyVars } from './keys';
import { xinranCopy } from './xinran';

/**
 * 文案取值唯一入口（架构文档 §6.8 第二道防线）。
 * 组件里禁止出现面向用户的中文字符串字面量，一律 `t('xxx.yyy')`。
 */

/** 占位符替换：{name} → vars.name */
function interpolate(template: string, vars?: CopyVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
}

/**
 * 取文案。
 * 缺失 key 时不抛错（避免文案表偶发缺失直接白屏），返回 key 本身并告警，
 * 由 `npm run lint:copy` 与 `tsc --noEmit` 在编译期兜底。
 */
export function t(key: CopyKey, vars?: CopyVars): string {
  const raw = xinranCopy[key];
  if (raw === undefined) {
    // eslint-disable-next-line no-console
    console.warn(`[copy] missing key: ${key}`);
    return key;
  }
  return interpolate(raw, vars);
}

/** 判断 level≠full 时是否要提示替代方案 */
export function hasAlt(key: CopyKey): boolean {
  return key !== 'alt.notNeeded';
}

/** React Hook：组件内取文案（保持引用稳定，便于 memo 依赖） */
export function useCopy(): (key: CopyKey, vars?: CopyVars) => string {
  return useCallback((key: CopyKey, vars?: CopyVars) => t(key, vars), []);
}

export { xinranCopy, XINRAN_GREETINGS, XINRAN_LAYERS, XINRAN_NAME, XINRAN_CREATOR_NOTES } from './xinran';
export type { CopyKey, CopyVars } from './keys';
export { COPY_KEYS } from './keys';
