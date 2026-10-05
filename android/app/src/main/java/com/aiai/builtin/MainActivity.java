package com.aiai.builtin;

import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * 应用主 Activity —— **唯一改动是接管返回键**。
 *
 * ★ 背景（为什么要写这个类，而不是留空）：
 *
 *   实测 Capacitor 7 的 Android 核心**完全没有返回键处理** ——
 *   在 `node_modules/@capacitor/android` 全源码里搜 `onBackPressed` /
 *   `OnBackPressedCallback` / `backButton` 是**零命中**。
 *   我们原先的 `MainActivity extends BridgeActivity {}` 是空实现，
 *   于是按返回键直接落到 Activity 默认行为 = **结束应用、退回桌面**。
 *
 *   对一个聊天类应用来说这是严重体验问题：用户在聊天页误触返回键，应用直接没了。
 *
 * ★ 修复思路：把「要不要退出」这个决定**交给 Web 层**。
 *   原生只做一件事 —— 问 JS 一句，JS 说 `exit` 才真的退出。
 *   这样返回键的层级判断（关浮层 → 回退一级 → 双击退出）与应用的**路由和浮层状态**
 *   天然一致，不必在 Java 里重复维护一份导航栈。
 *   JS 侧的决策实现在 `src/hooks/useBackGuard.ts`，它把函数挂在 `window.__aiAiBack`。
 *
 * ★ 为什么覆写 `onBackPressed()`，而不用 `OnBackPressedCallback`：
 *   `OnBackPressedCallback` 来自 `androidx.activity`，而 Capacitor 把它声明为
 *   `implementation`（见 `capacitor/build.gradle`）⇒ **不在我们的编译类路径上**。
 *   要用它就得在 `app/build.gradle` 里加依赖；而**引入原生依赖会触发
 *   `cap sync` 式的工程同步**，那正是本项目构建链刻意绕开的一步
 *   （见 `scripts/build-apk.mjs` 的 `syncWebAssets` 注释）。
 *   覆写 `Activity.onBackPressed()` 是平台自带 API，**零新增依赖**。
 *   （该方法在 API 33+ 标为 deprecated，但只在我们未开启
 *    `android:enableOnBackInvokedCallback` 时仍会被系统调用 —— 我们没开，故有效。）
 *
 * ★ 默认放行策略：**JS 没准备好时一律"不退出"**（返回 'handled'）。
 *   宁可返回键暂时没反应，也不能因为 JS 还没加载完就误退。
 */
public class MainActivity extends BridgeActivity {

    /**
     * 问 Web 层「这次返回怎么处理」。
     *
     * ★ 必须是**单个表达式**（`evaluateJavascript` 不接受语句块），
     *   且用 try/catch 兜住 —— JS 抛异常时不能让原生侧悬着。
     * ★ 约定返回值只有两种：`"exit"` = 允许退出；其它（含 `handled`）= 已处理/别退。
     */
    private static final String BACK_JS =
        "(function(){"
            + "try{"
            + "var f=window.__aiAiBack;"
            + "if(typeof f!=='function'){return 'handled';}"
            + "return (f()==='exit')?'exit':'handled';"
            + "}catch(e){return 'handled';}"
            + "})()";

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        WebView webView = (getBridge() != null) ? getBridge().getWebView() : null;
        if (webView == null) {
            // WebView 还没起来：没有可问的对象，交回系统默认行为
            super.onBackPressed();
            return;
        }

        webView.evaluateJavascript(
            BACK_JS,
            value -> {
                // evaluateJavascript 的返回值是 JSON 编码的字符串，形如 "\"exit\""
                String result = (value == null) ? "" : value.replace("\"", "").trim();
                if ("exit".equals(result)) {
                    // Web 层确认可以退出（例如已在根部并完成了二次确认）
                    finish();
                }
                // 其余情况什么都不做：Web 层已经自己处理了
                // （关闭浮层 / history 回退一级 / 提示"再按一次就退出"）
            }
        );
    }
}
