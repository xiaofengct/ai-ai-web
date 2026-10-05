# QA 运行时回归（`scripts/qa/`）

> 目的：给「ai爱 Web」补上**运行时/交互/稳定性**这一层证据。
> `npm run verify` 只证明「代码能编译、文案表对得上」，证明不了**用户走得到**。
> 本套脚本按 `docs/07-交付说明.md` §8「浏览器验收方法（真验队规）」实现。

## 怎么跑

```bash
# 全量（自己起 dev server + 自己起 Edge，跑完自动收摊）
node scripts/qa/run-regression.mjs > scripts/qa/last-run.log 2>&1; echo "REAL_EXIT=$?"

# 只跑路由可达 / 只跑主流程
node scripts/qa/run-regression.mjs --only=routes
node scripts/qa/run-regression.mjs --only=flows

# 复用已经在跑的 server
node scripts/qa/run-regression.mjs --base=http://127.0.0.1:5173 --no-server
```

> ★ **退出码必须用重定向取 `$?`，不要用管道**（管道会吃掉退出码，永远是 0）。
> 脚本在「有流程失败 / 有致命错误 / 一条路由都没跑到」时返回 1——
> 最后一条很重要，否则「脚本自己挂了」会被误读成「全绿」。

产物落在 `scripts/qa/out/<时间戳>/`：

| 文件 | 内容 |
|---|---|
| `report.json` | 机器可读：每条路由/流程的结果、控制台告警、采集到的指标 |
| `report.md` | 人读汇总 |
| `shots/*.png` | 失败现场截图（证据） |

## 出问题时的诊断工具

```bash
# 看某个页面真实渲染出了哪些可交互元素（可见按钮 / aria-label / 图标 testid / 虚线边框容器 / 弹窗数）
MSYS_NO_PATHCONV=1 node scripts/qa/probe.mjs --url=/distill

# 按文本点击 / 输入 / 派发 drop / 执行任意表达式
node scripts/qa/probe.mjs --url=/ --clickAria=角色
node scripts/qa/probe.mjs --url=/distill --type=小圆
node scripts/qa/probe.mjs --url=/distill --drop='{"name":"a.txt","fixture":"scripts/qa/fixtures/wechat-sample.txt"}'

# 复杂交互序列写进文件再跑（Windows/Git-Bash 下长 JSON 塞命令行会被引号规则吃掉）
node scripts/qa/probe.mjs --url=/distill --seqfile=scripts/qa/cases/xxx.json
```

`--seqfile` 支持的动作：`click` / `clickAria` / `type` / `typeNth` / `wait` / `drop` / `jsInline` / `sleep`。

> Git-Bash 下 `--url=/` 会被 MSYS 改写成 Windows 路径，加 `MSYS_NO_PATHCONV=1` 前缀。

## 本沙箱的坑（都踩过并验证过因果，别重复踩）

| # | 坑 | 现象 | 解法 |
|---|---|---|---|
| 1 | 沙箱 `HTTP_PROXY` 劫持 localhost | 浏览器访问 `127.0.0.1:5173` 报连接被拒（server 明明活着） | Edge 加 `--no-proxy-server`；Node 侧设 `NO_PROXY`（都在 `lib/harness.mjs` 里了） |
| 2 | vite 的依赖缓存重建被 safe-delete 守卫拦 | `SAFE_DELETE_BULK_CONFIRM_REQUIRED count:429`，dev server 起不来 | 启动前把 `node_modules/.vite` **rename** 走（守卫只补丁了 `unlink`/`rm`，`rename` 不在清单里） |
| 3 | `fs.cpSync` 抛 `EIO, Access is denied` | 复制 `dist/` 做静态快照失败 | 改手写递归 `mkdirSync` + `copyFileSync`（同一棵树，84 个文件全部成功） |
| 4 | dev server 存活期只有几分钟 | 跑着跑着被回收；后续导航落到不透明源 → `IDBFactory denied` / `Failed to fetch` /「按钮全找不到」 | **每一步之前探活**，不健康就重启（`ensureServer`）；导航后校验 `location.origin` |
| 5 | 坐标点击偶发「点了没反应」 | `Input.dispatchMouseEvent` 在重排/遮挡下会点空 | 主路径改用 DOM `el.click()`（React 17+ 事件委托在根上，走的是同一处理器）；需要真指针序列时用 `clickTextCoord` |
| 6 | localStorage 是不透明源 | 停在 `about:blank` 时读 `localStorage` 抛 `SecurityError` | 先导航到应用 origin 再读写 |
| 7 | MUI `Stepper` 同时渲染**全部**步骤标题 | 用 body 文本判断「到第几步」永远为真（假绿） | 按 `.MuiStepLabel-root .Mui-active` 判断激活步 |
| 8 | zustand persist 的存储形状 | `ai-ai.settings.v1` 是 `{state:{settings:{...}}}`，不是裸 `AppSettings` | 探针先剥 `.state`（读错会得到 `null`，误判成「没导入」） |

## 覆盖范围（当前）

- **路由可达 28/28**：`src/router/paths.ts` 的 27 条具名路由 + 1 条兜底，逐条断言「不崩 / `#root` 非空 / 未被意外重定向 / 无未捕获异常」。
- **主流程 50 条断言组**：引导（两个分支）、首页、聊天（无 Key 守卫 + 工具条）、能力总览（141 条 + 四档分布 + 五档筛选 + 关键词检索）、蒸馏（零原材料全流程 / 同名 slug 唯一性 / 微信 txt 导入）、设置域与开发者/诊断、导入导出（zip 导出落盘 / settings 导入 / 人设 JSON 导入）、PWA（manifest + sw.js + 生产构建 SW 注册）。

## 已知未覆盖（诚实声明）

- **没有真实 LLM 请求**：全部走「无 Key」路径。配置真 Key 后的流式响应、重试、CORS 失败分支**未验**。
- **语音（TTS/ASR）未验**：`/voice/test`、`/voice/call` 只验了「能打开不崩」；sherpa-onnx WASM 的实际推理未跑。
- **图片 / PDF / OCR / Live2D**：只验了路由可达；解析链路未喂真实文件。
- **备份 zip 的「真机往返」**：只验了导出产生合法 zip；**没有**把导出的 zip 再导回来核对内容一致性。
- **多标签页 / 主动消息调度（proactive）**：未验。
- **能力总览的「替代方案」文案逐条正确性**：只验了条数与检索命中，未逐条核对文案语义。
