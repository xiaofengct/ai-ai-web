import { useCallback, useMemo } from 'react';
import { useUiStore } from '@/store/uiStore';
import { t, type CopyKey, type CopyVars } from '@/copy';

/**
 * ★ 欣然口吻提示（架构文档 §2 `hooks/useSnack.ts`）。
 *
 * 约定：**只传文案 key**，不传中文/英文原始 message
 * （英文 message 只进日志与开发者页，见 §6.2）。
 *
 * ★★ 返回值必须 `useMemo` 冻结引用（浏览器实测发现的真 bug）：
 *   若每次 render 都返回新的对象字面量，那么任何把它写进 `useCallback` /
 *   `useEffect` 依赖数组的组件都会「依赖每次都变」→ 副作用无限重跑。
 *   实测症状：`HomePage` 的 `load()` 依赖 `snack`，于是
 *   `setLoading(true)` → 查库 → `setLoading(false)` → 依赖变了 → 再 `setLoading(true)` …
 *   无限循环，首页会话列表**永远停在转圈**，卡片一条都不渲染（PG-14 直接不可用），
 *   同时 IndexedDB 被反复查询。
 *   冻结引用后 `snack` 恒等于同一个对象，依赖数组才真正稳定。
 */

// ★★ 这里曾有一个 `raw(text)` 接口：**丢弃入参**，恒推 `common.done` + `{ text }` 变量。
//   结果是「复制失败」也弹「好了」——用户看到的是假成功（B-03）。
//   已按裁决删除接口与实现：所有提示**只能走 CopyKey**，没有绕过文案表的后门。
//   ★ 不要再加回 raw()：一旦有后门，就会有人用它塞裸字符串，文案表立刻失去意义。
export interface SnackApi {
  /** 默认（info） */
  show(key: CopyKey, vars?: CopyVars): string;
  success(key: CopyKey, vars?: CopyVars): string;
  error(key: CopyKey, vars?: CopyVars): string;
  warn(key: CopyKey, vars?: CopyVars): string;
  info(key: CopyKey, vars?: CopyVars): string;
}

export function useSnack(): SnackApi {
  const pushSnack = useUiStore((s) => s.pushSnack);

  const show = useCallback(
    (key: CopyKey, vars?: CopyVars) =>
      pushSnack({ key, vars, severity: 'default', durationMs: 3000 }),
    [pushSnack],
  );

  const success = useCallback(
    (key: CopyKey, vars?: CopyVars) =>
      pushSnack({ key, vars, severity: 'success', durationMs: 2600 }),
    [pushSnack],
  );

  const error = useCallback(
    (key: CopyKey, vars?: CopyVars) =>
      // 错误停留久一点，用户要看清「不是你的问题」
      pushSnack({ key, vars, severity: 'error', durationMs: 5200 }),
    [pushSnack],
  );

  const warn = useCallback(
    (key: CopyKey, vars?: CopyVars) =>
      pushSnack({ key, vars, severity: 'warning', durationMs: 4000 }),
    [pushSnack],
  );

  const info = useCallback(
    (key: CopyKey, vars?: CopyVars) =>
      pushSnack({ key, vars, severity: 'info', durationMs: 3000 }),
    [pushSnack],
  );

  // ★ 引用冻结：见文件头注释（修的是首页无限重载的真 bug，不要删）
  return useMemo(() => ({ show, success, error, warn, info }), [
    show,
    success,
    error,
    warn,
    info,
  ]);
}

/** 非组件场景（服务层）推提示：直接操作 store */
export const snack = {
  show: (key: CopyKey, vars?: CopyVars) =>
    useUiStore.getState().pushSnack({ key, vars, severity: 'default', durationMs: 3000 }),
  success: (key: CopyKey, vars?: CopyVars) =>
    useUiStore.getState().pushSnack({ key, vars, severity: 'success', durationMs: 2600 }),
  error: (key: CopyKey, vars?: CopyVars) =>
    useUiStore.getState().pushSnack({ key, vars, severity: 'error', durationMs: 5200 }),
  warn: (key: CopyKey, vars?: CopyVars) =>
    useUiStore.getState().pushSnack({ key, vars, severity: 'warning', durationMs: 4000 }),
  info: (key: CopyKey, vars?: CopyVars) =>
    useUiStore.getState().pushSnack({ key, vars, severity: 'info', durationMs: 3000 }),
};

/** 取渲染后的文案（组件里需要字符串时用） */
export function useCopyText(key: CopyKey, vars?: CopyVars): string {
  return t(key, vars);
}

export default useSnack;
