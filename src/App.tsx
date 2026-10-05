import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import ThemeProvider from '@mui/material/styles/ThemeProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SnackbarHost } from '@/components/SnackbarHost';
import { ExitConfirm } from '@/layouts/ExitConfirm';
import { AppRouter } from '@/router';
import CrashPage from '@/features/crash/CrashPage';
import { startAutoBackup, stopAutoBackup } from '@/backup/autoBackup';
import { bootstrap } from '@/db/bootstrap';
import { startProactiveScheduler, stopProactiveScheduler } from '@/proactive/scheduler';
import { usePersonaStore } from '@/store/personaStore';
import { useSettingsStore } from '@/store/settingsStore';
import { createAppTheme } from '@/theme/muiTheme';
import { applyRootClasses, resolveMode, watchSystemTheme } from '@/theme/modes';
import { log } from '@/store/logStore';
import { useBackGuard } from '@/hooks/useBackGuard';
import { useIlinkStore } from '@/store/ilinkStore';

/**
 * ★ 根组件：主题装配 + 错误边界 + 路由宿主 + 提示宿主。
 *
 * - 主题：`settings.appearance` → `createAppTheme()`（唯一的主题入口，见 T01）；
 * - 崩溃兜底：ErrorBoundary 的 fallback 指向 CrashPage（PG-27，含复制日志 / 重载 / 安全模式）；
 * - 路由：27 条路由 + 布局壳由 `@/router` 负责（T07）；
 * - 业务数据：**不在这里 mount 时等待**，各页面自己按需查库，避免首屏被 Dexie 阻塞。
 */
export default function App() {
  const appearance = useSettingsStore((s) => s.settings.appearance);
  const reloadPersonas = usePersonaStore((s) => s.reload);
  const [systemMode, setSystemMode] = useState<'light' | 'dark'>(() => resolveMode('system'));

  // 跟随系统：darkMode='system' 时实时响应 prefers-color-scheme
  useEffect(() => watchSystemTheme(setSystemMode), []);

  /**
   * Android 返回键接管（FN-16）。
   *
   * ★ 必须挂在应用顶层：它往 `window.__aiAiBack` 安装一个全局函数，
   *   原生侧（`MainActivity.onBackPressed()`）通过 `evaluateJavascript` 调它来决定
   *   "这次返回是否允许退出"。决策逻辑本身在 `hooks/useBackGuard.ts`。
   */
  useBackGuard();

  /**
   * 人设列表预加载（欣然永远排第一），失败只记日志。
   *
   * ★★ 必须**等 `bootstrap()` 落库完成**再读，不能直接 `reloadPersonas()`。
   *
   * 原因（真浏览器实测复现的竞态）：`main.tsx` 里 `bootstrap()` 是 fire-and-forget，
   * 而本 effect 在首帧后立刻跑——于是「读人设」和「写入内置欣然卡」两条 async 链路
   * 抢同一个 Dexie 事务。首次访问（全新设备/清空存储后）会读到空列表，
   * 后果是 `ModelSection` 的 `imageBlocked` 判不出欣然，**XR-06 的隐私红线在首屏失效**：
   * 实测「生图前先问我」「角色文生图」两个开关首屏可点（`disabled=false`、无红字提示），
   * 手动刷新后才变成 `disabled=true`。
   *
   * 修法是让读取依赖种子完成，而不是把 `bootstrap()` 挪到渲染前——
   * 那会退化成「首屏等 Dexie」，违反 main.tsx 里写明的「不等待种子数据」。
   * `bootstrap()` 幂等（固定 id upsert / 固定 session id），重复调用不会重复种子。
   *
   * ★★ 用 `.finally()` 而不是 `.then()`（2026-10-04 修正，**这是一处我自己引入的回归**）：
   *   `bootstrap()` 会抛（`db/bootstrap.ts:147/183/199/208` 的 `throw new AppError('DB_FAILED', …)`，
   *   例如 IndexedDB 配额耗尽、库损坏、隐私模式）。
   *   原写法 `.then(() => reloadPersonas())` 在**种子失败时不会执行读取** ——
   *   这本身无害（只是列表空着），但自从 `personaStore` 引入 `hydrated` 之后，
   *   「永不读取」= `hydrated` 永为 false = 界面**永久停在"加载中"**：
   *   角色轨骨架卡死、引导页文案空白、而"一个角色都没有"的整页引导也**永远不显示**
   *   （它的判据需要 `personasHydrated`）—— 不内置版用户会连导入入口都看不到。
   *   ⇒ 改成 `.finally()`：**等种子结束**（成功或失败）**都读一次**，
   *     拿到"库里现在到底有什么"的真实状态并置 `hydrated`。
   *     语义也更对：读取反映的是库的真实内容，不该依赖种子是否成功。
   */
  useEffect(() => {
    void bootstrap()
      .catch((e: unknown) => {
        // 种子失败只记日志，不阻断：下面的读取仍会执行，界面据此显示真实（可能为空）的状态
        log.warn('app', '种子数据初始化失败', String(e), 'XR-07');
      })
      .finally(() => {
        void reloadPersonas().catch((e: unknown) => {
          log.warn('app', '人设列表预加载失败', String(e), 'XR-07');
        });
      });
  }, [reloadPersonas]);

  // 自动备份调度（FN-47 / SV-08）：默认关闭，用户在设置里打开后才真正产生快照
  useEffect(() => {
    startAutoBackup();
    return () => stopAutoBackup();
  }, []);

  // 主动消息调度器（FN-19 / SV-07）：应用级唯一启动点，可重复调用。
  // 「她想不想开口」由 jiwen 决定，跨标签页单写者选举在调度器内部完成；
  // 页面级不要自己 start，否则会重复注册定时器。
  useEffect(() => {
    startProactiveScheduler();
    return () => stopProactiveScheduler();
  }, []);

  /**
   * 微信 ClawBot 收消息循环（应用级唯一启动点）。
   *
   * ★ 由 `ilinkStore.ensureRunning()` 自己判断该不该跑：
   *   总开关关着、没绑定、或不在原生环境时它**直接返回**，不产生任何副作用；
   *   页面隐藏时循环只空转不打服务端（见 `src/ilink/receiver.ts`）。
   *   所以这里无条件调一次是安全的 —— "要不要收"的决策不散在调用方。
   *
   * ★ 与 `startProactiveScheduler` 的区别：那个是"她想不想主动开口"（本地定时），
   *   这个是"外面有没有人跟她说话"（外部长轮询），两条互不依赖，故分开两个 effect。
   */
  useEffect(() => {
    /**
     * ★★ 这里的 try/catch 不是"保险起见"，是**必需的**（2026-10-04，真机 P0）。
     *
     * ── 为什么 ─────────────────────────────────────────────────
     * `ensureRunning()` 在**升级场景**下抛过：
     *     TypeError: Cannot read properties of undefined (reading 'enabled')
     * 因为它读 `settings.ilink.enabled`，而老用户的 localStorage 里没有 `ilink`
     * 这个分组（它是后来新增的）。
     *
     * 后果**远超预期**：这不是"微信通道没启动"，而是**整个应用打不开** ——
     * 错误在 App 自身的 effect 里抛出，而 `<ErrorBoundary>` 挂在 **App 的子树里**
     * （见本文件底部的 `<ErrorBoundary>`），**捕获不到父组件自身的错误**。
     * React 于是卸载整棵树 ⇒ 用户看到空白，只有启动看门狗兜底弹出错误面板。
     *
     * ── 一层教训 ───────────────────────────────────────────────
     * **应用级 effect 的失败，不该等于"应用不可用"。**
     * 微信通道、主动消息这类"旁路功能"，最坏的合理结果是"这个功能没起来 + 记一条日志"，
     * 而不是让核心的聊天功能一起陪葬。
     *   ⇒ 推广到整个文件：凡是挂在这里的启动型 effect，都应当自己兜住异常。
     *     （它们的共同点是"锦上添花"，而不是"应用运行的前提"。）
     *
     * ── 根因已另修 ─────────────────────────────────────────────
     * `settings.ilink` 缺失的真正修法在 `store/settingsStore.ts` 的 `merge`
     * （每次 hydration 都用 `migrateSettings` 补齐缺失分组）。
     * 这里兜的是"即使将来又冒出别的缺字段，也只是这个功能不启动"。
     */
    try {
      useIlinkStore.getState().ensureRunning();
    } catch (e) {
      log.warn('app', '微信通道启动失败（不影响聊天）', String(e));
    }
  }, []);

  const mode = useMemo<'light' | 'dark'>(() => {
    if (appearance.darkMode === 'system') return systemMode;
    return appearance.darkMode;
  }, [appearance.darkMode, systemMode]);

  // 把 dark / grayscale 套到 <html>（grayscale 的滤镜在 global.css）
  useEffect(() => {
    applyRootClasses(mode, appearance.grayscale);
  }, [mode, appearance.grayscale]);

  const theme = useMemo(
    () => createAppTheme(mode, appearance.yandereMode),
    [mode, appearance.yandereMode],
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* ★ 任意组件抛错 → CrashPage（PG-27）：降级视图含复制日志 / 重载 / 安全模式 */}
      <ErrorBoundary
        fallback={(error, reset) => <CrashPage error={error} onRetry={reset} />}
      >
        <Box
          sx={{
            minHeight: '100dvh',
            bgcolor: 'background.default',
            color: 'text.primary',
          }}
        >
          <AppRouter />
        </Box>
        <SnackbarHost />
        {/* ★ 应用级退出确认（FN-16 / FN-20）：顶栏双击 Logo 与 Android 返回键共用同一处。
            提到应用级的原因见 `layouts/ExitConfirm.tsx` 头部注释。 */}
        <ExitConfirm />
      </ErrorBoundary>
    </ThemeProvider>
  );
}
