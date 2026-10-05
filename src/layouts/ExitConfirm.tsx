import { useCallback, useEffect } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { appEmitter } from '@/lib/emitter';
import { useUiStore } from '@/store/uiStore';
import { log } from '@/store/logStore';

/**
 * 应用级「退出确认」对话框。
 *
 * ★ 为什么要有这个组件（2026-10-04 新增，返回键改造的配套）：
 *
 *   改动前，退出确认与它的状态**分散在两处、且有一处是断的**：
 *   - `TopBar` 用一个**局部** `useState` 持有 `exitOpen`，对话框也渲染在 `TopBar` 里；
 *   - 同一处代码又往 `appEmitter` 发 `app:exit-request` 事件，注释说"由 FloatingLayer 弹出确认"
 *     —— 但**全仓没有任何监听方**，也就是那条广播一直是**死事件**。
 *
 *   而 Android 返回键需要在**根部**复用同一个确认框
 *   （见 `hooks/useBackGuard.ts` 的决策 ③），它显然碰不到 `TopBar` 的局部 state。
 *   ⇒ 把"谁来渲染"收敛成唯一一处：状态放 `uiStore.exitConfirmOpen`，
 *     本组件渲染；`TopBar` 双击 Logo 与返回键都只是**请求**打开它。
 *
 * ★ 顺带修掉死事件：`app:exit-request` 现在**真的有监听方了**，
 *   而且它与 `uiStore` 两条路都能触发（前者供非 React 代码用，如日志/脚本）。
 */
export function ExitConfirm(): JSX.Element {
  const open = useUiStore((s) => s.exitConfirmOpen);
  const requestExitConfirm = useUiStore((s) => s.requestExitConfirm);

  const close = useCallback((): void => {
    requestExitConfirm(false);
  }, [requestExitConfirm]);

  /**
   * 确认退出。
   *
   * ★ 两条路径，取决于运行环境：
   *   - **Android**：真正的 `finish()` 由原生在 `window.__aiAiBack()` 返回 `'exit'` 时执行；
   *     这里调用 `__aiAiExit`（由原生提供）走同一条出口。
   *   - **浏览器**：`window.close()` 只对脚本打开的标签页有效，
   *     普通标签页关不掉 —— 这时只记日志，不假装成功。
   *
   * ★ 不要在里面对 `app:exit-request` 再 emit：该事件的含义是「**请求**显示确认框」，
   *   在这里广播等于"刚关掉又请求打开"，会立刻把对话框弹回来（死循环）。
   *   若将来需要"正在退出"的通知，请**另加一个事件名**，不要复用这一个。
   */
  const handleConfirm = useCallback((): void => {
    close();

    // 原生侧若提供了退出钩子则用它（与返回键走同一条出口）
    const w = window as unknown as { __aiAiExit?: () => void };
    if (typeof w.__aiAiExit === 'function') {
      w.__aiAiExit();
      return;
    }

    try {
      window.close();
      log.info('app', '已请求关闭窗口', undefined, 'FN-16');
    } catch (e) {
      log.warn('app', '窗口无法被脚本关闭（非脚本打开的标签页）', String(e), 'FN-16');
    }
  }, [close]);

  /** 订阅广播：给非 React 的调用方（脚本/日志/将来别的原生入口）留一条路 */
  useEffect(() => appEmitter.on('app:exit-request', () => requestExitConfirm(true)), [requestExitConfirm]);

  return (
    <ConfirmDialog
      open={open}
      titleKey="confirm.exitApp"
      descKey="alt.exitConfirm"
      confirmKey="common.confirm"
      cancelKey="common.cancel"
      onConfirm={handleConfirm}
      onCancel={close}
    />
  );
}

export default ExitConfirm;
