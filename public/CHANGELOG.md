# 更新说明（对应 FN-35 更新说明弹窗的数据源）

> 「设置 → 关于 → 更新说明」读取本文件；版本号与 `VITE_APP_VERSION` 比对，
> 首次打开新版本时弹一次，已读版本写入 `AppSettings.updateNotesSeenVersion`。

## v0.1.0 — 地基版本

**基础设施**

- Vite 5 + React 18 + TypeScript 5 + MUI v5 + Tailwind CSS 3 工程搭建完成。
- 设计系统落地：`theme/themeTokens.ts` 为色板单一真源，MUI 与 Tailwind 同时派生。
- 深色模式支持 `system / light / dark`，`index.html` 内联防闪烁脚本，刷新不闪白。
- 灰度滤镜（`html.grayscale`）与病娇色板（`yandereMode`）接入主题变体。
- PWA：`manifest.webmanifest` + Service Worker 静态资源缓存（不含 Push）。

**类型 / 常量 / 文案**

- 全量类型落 `src/types/`（common / persona / chat / memory / media / settings / distill / backup / log / prompt）。
- **能力表 141 项**落 `src/constants/capabilities.ts`，每项含 `level / reason / alternative`，
  驱动 `<CapabilityGate>` 统一表达「不可实现 / 部分实现」。
- **文案唯一出口** `src/copy/xinran.ts` 建立：类型防线（漏 key 编译报错）+ 取值防线（`t()` / `useCopy()`）
  + 组件防线（props 只收 `CopyKey`）+ CI 防线（`npm run lint:copy`）。
- 工具库：`id / time / token / sleep / text / download / zip / crypto / errors / result / emitter / file`。

**数据层**

- Dexie 建表 15 张：`sessions / messages / personas / memories / stickers / timbres / live2d /
  distillJobs / distillArtifacts / distillRaw / blobs / logs / backups` + favorites 索引 + settings 镜像。
- 关键索引：`messages[sessionId+createdAt]`、`memories[sessionId][score][tags*]`、`blobs[path]`。
- Repository 层（12 个 repo）统一返回 `Result<T>` 或抛 `AppError`。
- 首次启动种子：内置欣然卡（`isBuiltin`、`privacy.noImage=true`、多条欢迎语）、
  DeepSeek / 硅基流动 Provider 预设、占位表情包、默认会话；重复启动不重复种子。

**状态层与通用组件**

- `settingsStore` 持久化到 `ai-ai.settings.v1`，`useSettings(sessionId)` 返回全局 + 会话覆盖**深合并**结果。
- `uiStore` / `logStore` / `personaStore` / `memoryStore` / `proactiveStore` 落地。
- 通用组件：`CapabilityGate`、`ErrorBoundary`、`ConfirmDialog`、`EmptyState`、`LoadingOverlay`、
  `SettingRow`、`NumberField`、`TokenBadge`、`PromptPreview`、`FileDropZone`、`SearchBar`、
  `VirtualList`、`SnackbarHost`、`MarkdownView`、`PortraitStage`。
- Hook：`useSettings` / `useSnack` / `useVisibility` / `useIdle` / `useDebounced`。

**已知缺口（后续版本补齐）**

- LLM 接入层、人格编译器、聊天主闭环、蒸馏引擎、路由与页面尚未接入（本期只留类型与接口）。
- 主动消息、桌宠、语音、模块 WebView 等受浏览器限制的项为降级实现，详见能力表。
