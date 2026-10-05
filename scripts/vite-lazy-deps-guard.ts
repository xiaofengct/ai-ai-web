/**
 * ★ 构建期断言：重型可选依赖不得出现在首屏（架构文档 §1.7「待补：构建期断言」）。
 *
 * 背景（2026-10-04 实测踩过）：
 *   `vite.config.ts` 的 `manualChunks` 兜底曾写成 `return 'vendor'`，把 `pdfjs-dist`
 *   和 `exifr` 提升成首屏共享 chunk `vendor-C-RtmAhz.js`（752.86 kB），
 *   被 `index.html` 的 modulepreload 挂进首屏 —— 白送 750 kB。
 *   改回「白名单 + undefined 兜底」后修复，但**没有任何东西阻止它再次发生**。
 *   本插件就是那道守卫：把「靠人眼发现的回归」变成「构建直接失败」。
 *
 * 挂载点为什么是 `generateBundle` 而不是 `closeBundle`：
 *   `generateBundle` 能拿到完整 chunk 图（每个 chunk 的 `isEntry` / `imports` / `modules`），
 *   报错可以精确到「哪个模块 id 被打进了哪个 chunk」；`closeBundle` 只有已落盘的文件列表，
 *   排查时还得回头 grep 产物。
 *
 * ★ 两个实现陷阱（§1.7 明确要求避开）：
 *   1. **禁止用产物文件名匹配，必须用模块 id。**
 *      `tesseract.js` 的 chunk 被 Rollup 命名为 `index-Dz0Qcp9F.js`（因为它的入口是包的
 *      `src/index.js`）—— 名字叫 `index` 但它根本不是主入口，按文件名判断会误判。
 *   2. **chunk 名不稳定，别硬编码。**
 *      `pdf-*.js` / `full.esm-*.js` 由 Rollup 按入口文件名推导，依赖升级改了入口文件名就会变。
 *      匹配目标应是**模块 id 里的包目录名**（`node_modules/pdfjs-dist`）。
 */

import type { Plugin } from 'vite';

/**
 * 检测清单 —— **只用于断言，不用于分包决策**。
 *
 * ⚠️ 分包决策走 `vite.config.ts` 里的「白名单 + undefined 兜底」，与本清单无关。
 *    别把两者混用：往这里加一项**不会**让依赖变懒加载，它只是让断言开始盯着这个包。
 *
 * 当前安装的：`pdfjs-dist`（EX-06 PDF）、`exifr`（EX-04 照片 EXIF）、`tesseract.js`（PL-18 OCR）。
 * 未安装但架构上属于重型可选依赖的，在此预留，将来谁装了断言自动生效。
 */
export const LAZY_DEPS: readonly string[] = [
  'pdfjs-dist', // PDF 解析，已装（v6.4.299）
  'exifr', // 照片 EXIF 时间线，已装（v7.1.3）
  'tesseract.js', // OCR，已装（v7.0.0）；真正的 ~15MB 是运行时 CDN 拉的语言包，但 shim 也该懒加载
  'onnxruntime-web', // 端侧推理（未装，预留）
  'onnxruntime', // 同上，兼容不同包名命名
  'sherpa-onnx', // 语音合成/识别（未装，预留）
  'pixi-live2d-display', // 桌宠 Live2D 渲染（未装，预留）
];

/**
 * ★★ 应用内模块黑名单（2026-10-04 新增，入口 chunk 胖 12.5 kB 事故后补）
 *
 * 背景：`LAZY_DEPS` 只盯 `node_modules` 里的重型包，**盯不住我们自己的代码**。
 * 实测事故：`src/main.tsx` 为了注入蒸馏适配器写了
 * `import { setLlmAdapter } from '@/distill/pipeline'`，
 * 而 `pipeline.ts` 静态引入整条蒸馏链（`parsers/common` / `prompts/*`），
 * 于是 **8 个蒸馏模块被拽进首屏主入口**，主包 193.42 → 205.95 kB。
 * **`manualChunks` 没坏、LAZY_DEPS 没漏——是这一类情况压根没人盯。**
 *
 * 修法是把注册表拆成零重依赖的 `src/llm/adapter/registry.ts`（依赖倒置：
 * 注入点不该依赖被注入者的实现）。本清单是**防止它再次发生**的那道锁。
 *
 * ⚠️ 加项前先确认：该模块**确实不该出现在首屏**。这里误加会让构建直接失败。
 */
export const ENTRY_FORBIDDEN_APP_MODULES: readonly string[] = [
  '/src/distill/', // 蒸馏引擎：只在蒸馏向导/详情页用，必须懒
  '/src/features/distill/', // 蒸馏相关页面：路由级懒加载
];

/** 违规记录：一条 = 「某个懒加载依赖的某个模块，被打进了某个 chunk」 */
interface Violation {
  /** 命中的依赖名（LAZY_DEPS 里的项） */
  dep: string;
  /** 被打进的 chunk 文件名 */
  chunk: string;
  /** 命中的模块 id（真实磁盘路径） */
  moduleId: string;
  /** 通过哪条断言发现的 */
  via: 'entry-closure' | 'modulepreload';
}

/**
 * 在模块 id 里找 LAZY_DEPS 的包目录名。
 *
 * 路径统一成正斜杠后匹配 `node_modules/<dep>`，并要求后面紧跟 `/` 或结束（包目录边界），
 * 这样 `onnxruntime` 不会误伤 `onnxruntime-web`，同时兼容 pnpm 的
 * `node_modules/.pnpm/exifr@7.1.3/node_modules/exifr/...` 这种嵌套路径。
 */
function findLazyDep(moduleId: string): string | null {
  const id = moduleId.replace(/\\/g, '/');
  for (const dep of LAZY_DEPS) {
    const marker = `node_modules/${dep}`;
    const idx = id.indexOf(marker);
    if (idx === -1) continue;
    const after = id.slice(idx + marker.length);
    if (after === '' || after.startsWith('/')) return dep;
  }
  return null;
}

/**
 * 在模块 id 里找应用内黑名单路径（`/src/distill/` 等）。
 * 同样统一成正斜杠，只按**目录边界**匹配，避免 `distill` 误伤 `distillXxx`。
 */
function findForbiddenAppModule(moduleId: string): string | null {
  const id = moduleId.replace(/\\/g, '/');
  for (const marker of ENTRY_FORBIDDEN_APP_MODULES) {
    if (id.includes(marker)) return marker;
  }
  return null;
}

/** 收集一个 chunk 的 modules 里命中的懒加载依赖 / 应用内黑名单模块 */
function scanChunkModules(
  modules: Record<string, unknown> | undefined,
  chunkName: string,
  via: Violation['via'],
): Violation[] {
  const found: Violation[] = [];
  for (const moduleId of Object.keys(modules ?? {})) {
    const dep = findLazyDep(moduleId) ?? findForbiddenAppModule(moduleId);
    if (dep) found.push({ dep, chunk: chunkName, moduleId, via });
  }
  return found;
}

/** 把 index.html 里的 href（`./assets/x.js` / `/assets/x.js`）归一化成 chunk 的 fileName（`assets/x.js`） */
function normalizeHref(href: string): string {
  return href.replace(/^\.?\//, '');
}

/** 从 index.html 里抽出所有 `rel="modulepreload"` 的 href */
function extractModulePreloads(html: string): string[] {
  const out: string[] = [];
  // 先抓所有 <link> 标签，再判断 rel —— 避免依赖属性顺序（href 可能写在 rel 前面）
  for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
    if (!/rel\s*=\s*"modulepreload"/.test(tag)) continue;
    const href = /href\s*=\s*"([^"]+)"/.exec(tag)?.[1];
    if (href) out.push(normalizeHref(href));
  }
  return out;
}

/**
 * 断言插件：重型可选依赖出现在首屏 → **构建报错退出**。
 *
 * 断言 1：入口 chunk 的静态 import 闭包里不得含任何 LAZY_DEPS 模块。
 * 断言 2：`index.html` 的 modulepreload 列表指向的 chunk 里不得含任何 LAZY_DEPS 模块。
 *   （两条必须一起跑：断言 1 抓不到「没静态 import、但被手加 modulepreload 提前拉取」的情况。）
 */
export function lazyDepsGuard(): Plugin {
  return {
    name: 'ai-ai:lazy-deps-guard',
    apply: 'build',

    generateBundle(_options, bundle) {
      const violations: Violation[] = [];

      /* ---------------- 断言 1：入口静态 import 闭包 ---------------- */

      const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry);
      if (entry && entry.type === 'chunk') {
        // BFS 展开 imports：只看入口那一个 chunk 是不够的，必须递归整个静态闭包
        const reachable: string[] = [];
        const seen = new Set<string>();
        const queue: string[] = [entry.fileName];
        while (queue.length > 0) {
          const name = queue.pop() as string;
          if (seen.has(name)) continue;
          seen.add(name);
          const chunk = bundle[name];
          if (!chunk || chunk.type !== 'chunk') continue;
          reachable.push(name);
          queue.push(...(chunk.imports ?? []));
        }

        for (const name of reachable) {
          const chunk = bundle[name];
          if (!chunk || chunk.type !== 'chunk') continue;
          violations.push(...scanChunkModules(chunk.modules, name, 'entry-closure'));
        }
      }

      /* ---------------- 断言 2：index.html 的 modulepreload ---------------- */

      for (const item of Object.values(bundle)) {
        if (item.type !== 'asset' || !item.fileName.endsWith('.html')) continue;
        const html = typeof item.source === 'string' ? item.source : '';
        if (!html) continue;
        for (const href of extractModulePreloads(html)) {
          const chunk = bundle[href];
          if (!chunk || chunk.type !== 'chunk') continue;
          violations.push(...scanChunkModules(chunk.modules, href, 'modulepreload'));
        }
      }

      /* ---------------- 命中即失败 ---------------- */

      if (violations.length === 0) return;

      // 同一 (dep, chunk) 只报一次，但把模块 id 列全，方便直接定位
      const grouped = new Map<string, Violation[]>();
      for (const v of violations) {
        const key = `${v.dep} -> ${v.chunk}`;
        const list = grouped.get(key) ?? [];
        list.push(v);
        grouped.set(key, list);
      }

      const detail = [...grouped.values()]
        .map((list) => {
          const head = list[0];
          const viaLabel = head.via === 'entry-closure' ? '入口静态 import 闭包' : 'index.html modulepreload';
          const modules = list.map((v) => `        · ${v.moduleId}`).join('\n');
          return [
            `  ✗ 依赖「${head.dep}」被打进了 chunk「${head.chunk}」`,
            `      发现途径：${viaLabel}`,
            `      命中模块（${list.length} 个）：`,
            modules,
          ].join('\n');
        })
        .join('\n\n');

      throw new Error(
        [
          '',
          '════════════════════════════════════════════════════════════════',
          ' 构建失败：重型可选依赖出现在首屏（架构文档 §1.7 硬规则）',
          '════════════════════════════════════════════════════════════════',
          '',
          detail,
          '',
          ' 这些依赖必须走运行时 import() 懒加载，不能进首屏同步加载链。',
          ' 常见成因：',
          '   1. vite.config.ts 的 manualChunks 兜底被改回了 return \'vendor\'',
          '      （会把包拉成具名共享 chunk，一旦被静态引用链触碰就被 modulepreload 进首屏）',
          '   2. 某个模块把重型依赖写成了顶层静态 import（应改成函数内 await import()）',
          '',
          ' 详见 docs/02-架构设计与任务分解.md §1.7',
          '════════════════════════════════════════════════════════════════',
          '',
        ].join('\n'),
      );
    },
  };
}

export default lazyDepsGuard;
