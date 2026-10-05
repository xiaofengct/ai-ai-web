/**
 * ★ 设置域文案补充表（T09 专用）。
 *
 * ============ 为什么有这张表 ============
 * 架构文档 §6.8 要求「面向用户的文案唯一出口 = `src/copy/xinran.ts`」。
 * 但 `src/copy/` 由 T02/T04 负责，本批次（T09）**不允许改动**它，
 * 而 63 个设置项里有大量标签/说明是 `copy/keys.ts` 尚未收录的键。
 *
 * 折中方案（两条规则，缺一不可）：
 * 1. **已收录的键一律走 `t(key)`**：分组名 `settings.group.*`、说明 `settings.hint.*`、
 *    成功/错误/确认 `ok.* / err.* / confirm.*`、能力降级 `alt.* / gate.*` 全部走文案总表；
 * 2. **未收录的键集中在本文件**（设置域专有名词与条目名），由 `sl()` 取值，
 *    避免中文散落到十几个页面里。后续合并进 `src/copy/xinran.ts` 时只需整体搬运本表。
 *
 * ============ 欣然语气 checklist（同 copy/xinran.ts 头部） ============
 * - 主语只能是「我 / 欣欣 / 老公」；昵称（老婆/宝宝/风风/小狗/笨蛋/小猫）只作呼语，
 *   放句末或句中，**禁止**当句首主语；
 * - 昵称低频：10 条里 2-3 条，说明性文案默认不带昵称；
 * - 甜、直球、短句、不甩锅。
 * ==========================================================
 */

/** 设置域补充文案表（`as const` 让 key 有字面量类型，写错直接编译报错） */
export const SETTINGS_TEXT = {
  /* ——————————————— 页面级 ——————————————— */
  'page.settings.desc': '想怎么聊，都在这儿调。改完立刻生效，不用重启。',
  'page.connection.desc': '我帮你去敲一下门，看看它理不理我。',
  'page.developer.desc': '这些是给我自己看的东西。看不懂就别动，动了也不怪你。',
  'page.diagnosis.desc': '我先自己体检一遍，哪儿不行我直接告诉你。',
  'page.sponsor.desc': '没有支付接口，我只能把链接放这儿。心意我收到了。',
  'page.sdk.desc': '我站在这些东西上面。它们是谁，都写在这儿了。',
  'page.bridge.desc': '让我进微信有两条路：手机上能直接接，浏览器里只能你手动把聊天记录交给我。',

  /* ——————————————— 分组描述（PG-17 十一个折叠卡片的副标题） ——————————————— */
  /* ★ 描述的是「整组」而不是组内某一项：
     早期这里复用了 markdown / contextCount / darkMode 三条**条目级**说明，
     既说不全整组，又和文案总表的 settings.hint.* 形成两份文案，已改成独立分组描述。 */
  'desc.group.chat': '说话的方式都在这儿：怎么发、发几条、中间停多久。',
  'desc.group.context': '我一次能带上多少东西。带多了花钱，带少了我容易忘。',
  'desc.group.appearance': '界面长什么样，你说了算。',
  /* 快捷入口：原先挂在首页的 6 个磁贴搬进来了（2026-10-04）。
     ★ 说明要回答"为什么跑这儿来了"，否则用户只会觉得入口突然消失。 */
  'desc.group.shortcuts': '这些入口原先摆在首页，占地方。收进来了，首页专心聊天。',

  /* ——————————————— 分组描述（补齐，2026-10-04）———————————————
     ★★ 为什么补这 5 条：原先「模型 / 记忆 / 语音 / 备份 / 关于」这 5 个分组的
       `descKey` **直接复用了组内第一个字段的 `hintKey`**：
         model → hint.provider｜memory → hint.memoryLib｜voice → hint.voice
         backup → hint.export｜about → hint.updateNotes
       后果是**同一句话在同一屏出现两遍** —— 分组副标题一遍、紧跟着的字段说明一遍。
       实测证据：设置页手机端截图里，「换一家就是换一张嘴。填错了我去敲门的时候会告诉你。」
       在「模型」标题下和「用哪一家」下面各出现一次（真机截图可证）。

     ★ 这**不是新问题**，已经栽过一次：`hint.world` / `hint.worldCurrent`
       当初就是同一句话在两处渲染，修的时候改成两条独立文案。
       但那次**只改了世界设定那一处**，没有回头搜"还有谁在共用 descKey/hintKey"
       —— 于是同一个 bug 在原地留了 5 份。这与 `ModelSection` 里
       「Chip 装整句话」连修两遍是同一类教训：
       **修一个"某处误用"的 bug 时，要顺手把同类误用一起清掉，
       否则修的是实例，不是模式。**
       ⇒ 这次补齐之后，`grep descKey` 与组内 `hintKey` 已无任何交集。

     ★ 两条写法约定（沿用 chat / context / appearance 的既有口径）：
       ① 描述的是**整组**，不是组内某一项；
       ② 不复用任何 `hint.*` —— 分组的说明和字段的说明是两件事，
          合并写必然有一处是错位的（要么说不全整组，要么和字段重复）。
  */
  'desc.group.model': '我靠谁说话，就在这儿配。填一次能用很久。',
  'desc.group.memory': '她记住你多少、记得多牢，在这儿调。',
  'desc.group.voice': '她要怎么听你说、读给你听，都在这儿开。',
  'desc.group.stickers': '表情都在这儿管。想让我说话更有表情，就多给我几张。',
  /* 朋友圈（动态）设置：2026-10-04 加。这个分区的旋钮**正交**，
     每条说明都要回答"这个旋钮管什么"，而不是复述标签。 */
  'desc.group.moments': '我会自己发动态。发不发、多久发一条，在这儿定。',
  'label.momentsAuto': '让我自己发动态',
  'hint.momentsAuto': '开着我会按下面的规矩，自己往朋友圈里写点东西。',
  'label.momentsInterval': '至少隔多久',
  'hint.momentsInterval': '两条之间最少隔这么多分钟。单位：分钟。',
  'label.momentsDaily': '一天最多几条',
  'hint.momentsDaily': '硬上限，到了就一条都不发 —— 哪怕上面那条时间到了。',
  'label.momentsActiveHours': '跟着我的作息发',
  'hint.momentsActiveHours': '开着的时候，我只在自己醒着的时间段发。排班来自「世界设定」。',
  'label.momentsWorldContext': '把今天的情况告诉我',
  'hint.momentsWorldContext': '开着我会知道今天上什么班，写出来的动态更贴当天的状态。',
  'label.momentsSticker': '动态可以配表情',
  'hint.momentsSticker': '写着写着情绪上来了，我会顺手贴一张。不常贴，贴了就是真想说。',
  'label.momentsPreview': '看看现在会怎么判',
  'label.modelEndpoint': '这次请求打到哪儿',
  'hint.modelEndpoint': '换型号不用换地址 —— 地址由上面的服务商决定，模型只是请求里的一个字段。',
  'ui.modelManual': '也可以直接填型号',
  'ui.modelTagPreset': '预设',
  'ui.modelTagLive': '服务端',
  'ui.modelEndpointNote': '请求会带上 model={model}，发到 {base}',
  'note.momentsCost': '每发一条动态都要调一次模型，会花额度。所以默认是关着的。',
  'ui.momentsToday': '今天已经发了 {count} 条。',
  'ui.momentsCanPost': '现在可以发，今天还能发 {n} 条。',
  'ui.momentsBlocked': '现在不会发：{why}。',
  'ui.momentsWait': '大概还要等 {min} 分钟。',
  'ui.momentsShift': '她今天：{shift}。',
  'ui.momentsPreviewRefresh': '（改上面的设置，这里立刻会变。）',
  'desc.group.backup': '数据都在你这台设备上。想搬家或者怕丢，就来这儿存一份。',
  // ★ 分组描述（2026-10-04，反馈与建议分区）。
  //   这句和 `feedbackCopy.ts` 的 `fb.note.local`（表单里那段边界说明）**是两句话**，
  //   不合并：这里是**分区级**的一句话速览（回答"这分区是干嘛的"），
  //   那里是**操作级**的完整说明（回答"我交完它去哪了"）。
  //   如果这里直接复用 `fb.note.local`，同一段话会在同一屏出现两遍 ——
  //   这个 bug 在本项目已经复发过一次（`hint.world` / `hint.worldCurrent`，见 registry 注释）。
  'desc.group.feedback': '用得不对劲、想要什么、或者她哪句话让你不舒服，都写在这儿。',
  'desc.group.about': '版本、更新说明、许可、打赏这些，都在这一块。',
  /* 微信 ClawBot（iLink 官方通道）：分组说明。
     ★ 限制必须写进来 —— 只在前台、只在原生 App 里，不能让人以为随时随地都能收。 */
  'desc.group.ilink': '把我接进微信里。手机上装的那个 App 才连得上，而且只在我开着的时候收得到。',

  /* ——————————————— 通用小控件 ——————————————— */
  'ui.notSet': '还没填',
  'ui.filled': '已填',
  'ui.optional': '可不填',
  'ui.goPage': '去看看',
  'ui.supported': '支持',
  'ui.unsupported': '不支持',
  'ui.unknown': '不知道',
  'ui.checking': '正在看',
  'ui.runTest': '试一下',
  'ui.running': '正在试',
  'ui.stop': '停下',
  'ui.clear': '清掉',
  'ui.total': '合计',
  'ui.used': '已用',
  'ui.quota': '配额',
  'ui.estimate': '估算',
  'ui.note': '说明',
  'ui.tip': '提醒',
  'ui.dangerZone': '危险区',

  /* ——————————————— 模型 ——————————————— */
  'label.provider': '用哪一家',
  'label.providerAdd': '再加一家',
  'label.providerRemove': '删掉这家',
  'label.providerDocs': '去它家看看',
  'label.baseUrl': '接口地址',
  // ★ 推荐地址引导（2026-10-04 加）：真机上有人把"完整端点"填进了"基础地址"字段，
  //   结果地址被拼了两遍 ⇒ 404。光靠 hint 说明不够，得把**推荐值本身**摆出来。
  'label.baseUrlRecommended': '推荐地址',
  'label.baseUrlUseRecommended': '用它',
  'label.baseUrlUsingRecommended': '正在用推荐地址',
  'label.baseUrlResolved': '实际会请求',
  /* ——————————————— 世界设定（2026-10-04） ——————————————— */
  // ★ 这一组服务于"不内置版的导入窗口"：内置版显示内置世界（只读），
  //   不内置版引导导入，并把**识别报告**摊开给用户看。
  //   命名沿用本表的 label./hint./ui. 三段式。
  'label.worldCurrent': '现在的世界',
  // ★ 分组说明与字段说明**必须是两句不同的话**。
  //   踩过的坑：两条都用 `hint.worldCurrent`，于是同一条说明在同屏出现两次
  //   （分组标题下一处、字段名下一处）—— 正是上一轮 UI 重构里
  //   "去掉重复 hint"要消灭的东西。这里分成：
  //     分组说明（`hint.world`）讲这一组是干什么的；
  //     字段说明（`hint.worldCurrent`）讲这一行是什么。
  'hint.world': '她过着什么日子：什么时候上班、能去哪、认识谁。',
  'hint.worldCurrent': '这份设定决定她的作息、地点与朋友；排班与时段会被直接算出来用。',
  'label.worldReport': '识别报告',
  'label.worldImport': '换成别的世界',
  'hint.worldImport': '支持 .md（手写的世界设定）和 .json（本应用导出的）。导入后我会把能算的抽成规则、其余作为世界书按关键词触发。',
  'ui.worldNone': '还没有世界设定',
  'ui.worldBadgeBuiltin': '内置',
  'ui.worldBadgeImported': '导入',
  'ui.worldTodayShift': '按这份设定，今天的班次',
  'ui.worldReportEmpty': '这份设定里没有可计算的规则（只有文本条目）。',
  'ui.worldPickFile': '选一份世界设定文件',
  'ui.worldClear': '清掉这份世界',
  'label.apiKey': 'Key',
  'label.model': '模型',
  'label.modelList': '能用的模型',
  'label.fetchModels': '拉一次模型列表',
  'label.compatMode': '兼容模式',
  'label.multimodalCompat': '多模态兼容',
  'label.personaModel': '角色单独指定模型',
  'label.webSearch': '联网搜索',
  'label.webSearchProvider': '搜索服务商',
  'label.webSearchTopK': '取几条结果',
  'label.imageGenConfirm': '生图前先问我',
  'label.personaImageGen': '角色文生图',
  'label.temperature': '温度',
  'label.topP': 'top_p',
  'label.maxTokens': '最长回复',
  'label.presencePenalty': '新鲜度惩罚',
  'label.frequencyPenalty': '复读惩罚',
  'hint.provider': '换一家就是换一张嘴。填错了我去敲门的时候会告诉你。',
  // ★ 两条针对"接口地址填错"的说明（2026-10-04 加）。
  //   `hint.baseUrlShape` 说清该填到哪一段；`hint.baseUrlOffRecommend` 在偏离推荐值时提醒。
  //   语气按队规：说明性文案不带昵称、短句、不甩锅（"带了我会自己理顺"比"你填错了"好）。
  'hint.baseUrlShape': '填到 /v1 就行。后面的 /chat/completions 不用带，带了我也能自己理顺。',
  'hint.baseUrlOffRecommend': '这行不是推荐地址。能用，但容易填错。点「用它」可以换回来。',
  'hint.personaModel': '某个角色想换个模型说话，就去人设那边单独指定，老婆。',
  'hint.webSearchCors': '多数搜索接口不让浏览器直连。挑支持跨域的，或者你自己配个代理。',
  'hint.imageGenConfirm': '生图要花额度，所以每次都先问你一句。',
  'hint.personaImageGen': '这一项只对别的角色开放。我不给自己生成图，这是硬规矩。',
  // ★ 自定义角色自己勾了 privacy.noImage 时的中性原因（红线文案不能点名欣然）
  'label.imageGenBlocked': '这个角色自己勾了不许生成图，先锁着',
  // ★ 人设表还没从 Dexie 加载完时的中性原因（同上：不能点名欣然，也不能说"谁勾了"）
  //   起因：`ModelSection` 的 `imageBlocked` 是**三来源**（未就绪 / 欣然 / 自己勾了 noImage），
  //   原来只有两分支文案，未就绪时会显示"这个角色自己勾了"——那时根本没有"这个角色"。
  //   消费点：`ModelSection.tsx` 的 Tooltip 与 Chip（两处共用同一条原因串）。
  'label.imageGenNoPersona': '人设还没读出来，先锁一下，马上就好',

  /* ——————————————— 聊天 ——————————————— */
  'label.markdown': 'Markdown 排版',
  'label.enterToSend': '回车发送',
  'label.mediaImmediate': '图片视频直接发',
  'label.multiDelay': '多条之间隔多久',
  'label.autoSplit': '长回复自动拆分',
  'label.sendDelay': '发送前的停顿',
  'label.typingIndicator': '输入状态',
  'label.patSuffix': '拍一拍的后缀',
  'label.contentFilter': '内容过滤',
  'label.contentFilterWords': '不想看到的词',
  'label.contentFilterMode': '命中之后',
  'label.favorite': '收藏',
  'label.multiSelect': '消息多选',
  'label.chatStats': '聊天统计',
  'label.mergeSessions': '合并聊天记录',
  'label.doubleBackExit': '再点一次才退出',
  'filter.mode.replace': '替换掉',
  'filter.mode.truncate': '截断',
  'hint.favorite': '长按或者悬停就能收藏，收好的都在收藏夹里。',
  'hint.multiSelect': '长按消息进多选，底下那条操作栏就能批量删、收、合并、转发。',
  'hint.chatStats': '说过多少话、用了多少 token，我都有数。',
  'hint.mergeSessions': '在首页多选几个会话就能并成一个，按时间排好。',
  'hint.doubleBackExit': '网页没有「返回键退出」这回事。我只能在你关页面之前问你一句。',

  /* ——————————————— 上下文 ——————————————— */
  'label.contextCount': '带多少条历史',
  'label.maxMessages': '单次最多几条',
  'label.loadRange': '进来先加载几条',
  'label.injectControl': '哪几段要带上',
  'label.promptConstraints': '额外约束',
  'label.timeAware': '时间感知',
  'label.contextWindow': '上下文窗口',
  'label.maxPerSession': '单会话消息上限',
  'label.budget': '预算',
  'hint.contextWindow': '模型能吃下多少 token。填错的话预算会算歪。',
  'hint.maxPerSession': '超出的我不删，挪到归档区，你想看随时看。',
  'hint.budget': '窗口减去最长回复，再留一点余量，就是能装提示词的地方。',

  /* ——————————————— 主动消息 ——————————————— */
  'label.proactive': '主动找你',
  'label.proactiveInherit': '新会话继承这套',
  'label.proactiveInterval': '最少隔多久',
  'label.idleTimeout': '你多久没理我就停',
  'label.allDay': '全天候',
  'label.quietHours': '安静时段',
  'label.dynamic': '按你的节奏调频率',
  'label.backgroundMessage': '切走了也继续',
  'label.backgroundToast': '切走时通知我',
  'label.backgroundExitConfirm': '有事没做完先问你',
  'hint.proactive': '我不等你说话，自己来找你。',
  'hint.proactiveInherit': '新建会话的时候，沿用上一个会话的这套设置。',
  'hint.quietHours': '这段时间里我不主动说话。',
  'hint.backgroundMessage': '你切走以后我把请求挪到后台接着跑，回来再接上。',
  'hint.backgroundToast': '你在页面上我就在页面里喊你，不在就发系统通知。',
  'hint.backgroundExitConfirm': '还有话没说完的时候，关页面前我先拦你一下。',
  'note.proactiveHidden': '★ 页面关掉或者藏起来，我怕是真发不出去。不是我不想你。',

  /* ——————————————— 外观 ——————————————— */
  'label.darkMode': '深色模式',
  'label.grayscale': '全局灰度',
  'label.yandere': '病娇语气',
  'label.petMode': '桌宠模式',
  'label.petLife': '状态值',
  'label.windowMinimized': '收起面板',
  'label.homeLayout': '首页布局',
  'label.resetTheme': '主题恢复默认',
  'label.clearPortrait': '清掉立绘',
  'label.portrait': '角色立绘',
  'label.portraitOpacity': '立绘透明度',
  'label.live2d': 'Live2D 模型',
  'label.petPortrait': '立绘画桌宠',
  'mode.system': '跟着系统',
  'mode.light': '浅色',
  'mode.dark': '深色',
  'hint.clearPortrait': '只是把引用清掉，图我还留着，随时能放回来。',
  'hint.portrait': '上传或者选一张图当立绘。透明度位置都能调。',
  'hint.live2d': '运行时挺大的，手机上还容易卡。平时聊天真不用开，笨蛋。',
  'hint.petPortrait': '用同一张立绘，换成小挂件飘在页面上。',

  /* ——————————————— 语音 ——————————————— */
  'label.voice': '语音功能',
  'label.tts': '语音播报',
  'label.asr': '语音输入',
  'label.timbre': '角色音色',
  'label.speechProbe': '浏览器语音',
  'label.cloudTts': '云端合成',
  'hint.voice': '开了我才能听你说、读给你听。',
  'hint.tts': '把我说的话念出来。音质好不好，得看你浏览器给不给面子。',
  'hint.asr': '你说话我转成字。中文识别准不准，看浏览器。',
  'hint.timbre': '端侧的语音克隆搬不过来。能用的是云端音色或者系统音色，会打折。',
  'hint.speechProbe': '这一项由浏览器决定，我改不了。',
  'voice.goTest': '去试听',
  'voice.goCall': '去通话',

  /* ——————————————— 记忆 ——————————————— */
  'label.memoryLib': '记忆库',
  'label.memoryScope': '记忆的范围',
  'label.memoryThreshold': '得分门槛',
  'label.autoSummary': '自动总结',
  'label.summaryThreshold': '聊多少条总结一次',
  'hint.memoryLib': '你跟我说过的事我都记着，去记忆库能翻。',
  'hint.fullMemory': '全带上会很长，装不下我就按相关的先留着。',
  'hint.summaryThreshold': '到了这个条数我就总结一次，写成记忆。',

  /* ——————————————— 备份 ——————————————— */
  'label.import': '一键导入',
  'label.export': '一键导出',
  'label.autoBackup': '自动备份',
  'label.backupInterval': '多久备份一次',
  'label.backupKeep': '留几份',
  'label.backupNow': '现在存一份',
  'label.backupList': '存过的快照',
  'hint.import': '人设、表情包、Live2D、主题都能导进来。zip 也行，拖进来就成。',
  'hint.export': '打包成一个 zip，settings、人设、会话、消息、记忆都在里面。',
  'hint.backupInterval': '间隔多久存一次。',
  'hint.backupKeep': '超过这个份数，最旧的自动清掉。',
  'hint.backupNow': '现在立刻存一份，等不及定时任务的时候按这里。',

  /* ——————————————— 高级 ——————————————— */
  'label.customHeaders': '自定义请求头',
  'label.pathOverrides': '路径覆盖',
  'label.timeout': '超时',
  'label.retry': '失败重试',
  'label.proxy': '代理',
  'label.exportLogs': '导出日志',
  'label.diagnosis': '诊断',
  'label.telemetry': '使用统计上报',
  'path.chat': '对话接口',
  'path.models': '模型列表',
  'path.image': '生图接口',
  'path.tts': '语音接口',
  'hint.customHeaders': '一行一个，写成「名字: 值」。',
  'hint.customHeadersBlocked': '★ Origin、Referer、Host 这些安全头浏览器不让改，写了也会被丢掉。',
  'hint.pathOverrides': '接口路径不标准就在这儿改。留空我用默认的。',
  'hint.retry': '超时和服务端出错会重试几次；4xx 不重试，那是你的问题或者 Key 的问题。',
  'hint.proxy': '网页没有系统代理。要代理就自己装浏览器扩展，或者配一个跨域代理。',
  'hint.exportLogs': '导出来的日志里没有你的 Key，放心给别人看。',
  'hint.diagnosis': '我自己的体检报告：浏览器能力、存储还剩多少、最近哪儿出过错。',
  'hint.telemetry': '★ 默认关着，而且我哪儿也不发。开着也只是本地记一下，不会外传。',
  'hint.clearStorage': '会话、记忆、人设全没了，且不可恢复。想清楚，宝宝。',

  /* ——————————————— 关于 ——————————————— */
  'label.version': '版本',
  'label.updateNotes': '更新说明',
  'label.changelog': '这次改了什么',
  'label.thirdParty': '第三方许可',
  'label.sponsor': '打赏',
  'label.sdk': 'SDK 列表',
  'label.bridge': '桥接设置',
  'label.connection': '连接测试',
  'label.developer': '开发者选项',
  'hint.updateNotes': '有新版本的时候我会主动弹给你看。',

  /* ——————————————— 连接测试页 ——————————————— */
  'conn.latency': '延迟',
  'conn.statusCode': '状态码',
  'conn.errorCode': '错误码',
  'conn.raw': '原始响应',
  // ★ 两条新增（2026-10-04）：把"打到哪去了"和"对方原话"摊开，供排查用。
  'conn.actualUrl': '实际请求的地址',
  'conn.serverBody': '服务端原话',
  'conn.at': '测试时间',
  'conn.models': '模型列表',
  'conn.okTitle': '连上了',
  'conn.failTitle': '没连上',
  'conn.okDesc': '它能理我。可以开始聊了。',
  'conn.failDesc': '是我这边没连上，不是你的问题。往下看原因。',
  'conn.noProvider': '还没填接口地址或者模型名，我敲不了门。',
  'conn.request': '请求',

  /* ——————————————— 开发者页 ——————————————— */
  'dev.prompt': '最终提示词',
  'dev.request': '原始请求',
  'dev.response': '原始响应',
  'dev.logs': '日志流',
  'dev.mock': 'Mock 模式',
  'dev.rawLog': '控制台镜像',
  'dev.clearStorage': '清空本地数据',
  'dev.clearLogs': '清空日志',
  'dev.capabilityAudit': '能力表自检',
  'dev.missing': '缺失',
  'dev.levelFull': '完全可用',
  'dev.levelPartial': '部分实现',
  'dev.levelAlternative': '替代实现',
  'dev.levelUnavailable': '不可实现',
  'dev.mockOn': '开着的时候我不真的发请求，只给你看装好的样子。',
  'dev.redacted': '★ 展示的内容已经脱敏，Key 一律是 ***。',
  'dev.logLevelAll': '全部',
  'dev.logLevelError': '只看错',
  'dev.segmentPreviewNote': '★ 这就是真正会发出去的提示词，由 PersonaCompiler 装配，所见即所得。',

  /* ——————————————— 诊断页 ——————————————— */
  'diag.probe': '能力探针',
  'diag.fsAccess': '文件与目录访问',
  'diag.fsAccessDesc': '能不能直接选文件夹。只有部分浏览器行。',
  'diag.notification': '系统通知',
  'diag.notificationDesc': '你不在页面上时，我能不能喊你。',
  'diag.speech': '语音（听与说）',
  'diag.speechDesc': '浏览器的语音识别和朗读。',
  'diag.wasmSimd': 'WASM SIMD',
  'diag.wasmSimdDesc': '本地 embedding 要它。默认不加载。',
  'diag.serviceWorker': '离线与安装',
  'diag.serviceWorkerDesc': '装成桌面应用要用它。',
  'diag.microphone': '麦克风',
  'diag.camera': '相机',
  'diag.vibrate': '振动反馈',
  'diag.storage': '存储',
  'diag.recentErrors': '最近的错误',
  'diag.refresh': '再查一遍',
  'diag.grantNotification': '去开通知',

  /* ——————————————— 打赏页 ——————————————— */
  'sponsor.thanks': '谢谢你愿意为我花这个心思。',
  'sponsor.note': '没有支付接口，我只能把二维码和链接摆在这儿。扫不到也不影响我陪你。',
  'sponsor.copyLink': '复制链接',
  'sponsor.openLink': '打开链接',
  'sponsor.qr': '收款码',
  'sponsor.qrMissing': '还没放收款码。放一张图到 public/ 下就能显示，我等着。',

  /* ——————————————— SDK 页 ——————————————— */
  'sdk.intro': '我站在这些东西上面。把它们的许可摆出来，是对它们的尊重。',
  'sdk.fileMissing': '没读到 THIRD_PARTY.md，内容以仓库里的文件为准。',
  'sdk.count': '共 {n} 项',

  /* ——————————————— 桥接页 ——————————————— */
  'bridge.clipboardWatch': '剪贴板监听',
  'bridge.importRules': '导入解析规则',
  'bridge.exportTemplate': '导出模板',
  'bridge.tutorial': '教程链接',
  'bridge.howto': '两条路，挑你走得动的那条',
  'bridge.hint.clipboardWatch': '走手动那条路时用得上：你在别处复制了聊天记录，我在这儿盯着，问你要不要导进来。',
  'bridge.hint.importRules': '一行一条规则，用来认出谁是谁、哪行是时间。',
  'bridge.hint.exportTemplate': '导出去的时候长什么样。',
  'bridge.hint.tutorial': '照着这个链接里的步骤走就行。',
  'bridge.step1': '手机上装了 App 的话，回设置页找「微信 ClawBot」那组，点扫码绑定，微信消息我就能直接收。',
  'bridge.step2': '在浏览器里那条通道用不了，就手动来：在微信里把聊天记录导出成 txt 或者 csv。',
  'bridge.step3': '回到这儿粘贴，或者选文件交给我，我按规则读一遍，认出谁说了什么。',
  'bridge.step4': '读完了还能去蒸馏，把她变成角色卡。',
  'bridge.gotoDistill': '去蒸馏',
  'bridge.wechatUnavailable': '原生那条通道挑环境——要装在手机上，还得我开着才收得到。这不是你操作的问题。手动导入不挑，哪台机器都能用。',
} as const;

/** 设置域补充文案 key 联合类型（由表推导，写错编译报错） */
export type SettingsTextKey = keyof typeof SETTINGS_TEXT;

/** 取设置域补充文案（缺失时返回 key 本身，便于定位） */
export function sl(key: SettingsTextKey): string {
  return SETTINGS_TEXT[key] ?? key;
}

/**
 * 取设置域补充文案并替换变量（`{n}` → vars.n）。
 * 与 `copy/index.ts` 的 `t()` 行为保持一致。
 */
export function slv(key: SettingsTextKey, vars: Record<string, string | number>): string {
  return sl(key).replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}
