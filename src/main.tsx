import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import CrashPage from '@/features/crash/CrashPage';
import { bootstrap } from '@/db/bootstrap';
import { runLegacyDbRename } from '@/db/legacyRename';
import { registerSW } from '@/pwa/registerSW';
import { llmClient } from '@/llm/client';
// ★ 从 registry 取，不从 '@/distill/pipeline' 取：后者会把整个蒸馏引擎（~65 kB 源码）
//   拽进主入口 chunk（实测入口 193.42 → 205.95 kB）。registry 零重依赖，主入口可安全 import。
import { setLlmAdapter } from '@/llm/adapter/registry';
import '@/theme/global.css';

/**
 * ★ 应用入口（T01）。
 *
 * 启动顺序：
 * 1. 安装全局错误兜底（未捕获异常 / 未处理的 Promise）——对应 PG-27 崩溃页；
 * 2. 挂载 React（不等待种子数据，避免首屏白屏）；
 * 3. ★ 注入蒸馏 LLM 适配器（必须在任何蒸馏调用之前完成，见下方说明）；
 * 4. 异步跑 `bootstrap()` 首次启动种子（T03，重复启动不重复种子）；
 * 5. 注册 Service Worker（仅生产环境，失败静默降级）。
 */

/** 未捕获错误兜底：交给 window 上的自定义事件，由 ErrorBoundary/CrashPage 消费 */
function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    // eslint-disable-next-line no-console
    console.error('[ai-ai] uncaught error', event.error ?? event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    // eslint-disable-next-line no-console
    console.error('[ai-ai] unhandled rejection', event.reason);
  });
}

/**
 * 启动期全局钩子（由 `index.html` 的**内联脚本**提前定义好）。
 *
 * ★ 为什么不在这里 `declare global` 一套类型：
 *   项目已有做法是就地窄化（见 `hooks/useBackGuard.ts` 挂 `__aiAiBack`）。
 *   沿用同一手法，避免为两个只在启动期用一次的钩子新增全局类型声明。
 *
 * ★ 为什么用可选调用（`?.`）：这些钩子由 `index.html` 提供。
 *   若 HTML 与 bundle 版本不匹配（例如用户从缓存里读到旧的 index.html），
 *   钩子可能不存在 —— 那种情况下**不能让"上报失败"本身变成新的崩溃**。
 */
interface BootHooks {
  __aiAiBootFail?: (label: string, detail?: unknown) => void;
}
const bootHooks = window as unknown as BootHooks;

/**
 * React 渲染成功后，撤掉 `index.html` 里的**静态启动页**。
 *
 * ★ 为什么用轮询而不是 `render()` 的回调：
 *   React 18 的 `createRoot().render()` **没有回调**（render 是并发、异步提交的），
 *   所以"什么时候真的画出来了"只能观察 DOM。
 *
 * ★ 为什么观察 DOM 而不是直接把 `#boot` 删掉：
 *   如果先删启动页、React 又没渲染成功，屏幕就**回到白屏** —— 那正是我们要消灭的形态。
 *   必须"看到 #root 有内容"才撤，顺序不能反。
 *
 * ★ 为什么轮询上限是 10s：与 `index.html` 里看门狗的延时一致。
 *   超过就交给看门狗去显示错误面板，这里不再管（也不重复报错）。
 */
function watchBootCompletion(): void {
  let tries = 0;
  const timer = window.setInterval(() => {
    tries += 1;
    const root = document.getElementById('root');
    if (root && root.childElementCount > 0) {
      window.clearInterval(timer);
      // React 已经接管，撤掉静态启动页
      document.getElementById('boot')?.remove();
      return;
    }
    if (tries >= 100) window.clearInterval(timer);
  }, 100);
}

function mount(): void {
  const container = document.getElementById('root');
  if (!container) {
    // 挂载点缺失属于"结构性失败"，必须让用户看见，不能只是白屏
    bootHooks.__aiAiBootFail?.('#root 不存在', 'index.html 与 bundle 不匹配');
    throw new Error('#root not found in index.html');
  }
  createRoot(container).render(
    <React.StrictMode>
      {/*
        ★★★ 外层错误边界 —— 必须在 `<App />` **外面**（2026-10-04，真机 P0 修复）。
         *
         * ── 为什么 App 内部那个边界不够 ─────────────────────────────
         * `App.tsx` 里已经有一个 `<ErrorBoundary>`，但它挂在 **App 的子树里**：
         *
         *     function App() {
         *       useEffect(() => { ensureRunning(); }, []);   // ← 错误在这里
         *       return <ThemeProvider><ErrorBoundary>…</ErrorBoundary></ThemeProvider>;
         *     }
         *
         * React 的错误边界**只能捕获自己子树里的错误**，捕获不到父组件自身的错误。
         * 而挂载型 effect（如上面的 `ensureRunning`）恰恰属于 **App 自己** ——
         * 于是那次 `TypeError: …reading 'enabled'` 直接穿透了所有边界，
         * React 卸载整棵树 ⇒ 用户看到空白。
         *
         * ★ 这与 2026-10-04 白屏事故（`structuredClone` 那次）是**同一个机理**：
         *   边界的位置在错误点的**下方**。两次都栽在这里，所以这次从结构上修掉。
         *
         * ── 为什么保留 App 内部那个边界 ─────────────────────────────
         * 两个边界各司其职，不是重复：
         *   - **本层（外）**：兜 App 自身 —— 保底，保证"无论什么错都有 UI"。
         *     它拿不到 ThemeProvider，CrashPage 会用 MUI 默认主题渲染
         *     （样式朴素但完全可用：能看到错误、能复制日志、能重载）。
         *   - **内层**：兜路由子树，此时主题已就绪，崩溃页样式正常，
         *     且不会波及顶栏/提示宿主等外层结构。
         *
         * ⚠️ 若 CrashPage 自身也抛错，会冒到 window，由 `index.html` 的
         *    启动看门狗与错误面板兜住 —— 三层防线，最坏情况仍看得到东西。
         */}
      <ErrorBoundary fallback={(error, reset) => <CrashPage error={error} onRetry={reset} />}>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
  watchBootCompletion();
}

installGlobalErrorHandlers();

/**
 * ★ 启动必须整体被 try/catch 包住（2026-10-04，白屏 P0 修复的一环）。
 *
 * 背景：真机白屏事故里，错误发生在模块求值 / 首次渲染阶段，
 *   `<ErrorBoundary>` 挂在 `App` **内部** ⇒ 边界在错误点**下方**，抓不到，
 *   于是 React 卸载整棵树、屏幕一片空白，用户和我们拿不到任何信息。
 *
 * 这里把"启动"当成一个**可能失败的操作**来处理：失败就把原因画到屏幕上。
 * 注意 `mount()` 抛出的错误会同步冒到这里，但模块求值期的错误**不会**
 *   （那时本文件都还没执行）—— 那一路由 `index.html` 的看门狗负责。
 * 两条路合起来才覆盖完整：**内联看门狗管"脚本没跑起来"，这里管"跑起来但启动失败"**。
 */
/**
 * ★★ 启动顺序：**先迁移库名，再挂载**（2026-10-05 全项目改名 `aiyu` → `ai-ai`）。
 *
 * `DB_NAME` 改成 `ai-ai-web` 后，IndexedDB 的库名变了 —— 而库里装着用户的
 * 聊天记录 / 记忆 / 人设 / 表情。老用户升级后若不迁移，会看到**一片空白**
 * （数据还在磁盘上，只是应用再也不去读它）。
 *
 * ⇒ `runLegacyDbRename()` 必须在**任何仓储查询之前**跑完，否则 Dexie 会先
 *   懒打开新库、建立连接，"确保新库还没被写过"这个前提就没了。
 *
 * ★ 为什么用 `boot()` 包一层而不是顶层 `await`：
 *   本项目的构建目标是 **es2017**（见 `vite.config.ts` 的 `build.target`），
 *   而顶层 await 需要 es2022 ⇒ esbuild 会直接报错。包成 async 函数是等价且安全的写法。
 *
 * ★ 迁移**不会**阻塞用户看到界面（它没有"等网络"这类慢操作，只是本地整库读一遍），
 *   而且**失败不抛**（见 `legacyRename.ts` 第 ④ 条闸门）⇒ 最坏情况是新库为空。
 */
async function boot(): Promise<void> {
  await runLegacyDbRename();
  mount();
}

boot().catch((err: unknown) => {
  bootHooks.__aiAiBootFail?.('应用挂载失败', err);
  throw err;
});

/**
 * ★★ 注入蒸馏 LLM 适配器（B-13 阻断级修复）。
 *
 * 不注入的后果是**功能为零，不是降级**：`hasLlmAdapter()` 恒 false →
 * StepAnalyze 守卫命中 → 双线分析永不执行 → EX-01~EX-10 十项全部不可用。
 * 所以这一步是硬要求，必须跑在任何蒸馏调用之前。
 *
 * ★ 走 `llmClient` 门面，不裸 fetch：重试（5xx/超时）、入出站内容过滤、
 *   脱敏日志、错误归一化都在门面里。蒸馏是最烧 token 的一路，绕过去等于全丢。
 *
 * ★ `stream: false` 必须显式传：蒸馏不启用流式（PRD §7.3），
 *   写死可防止将来门面给 `stream` 加默认值时把蒸馏悄悄变成流式。
 */
setLlmAdapter({
  complete: (req) => llmClient.complete({ ...req, stream: false }),
});

// 种子数据异步执行，失败只记日志，不阻塞首屏
void bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[ai-ai] bootstrap failed', err);
});

void registerSW({
  onUpdate: () => {
    // 有新版本时不强制刷新，交给 UI 提示（走 copy/xinran.ts 文案）
    // eslint-disable-next-line no-console
    console.info('[ai-ai] service worker update available');
  },
});
