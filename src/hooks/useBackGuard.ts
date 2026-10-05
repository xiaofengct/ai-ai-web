import { useEffect } from 'react';
import { useUiStore } from '@/store/uiStore';
import { log } from '@/store/logStore';

/**
 * Android 返回键行为（FN-16）。
 *
 * ★ 背景：**Capacitor 7 不处理返回键**。
 *   实测在 `node_modules/@capacitor/android` 全源码里搜 `onBackPressed` /
 *   `OnBackPressedCallback` / `backButton` 是**零命中**；我们的 `MainActivity` 原先也是空实现。
 *   结果：按一下返回键 ≈ 结束应用退回桌面。对聊天应用来说这是严重误伤
 *   —— 用户在聊天页误触就没了。
 *
 * ★ 修法的分工（原生只问一句，决定权在 Web）：
 *   - `MainActivity.onBackPressed()` 问 JS：`window.__aiAiBack()` 返回 `'exit'` 才 `finish()`。
 *     原生侧**不维护导航栈** —— 见 `android/.../MainActivity.java` 的注释。
 *   - 本文件安装那个函数，并在这里做**唯一的决策**。
 *   这样返回键与路由/浮层状态天然一致，不会出现"两套导航栈互相打架"。
 *
 * ★ 决策顺序（顺序本身就是设计，别随意调换）：
 *   ① **有浮层（弹窗/抽屉/菜单）→ 关掉它**。
 *      必须先于路由判断：弹窗里按返回应该是"关弹窗"，而不是"回退路由"
 *      ——否则用户会看到弹窗还开着、底下的页面变了，非常困惑。
 *   ② **不在 Tab 根 → 回退一级**。
 *      Tab 根 = `/`、`/memories`、`/distill`、`/settings`（与底部 4 个 Tab 一致）。
 *      在子页（如 `/settings/developer`、`/chat/:id`）按返回应回到上级。
 *   ③ **在 Tab 根 → 弹退出确认**（而不是直接退出）。
 *      复用应用既有的确认框（文案是 `confirm.exitApp`：「这就走了？我还没聊够呢。」），
 *      **不新建文案** —— 这一步完全满足用户诉求「不要直接退出到桌面」。
 *   ④ **确认框已经开着 → 放行退出**。即"在根部连按两次返回"才真的走，
 *      与 `chat.doubleBackExit`（默认 true，FN-16）的语义一致。
 *
 * ★ 为什么用「确认框」而不是 Android 常见的「再按一次」toast：
 *   toast 需要一句新文案，而 `src/copy/` 当前被另一个 worker 占用（冻结中）；
 *   更重要的是确认框**已经存在**（`confirm.exitApp` / `alt.exitConfirm` / `common.confirm` / `common.cancel`），
 *   复用它能顺带修掉那个"广播了却没人听"的死事件，不必再造一套。
 */

/** Tab 根路径（与 `layouts/MobileTabs.tsx` 的 4 个 Tab 对齐） */
const TAB_ROOTS: readonly string[] = ['/', '/memories', '/distill', '/settings'];

/** 会被返回键关掉的浮层选择器（MUI 的几种模态容器） */
const OVERLAY_SELECTOR = [
  '.MuiDialog-root',
  '.MuiDrawer-root.MuiModal-root',
  '.MuiMenu-root',
  '.MuiPopover-root',
  '.MuiModal-root',
].join(',');

/** 当前是否处于 Tab 根 */
function atTabRoot(pathname: string): boolean {
  return TAB_ROOTS.includes(pathname);
}

/**
 * 关掉最上层的浮层。
 *
 * ★ 手段是**派发 Escape**，而不是去调各浮层的关闭回调：
 *   我们无法从外部拿到任意组件的 `onClose`（它们各是局部 state）。
 *   MUI 的 Modal / Dialog / Drawer / Menu 默认都响应 Escape 键，
 *   所以这是**唯一一个不需要每个组件配合**的通用办法。
 *
 * ★ 已知局限（如实记录，不假装完备）：
 *   若某个浮层显式设了 `disableEscapeKeyDown`（MUI 允许关掉 Escape 关闭），
 *   这里会失效 —— 表现为"按返回没反应"，但**不会误退出**。
 *   宁可不响应，也不能退错。
 */
function closeTopOverlay(): boolean {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR));
  if (overlays.length === 0) return false;
  // DOM 顺序里靠后的通常是后打开、层级更高的那个
  const top = overlays[overlays.length - 1];
  if (!top) return false;
  top.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
}

/** 询问「退出确认框开着吗」（放在 store 里，避免与组件生命周期耦合） */
function exitConfirmVisible(): boolean {
  return useUiStore.getState().exitConfirmOpen;
}

/**
 * 返回键的决策函数 —— **独立导出，便于从真实页面里直接驱动验证**。
 *
 * ★ 为什么独立于 React：本项目没有单测框架（`package.json` 里没有 test 脚本），
 *   所以"可测"的真实含义是 —— 它挂在 `window.__aiAiBack` 上之后，
 *   QA 用的 CDP 脚本可以在真实浏览器里 `Runtime.evaluate('window.__aiAiBack()')`，
 *   在**不同页面状态**下断言返回值与副作用（路由是否回退、浮层是否关闭）。
 *   这正是 `scripts/qa/` 那套装置擅长的事。
 *   ⇒ 因此它必须是**纯函数式决策 + 明确的字符串返回值**，不能藏在 React 闭包里。
 *
 * @returns `'exit'` 放行退出；`'handled'` 已自行处理，原生不要退出
 */
export function decideBack(): 'exit' | 'handled' {
  // ④ 确认框已开 → 再按一次才放行。
  //    与 `chat.doubleBackExit`（默认 true，FN-16）的语义一致，
  //    也满足用户诉求「不要直接退出到桌面」。
  if (exitConfirmVisible()) return 'exit';

  // ① 浮层优先
  if (closeTopOverlay()) return 'handled';

  // ② 非根路径 → 回退一级。
  //    用 `history.back()` 而不是 router.navigate(-1)：本函数在 React 之外，
  //    拿不到 router 实例；而 SPA 的 popstate 会驱动 React Router 正常响应。
  if (!atTabRoot(window.location.pathname)) {
    window.history.back();
    return 'handled';
  }

  // ③ 根部 → 弹退出确认，绝不直接退
  useUiStore.getState().requestExitConfirm(true);
  return 'handled';
}

/** 供原生调用的全局函数名（与 `MainActivity.BACK_JS` 的 `window.__aiAiBack` 必须一致） */
const GLOBAL_BACK_FN = '__aiAiBack';

/**
 * 安装返回键处理。在 `App` 顶层调用一次。
 *
 * ★ 为什么挂在 `window` 上：原生侧只能通过 `evaluateJavascript` 调用
 *   全局作用域里的函数。这也是 Capacitor 项目接管返回键的常规做法。
 *
 * ★ 本函数**只处理 Android 原生**场景（只有 `MainActivity` 会调它）。
 *   浏览器里的返回键归浏览器自己管 —— 不去监听 `popstate` 抢它的行为，
 *   那会破坏用户对浏览器前进/后退的预期。
 */
export function useBackGuard(): void {
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w[GLOBAL_BACK_FN] = decideBack;
    log.info('app', '返回键接管已安装', { at: window.location.pathname }, 'FN-16');

    return () => {
      // 卸载时摘掉，避免 HMR 之后留下指向旧闭包的引用
      delete w[GLOBAL_BACK_FN];
    };
  }, []);
}

export default useBackGuard;
