import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { lazyDepsGuard } from './scripts/vite-lazy-deps-guard';

/**
 * Vite 配置。
 * - `@` 别名指向 src，全项目禁止超过 3 层的 `../../..` 相对导入。
 * - manualChunks 只做「白名单式」命名拆分，兜底必须返回 undefined。
 *
 * ★ 兜底为什么不能是 `return 'vendor'`（踩过的坑，2026-10-04 实测）：
 *   一旦给某个包命名了 chunk，Rollup 就会把它拉成一个**具名共享 chunk**，
 *   只要它同时被任何一条静态引用链触碰，整个 chunk 就会被 `<link rel="modulepreload">`
 *   挂进 index.html —— 首屏直接下载。
 *   `pdfjs-dist`（build/pdf.mjs 860 KB）和 `exifr` 只被 `src/distill/parsers/{file,photo}.ts`
 *   里的**动态** `import()` 引用，本应是懒加载的；但旧配置的兜底把它们归进了
 *   `vendor-C-RtmAhz.js`（759 KB），结果首屏白送 750 KB。
 *   改为白名单 + undefined 兜底后，未列出的依赖交回 Rollup 自动分包：
 *   只被动态 import 引用的自然落进懒加载 chunk，静态引用的自然进主包/共享 chunk。
 *
 * - Live2D / OCR / ONNX / sherpa-onnx 的 .wasm 等重型可选依赖是**运行时下载的资源文件**，
 *   不参与打包，同样不受此处影响（见架构文档 §1.3.2）。
 */
export default defineConfig({
  /**
   * ★ 构建期守卫：重型可选依赖（pdfjs-dist / exifr / tesseract.js …）一旦出现在
   *   入口静态闭包或 index.html 的 modulepreload 里，**构建直接失败**。
   *   用途是把「上面那段踩坑」从「靠人眼发现」变成「构建拦住」，见架构文档 §1.7。
   */
  plugins: [react(), lazyDepsGuard()],
  /**
   * ★★ web 产物加固（2026-10-04）—— 只做**去掉诊断输出**这一件事。
   *
   * ── 为什么只做这一件 ────────────────────────────────────────────────
   * 打包给用户的是 **Android APK**，R8 只能混淆原生层；
   * `assets/public/**` 里的 JS 是 Vite 产物，R8 一行都碰不到。
   * 所以 web 层的"抗逆向"必须在这里做。可选项其实很少：
   *
   *   · sourcemap —— 已经是 `false`（见下面 build.sourcemap），**不能开**。
   *     一个 `.map` 文件等于把源码原样送出去。
   *   · 变量名混淆 —— esbuild 的 `minify` 已经在做（局部名 + 模块级名）。
   *   · **字符串混淆** —— 是最有效的反逆向手段，但**本项目刻意不用**，
   *     理由见下（这不是偷懒，是一个明确的取舍）。
   *
   * ── 为什么不做字符串混淆（重要，别以为是忘了）──────────────────────────
   * `scripts/build-apk.mjs` 的 `verifyApk()` 靠**字符串特征**判定两个版本没打反：
   * 它在 bundle 里找 `创建内置欣然卡失败` / `创建默认会话失败` / `和欣然`
   * 这**三个只存在于种子分支的中文字面量**（判据见 `src/constants/buildMode.ts`）。
   *
   *   ⇒ 一旦对这些字符串做编码/加密，那三个标记就找不到了，
   *     于是 `verifyApk` 会**静默失效** —— 它不会报错，只会"什么都没找到"，
   *     而"不内置版不该出现内置特征"这条断言在找不到时**同样是绿的**。
   *     也就是说：字符串混淆会把"版本没打反"的唯一自动化保障**变成一条假绿**。
   *
   *   用「一个可验证的不变量」换「一层轻度的反逆向」，这笔账不划算。
   *   而且这些字符串本来就不含密钥（Key 是用户自填、存设备本地）——
   *   混淆它们防的是"看懂这个应用在做什么"，防不了"拿走用户数据"。
   *
   * ── 那这一项加固到底做了什么 ──────────────────────────────────────
   * `esbuild.drop` 删掉**全部 `console.*` 调用**与 `debugger` 语句。
   *   实测价值：本项目有**大量诊断输出**（日志里带功能编号 PG-xx / FN-xx、
   *   状态机转移、失败原因分类等中文短句），它们会原样留在产物里。
   *   对逆向者是**免费的导览图**（"这里有个状态叫 redirected"、
   *   "这里会走 qrRefreshLimit 分支"），对用户则毫无价值。
   *   ⇒ 删掉它：产物更小、可读面更窄，且**不损失任何用户可见行为**
   *     （应用自己的日志走 `logStore` → IndexedDB，与 `console` 无关）。
   *
   * ★ 前提：`build.target` 仍是 `es2017`，esbuild 的 drop 不会改语法等级 ——
   *   `scripts/qa/check-boot-compat.mjs` 的"入口 chunk 不得含 `?.` / `??`"断言
   *   在构建流程里会重新核一遍，改坏了会直接拒绝打包。
   */
  esbuild: {
    drop: ['console', 'debugger'],
    legalComments: 'none',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    open: false,
  },
  preview: {
    port: 4173,
  },
  build: {
    /**
     * ★★ 构建目标下调为 `es2017`（原 `es2020`）—— 2026-10-04 真机白屏 P0 修复的一部分。
     *
     * 背景：用户机器的 Android System WebView 版本较旧，导致应用**完全空白**。
     * 已确认的致命点是 `structuredClone` 这个**运行时 API**（WebView 98+），
     * 已用独立工具替换 + `index.html` 兜底解决。
     *
     * 但"运行时 API"只是风险的一半，另一半是**语法**：
     * `es2020` 目标允许产物里保留可选链 `?.`、空值合并 `??`、类字段等语法，
     * 而这些同样有版本门槛（可选链/空合并在 Chrome 80+，类字段更晚）。
     * 一旦语法解析失败，是**整个 bundle 静默失效** —— 比运行时异常更难查，
     * 因为报错信息最少、且不经过任何我们自己的代码。
     *
     * 降到 `es2017`：esbuild 会把上述语法全部**转译**掉，产物可运行在
     * Chrome/WebView 55+ 这一档，覆盖面显著变宽；代价只是产物略大、略慢。
     * 对一个"用户自备 API、跑在千奇百怪国产 ROM 上"的应用，这个取舍是划算的。
     *
     * ⚠️ 这不是"支持所有老安卓"的承诺。真机最低要求仍是
     *    「Android System WebView 能更新到较新版本」，只是把门槛从 98 降到 ~55。
     */
    target: 'es2017',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        /**
         * ★ 白名单式分包：下面列的都是「确定进首屏」的依赖，才给它们命名 chunk。
         *   任何**没列在这里**的 node_modules 一律返回 undefined，
         *   由 Rollup 自动决定归属 —— 这是重型可选依赖能真正懒加载的前提。
         *   新增依赖时请先问一句：它是首屏就要用的吗？
         *   不是 → **不要**加到这个列表里，让它走自动分包。
         */
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-markdown') || id.includes('remark') || id.includes('micromark') || id.includes('mdast')) {
            return 'vendor-markdown';
          }
          if (id.includes('@mui/') || id.includes('@emotion/')) return 'vendor-mui';
          if (id.includes('dexie')) return 'vendor-db';
          if (id.includes('/fflate')) return 'vendor-zip';
          if (id.includes('/dayjs')) return 'vendor-time';
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'vendor-react';
          if (id.includes('react-router')) return 'vendor-router';
          if (id.includes('/zustand/') || id.includes('/immer/') || id.includes('use-sync-external-store')) {
            return 'vendor-state';
          }
          // ★ 兜底：undefined，不是 'vendor'。理由见文件头注释。
          // ★ 改回 'vendor' 会触发 scripts/vite-lazy-deps-guard.ts 的构建期断言，构建直接失败。
          return undefined;
        },
      },
    },
  },
});
