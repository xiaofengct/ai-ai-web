/**
 * ★★ 先读这段（团队规矩，team-lead 已定为队规）★★
 *
 * **任何人要报「还差多少个 key / 某张表有多少条」，一律以 `npm run lint:copyTables` 的输出为准，
 * 禁止自己写临时脚本数一遍。**
 *
 * 原因（已发生过两次误报）：临时脚本极易漏匹配——单引号匹配不到 JSX 的双引号属性、
 * 多行写法、模板字符串都会漏。engineer-5 的「还差 51 个」和 software-engineer 的「58 个」
 * 都是这么来的，**两个实测都是 0**，差点据此开出无效工单。
 *
 * 想数数就先跑它；它已挂进 `npm run verify`，红灯就修。
 *
 * ────────────────────────────────────────────────
 *
 * ★ 文案表总登记（copy 归口人维护，其他人只读）。
 *
 * 为什么要有这张表：
 *   项目里的文案表分布在 `src/copy/`、`src/proactive/`、`src/persona/`、`src/distill/`、`src/backup/`
 *   与若干 feature 域内（**张数与条数不许在这里写死，一律以 `lint:copyTables` 输出为准**——
 *   写死过一次就错一次，本注释头就是反面教材）。
 *   它们各自都是**单文件自洽**的（key 联合 + `as const` / `Record<Key, string>`），
 *   所以写错 key 都会编译报错——**编译期保护不缺**。
 *   真正缺的是**「有哪些表、谁负责、key 长什么样」这一层可见性**：
 *   没有总登记，散落的域内表就会变成没人认领的暗账，也就是我们一路在清的「第二份真相」。
 *
 * ★★ 本表只登记元数据，**不搬运任何文案内容**。
 *    文案正文继续留在各自的域内文件里，理由见下面每条的 `note`。
 *
 * ★ 一致性由 `scripts/check-copy-tables.ts` 校验（条数漂移 / 前缀越界 / 跨表重名都会失败）。
 *
 * ────────────────────────────────────────────────
 *
 * ★★ 写文案表的一条硬格式约定：**值一律不折行**（`'key': '值',` 写在同一行）。
 *
 * 原因（2026-10-04 实测踩到，教训记在这）：校验脚本抽 key 联合用的是**行锚定**正则
 * `/^\s*'([^']+)',$/gm`（`scripts/check-copy-tables.ts` 的 `arrayKeys`）——
 * 只要某一行长成 `'xxx',` 就计成一个 key。于是这种「为了可读性折行」的写法：
 *
 *   'distill.sources.reason.nativeReadTool':
 *     '那是桌面端的工具，网页里没有。……',      // ← 这一行被误计成一个 key
 *
 * 会让「key 联合」凭空多出 5 条，报 `key 联合 160 条 != 文案对象 155 条`。
 * ★ 而这条报错**指不到真正原因**（看起来像表写错了，实际只是折了个行）。
 *
 * team-lead 已裁定：验收前**不**改脚本正则（会牵动 13 张表的计数口径，收益 < 风险），
 * 只把这条约定写在这里。**加 key 时请把值写在同一行。**
 *
 * 同类教训一句话：**脚本报红不代表表一定错了——看到红，先怀疑计数器，再怀疑数据。**
 *
 * ★ 后续（2026-10-04 晚些时候）：折行**已不再会造成假红**——新增了 `blockArrayKeys()`，
 *   它**先锚定数组块再扫**，喂给正则的文本从「整个文件」缩小到「数组块内」。
 *   （没改正则本身，改的是它的作用范围；且目前只对 `distill` 生效——
 *    它是唯一一张"数组与对象同住一个文件"的表。已报 team-lead 确认。）
 *   ★ 所以下面这条「值不折行」现在是**格式约定**，不再是"为了让 CI 绿"——
 *     这两件事别混为一谈，否则后人会以为「折行会红」，那又是一条错误信息。
 *
 * ────────────────────────────────────────────────
 *
 * ★★ 第二条硬格式约定：**新增 key 时，在 `declaredCount` 那几行注释里署名 + 日期**。
 *
 * 格式：
 * ```
 * // +1 <key 名或用途>（YYYY-MM-DD，<谁加的>）
 * ```
 *
 * 为什么（2026-10-04 实证踩到）：**当时**本项目还没有 git 仓库（`git log` 报 `not a git repository`），
 *   所以一旦出现条数漂移，**没有任何技术手段能查到是谁加的**。
 *   ★ **2026-10-04 收尾期已建仓**（基线提交 `3017987`），但**漂移仍然查不到作者**——
 *     因为基线是 `git add -A` **一次性压平**的（303 个文件合为一个提交），
 *     ⇒ **压平之前的历史不在本仓库里**，`git log` 查不到"谁加的某个 key"。
 *     ⇒ 署名的必要性**不因建仓而消失，只是原因换了**（从"没有仓库"变成"历史被压平"）。
 *   实例：`distill` 从 155 漂到 156，归口人查不到作者，**先猜成了 software-engineer-3**，
 *   被否认后又重新查——**两轮往返只是为了问一句"这行是谁写的"**。
 *   ★ 猜错人名的代价比"不写"更大：它会变成一条**指向错误的人的暗账**，
 *     让人去问一个根本不知情的人，还问不出结果。**写错人名比不写更糟。**
 *
 * 关键不是署名本身，是它把「猜」变成「查」：
 *   - 有署名 → 漂移时直接找到人问，不用在群里互相否认；
 *   - 没署名 → 又是一次「我没加过」「那可能是你？」的循环。
 *
 * ★ 写在 `declaredCount` 那几行，是因为**漂移报错就指向这里**——
 *   将来谁看到红，第一眼就能看见是谁加的。
 *
 * （本条由 software-engineer-3 提议，归口人采纳并落地；不动脚本、不动表结构，只有一条注释约定。）
 *
 * ────────────────────────────────────────────────
 *
 * ★★ 第三条硬约定：**改一条文案的「值」之前，先枚举它的全部消费点**
 *
 * 命令（已做进校验脚本，不用手写 grep）：
 * ```
 * npx tsx scripts/check-copy-tables.ts --consumers <key>
 * ```
 *
 * 为什么（2026-10-04 实证踩到，需求由 software-product-manager 提、归口人落地）：
 *   `hint.voice` 同时被两处消费，而**两处的语义主体不同**：
 *     - `VoiceSection.tsx:73`  → **字段级**（那一个开关的 hint）
 *     - `SettingsPage.tsx:84`  → **分区级**（整个语音分区的 desc）
 *   只想改"开关那句"就直接改值，会连带改写分区描述，
 *   **把"总开关没接线"外推成"整个语音分区不可用"**——假话换了方向，仍然是假话。
 *
 * 判据：**只要消费点 ≥2，先确认它们的语义主体是否相同**（字段级 / 分区级 / 页面级 / 提示级）。
 *   - 相同 → 可以改值；
 *   - 不同 → **不要改值**，改为**新增一条 key**，只把要改的那处指向它。
 *
 * ★ 它和另外三条"不许承诺"是同一族，别只记一条：
 *   ① 不许承诺**控制权**（改完的值不得再承诺门控）
 *   ② 不许承诺**未来**（§6.5.3 时间指向可兑现性：马上 / 一会儿 / 就好了…）
 *   ③ **不许承诺范围**（把字段级事实外推成区级状态）← 本条管的
 *   ④ **不许断言「会过期的状态」**（2026-10-04，software-product-manager 提出）
 *      「目前 / 暂时 / 尚未 / 还没部署 / 暂不支持」这类措辞，会在代码改动后**静默变假**。
 *      ★ ② 和 ④ 的区别很要紧：**② 的假话有人来追**（承诺了没做，用户会来问）；
 *        **④ 的假话没人知道**（做完了，没人回头改文案）——所以 ④ 更隐蔽。
 *      ⇒ 真要用这类措辞，**必须同时登记一条"接线后须回改"的待办**，否则它就是
 *        下一份报告里的一条「文档与代码不符」。
 *
 *      **★ ④ 的风险分级（software-product-manager 提出，2026-10-04）**：
 *      | 情形 | 风险 | 处置 |
 *      |---|---|---|
 *      | **有伴生信号**：状态变了，旁边必有别的字段/代码一起变 | 低 | 可不挂 |
 *      | **无伴生信号**：状态变了，原字段**不变**，没有东西提醒你 | **高** | **必须挂** |
 *
 *      ⚠ **"有没有伴生信号"本身也要核，不能想当然**（PM 自纠实例）：他第一反应判
 *        `cap.note.FN-02` 低险（以为改 `level` 的人会顺手改 `note`），核了才发现是反的——
 *        `FN-02` 的 `level` 已经是 `full`、支持 PNG 后**仍是 `full`**，`reason` 又与 PNG 无关，
 *        **没有任何字段会变 ⇒ 无伴生信号 ⇒ 高险**。
 *        ⇒ 这条跟下面"为什么 20+ 条空态不算"是同一种写法：**判据要带排除面，也要带"怎么判"**，
 *          否则下一个人照样猜。
 *
 *      **已知命中 3 条（2026-10-04 首轮实扫）**：
 *      - `cap.note.FN-02`（`xinran.ts`）「PNG 载体角色卡**暂不支持**」→ **高险（无伴生信号）**，
 *        已在原文挂回改标记；**另一个副本在 `capabilities.ts:321` 的注释里**，改一处不提醒另一处
 *      - `voice.hint.sherpaNotDeployed`（`xinran.ts`）「现在还没部署」→ 部署动作本身是伴生信号，
 *        已在原文挂注释
 *      - `err.importBadExt`（`xinran.ts:139`）「**目前**只收 .json 和 .zip」→ 支持新格式后须回改
 *      ★ 未命中（`empty.*` / `err.llmNoProvider` / `distill.*.empty` 等 20+ 条）：
 *        它们是**空态 / 错误态**，每次渲染重新求值，说"还没…"永远是当下的真话，**不属于 ④**。
 *
 * ★ 不靠自觉，靠跑一下：`--consumers` 会在 ≥2 个文件时自动告警，0 个文件时提示"建了没用"。
 */

/**
 * 文案表种类：
 * - `ui`     = 面向用户的界面文案（走 `t()` 或域内的 `slv()/dt()/plv()/mlv()/cl()`）
 * - `prompt` = 注入 LLM 的角色行为指令（不是界面文案，不进 `CopyKey`）
 * - `name`   = 功能项显示名映射（key 是 `FeatureId`，不是 `<域>.<语义>`，约束是完备性而非措辞）
 */
export type CopyTableKind = 'ui' | 'prompt' | 'name';

export interface CopyTableRegistration {
  /** 表 id（唯一） */
  id:
    | 'main'
    | 'settings'
    | 'distill'
    | 'persona'
    | 'memory'
    | 'capabilities'
    | 'featureNames'
    | 'intakeCopy'
    | 'segmentLabels'
    | 'distillPrompts'
    | 'tone'
    | 'backupText'
    | 'templateLabels'
    // ★ 新增一张域内表时，这个联合类型**必须同步加一项**，否则 registry 里
    //   那条 `id: 'xxx'` 会报 TS2322（不可赋值给联合类型）。
    //   ⇒ 加一张表的完整清单是**四处**：① 本联合 ② COPY_TABLES 条目
    //     ③ `scripts/check-copy-tables.ts` 的 switch case ④ 新表的 `declaredCount`。
    //     第 ③ 处最容易漏 —— 漏了不报类型错，只会得到一个指不到原因的
    //     "声明 N 条，源码实际 0 条"。
    | 'moments'
    | 'stickers'
    // ★ 反馈域（2026-10-04，随「用户反馈入口」一起加）。
    | 'feedback';
  /** 用途（一句话） */
  purpose: string;
  /** 种类：决定它是否并入 `CopyKey` */
  kind: CopyTableKind;
  /** key 形状示例 */
  keyShape: string;
  /**
   * 该表**独占**的 key 前缀。
   * 跨表不得重复（脚本校验）——前缀是归口的第一道边界，谁新增 key 先看这里。
   */
  prefixes: readonly string[];
  /** key 的前缀分隔符：文案表是 `.`，功能名表是 `-`（如 `PG-01`） */
  prefixDelimiter: '.' | '-';
  /** 声明的条目数（脚本会拿源码实际值比对，漂移即失败） */
  declaredCount: number;
  /** 取值函数（组件里只能用它，不许写中文字面量） */
  accessFn: string;
  /** 是否并入 `CopyKey`（`keys.ts` 的联合类型） */
  inCopyKey: boolean;
  /** 去重后的自检入口（无则空串） */
  auditFn: string;
  /** 为什么不并进 `keys.ts` / 为什么保留域内 */
  note: string;
  /**
   * 归属文件路径（相对仓库根）。
   *
   * ⚠️ **这是给人读的**，格式随人怎么写而变（例见 `distillPrompts`）。
   *    **机器不许读它**——机器读 `files`。理由见下。
   */
  path: string;
  /**
   * 声明的**机器可读**文件清单（仓库相对路径）。
   *
   * ★★ 为什么 `path` 之外还要 `files`：`path` 是**人写的速览**，格式不稳
   *   （`distillPrompts` 的 `path` 就是「src/distill/prompts（analyzers / builders / …）」
   *   这种带全角括号的散文）。把 `path` 当机器输入去切分 = **用第二份真相喂工具**：
   *   格式一漂，工具就**静默失效**——这类"不报错但没生效"比报错难查得多。
   *   故：**机器只读 `files`；`path` 保留给人看**。
   * ★ 两者必须一致，由 `checkCopyTableFilesConsistency()` 校验，
   *   不一致即**报错退出**（**不许静默取一边**——那等于又造第二份真相）。
   * ★ 用途：`scripts/check-copy-tables.ts --consumers` 判「定义处 vs 消费点」
   *   **不再看行的形状**（`'key',` / `'key':` / `cond ? 'key' : …` 都不猜了），
   *   只看命中的文件是否在本清单里。判据从"猜行形"变成"查注册表"。
   * ★ 加 key / 搬文件时：`files` + `path` + `declaredCount` 三处一起改。
   */
  files: readonly string[];
  /**
   * 计数方式：
   * - `objectKeys`（默认）= 数 `'key':` 形式的条目；
   * - `exportConst` = 数 `export const` 条目（用于「导出常量」而非「key→文案」形态的表，如提示词模板）。
   */
  countMode?: 'objectKeys' | 'exportConst';
  /** `countMode` 为 `exportConst` 时，按这些文件计数；缺省用 `path` */
  countFiles?: readonly string[];
  /**
   * 表归属人（填 teammate 名或角色）。
   *
   * ★★ 归口人**不替归属人改文案**：要加 key 由归属人改自己的域内文件，
   *    再把 `declaredCount` 同步到这里（或直接向归口人提申请）。
   *    归口人只保证「它在册、条数对得上、前缀没越界」。
   */
  owner: string;
  /**
   * 是否豁免「硬编码中文」扫描（check-copy 扩到全 `src/` 后的豁免依据）。
   *
   * ★★ 两条必须一起读，缺一条就会用错：
   *   1. **豁免扫描 ≠ 豁免登记**——设 `true` 只是说「它含中文是刻意的，不要判违规」，
   *      **它照样要登记在册、照样有归属人**。`featureNames` / `segmentLabels` 都设 true，
   *      但它们和任何 UI 文案表一样在总账里。
   *   2. **只有「与类型一对一绑定的编译期元数据」才有资格设 true**——
   *      即 `Record<SomeIdUnion, string>` 这种形态：漏配一个标签**直接编译报错**，
   *      含中文是刻意的约束手段，不是忘了走文案表。
   *      普通 UI 文案表一律 `false`，界面文案必须走 `t()` / 域内表的取值函数。
   *
   * ★ 豁免规则住在 registry 而不是扫描脚本里：脚本里开 `if (file.includes('xxx')) continue`
   *   就是又一份第二份真相——将来加第三张同类表忘了同步脚本，扫描就会误报。
   *   统一走这里：**加表即豁免，脚本零改动**。
   */
  scanExempt: boolean;
}

export const COPY_TABLES: readonly CopyTableRegistration[] = [
  {
    id: 'main',
    purpose: '全局通用界面文案（动作 / 导航 / 空态 / 加载 / 成功 / 错误 / 确认 / 能力降级替代方案…）',
    owner: 'software-engineer-4（copy 归口人本人）',
    kind: 'ui',
    keyShape: 'common.confirm',
    prefixes: [
      'common',
      'nav',
      'app',
      'empty',
      'loading',
      'ok',
      'err',
      'confirm',
      'settings',
      'gate',
      'crash',
      'tip',
      'action',
      'session',
      'home',
      'guide',
      'pat',
      'chat',
      'ui',
      'alt',
      // ★ 语音通话页文案（`voice.*`）放在主表而不是新建语音域内表，理由见 `keys.ts` 同前缀注释；
      //   与 settings 表共有 `voice` 前缀，但语义分层不同（页面 vs 设置分区），精确 key 无冲突。
      'voice',
      // ★ 模型商预设提示（`provider.*`）。新前缀，无冲突。
      //   放主表而非 settingsCopy 的硬理由见 `keys.ts` 同处注释：
      //   `providers.ts` 被 `db/` 与 `llm/` 消费，落域内表会让这两层反向依赖 `features/**`。
      'provider',
      // ★ 能力表原因 / 补充说明（`cap.*`）。新前缀，无冲突。
      //   落主表而非 `capabilitiesCopy.ts` 域内表：存在**跨域消费者**
      //   （`components/CapabilityGate`、`features/module/ModulePermissionPage`），
      //   落域内表会形成 components → features 的反向依赖。
      'cap',
      // ★ 微信 ClawBot / iLink Bot 通道（`ilink.*`）。新前缀，与既有前缀无冲突。
      //   落主表而非 `settingsCopy.ts` 域内表的硬理由：这些 key 的消费者**跨域**——
      //   `src/ilink/login.ts` 的纯状态机直接返回 `CopyKey` 当状态与失败原因，
      //   `src/store/ilinkStore.ts` 与设置页都要读。落 settingsCopy 会让「设置域文案表」
      //   被迫服务非设置场景，并把 ilink 域拖进 features/ 的依赖方向。
      'ilink',
    ],
    prefixDelimiter: '.',
    // 355 → 379：+24 语音试听页 / 音色管理文案（voice.channel.* / voice.timbre.* 等）
    //   （2026-10-04，software-engineer-4）。由英文 JSX 字面量收编而来。
    //   起因是归口人自己把这两处误判成 `@copy-tier B`
    //   （误以为「设置 → 语音」是开发者通路，实际是一级用户路径），已纠正，见 `keys.ts` 注释。
    // 379 → 381：+2 导入失败原因（err.importPngCard / err.importStickerSkipped）
    //   （2026-10-04，software-engineer-3——**已认领**：他看到"未署名"那条后主动认领，
    //     起因是 `src/persona/importer.ts` 的两处**静默丢弃**要改成可见报告项）。
    //   ★ 这条曾被归口人标成"未署名 / 作者未查明"，是**署名约定生效前**加的。
    //     现在能确定了就改回真名——**既然能确定，就别让一条本可以确定的人名继续挂在"未查明"上**，
    //     那恰恰是这条约定要消灭的东西。
    // 381 → 385：+4（provider.note.* 3 条 + ui.tokenBadge 1 条）（2026-10-04，software-engineer-4）。
    //   provider 前缀为**新增**，无冲突；三条 note 原样从 `constants/providers.ts` 搬来。
    //   ui.tokenBadge 是 A 档判据改成「按取值方式」之后才浮出来的英文硬编码（原 ` tok`）。
    // 385 → 387：+2 顶栏 aria-label（ui.aria.menu / ui.aria.toggleTheme）（2026-10-04，software-engineer-4）。
    //   `aria-label` 不显示但**会被读屏念出来**，按 §6.5.3 a11y 判据是 A 档。
    // 387 → 549：+162（cap.reason.* 141 + cap.note.* 20 + cap.reason.full 1）
    //   （2026-10-04，software-engineer-5，141 条归口）。文案**原样搬运，一字未改**。
    //   ★ note 实为 20 条不是 19：`EX-08` 的 note 值是**折行写法**，`grep -c "note: '"
    //     这种"值同行"的正则数不到它——与 reason 的 B 形态是同一个坑。
    // 549 → 550：+1 alt.manualExportSms（2026-10-04，software-engineer-3）。
    //   短信那条不可实现模式的「替代办法」原来共用 alt.exportOnly（按 iMessage 写的 chat.db 说法），
    //   讲不通，拆出本 key；alt.exportOnly 保持不动，iMessage / EX-03 的具体指引不丢。
    // 550 → 551：+1 voice.asrOffHint（2026-10-04，software-engineer-4，A3′ 第 2 项）。
    //   麦克风按钮置灰时 Tooltip 的说明；与 `voice.*` 同组落主表
    //   （`/voice/call` 跨设置域，落域内表会造出同一前缀的第三份真相）。
    //   ★ 本条**不是**「先建 key 后接线」的暗账：消费点同批落地（`VoiceCallPage.tsx`），
    //     落地后用 `--consumers voice.asrOffHint` 复核，结果贴在回报里。
    // 551 → 556：+5 双版本（内置欣然 / 不内置欣然）相关（2026-10-04）。
    //   `empty.personasSolo`（PersonaRail / 引导页无角色空态，standalone 专用）、
    //   `empty.noPersona`（首页无角色引导块）、`action.importPersona`（导入人设主行动）、
    //   `err.noPersonaToChat`（无角色时新建会话 / 开始聊天的提示）、
    //   `guide.step2Solo`（引导页第 2 步标题，原「认识一下我」是欣然第一人称）。
    //   ★ 为什么不动 `empty.personas`：那句是「只有我一个」，**以"欣然已存在"为前提**，
    //     内置版的口吻是它的一部分（人格注入），不能为迁就 standalone 而改中性；
    //     故按 `BUILTIN_XINRAN` 分流到 `empty.personasSolo`（见 `constants/buildMode.ts`）。
    //   ★ `err.noPersonaToChat` 修的是**两处静默 return**（`NewSessionDialog` / `GuidePage`）：
    //     原实现 `if (!personaId) return;` 让"点了没反应"，与 XR-04「不给静默缺失」相悖。
    // 556 → 602：+46（2026-10-04，clawbot-spec）。微信 ClawBot（iLink Bot 通道）：
    //   `settings.group.ilink` 1 条（分组标题）+ `ilink.*` 45 条
    //   （4 个开关标签 / 二维码两项 / 6 个动作 / 5 条降级说明 / 11 条登录状态 /
    //     7 条失败原因 / 5 条 toast / 3 条入站占位文案 / 1 条微信会话标题 /
    //     1 条测试消息正文）。★ 测试消息正文刻意单独一条：它是**发到微信里的内容**，
    //     不是 UI 动作标签，复用 `ilink.action.test` 会把按钮文案发出去。
    //   ★ 新前缀 `ilink`（见上方 prefixes 里那段注释：消费者跨域，故不拆域内表）。
    //   ★ 计数口径已核：`keys.ts` 数组 + `xinran.ts` 对象**各 602 条**
    //     （脚本 `main` 分支两边都数），不是"数组 602 / 对象 601"。
    // 602 → 603：+1 `ilink.note.voiceNotImplemented`（2026-10-04，clawbot-spec）。
    //   ★ 起因是一次**事实错误**：`voiceReply` 开关原先挂的是
    //     `ilink.note.mediaUnavailable`（"纯 Web 做不到"），但语音回复在**原生端也没实现**
    //     ——那句会让原生用户以为"换个环境就能用"。新 key 明确说"这一版没做"、
    //     并直说"开了也不会变成语音"（否则就是个假开关，用户会以为是自己没配对）。
    // 604 → 607：+3（2026-10-04，世界设定：`settings.group.world` /
    //   `ok.worldImported` / `err.worldNotRecognized`）。
    //   ★ 起因：用户要求"不内置欣然版要留一个导入排班与世界逻辑的窗口"。
    //     三条分别负责：设置页的分组标题、导入成功的反馈、
    //     以及"这份文件我读到的可用设定不多"的**如实提示**
    //     （识别少 ≠ 格式错，不能混成一句"失败"）。
    // 607 → 606：**−1** 删除 `provider.note.deepseek`（2026-10-04）。
    //   ★ 起因：用户看真机截图后指出这句是多余的，要求删掉
    //     （原文「原作者在教程里提醒：DeepSeek 有时不写记忆库、不遵守生图指令。」）。
    //     这是**唯一一次条数下降**——本表此前只增不减，故把"怎么删"记在这里：
    //     删 key 要**三处一起动**（`keys.ts` 的联合 + `xinran.ts` 的对象 + 这里的计数），
    //     漏掉任何一处都会红：漏 keys.ts 编译报错、漏 xinran.ts 报 TS2741、
    //     漏这一行则是 `606 != 607` 的条数漂移。
    //   ★ `provider.note.*` 另两条**保留**：`note` 字段已改为可选，
    //     只删了用户点名的那一条，没有顺手把整组删掉。
    // 606 → 607：+1 `settings.group.shortcuts`（2026-10-04）。
    //   ★ 起因：用户要求把首页那排快捷磁贴收进设置页
    //     （原文「请将这些功能统一集成到"设置"页面中，主界面保持简洁」）。
    //     分组标题必须是**主表** key —— `SettingsPage` 的 `titleKey` 收的是 `CopyKey`，
    //     域内表（`settingsCopy.ts`）的 key 进不去；那条通路只服务 `descKey`。
    //     故：标题进主表（+1），分组说明进 `settingsCopy`（那条不动本计数）。
    // 607 → 609：+2（2026-10-04，「朋友圈」功能）。
    //   `nav.moments`（'朋友圈'，导航项 + TopBar 标题）与
    //   `confirm.deleteMoment`（删除动态的二次确认）。
    //   ★ 为什么不落 `momentsCopy.ts` 域内表：
    //     ① `nav.*` / `confirm.*` 是**主表前缀**，落域内表会在
    //        `lint:copyTables` 的前缀校验上直接越界报错；
    //     ② 两者都被**跨域**消费 —— TopBar 的 `resolveTitleKey()` 按路径反查标题，
    //        `ConfirmDialog` 的入参类型只收 `CopyKey`，域内表的 key 传不进去。
    // 609 → 610：+1 `confirm.deleteStickerPack`（2026-10-04，表情包管理）。
    //   删除整个表情包时的二次确认。落主表而非 `stickersCopy`：
    //   `ConfirmDialog` 只收 `CopyKey`（同上面 `confirm.deleteMoment` 的理由）。
    // 610 → 611：+1 `settings.group.stickers`（2026-10-04，表情包管理分区）。
    // 611 → 612：+1 `settings.group.moments`（2026-10-04，朋友圈动态设置分区）。
    // 612 → 627：+15（2026-10-04，聊天拍照）。
    //   `chat.camera` / `cameraShutter` / `cameraFlip` / `cameraRetake` / `cameraUse` /
    //   `cameraStarting` / `cameraShotReady` / `cameraRetry`（8 条界面文案）
    //   + 6 条**失败分类**文案（denied / noDevice / inUse / insecure / unsupported / failed）
    //   + `cameraTooLarge`。
    //   ★ 六条失败文案是这个功能最容易做错的地方：四种失败原因对应**四种不同解法**，
    //     混成一句"打不开相机"用户只能放弃（详见 `features/chat/useCamera.ts` 的注释）。
    // 627 → 629：+2（2026-10-04，「用户反馈入口」）。
    //   `settings.group.feedback`（'反馈与建议'，设置页分组标题）与
    //   `nav.feedback`（'反馈信箱'，`/settings/feedback` 的 TopBar 标题）。
    //   ★ 为什么两条都落**主表**而不进 `feedbackCopy.ts`：
    //     ① `SettingsPage` 的 `titleKey` 与 `resolveTitleKey()` 的返回值类型都是
    //        `CopyKey`，域内表（`feedbackCopy.ts`）的 key **传不进去**（同
    //        `settings.group.shortcuts` / `nav.moments` 的理由）；
    //     ② `nav.*` / `settings.group.*` 是主表前缀，落域内表会在
    //        `lint:copyTables` 的前缀校验上直接越界报错。
    // 629 → 633：+4（2026-10-04，反馈提示）。
    //   `ok.feedbackSaved` / `ok.feedbackNoteSaved` / `err.feedbackCopyFailed` /
    //   `err.feedbackShareFailed`。
    //   ★ 只加这四条：`useSnack` 的入参是 `CopyKey`，域内表（`feedbackCopy.ts`）的 key
    //     **传不进去**，所以提示必须落主表（同 `ok.worldImported` / `ok.memorySaved` 的处境）。
    //   ★ 而"保存成功 / 导出成功 / 删除成功"三句**直接复用已有的** `ok.saved` /
    //     `ok.exported` / `ok.deleted`，没有新造 —— 新造只会让同一句话有两个来源。
    // 633 → 635：+2（2026-10-04，反馈的两条二次确认）。
    //   `confirm.deleteFeedback` / `confirm.clearFeedback`。
    //   ★ 落主表而非 `feedbackCopy.ts`：`ConfirmDialog` 的 `titleKey` 只收 `CopyKey`。
    //   ★ 为什么不复用 `confirm.clearLogs`：那句说的是"日志"，这里删的是
    //     **用户自己写的反馈**，代价完全不同 —— 标题读错的确认框会让人点掉自己的东西。
    declaredCount: 635,
    accessFn: 't()',
    scanExempt: false,
    inCopyKey: true,
    auditFn: '',
    note: '唯一真源。`keys.ts` 加 key 必须同时给 `xinran.ts` 加文案，两份一起改（只改一份会 TS2741 全项目挂）。',
    path: 'src/copy/keys.ts + src/copy/xinran.ts',
    // ★ 主表有两个声明位：`keys.ts`（联合/数组）+ `xinran.ts`（文案值）。
    //   `--consumers` 里一个主表 key 的「定义处」正常就是 **2 处**，不是重复计数。
    files: ['src/copy/keys.ts', 'src/copy/xinran.ts'],
  },
  {
    id: 'settings',
    purpose: '设置域补充文案（PG-06 主设置 + 连接测试 + 开发者 + 诊断 + 关于）',
    owner: 'software-engineer-5',
    kind: 'ui',
    keyShape: 'page.settings.title',
    prefixes: ['page', 'desc', 'ui', 'label', 'hint', 'filter', 'note', 'mode', 'voice', 'path', 'conn', 'dev', 'diag', 'sponsor', 'sdk', 'bridge'],
    prefixDelimiter: '.',
    // 265 → 266（2026-10-04，software-engineer 寇豆码 已认领）：加 1 条
    //   `label.imageGenBlocked`——自定义角色自己勾了 `privacy.noImage` 时的中性原因。
    //   起因：`ModelSection` 的 FN-33 / FN-50 红线提示原先一律用 `tip.privacyNoImage`
    //   （原文点名「欣然的图像不生成」），但 `imageBlocked` 的第二条来源是
    //   **当前角色自己勾了 noImage**，那种情况下文案张冠李戴。故按来源分流。
    // 266 → 267：+1 `label.imageGenNoPersona`（2026-10-04，software-engineer 寇豆码）。
    //   ★ 起因：上面那次分流只补了两条分支，但 `imageBlocked` 是**三来源**——
    //     漏掉的第三条是 `!personaReady`（启动竞态，人设表还没加载完）。
    //     它命中时会沿用 `label.imageGenBlocked`（"这个角色自己勾了"），
    //     而此时**根本没有"这个角色"、也没人勾过任何东西**，仍是张冠李戴。
    //     故补第三条中性文案，三来源对三分流，措辞不点名任何原因主体。
    //     消费点同为 `ModelSection.tsx`（Tooltip + Chip 共用一条串）。
    // 268 → 276：+8（2026-10-04，修"接口地址填错导致 404"时一并加）。
    //   ★ 一批 8 条，分三组，都服务于"让用户看清地址会被怎么拼"：
    //     ① 推荐地址引导 4 条：`label.baseUrlRecommended` / `label.baseUrlUseRecommended`
    //        / `label.baseUrlUsingRecommended` / `label.baseUrlResolved`
    //        （消费点 `ModelSection.tsx` 的接口地址行）；
    //     ② 地址填法说明 2 条：`hint.baseUrlShape`（该填到 /v1）/
    //        `hint.baseUrlOffRecommend`（偏离推荐值时提醒）；
    //     ③ 连接测试排查 2 条：`conn.actualUrl` / `conn.serverBody`
    //        （消费点 `ConnectionTestPage.tsx`——原来只显示应用自己的错误描述，
    //         用户拿着"请求被拒绝（HTTP 404）"四个字查不到任何东西）。
    //   ⇒ 起因是**真机 404**：字段只给 placeholder，用户把完整端点整段粘进来，
    //     地址被拼两遍。详见 `docs/14`。
    // 276 → 288：+12（2026-10-04，世界设定分区）。
    //   `label.worldCurrent` / `hint.worldCurrent` / `label.worldReport` /
    //   `label.worldImport` / `hint.worldImport`（5 条表单标签与说明）
    //   + `ui.worldNone` / `ui.worldBadgeBuiltin` / `ui.worldBadgeImported` /
    //   `ui.worldTodayShift` / `ui.worldReportEmpty` / `ui.worldPickFile` /
    //   `ui.worldClear`（7 条界面文案）。
    //   ⇒ `hint.world`（分组说明）与 `hint.worldCurrent`（字段说明）是**两句不同的话**：
    //     曾误用同一条，导致同屏出现两遍 —— 见 settingsCopy.ts 里的说明。
    // 289 → 290：+1 `desc.group.shortcuts`（2026-10-04）。
    //   承接首页快捷磁贴迁入设置页时的分组说明（标题走主表，见那边注释）。
    // 317 → 323：+6（2026-10-04，模型选择改造）。
    //   `label.modelEndpoint` / `hint.modelEndpoint` / `ui.modelEndpointNote`
    //   （"这次请求打到哪儿"那一行 —— 用户要求"切换模型后直接显示对应接口地址"）
    //   + `ui.modelManual` / `ui.modelTagPreset` / `ui.modelTagLive`（下拉相关）。
    // 296 → 317：+21（2026-10-04，朋友圈动态设置分区）。
    //   `desc.group.moments` + 6 个 `label.moments*` + 5 个 `hint.moments*`
    //   + `note.momentsCost` + 4 个 `ui.moments*`（预览面板）。
    // 295 → 296：+1 `desc.group.stickers`（2026-10-04，表情包管理分区说明）。
    // 290 → 295：**+5**（2026-10-04）补齐被复用的分组描述：
    //   `desc.group.model` / `desc.group.memory` / `desc.group.voice` /
    //   `desc.group.backup` / `desc.group.about`。
    //   ★ 起因：这 5 个分组的 `descKey` 原先**直接复用组内第一个字段的 `hintKey`**
    //     （model←hint.provider、memory←hint.memoryLib、voice←hint.voice、
    //      backup←hint.export、about←hint.updateNotes），
    //     于是**同一句话在同一屏出现两遍**：分组副标题一遍、紧跟着的字段说明一遍。
    //     真机截图可证（「换一家就是换一张嘴…」在「模型」下和「用哪一家」下各一次）。
    //   ★ 这是**已知 bug 类的复发**：`hint.world` / `hint.worldCurrent` 当初就是
    //     同一句话渲染两处，修的时候只改了世界设定那一处，没回头搜同类用法 ——
    //     于是同一个 bug 在原地留了 5 份。教训：**修"某处误用"要顺手清掉同类误用**，
    //     否则修的是实例、不是模式。
    //   ★ 补完后 `descKey` 与组内 `hintKey` 已无任何交集（可 grep 复核）。
    // 323 → 324：+1 `desc.group.feedback`（2026-10-04，反馈与建议分区说明）。
    //   ★ 它和 `feedbackCopy.ts` 的 `fb.note.local` 是**两句不同的话**：
    //     这里是分区级速览，那里是操作级完整说明。若复用，同一段话会同屏出现两遍 ——
    //     这个 bug 本项目已复发过一次（`hint.world` / `hint.worldCurrent`）。
    declaredCount: 324,
    accessFn: 'slv()',
    scanExempt: false,
    inCopyKey: false,
    auditFn: '',
    note:
      '保留域内：单文件自洽（`SettingsTextKey = keyof typeof SETTINGS_TEXT`），写错即编译报错。' +
      '不并入 `keys.ts` 的原因：它的 `ui.*` / `label.*` / `hint.*` 是**通用前缀**，与主表 `ui.*` 同前缀不同语义，' +
      '硬并会污染 `CopyKey` 命名空间；且并进两文件结构反而新增 265 条「必须同步改」的面，放大已炸过两次的 TS2741 风险。',
    path: 'src/features/settings/settingsCopy.ts',
    files: ['src/features/settings/settingsCopy.ts'],
  },
  {
    id: 'distill',
    purpose: '蒸馏域文案（5 步向导 / 导入解析 / 预览 / 结果）',
    owner: 'software-engineer-3',
    kind: 'ui',
    keyShape: 'distill.step.intake',
    prefixes: ['distill'],
    prefixDelimiter: '.',
    // 141 → 147：补 6 条产物导出/导入（exportJson / exportPng / export.empty /
    // export.pngTruncated / import.title / import.invalid）。
    // 147 → 155：补 8 条（6 条不可实现模式的原因 `distill.sources.reason.*`
    //   + `distill.sources.altPrefix` + `distill.import.baseNote`）。
    //   起因：这些中文原本硬写在 parser / artifactTransfer 里，且 `UnavailableMode.reason`
    //   **零消费**（UI 只渲染 label），与 PRD §11「逐条置灰 + 原因」不符，一并对齐。
    // 155 → 156：多出 1 条 `distill.write.skeletonDone`（消费点 `src/features/distill/StepWrite.tsx:92`）。
    //   归口人核对源码（数组 156 / 对象 156 一致）后代同步 declaredCount。
    //   ★★ 归因已更正（2026-10-04）：归口人**最初把这条记在 software-engineer-3 头上，是错的**——
    //     E3 明确否认（他上轮收尾时是 155/155/155 全绿，之后没再加过 distill key），
    //     且这条 key 的消费者是 `StepWrite` 页。作者**未查明**——当时无 git 仓库可用；
    //     2026-10-04 收尾期虽已建仓，但基线是**压平提交**（`3017987`，303 个文件合为一个），
    //     ⇒ 压平之前的历史不在本仓库，`git log` 仍查不出这行的作者。**所以归因仍然只能靠署名。**
    //     所以这里不写具体人名，只记事实。
    //     ★ 教训：归因和计数一样，**没证实就不能落笔**——写错人名比不写更糟，
    //       它会在复盘时变成一条指向错误的人的"暗账"，而这张表正是为了消灭暗账才建的。
    //   ★ 归口通道提醒：加 key 要改**三处**（数组 + 对象 + 本表 declaredCount），只改前两处会在这里红。
    // 156 → 159（2026-10-04，software-engineer-3 已认领）：收编 `artifactTransfer.ts`
    //   里 5 处英文裸串（distill job not found / canvas unavailable / canvas 2d context
    //   unavailable / canvas toBlob failed / canvas toDataURL failed），归并为 3 条 key。
    declaredCount: 159,
    accessFn: 'dt()',
    scanExempt: false,
    inCopyKey: false,
    auditFn: '',
    note:
      '保留域内：与主表**完全同构**（`DISTILL_COPY_KEYS` 联合 + `Record<DistillCopyKey, string>`），' +
      '编译期保护与主表等强；前缀 `distill.*` 独立，不并入即可，并入只是把 129 条搬进两文件结构。',
    path: 'src/distill/copy.ts',
    files: ['src/distill/copy.ts'],
  },
  {
    id: 'persona',
    purpose: '人设域文案（角色卡编辑 / 字段提示 / 来源标记）',
    // ★ 归属人已认领：software-engineer-2（T10 建表）。改这张表请找我，改完同步 declaredCount。
    owner: 'software-engineer-2',
    kind: 'ui',
    keyShape: 'page.persona.title',
    prefixes: ['page', 'label', 'origin', 'hint'],
    prefixDelimiter: '.',
    // 33 → 37：补 4 条 FN-50 文生图字段标签（label.imageProvider / imageModel / imageSize /
    // imagePromptTemplate），由英文 JSX 字面量收编而来，见 personaCopy.ts 内注释。
    // 37 → 38（2026-10-04，software-engineer 寇豆码 已认领）：加 1 条 `hint.imageGenLocked`。
    //   起因同 settings 那条：PersonaEditorPage 的「角色文生图」分区对欣然**整段隐藏**，
    //   所以 `draft.noImage === true` 的锁死提示只会给**自定义角色**看到，
    //   原先复用 `tip.privacyNoImage`（原文点名「欣然的图像不生成」）属于文案张冠李戴。
    declaredCount: 38,
    accessFn: 'plv()',
    scanExempt: false,
    inCopyKey: false,
    auditFn: '',
    note:
      '保留域内：单文件自洽（`PersonaTextKey = keyof typeof PERSONA_TEXT`）；体量小。' +
      '★ 它用 `page.*` / `label.*` / `hint.*` 这些**通用前缀**，与 settings / memory 共有——' +
      '这是历史形成的，精确 key 之间无冲突（脚本校验），不强行改名以避开大规模改动。',
    path: 'src/features/persona/personaCopy.ts',
    files: ['src/features/persona/personaCopy.ts'],
  },
  {
    id: 'memory',
    purpose: '记忆域文案（记忆条目 / 检索模式 / 字段提示）',
    // ★ 归属人已认领：software-engineer-2（T10 建表，与 personaCopy 同一批、同一套口径）。
    //   证据：`memoryCopy.ts` 文件头写明「T10 专用」，且 `ml()` / `mlv()` 与 `pl()` / `plv()` 是同一个模子；
    //   记忆管理页面（MemoryManagePage / MemoryEditorPage / MemoryItem）同出 T10。
    //   ★ 更正一条错误信息：team-lead 曾转达「persona / memory 归 engineer-5」，至少文案表这层不成立
    //     （engineer-5 做的是 T09 设置体系，可能是把"设置里的记忆相关设置项"和"记忆域文案表"混了）。
    owner: 'software-engineer-2',
    kind: 'ui',
    keyShape: 'page.memory.title',
    prefixes: ['page', 'label', 'hint', 'mode'],
    prefixDelimiter: '.',
    declaredCount: 34,
    accessFn: 'mlv()',
    scanExempt: false,
    inCopyKey: false,
    auditFn: '',
    note:
      '保留域内：单文件自洽（`MemoryTextKey = keyof typeof MEMORY_TEXT`）。' +
      '★ 同样使用 `page.*` / `label.*` / `hint.*` 通用前缀，与 settings / persona 共有；' +
      '精确 key 无冲突（脚本校验），保持现状。',
    path: 'src/features/memory/memoryCopy.ts',
    files: ['src/features/memory/memoryCopy.ts'],
  },
  {
    id: 'stickers',
    purpose: '表情包域文案（导入 / 联网搜索 / 加载失败 / 内容安全边界说明）',
    owner: 'software-engineer（2026-10-04 新建，随「表情包导入 + 联网搜索」一起加）',
    kind: 'ui',
    keyShape: 'tab.mine',
    // ★ 单一 `'*'` 之外的键用 `ui.` / `err.` / `ok.` / `label.` / `hint.` / `note.` / `empty.` / `tab.`。
    //   这些前缀与其它表**共有**（脚本允许：精确 key 不冲突即可），
    //   但本表的 key 全部带具体语义（如 `err.skipTooLarge`、`note.limits`），不会撞。
    prefixes: ['tab', 'ui', 'label', 'hint', 'empty', 'ok', 'err', 'note', 'sk'],
    prefixDelimiter: '.',
    // 新建表即 35 条（2026-10-04）。取值函数 `vs()`：
    //   ★ `sl` / `ml` / `mo` / `pl` 均已被其它域占用。
    declaredCount: 35,
    accessFn: 'vs()',
    scanExempt: false,
    inCopyKey: false,
    auditFn: '',
    note:
      '保留域内：单文件自洽（`StickerTextKey = keyof typeof STICKERS_TEXT`），写错即编译报错。' +
      '消费方是 `features/stickers/**` 与聊天页的表情面板，无跨域读者。' +
      '★ `note.limits` 是这个功能**唯一诚实的边界说明**（远程图拿不到像素、做不到内容识别），' +
      '它必须显示在管理页面上，不许折叠进帮助文档。',
    path: 'src/features/stickers/stickersCopy.ts',
    files: ['src/features/stickers/stickersCopy.ts'],
  },
  {
    id: 'moments',
    purpose: '朋友圈域文案（时间线 / 发布 / 点赞 / 空态 / 反馈）',
    owner: 'software-engineer（2026-10-04 新建，随「朋友圈」功能一起加）',
    kind: 'ui',
    keyShape: 'moments.page.desc',
    // ★ 全部 key 用 `moments.` 单一前缀。
    //   不复用 `page.*` / `label.*` 这些通用前缀 —— 它们已被 settings / persona /
    //   memory / capabilities 四张表共享，脚本虽允许（精确 key 不冲突），
    //   但共享前缀是**历史形成**的负担，新表没有理由再往里加一个。
    prefixes: ['moments'],
    prefixDelimiter: '.',
    // 新建表即 26 条（2026-10-04）。取值函数 `mo()`：
    //   ★ 不叫 `ml()` —— 那个名字已被记忆域（`features/memory/memoryCopy.ts`）占用。
    declaredCount: 26,
    accessFn: 'mo()',
    scanExempt: false,
    inCopyKey: false,
    auditFn: '',
    note:
      '保留域内：单文件自洽（`MomentsTextKey = keyof typeof MOMENTS_TEXT`），写错即编译报错。' +
      '只有 `features/moments/**` 消费它，无跨域读者，故不进主表。',
    path: 'src/features/moments/momentsCopy.ts',
    files: ['src/features/moments/momentsCopy.ts'],
  },
  {
    id: 'feedback',
    purpose: '反馈域文案（提交表单 / 反馈信箱管理 / 分享导出 / 本地留存边界说明）',
    owner: 'software-engineer（2026-10-04 新建，随「用户反馈入口」一起加）',
    kind: 'ui',
    keyShape: 'fb.form.title',
    // ★ 全部 key 用**单一 `fb.` 前缀**。
    //   不复用 `ui.*` / `ok.*` / `err.*` / `label.*` / `hint.*` / `empty.*` / `note.*` ——
    //   这些通用前缀在 main / settings / capabilities / stickers 四张表里都有人用，
    //   而 `lint:copyTables` 的**跨表重名检查**会直接报错
    //   （`stickersCopy.ts` 已经踩过两轮：`ok.imported` / `ui.search` / `ui.searchPlaceholder`）。
    //   ⇒ 新表用**自己的命名空间**，是唯一干净的做法。
    prefixes: ['fb'],
    prefixDelimiter: '.',
    // 新建表即 64 条（2026-10-04）。
    //   分布：表单 13 + 类型 4 + 状态 4 + 动作 13 + 标签提示 10 + 空态 2
    //        + 边界说明 4 + 信箱 3 + 导出版式 3 + 环境字段名 6 + 构建形态 2 = 64。
    //   ★ 环境字段名（`fb.env.*`，6 条）与构建形态（`fb.flavor.*`，2 条）是**补进来的**：
    //     第一版把它们硬写在 `feedbackEnv.ts` 里，`lint:copy` 的兜底扫描 6 条全命中 ——
    //     它们是**用户看得见**的（提交前那一块 + 导出文本里的环境段落），
    //     不是内部标识符。硬写的判据很简单：**这句话会不会出现在用户眼前的某个界面上**。
    //   ★ 计数口径同其它域内表（`objectKeys`：数 `'key':` 行）。
    //     本文件的 `fb.note.*` 四条是**折行 `+` 拼接**的写法，值那几行
    //     不含 `'xxx':` 形态，不会被误计 —— 已按 `stickersCopy.ts` 的既有形态写，
    //     不是新引入的格式。
    //   ★ 另 **−10**（不是 +）：第一版写在这里的 `fb.ok.*`（5 条）与
    //     `fb.err.*`（5 条）**没有一条能被消费** —— `useSnack` 只收主表 `CopyKey`，
    //     域内表的 key 类型上就传不进去。已全部删除，改由主表承担
    //     （见 `main` 表 629 → 635 那段注释）。
    //     ⇒ 教训：**域内表里的 key 加之前先确认它有消费者**。
    //       一张域内表看起来"自洽、能编译"，但那些永远不会被引用的 key，
    //       和一个没人认领的空账号没有区别。
    declaredCount: 64,
    accessFn: 'fb()',
    scanExempt: false,
    inCopyKey: false,
    auditFn: '',
    note:
      '保留域内：单文件自洽（`FeedbackTextKey = keyof typeof FEEDBACK_TEXT`），写错即编译报错。' +
      '消费方是 `features/feedback/**` 与设置页的反馈分区，无跨域读者。' +
      '★ `fb.note.local` / `fb.note.inboxScope` 是这个功能**唯一诚实的边界说明**' +
      '（应用没有服务端，反馈不会自己上传；不点「发出去」开发者就收不到），' +
      '它们必须显示在提交表单和信箱页面上，不许折叠进帮助文档 —— ' +
      '一句含糊的"反馈已提交"会让用户以为东西已经发出去了，然后他就等回音。',
    path: 'src/features/feedback/feedbackCopy.ts',
    files: ['src/features/feedback/feedbackCopy.ts'],
  },
  {
    id: 'capabilities',
    purpose: '能力总览域文案（页面标题 / 筛选 / 程度四档 / 条目字段 / 统计）',
    owner: 'software-engineer-2',
    kind: 'ui',
    keyShape: 'page.capabilities.title',
    prefixes: ['page', 'ui', 'level', 'label', 'empty', 'stat'],
    prefixDelimiter: '.',
    // 20 → 26：补 6 条分组显示名（ui.group.*），原先直接拿 group 字面量当标题渲染
    declaredCount: 26,
    accessFn: 'cl() / clv()',
    scanExempt: false,
    inCopyKey: false,
    auditFn: '',
    note:
      '★ 第二类（UI 文案，域内表）。沿用 settingsCopy 的模式：单文件自洽' +
      '（`CapabilityTextKey = keyof typeof CAPABILITY_TEXT`），写错即编译报错。' +
      '不并入 `keys.ts`：`page` / `ui` / `label` / `empty` 均为与其它表共有的通用前缀，' +
      '硬并必然污染 `CopyKey`；且它随能力总览页演进，放域内改动半径最小。' +
      '已收录的通用键（`gate.*` / `alt.*`）仍走 `t()`，本表只放本域专有名词。',
    path: 'src/features/capabilities/capabilitiesCopy.ts',
    files: ['src/features/capabilities/capabilitiesCopy.ts'],
  },
  {
    id: 'backupText',
    purpose: '备份域补充文案（导入失败原因 / 备份包版本提示）',
    owner: 'software-engineer-2',
    kind: 'ui',
    keyShape: 'import.reason.stickerEmpty',
    prefixes: ['import', 'bundle'],
    prefixDelimiter: '.',
    // 6 → 7：补 import.reason.blobFailed（原 `${n} blob(s) failed` 英文字面量收编）
    declaredCount: 7,
    accessFn: 'bl() / blv()',
    scanExempt: false,
    inCopyKey: false,
    auditFn: '',
    note:
      '★ 第二类（UI 文案，域内表）。沿用 `settingsCopy.ts` 的域内表模式：单文件自洽' +
      '（`BackupTextKey = keyof typeof BACKUP_TEXT`），写错即编译报错。' +
      '★ 它诞生的直接原因是 2026-10 的英文泄漏事故：备份导入的失败原因原本直接把' +
      '`AppError.message`（英文）塞进 `ImportReport.items[].reason`，UI 上原样渲染给用户，' +
      '而所有检查脚本的判据是「连续 N 个中文字符」，对英文 100% 静默。' +
      '本表即为该通道的收编：**面向用户的 reason 必须是文案，英文 message 只进日志与开发者页**。' +
      '★ `import` / `bundle` 两个前缀此前无人声明，无跨表冲突；' +
      '注意主表里有 `err.importNotJson` 等 7 条，它们的前缀是 `err` 不是 `import`，不构成重名。' +
      '★ `scanExempt: false`：它是普通 UI 文案表，不是 `Record<IdUnion, string>` 形态的编译期元数据，' +
      '含中文不是刻意的约束手段，界面上必须走 `bl()` / `blv()`。',
    path: 'src/backup/backupCopy.ts',
    files: ['src/backup/backupCopy.ts'],
  },
  {
    id: 'featureNames',
    purpose: '141 项功能项的显示名（`FeatureId` → 名称），供能力总览页展示功能名列',
    owner: 'software-engineer-2',
    kind: 'name',
    keyShape: 'PG-01（= `FeatureId` 本身，不是 `<域>.<语义>`）',
    prefixes: ['PG', 'FN', 'SV', 'PL', 'EX', 'XR'],
    prefixDelimiter: '-',
    declaredCount: 141,
    accessFn: 'featureName()',
    scanExempt: true,
    inCopyKey: false,
    auditFn: '',
    note:
      '★ 第四类（功能项显示名映射），与 `tone.*` 一样**不进 `CopyKey`**，但理由不同：' +
      '`tone.*` 不进是因为「它是注入 LLM 的指令，不是界面文案」；' +
      '本表不进是因为「它的 key 是 `FeatureId` 而不是 `<域>.<语义>`」，' +
      '并进 `CopyKey` 会把 141 个 `PG-01` 这类 id 塞进文案联合类型，语义完全错位。' +
      '★ 它的约束是**完备性**而不是措辞：`Record<FeatureId, string>` 天然强制 141 项全覆盖——' +
      '`ALL_FEATURE_IDS` 里加一个 id，这里少一个名字就直接编译报错，' +
      '不需要 `tone` 那样的运行时自检。' +
      '★ 它不是能力数据的第二份真相：level / reason / alternative 一律以 `CAPABILITIES` 为准，' +
      '本表**只提供名称**；与 `ModulePermissionPage` 的 17 项模块授权子集无关，不互相引用。',
    path: 'src/features/capabilities/featureNames.ts',
    files: ['src/features/capabilities/featureNames.ts'],
  },
  {
    id: 'segmentLabels',
    purpose: '提示词 12 个分段的显示名（`PromptSegmentId` → 段名），供提示词预览 / 注入控制 UI 展示',
    owner: 'software-engineer（T10 提示词装配域）',
    kind: 'name',
    keyShape: 'identity / personaLayers / scenario …（= `PromptSegmentId` 本身）',
    prefixes: [],
    prefixDelimiter: '.',
    declaredCount: 12,
    accessFn: 'SEGMENT_LABELS[id]',
    scanExempt: true,
    inCopyKey: false,
    auditFn: '',
    note:
      '★ 与 `featureNames` 同属第四类：**与类型一对一绑定的编译期元数据**，不是 UI 文案。' +
      '`Record<PromptSegmentId, string>` 决定了 `PromptSegmentId` 加一个段、这里少一个名字就**直接编译报错**——' +
      '含中文是刻意的约束手段，所以 `scanExempt: true`。' +
      '★ **豁免扫描 ≠ 豁免登记**：它照样在总账里、照样有归属（T10 提示词装配域）。' +
      '★ `prefixes` 留空是有意的：key 空间由 `PromptSegmentId` 联合类型强制，' +
      '不需要（也无法用）前缀校验，重一个前缀反而会漏报真问题。',
    path: 'src/persona/promptTypes.ts',
    files: ['src/persona/promptTypes.ts'],
  },
  {
    id: 'intakeCopy',
    purpose: '蒸馏引导流程里**直接问用户**的提问与选项（称呼 / 关系描述 / 性格描述 / 依恋类型 / 爱情标签 / MBTI / 星座…）',
    owner: 'software-engineer-3',
    kind: 'ui',
    keyShape: '（无 key，按导出常量组织：`INTAKE_Q1` / `ATTACHMENT_TYPES` / `LOVE_TAGS` / `MBTI_TYPES`…）',
    prefixes: [],
    prefixDelimiter: '.',
    declaredCount: 10,
    accessFn: '直接导入常量',
    scanExempt: false,
    inCopyKey: false,
    auditFn: '',
    countMode: 'exportConst',
    countFiles: ['src/distill/prompts/intake.ts'],
    note:
      '★ 性质是**面向用户的界面文案（第二类）**，只是恰好住在 `prompts/` 目录里——' +
      '「她怎么称呼？」「安全型/焦虑型/回避型/混乱型」这些都是给用户看、给用户选的，不是喂给模型的指令。' +
      '不进 `CopyKey` 的原因与搬移与否**无关**，纯粹是它现在以「导出常量」而非「key→文案映射」组织，' +
      '且归属 software-engineer-3 的蒸馏域。' +
      '★ 本条只做**可见性登记**：是否需要拆成 key→文案并搬进 copy 层，涉及拆文案 / 改调用方 / 过 T11 验收，' +
      '属于工程改动，**不在登记阶段决定**，由 team-lead 另行排期。' +
      '★ 它此前既不在任何文案表、也不在 `check-copy` 扫描范围（`src/distill` 不在 SCAN_DIRS 内），' +
      '是这次报出的暗账，登记即为收编。',
    path: 'src/distill/prompts/intake.ts',
    files: ['src/distill/prompts/intake.ts'],
  },
  {
    id: 'distillPrompts',
    purpose: '蒸馏各阶段的 LLM 提示词正文（分析 / 构建 / 纠错 / 合并 / 索引），模板源 `ex-skill v1.0.0`',
    owner: 'software-engineer-3',
    kind: 'prompt',
    keyShape: '（无 key，按导出常量组织：`MEMORIES_ANALYZER_PROMPT` / `PERSONA_BUILDER_PROMPT` / `MERGER_PROMPT`…）',
    prefixes: [],
    prefixDelimiter: '.',
    declaredCount: 12,
    accessFn: 'buildDistillPrompt()',
    scanExempt: false,
    inCopyKey: false,
    auditFn: '',
    countMode: 'exportConst',
    countFiles: [
      'src/distill/prompts/analyzers.ts',
      'src/distill/prompts/builders.ts',
      'src/distill/prompts/correction.ts',
      'src/distill/prompts/index.ts',
      'src/distill/prompts/merger.ts',
    ],
    note:
      '★ 性质是**注入 LLM 的指令（第三类）**，与 `tone.*` 同类：这些正文是喂给模型的，不是给用户看的。' +
      '★ **与同目录的 `intakeCopy` 必须分开看**——两者同住 `src/distill/prompts/`，但性质相反：' +
      '本表是指令，`intakeCopy` 是界面文案。后来者据此判断该不该搬：' +
      '**指令类不该搬进 copy 表（`CopyKey` 是界面文案语义），界面文案类才在「是否搬」的讨论范围内**，' +
      '且后者是否搬仍需工程排期，不在登记阶段定。' +
      '★ 另含两张翻译对照表（`TAG_TRANSLATION_TABLE` / `ATTACHMENT_TRANSLATION_TABLE`），' +
      '同样是指令侧数据，随本表一起纳管。',
    path: 'src/distill/prompts（analyzers / builders / correction / index / merger）',
    // ★ 本表的 `path` 就是上面那种**人读散文**（全角括号 + 空格），故它尤其不能当机器输入——
    //   机器清单以这里为准，与 `countFiles` 保持一致。
    files: [
      'src/distill/prompts/analyzers.ts',
      'src/distill/prompts/builders.ts',
      'src/distill/prompts/correction.ts',
      'src/distill/prompts/index.ts',
      'src/distill/prompts/merger.ts',
    ],
  },
  {
    id: 'templateLabels',
    purpose: '蒸馏流水线 7 个阶段的显示名（`DistillTemplateId` → 名称），开发者页 / 日志用',
    owner: 'software-engineer-3',
    kind: 'name',
    keyShape: 'intake / memories_analyzer / merger …（= `DistillTemplateId` 本身）',
    prefixes: [],
    prefixDelimiter: '.',
    declaredCount: 7,
    accessFn: 'TEMPLATE_LABEL[id]',
    scanExempt: true,
    inCopyKey: false,
    auditFn: '',
    note:
      '★ 与 `featureNames` / `segmentLabels` 同属第四类：**与类型一对一绑定的编译期元数据**——' +
      '`Record<DistillTemplateId, string>` 决定了 `DistillTemplateId` 加一个阶段、这里少一个名字就**直接编译报错**，' +
      '含中文是刻意的约束手段，所以 `scanExempt: true`。' +
      '★ `prefixes` 留空同 `segmentLabels`：key 空间由 `DistillTemplateId` 联合类型强制，前缀校验用不上。' +
      '★ 它住在 `pipeline.ts`（蒸馏流水线）而不是 copy 目录，是这次巡目录才捞出来的暗账——' +
      '登记前它不在任何清单里，`lint:copyTables` 也看不见它（脚本只校验已登记的表）。' +
      '★ 不进 `CopyKey`：key 是 `DistillTemplateId`（`memories_analyzer` 这种 id），不是 `<域>.<语义>`，' +
      '并进文案联合类型会语义错位。' +
      '★ 用途是「开发者页 / 日志」，不是主流程界面——但也因此更容易被漏掉，登记即为收编。',
    path: 'src/distill/pipeline.ts',
    files: ['src/distill/pipeline.ts'],
  },
  {
    id: 'tone',
    purpose: '欣然的语气行为指令（9 情绪簇 × 5 档 pride = 45 条），注入 LLM 提示词',
    owner: 'software-engineer-4（T12 增强能力层）',
    kind: 'prompt',
    keyShape: 'tone.<cluster>.<tier>（如 tone.excited.1）',
    prefixes: ['tone'],
    prefixDelimiter: '.',
    declaredCount: 45,
    accessFn: 'buildXinranStyleBlock() / xinranToneGuidance()',
    scanExempt: false,
    inCopyKey: false,
    auditFn: 'auditToneCopy()',
    note:
      '★ 第三类：**注入 LLM 的角色行为指令，不是界面文案**，因此不并入 `CopyKey`（并入会污染 `CopyKey` 语义）。' +
      '「不被 keys.ts 管」不等于「没人管」：本表登记即为它的归属，' +
      '并由 `auditToneCopy()`（DEV-only、只 warn 不抛）自检 45 条是否缺项或空内容。',
    path: 'src/proactive/xinranTone.ts',
    files: ['src/proactive/xinranTone.ts'],
  },
];

/** 按 id 取登记表 */
export function getCopyTable(id: CopyTableRegistration['id']): CopyTableRegistration | undefined {
  return COPY_TABLES.find((table) => table.id === id);
}

/**
 * ★★ 自检：`files`（**机器读**）必须与 `path` / `countFiles`（**人读**）一致。
 *
 * 为什么要有这条：两份描述同一件事的东西，一定会漂。**漂了就必须报错退出**，
 * 不许静默取一边——否则"第二份真相"又回来了，而且这次它藏在一个自称能防这个病的工具里。
 *
 * 期望值推导（不额外引入第三份真相）：
 * - 有 `countFiles` 的表 ⇒ 用它（`exportConst` 类表本来就这么计数）；
 * - 否则 ⇒ 把 `path` 按 ` + ` 切开（单文件表切完就是它自己）。
 *
 * @returns 人类可读的不一致清单；**空数组 = 通过**。
 */
export function checkCopyTableFilesConsistency(): string[] {
  const errors: string[] = [];
  const norm = (xs: readonly string[]): string[] =>
    xs.map((x) => x.replace(/\\/g, '/')).sort();
  for (const table of COPY_TABLES) {
    const expected =
      table.countFiles !== undefined && table.countFiles.length > 0
        ? [...table.countFiles]
        : table.path.split(' + ').map((s) => s.trim()).filter((s) => s !== '');
    const [want, got] = [norm(expected), norm(table.files)];
    const same = want.length === got.length && want.every((v, i) => v === got[i]);
    if (!same) {
      errors.push(
        `表 ${table.id}：path/countFiles 推出 [${expected.join(', ')}]，` +
          `但 files = [${table.files.join(', ')}]`,
      );
    }
  }
  return errors;
}

/**
 * 按种类分别统计已登记条数。
 *
 * ★ 不要只报一个总数：`ui`（界面文案）/ `name`（功能名映射）/ `prompt`（LLM 指令）
 * 三类性质不同，混成一个数会得出「我们有 1032 条文案」这种无法解读的结论——
 * 其中只有 `ui` 那部分才是真正的界面文案资产。
 */
export function totalRegisteredByKind(): Record<CopyTableKind, number> {
  const out: Record<CopyTableKind, number> = { ui: 0, prompt: 0, name: 0 };
  for (const table of COPY_TABLES) {
    out[table.kind] += table.declaredCount;
  }
  return out;
}

/** 已登记的条目总数（跨种类，仅供自检展示；对外报数请用 `totalRegisteredByKind()`） */
export function totalRegisteredCopyCount(): number {
  return COPY_TABLES.reduce((sum, table) => sum + table.declaredCount, 0);
}
