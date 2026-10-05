# 第三方依赖与许可证（对应 PG-26 第三方 SDK 公示）

> 本页面由「设置 → 关于 → 第三方 SDK 公示」渲染。
> 许可证以各包仓库根目录下的 `LICENSE` 为准；本表为人工维护清单，升级依赖时需同步。

## 运行时依赖

| 依赖 | 版本 | 用途 | 许可证 |
|---|---|---|---|
| `react` | ^18.3.1 | UI 框架 | MIT |
| `react-dom` | ^18.3.1 | DOM 渲染 | MIT |
| `react-router-dom` | ^6.26.2 | 路由 | MIT |
| `@mui/material` | ^5.16.7 | 组件库 | MIT |
| `@mui/icons-material` | ^5.16.7 | 图标 | MIT |
| `@emotion/react` | ^11.13.3 | MUI 样式引擎 | MIT |
| `@emotion/styled` | ^11.13.0 | MUI 样式引擎 | MIT |
| `zustand` | ^4.5.5 | 状态管理 | MIT |
| `immer` | ^10.1.1 | 不可变更新 | MIT |
| `dexie` | ^4.0.8 | IndexedDB ORM | Apache-2.0 |
| `dexie-react-hooks` | ^1.1.7 | 响应式查询 | Apache-2.0 |
| `idb-keyval` | ^6.2.1 | 轻量 KV | MIT |
| `dayjs` | ^1.11.13 | 时间处理 | MIT |
| `react-markdown` | ^9.0.1 | Markdown 渲染 | MIT |
| `remark-gfm` | ^4.0.0 | GFM 扩展 | MIT |
| `fflate` | ^0.8.2 | zip 打包/解包 | MIT |
| `react-zoom-pan-pinch` | ^3.6.1 | 图片缩放预览 | MIT |
| `@tanstack/react-virtual` | ^3.10.8 | 虚拟滚动 | MIT |

## 可选依赖（默认不进主包，运行时懒加载）

| 依赖 | 版本 | 用途 | 许可证 | 加载时机 |
|---|---|---|---|---|
| `exifr` | ^7.1.3 | 照片 EXIF 时间线（EX-04） | MIT | 用户选「原材料 C：照片」时 |
| `pdfjs-dist` | ^4.6.82 | PDF 抽文本（EX-06） | Apache-2.0 | 上传 PDF 时 |
| `tesseract.js` | ^5.1.1 | OCR（PL-18） | Apache-2.0 | 点击「识别文字」时 |
| `pixi.js` | ^7 | Live2D 渲染底座（FN-53） | MIT | 设置里显式开启 Live2D 后 |
| `pixi-live2d-display` | ^0.5 | Live2D 模型显示（FN-53） | MIT | 同上 |
| `onnxruntime-web` | ^1.19 | 本地 embedding（FN-57 增强） | MIT | 开发者页显式开启实验开关后 |

> Cubism Core（Live2D 运行时）由其官方许可约束，商用前请自行确认；本应用默认关闭 Live2D。

## 构建期依赖

| 依赖 | 版本 | 用途 | 许可证 |
|---|---|---|---|
| `vite` | ^5.4.8 | 构建 | MIT |
| `@vitejs/plugin-react` | ^4.3.2 | React 插件 | MIT |
| `typescript` | ^5.5.4 | 类型 | Apache-2.0 |
| `tailwindcss` | ^3.4.13 | 原子类 | MIT |
| `postcss` | ^8.4.47 | CSS 处理 | MIT |
| `autoprefixer` | ^10.4.20 | 浏览器前缀 | MIT |
| `tsx` | ^4.19.1 | 文案自检脚本运行器 | MIT |
| `@types/node` | ^20.16.11 | 类型 | MIT |
| `@types/react` | ^18.3.11 | 类型 | MIT |
| `@types/react-dom` | ^18.3.1 | 类型 | MIT |

## 明确不引入

`jszip`（改用 `fflate`）、`papaparse`（自写 CSV 解析）、`axios`（原生 `fetch` + SSE）、
`lodash`（自写工具）、`moment`（改用 `dayjs`）、`@reduxjs/toolkit` / `mobx`（改用 `zustand`）、
`nanoid` / `uuid`（原生 `crypto.randomUUID`）、`react-i18next`（中文单语）、
`sqlite-wasm` / `sql.js`（`chat.db` 直读在 Web 不可实现）、`react-window` / `react-virtuoso`（已有 `@tanstack/react-virtual`）。

## 遥测与上报

本应用**没有任何遥测 / 崩溃上报 SDK**（对应 PL-20：Firebase datatransport 已用本地日志 + 手动导出替代）。
所有日志存于浏览器本地 `logs` 表，可由「设置 → 开发者 → 导出日志」导出，导出前自动脱敏。
