> ## ⚠️ 使用限制（务必先读）
>
> - **著作权归属**：© 2026 **ai-ai-web**，保留所有权利（All Rights Reserved）。
> - **禁止任何形式的商业用途**（销售、集成进商业产品/服务、付费服务、获客引流、SaaS 化等均被禁止）。
> - **禁止未经授权的二次开发、修改、再分发**——此类行为须**事先取得著作权人的书面授权**。
> - 本许可为**源码可用（source-available）许可，并非开源（open source）许可**。
> - 完整条款、授权申请通路与免责声明见 [`LICENSE`](LICENSE)。

---

# ai爱

> **AI 情感陪伴 Web 应用。**  
> 人格设定、世界设定与情感互动内容为本项目原创；代码为从零实现的 TypeScript / React 应用纯前端 SPA，可 PWA 安装；数据全部留在浏览器（IndexedDB + localStorage）；**用户自备 OpenAI 兼容的 LLM API**。

| 项    | 内容                                                         |
| ---- | ---------------------------------------------------------- |
| 技术栈  | Vite 5 + React 18 + TypeScript 5 + MUI v5 + Tailwind CSS 3 |
| 状态管理 | Zustand（+ immer）                                           |
| 持久化  | Dexie（IndexedDB，15 张表）+ idb-keyval（localStorage）           |
| 运行环境 | 现代浏览器（Chrome / Edge 推荐；Safari / Firefox 部分能力降级）            |
| 界面语言 | 中文（单语，不做 i18n）                                             |

---

## 1. 快速开始

```bash
npm install
npm run dev          # 开发服务器 http://localhost:5173
npm run typecheck    # tsc --noEmit
npm run build        # 产出 dist/
npm run preview      # 预览构建产物
npm run lint:copy    # 文案自检：扫描硬编码中文串
npm run verify       # typecheck + build 一次跑完
```

首次打开会强制进入 **引导页**（4 步）：接入模型 → 导入/选择人设 → 认识欣然 → 开始聊天。

---

## 2. 关于 API Key 与 CORS（**必读**）

- 本应用**没有任何后端**，请求从你的浏览器直接发往你填写的 `BaseURL`。
- Key 保存在浏览器本地（`localStorage` 的 `ai-ai.settings.v1`），可选 AES-GCM 加密（见「设置 → 高级」）。
- **CORS 风险**：多数 LLM 厂商的接口**不允许浏览器跨域直连**。若你在连接测试里看到 `CORS` / `Failed to fetch` 类错误：
  1. 优先换用支持浏览器直连的服务商或中转；
  2. 或自行配置 CORS 代理 / 浏览器扩展（本版本不内置代理，见 PRD Q2）。
- **浏览器禁止覆盖 `Origin` / `Referer` 等安全头**（对应 FN-62），高级配置里填了也会被忽略，属浏览器安全模型限制，不是本应用的 bug。

---

## 3. 目录结构速览

```
src/
├── theme/        设计系统（themeTokens 单一真源 + MUI + Tailwind）
├── types/        全量跨文件类型（禁止在 feature 内重复定义）
├── constants/    存储键 / 默认值 / 能力表(141 项) / Provider 预设 / 上限 / 功能 ID
├── copy/         ★ 所有面向用户的文案唯一出口（keys.ts 类型防线 + xinran.ts）
├── lib/          id / time / token / text / zip / crypto / errors / result / emitter ...
├── db/           Dexie 建表 + Repository + 首次启动种子
├── store/        Zustand：settings / ui / log / persona / memory / proactive ...
├── hooks/        useSettings / useSnack / useVisibility / useIdle / useDebounced ...
├── components/   CapabilityGate / ErrorBoundary / SettingRow / SnackbarHost ...
├── pwa/          Service Worker 注册
└── (llm / persona / memory / distill / proactive / backup / features / router ...)
```

约定：

- 导入别名统一 `@/`（如 `import { db } from '@/db/db'`），禁止 3 层以上 `../../..`。
- **组件里禁止出现面向用户的中文字符串字面量**，一律走 `t(CopyKey)` / `useCopy()`。
- 不可实现功能统一由 `constants/capabilities.ts` + `<CapabilityGate>` 表达：置灰 + 原因 Tooltip + 替代方案，不允许静默缺失。

---

## 4. 能力覆盖

共 **141 项功能**（页面 27 / 后台 11 / 设置项 63 / 平台能力 21 / ex-skill 10 / 欣然人格 9），  
机器可读的降级表在 `src/constants/capabilities.ts`。

不可实现 / 需替代的项集中在四类：

1. 系统级权限（悬浮窗 `SYSTEM_ALERT_WINDOW`、无障碍、设备管理器、开机自启）→ 降级为应用内浮层 / 明确不做；
2. 常驻后台与精确定时 → Web Worker 心跳 + Notification 补偿，页面隐藏不保证触发；
3. 微信外部接入 → 改为「手动导出聊天记录 → 解析器导入」的等价路径；
4. 端侧原生库（sherpa-onnx / ML Kit / 加固壳）→ Web Speech API、tesseract.js 等替代。

---

## 5. 依赖与替代说明

| 用途         | 选型                                | 说明                       |
| ---------- | --------------------------------- | ------------------------ |
| zip 打包     | `fflate`                          | 体积约 30KB，替代 `jszip`      |
| 虚拟滚动       | `@tanstack/react-virtual`         | 约 10KB，替代 `react-window` |
| CSV 解析     | 自写（约 30 行）                        | 不引入 `papaparse`          |
| HTTP / SSE | 原生 `fetch` + `ReadableStream`     | 不引入 `axios`（SSE 必须用原生流）  |
| 工具函数       | 自写进 `src/lib/`                    | 不引入 `lodash`             |
| ID         | `crypto.randomUUID()`（带 fallback） | 不引入 `nanoid` / `uuid`    |
| 时间         | `dayjs`                           | 不引入 `moment`             |
| 状态         | `zustand`                         | 不引入 Redux / MobX         |

**可选重型依赖默认不进主包**，运行时 `import()` 懒加载：`exifr`（EXIF）、`pdfjs-dist`（PDF）、  
`tesseract.js`（OCR）、`pixi.js` + `pixi-live2d-display`（Live2D）、`onnxruntime-web`（本地 embedding）。  
任一加载失败都会优雅降级并给出提示，不会中断主流程。

---

## 6. 隐私红线

内置角色「欣然」为真实人物设定，因此：

- `persona.privacy.noImage = true`，**禁止**为欣然生成任何图像（文生图 / 立绘生成入口隐藏或置灰）；
- 不生成、不询问欣然的外貌描述；
- 日志与导出内容中的 Key / Authorization 一律脱敏为 `***`。

---

## 7. 已知限制

- `npm run build` 不内置类型检查（为避免 IDE 与 CI 双重标准），请单独跑 `npm run typecheck` 或用 `npm run verify`。
- PWA 的 Service Worker **只做静态资源缓存**，不实现 Push（Push 需要服务端）。
- 页面隐藏时，浏览器会节流甚至冻结 JS 定时器，主动消息 / 自动备份的触发时机不保证精确。

---

## 8. ★ APK 打包与版本归档（长期约定，必读）

**打包唯一入口是 `npm run apk`（= `node scripts/build-apk.mjs`），不要手敲 gradle。**

### 命名规则：`v1`、`v2`、`v3` …… 依次递增

每次打包都会**新建**一个版本目录，**绝不覆盖、不替换、不删除**任何历史版本：

```
release/
├── INDEX.md                             ← 历史索引（含"各版本发生了什么"）
├── README.md
├── v1/                                  ← 第 1 版（含黑屏 bug）
├── v2/  v3/  v4/  v5/
├── v6/                                  ← 当前推荐版本
│   ├── ai爱-内置欣然-v6.apk
│   ├── ai爱-不内置欣然-v6.apk
│   ├── ai爱-源码-v6-2026-10-04.zip      ← 同一次构建产出 ⇒ 一一对应
│   ├── MANIFEST.json                    ← APK↔源码↔git 的对应关系 + 哈希
│   └── SHA256SUMS.txt                   ← `sha256sum -c` 可独立复核
└── v7/ …                                ← 下一次构建
```

编号由脚本**扫描 `release/` 自动分配**（目录列表是唯一事实来源，不维护计数器文件）。

```bash
npm run apk           # 打两个版本（内置 + 不内置），自动归档到 release/v<N+1>/
npm run apk:list      # 查历史（版本号 / 时间 / APK / 源码 / git 状态）
npm run apk:verify    # 复验最新版本的哈希与包特征
```

**对应关系靠"物理同目录"**：同一 `v<N>/` 里的 APK 与该源码备份由同一次构建产生，  
不是靠文件名约定去猜。四道防线：  
碰撞守卫（拒绝覆盖）、**启动兼容性检查（失败即拒绝打包）**、  
产物自检（内置/不内置特征断言）、源码备份硬断言（找不到就报错）。

**三条必须知道的边界**：

1. `release/` 内容**不入 git**（二进制、逐版累积约 20 MB/版），只有 `INDEX.md` 与 `README.md` 入库  
   ⇒ **归档目录必须单独做存储层备份**。
2. 源码备份里**不含签名私钥**（`android/keystore/`）⇒ 私钥必须单独备份，丢了就无法覆盖升级。
3. 历史版本**一律保留**：它们既是排错样本，也是"哪一版能用"的对照。

### 8.1 启动相关故障的排查手册（两次真机 P0 的沉淀）

应用**绝不会白屏**：若启动失败，会显示错误面板（含错误详情 + 失败资源 + UA + 重载按钮）。

```bash
# ① 老引擎能否启动（模拟低版本 WebView）
node scripts/qa/diagnose-blank.mjs --legacy --native

# ② 覆盖升级会不会崩（模拟旧数据里缺少新增的设置分组）
node scripts/qa/diagnose-blank.mjs --stale --native

# ③ 兜底是否真的可见（故意让入口 404，断言出现错误面板）
node scripts/qa/diagnose-blank.mjs --break

# ④ 交付物里到底有没有修复（直接从 APK 内部核对）
python scripts/qa/check-apk-boot-fix.py
```

| 故障现象                                       | 根因                          |
| ------------------------------------------ | --------------------------- |
| 打开是纯黑屏                                    | `structuredClone` 在低版本 WebView 不存在 |
| 覆盖升级后崩溃                                   | 旧数据里缺少新增的设置分组（`reading 'enabled'`） |

---

## 9. 版权与许可

© 2026 **ai-ai-web**，保留所有权利（All Rights Reserved）。

本仓库采用**自定义限制性许可**（**源码可用 / source-available**，**非开源许可**）：

- **允许**：在遵守许可条款前提下，个人以**非商业**目的查阅、学习，并在本地运行以评估本软件。
- **禁止**：任何形式的**商业用途**；未经授权的**修改、二次开发、衍生与再分发**。
- 如需超出上述范围使用，须**事先取得著作权人的书面授权**（通过本仓库 Issue 或 GitHub 账号  
  [`ai-ai-web`](https://github.com/ai-ai-web) 联系）。

完整条款（中英对照，以中文为准）见仓库根目录的 [`LICENSE`](LICENSE) 文件。
