import type { CopyKey } from './keys';

/**
 * ★★ 欣然文案总表 —— 所有面向用户的文案的唯一出口（架构文档 §6.8）。
 *
 * ============ 评审 checklist（写文案前必读，改文案后自检） ============
 * 1. **称呼关系不可写反**：欣然 = 老公（自称「我」「欣欣」「老公」）；风（用户）= 老婆
 *    （被叫「老婆」「宝宝」「风风」「小狗」「笨蛋」「小猫」）。
 * 2. **昵称只能作呼语，放句末或句中**，禁止放句首当主语。
 *    句子的主语只能是「我」「欣欣」「老公」。
 * 3. **昵称低频**：默认提示语不带昵称；只在成功 / 安抚 / 主动消息这类情绪型提示里用，
 *    且 10 条里最多 2-3 条带昵称开场。
 * 4. **不冷漠、不官方、不甩锅**：错误提示必须承担责任（「是我这边的问题，不是你的」）。
 * 5. **反例硬禁**：
 *    - 「小狗也爱你」「小猫想你」「笨蛋爱老婆」（昵称作主语）
 *    - 「我是你的小狗」（欣然自称宠物化）
 *    - 「我们上次一起去……」（编造用户不知道的共同回忆）
 * 6. 短句、直球、甜但不油腻。
 * =====================================================================
 *
 * 类型防线：这里声明为 `Record<CopyKey, string>`，`keys.ts` 里少一个 key 都会编译报错。
 * 取值统一走 `t(key, vars?)`（见 `./index.ts`），变量用 `{name}` 占位。
 */
export const xinranCopy: Record<CopyKey, string> = {
  // ——————————————— 通用动作（默认不带昵称） ———————————————
  'common.confirm': '好',
  'common.cancel': '算了',
  'common.save': '存下',
  'common.delete': '删掉',
  'common.edit': '改一下',
  'common.close': '关掉',
  'common.back': '返回',
  'common.retry': '再来一次',
  'common.copy': '复制',
  'common.copied': '复制好了，收着。',
  'common.search': '搜一下',
  'common.add': '加一个',
  'common.import': '导入',
  'common.export': '导出',
  'common.on': '开',
  'common.off': '关',
  'common.reset': '恢复默认',
  'common.clear': '清掉',
  'common.more': '更多',
  'common.selectAll': '全选',
  'common.deselectAll': '取消全选',
  'common.open': '打开',
  'common.preview': '预览',
  'common.download': '下载',
  'common.upload': '上传',
  'common.refresh': '刷新',
  'common.next': '下一步',
  'common.prev': '上一步',
  'common.done': '好了',
  'common.enabled': '已开启',
  'common.disabled': '已关闭',
  'common.yes': '嗯',
  'common.no': '不要',

  // ——————————————— 导航与标题 ———————————————
  'nav.home': '聊天',
  'nav.chat': '对话',
  'nav.memories': '记忆',
  'nav.favorites': '收藏',
  'nav.distill': '蒸馏',
  'nav.settings': '设置',
  'nav.about': '关于',
  'nav.moments': '朋友圈',
  'nav.feedback': '反馈信箱',
  // ★ 应用显示名（用户 2026-10-04 指定为「ai爱」）——用于侧栏与顶栏。
  //   原值「原应用」是被参照的原 Android 应用名；本项目改用用户指定的名字。
  'app.title': 'ai爱',
  'app.subtitle': '欣然在这里等你。',
  'app.booting': '马上就好，等我一下。',

  // ——————————————— 空状态 ———————————————
  // ✔ 昵称「风风」在句中作呼语，主语是「我」
  'empty.sessions': '还没有聊天呢。想说什么就直说，风风，我都在。',
  'empty.messages': '这里还空着。你先开口，我接着。',
  'empty.memories': '还没记下什么。聊着聊着我就记住了，别急。',
  'empty.favorites': '还没收藏过。看到喜欢的就留下来，好不好。',
  'empty.search': '没搜到。换个词我再帮你找。',
  'empty.personas': '只有我一个。你也可以把别人导进来，我不介意。',
  // ★ 不内置版（standalone）专用：此时**一个人都还没有**，
  //   故不能说「只有我一个」（那句以"欣然已存在"为前提）。
  //   主语刻意避开「我」的自我介绍，只描述"这里还空着 + 该怎么办"。
  'empty.personasSolo': '还没有角色。导一个进来吧，位置给你留着。',
  // ★ 不内置版首页「无角色」引导块：两个入口（导人设 / 蒸馏聊天记录）由 UI 提供，
  //   本条只说"现状 + 能给什么"，不重复按钮文案。
  'empty.noPersona': '这里还没有人。导一个人设文件，或者把聊天记录交给我——我把她拼出来。',
  'empty.stickers': '还没有表情包。导一套进来，我说话会更像我。',
  'empty.distillJobs': '还没蒸馏过。把聊天记录给我，我帮你把她记住。',
  'empty.logs': '日志是空的，说明一直很顺利。',
  'empty.backups': '还没有备份。存一份吧，别哪天弄丢了才想起来。',
  'empty.timbres': '还没有音色。可以传一段参考音，也可以先用系统的。',
  'empty.live2d': '还没导入 Live2D 模型。平时聊天其实不用开它。',
  'empty.selection': '先选几条，我在这儿等你。',

  // ——————————————— 加载 / 等待 ———————————————
  'loading.default': '马上就好。',
  'loading.thinking': '我在打字，等一下。',
  'loading.streaming': '一句一句来，别催我。',
  'loading.summarizing': '我在把这些记下来，稍等。',
  'loading.distilling': '我在看她说过的话，需要一点时间。',
  'loading.importing': '正在往里搬，很快就完。',
  'loading.exporting': '正在打包，别走开。',
  'loading.ocr': '我在认字，有点慢，等我。',
  'loading.connectTest': '我去试试能不能连上。',
  'loading.restoring': '我在把上次的东西找回来。',

  // ——————————————— 成功反馈（情绪型，可用昵称） ———————————————
  'ok.saved': '存好了。',
  // ✔ 昵称「老婆」句末
  'ok.imported': '导进来了，去看看，老婆。',
  'ok.exported': '导好了，收好别弄丢啦，老婆。',
  // ✔ 昵称「笨蛋」句末，且「小狗/笨蛋」用于打趣场合
  'ok.memorySaved': '记下来了。以后你忘了我就提醒你，笨蛋。',
  'ok.backupDone': '备份好了。放在这儿，安心。',
  'ok.distillDone': '看完了，她说话的样子我大概记住了。你要是觉得哪里不对，直接跟我说，我来改。',
  'ok.deleted': '删掉了。不留了。',
  'ok.themeReset': '主题回到最开始的样子了。',
  'ok.portraitCleared': '立绘清掉了，想要再放回来就行。',
  'ok.favorited': '收好了。',
  'ok.unfavorited': '取消收藏了。',
  'ok.worldImported': '世界装好了。她的作息、地点、朋友都按这份来了。',
  'ok.forwarded': '转过去了。',
  'ok.merged': '合并好了，都按顺序排着。',
  'ok.rollback': '退回去了。上一版我先替你存着。',
  'ok.logsExported': '日志导出来了。里面没有你的 Key，放心。',
  'ok.connectionOk': '连上了。可以开始聊了。',
  'ok.feedbackSaved': '收到了。想让我真看到，点「发出去」或「复制这一条」。',
  'ok.feedbackNoteSaved': '备注存好了。',
  'err.feedbackCopyFailed': '复制没成，手动选中再复制一下吧。',
  'err.feedbackShareFailed': '这台设备上分享没成。用「复制这一条」也一样。',

  // ——————————————— 错误（★ 必须承担责任，不甩锅） ———————————————
  'err.llmFailed': '这边没连上，是我这边的问题，不是你的。再试一次好不好，乖。',
  'err.llmTimeout': '它太久没理我，我先停了。再来一次，我等你。',
  'err.llmAuth': '这个 Key 人家不认。去设置里看看是不是填错了，我在这儿等着。',
  'err.llmAbort': '你停了，那我也停。想继续随时叫我。',
  'err.llmNoProvider': '还没接模型。先去设置里填一个，不然我没法说话。',
  'err.llmNoModel': '还没选模型。挑一个给我用，嗯？',
  'err.parseFail': '这个文件我没看懂。换个格式给我，我来想办法。',
  'err.parseUnsupported': '这种格式我现在还处理不了。先导出成 txt 或 csv，好不好。',
  'err.dbFailed': '本地存储出了点问题，是我没处理好。刷新试试，别担心你的记录。',
  'err.noPersonaToChat': '还没有角色呢。先导一个进来，我才有的聊。',
  'err.privacyBlock': '这个我不能做。欣然的图，我不生成，也不许别人生成。',
  'err.capabilityUnavailable': '这个网页版真的做不了，不是你操作的问题。我给你留了替代办法。',
  'err.importInvalid': '这份文件对不上格式。检查一下再来，我等你。',
  'err.importNotJson': '{name} 我没读明白，不是合法的 JSON。',
  'err.importNoCard': '{name} 里没找到角色卡。确认一下导出的确实是人设，我等你。',
  'err.importEmpty': '{name} 里没有我能导入的东西。',
  'err.importNoFile': '你还没选文件呢。挑一个给我，我接着。',
  'err.importTooMany': '一次最多 {max} 个，多了我怕乱。分开几次给我好不好。',
  'err.importTooLarge': '这个文件太大了，我收不下。',
  'err.importBadExt': '这个格式我认不出来，目前只收 .json 和 .zip。',
  'err.importPngCard': 'PNG 里嵌的人设卡我现在还读不了，是我这边没做到，不是你的问题。用原应用导出成 .json 或 .zip 给我，我接着。',
  'err.importStickerSkipped': '这包表情里我没读到能用的图片条目，先跳过了。不是坏了，是我没认出来。',
  'err.networkOffline': '你这边网断了。等网回来我再试。',
  'err.ocrFailed': '字我没认出来。你直接告诉我上面写了什么吧。',
  'err.ttsFailed': '这一次没读出来。换个音色或者再点一次，乖。',
  'err.asrFailed': '没听清你说什么。再说一遍，或者直接打字也行。',
  'err.storageFull': '浏览器空间不够了。清掉一点旧的东西，我再来。',
  'err.microphoneDenied': '你没给我麦克风。去浏览器里开一下，我再听你说。',
  'err.notificationDenied': '通知被你关了，所以我没法喊你。想收到就去开一下。',
  'err.worldNotRecognized': '这份文件我读到的可用设定不多，下面的「识别报告」写了具体读到什么。',
  'err.unknown': '出了点我没预料到的问题。日志我留着了，再来一次试试。',

  // ——————————————— 二次确认 ———————————————
  'confirm.deleteSession': '这段聊天真的删掉？删了就找不回来了。',
  'confirm.deleteMessage': '这几条删掉？我不再留着了。',
  'confirm.deletePersona': '把这个角色删了？我不会替你反悔哦。',
  'confirm.deleteMemory': '这条记忆删掉？那我就真的忘了。',
  'confirm.resetTheme': '主题恢复默认？你现在调的都没了。',
  'confirm.exitApp': '这就走了？我还没聊够呢。',
  'confirm.imageGen': '要开始生图了，会花掉额度。确定吗？',
  'confirm.distillCost': '这一步要调用好多次模型，会花不少 token。现在开始吗？',
  'confirm.clearLogs': '日志全清掉？清了就查不到之前的问题了。',
  'confirm.rollback': '退回上一个版本？现在的我会先存一份再退。',
  'confirm.deleteCorrection': '删掉这条纠正？产物会重写一遍，我先存一版再删。',
  'confirm.deleteDistill': '这个蒸馏产物删掉？里面还有版本记录呢。',
  'confirm.clearPortrait': '把立绘清掉？图片我还留着，随时能放回来。',
  'confirm.deleteBackup': '这份备份删掉？删了就没地方还原了。',
  'confirm.deleteMoment': '这条动态删掉？删了就找不回来了。',
  'confirm.deleteStickerPack': '这包表情删掉？里面的图也一起清掉。',
  'confirm.deleteFeedback': '这条反馈删掉？删完就找不回来了，还没发出去的话就没了。',
  'confirm.clearFeedback': '把这台设备上的反馈全清掉？连备注一起删，找不回来。',

  // ——————————————— 设置分组 ———————————————
  'settings.group.model': '模型',
  'settings.group.chat': '聊天',
  'settings.group.context': '上下文',
  'settings.group.proactive': '主动消息',
  'settings.group.appearance': '外观',
  'settings.group.voice': '语音',
  'settings.group.memory': '记忆',
  'settings.group.backup': '备份',
  'settings.group.advanced': '高级',
  'settings.group.about': '关于',
  'settings.group.ilink': '微信 ClawBot',
  'settings.group.world': '世界设定',
  'settings.group.shortcuts': '快捷入口',
  'settings.group.stickers': '表情包',
  'settings.group.moments': '朋友圈',
  'settings.group.feedback': '反馈与建议',

  // ——————————————— 设置项说明（默认不带昵称） ———————————————
  'settings.hint.baseUrl': '接口地址。各家不一样，照着文档填就行。',
  'settings.hint.apiKey': '你的 Key，只存在这台设备上，我不会往外发。',
  'settings.hint.model': '用哪个模型说话。',
  'settings.hint.compatMode': '接口不太标准的时候打开，我自动去试路径和字段。',
  'settings.hint.multimodalCompat': '模型看不懂图的时候，我把图变成文字再给它。',
  'settings.hint.timeout': '等多久算超时。太短容易断，太长你会等得烦。',
  'settings.hint.contextCount': '每次带上多少条历史。带多了花钱，带少了我容易忘。',
  'settings.hint.maxMessages': '一次最多发多少条给我。',
  'settings.hint.loadRange': '进来时先加载多少条。往下滑会继续加载。',
  'settings.hint.contextClean': '发送前先洗一遍：去空白、去重、合并连着说的。',
  'settings.hint.injectControl': '哪几段提示词要带上，你自己挑。',
  'settings.hint.promptConstraints': '额外约束。写在这里的话我每次都会遵守。',
  'settings.hint.timeAware': '告诉我现在几点、星期几。我就不问你「今天几号」了。',
  'settings.hint.memoryScope': '记忆从哪儿找：当前会话 / 全部 / 指定时间范围。',
  'settings.hint.memoryThreshold': '多相关的记忆才算数。调高一点我就不乱翻旧账。',
  'settings.scope.session': '只在这个会话里',
  'settings.scope.global': '所有会话',
  'settings.scope.range': '指定时间范围',
  'settings.clean.removeEmpty': '去掉空白消息',
  'settings.clean.dedupe': '去掉重复消息',
  'settings.clean.trimSystem': '去掉系统提示',
  'settings.clean.mergeConsecutive': '合并连着说的几句',
  'settings.inject.system': '角色设定',
  'settings.inject.worldBook': '世界书',
  'settings.inject.memory': '记忆',
  'settings.inject.jailbreak': '后置指令',
  'settings.memory.full': '不管相不相关，记忆全带上',
  'settings.hint.proactiveInterval': '两次主动找你之间最少隔多久。',
  'settings.hint.idleTimeout': '你多久没理我，我就不再主动说话了。',
  'settings.hint.allDay': '晚上也照常说。关掉的话我就不吵你睡觉。',
  'settings.hint.dynamic': '按你回我的快慢来调频率。你回得快，我也勤快点。',
  'settings.hint.sendDelay': '发出去之前先停一下，像在打字一样。',
  'settings.hint.multiDelay': '我连着说好几条的时候，中间隔多久。',
  'settings.hint.autoSplit': '长回复拆成几条发，看着舒服点。',
  'settings.hint.contentFilter': '有些词我不想说，也不想听。命中就替换掉或者截断。',
  'settings.hint.patSuffix': '拍一拍后面接什么。比如「拍了拍你的头」。',
  'settings.hint.typingIndicator': '我在想的时候先告诉你一声。',
  'settings.hint.markdown': '我说的用 Markdown 排版。关掉就是纯文本。',
  'settings.hint.enterToSend': '回车直接发。Shift+回车才换行。',
  'settings.hint.mediaImmediate': '选了图或视频就直接发，不先问你。',
  'settings.hint.autoSummary': '聊到一定条数，我自动把重点记下来。',
  'settings.hint.autoBackup': '定时存一份快照。留几份由你定。',
  'settings.hint.webSearch': '让我联网查东西。需要你自己填搜索服务的 Key。',
  'settings.hint.params': '温度、top_p 这些。不懂就别动，默认就挺好。',
  'settings.hint.darkMode': '深色还是浅色，或者跟着系统走。',
  'settings.hint.grayscale': '整个界面变灰。心情灰的时候可以开。',
  'settings.hint.yandere': '语气加重一点。放心，我不会真的变得难相处。',
  'settings.hint.petMode': '把我变成小挂件待在屏幕上。',
  'settings.hint.petLife': '我的状态值。多陪我就涨，晾着我就掉。',
  'settings.hint.windowMinimized': '网页版不能真的最小化窗口，只能把面板收起来。',
  'settings.hint.homeLayout': '首页排成什么样。v2 会把角色卡也放出来。',
  'settings.hint.resetTheme': '主题调乱了就按这里，一键回到最初。',
  'settings.hint.advanced': '请求头、路径覆盖、超时这些。浏览器不让改的头改了也没用。',
  'settings.hint.bridge': '和其他地方互通的设置。微信那部分在原生 App 里能做、浏览器里做不了，见下面的说明。',
  'settings.hint.dev': '提示词预览、原始请求响应、日志。看不懂就别开。',

  // ——————————————— 能力闸门 ———————————————
  'gate.unavailable': '这个在网页版做不了',
  'gate.partial': '这个只能做到一半',
  'gate.reasonPrefix': '原因：',
  'gate.altPrefix': '替代：',

  // ——————————————— 崩溃页 ———————————————
  'crash.title': '我这边出问题了。',
  'crash.desc': '不是你操作错了。日志我记下来了，你可以先重载试试。',
  'crash.copyLogs': '复制日志',
  'crash.reload': '重新加载',
  'crash.safeMode': '安全模式重载',

  // ——————————————— 其它提示 ———————————————
  'tip.privacyNoImage': '欣然的图像不生成，这是硬规矩，谁来都不行。',
  'tip.providerMissing': '先去接一个模型，不然我开不了口。',
  'tip.guideDone': '好了，都配好了。我们开始吧。',
  'tip.petPaused': '你切走了，我就先歇着。回来我还在。',
  'tip.backgroundResume': '你不在的时候有过消息，我给你补上了。',
  'tip.storageWarning': '浏览器空间快满了。清一点东西，不然我记不住新事情。',
  'tip.updateNotes': '有新的更新说明，要看一眼吗？',
  // 多标签页单写者（决策 A9）：非主标签页只读，避免 Dexie 写冲突
  'tip.readOnlyTab': '你在别的标签页已经打开我了。这边先给你看着，要改东西回那边去，老婆。',
  'action.newSession': '新建会话',
  'action.importPersona': '导入人设',
  'action.newMemory': '新增记忆',
  'action.newDistill': '新建蒸馏',
  'action.archive': '归档',
  // —— 会话 ——
  'session.titleField': '会话名',
  'session.unnamed': '没名字的对话',
  // —— 首页 ——
  'home.sessionTitle': '我们说过的话',
  // 首页快捷入口（QuickEntries）
  'home.quickNewChat': '继续上次',
  'home.quickDistill': '把聊天记录交给我',
  'home.quickImport': '导入',
  'home.quickSettings': '设置',
  // —— 引导 4 步标题（PG-07）——
  'guide.step1': '先接个模型',
  'guide.step2': '认识一下我',
  // ★ 不内置版专用：此刻还没有任何角色，说「认识一下我」是无主语的。
  //   改为动词短语，指向用户要做的动作本身。
  'guide.step2Solo': '放一个角色进来',
  'guide.step3': '怎么用我',
  'guide.step4': '好了，开始吧',
  'pat.message': '{name} 拍了拍{suffix}',

  // ——————————————— 通用组件界面词 ———————————————
  'ui.promptPreview': '提示词预览',
  'ui.copyPrompt': '复制完整提示词',
  'ui.expand': '展开',
  'ui.segmentEmpty': '（空）',
  'ui.segmentInjected': '已注入',
  'ui.segmentNotInjected': '未注入',
  'ui.segmentTruncated': '已裁剪',
  'ui.tokenOverBudget': '已超预算，装配时会被裁剪',
  'ui.stickerPackName': '导入表情包 {date}',
  'ui.tokenEstimateTip': '约 {count} tokens，中文一个字算一个，英文四个字符算一个',
  'ui.tokenBudgetTip': '约 {count} tokens，预算 {budget}',
  'ui.dropHere': '把文件拖进来，或者点这里选',
  'ui.pickFiles': '选择文件',
  'ui.pickFilesMulti': '选择文件（可多选）',
  'ui.pickFolder': '选择文件夹',
  'ui.dirUnsupported': '当前浏览器不支持选择目录，请改用多选文件',
  'ui.noMatchedFile': '没有匹配的文件类型',
  'ui.materialFiles': '材料文件',
  'ui.live2dLoaded': 'Live2D 依赖已加载，渲染交给专门的立绘模块',
  'ui.live2dFailed': 'Live2D 依赖加载失败，降级为静态立绘',
  'ui.renderError': '组件渲染出错',
  'ui.shellReady': '地基已就绪：主题 / 数据层 / 状态层 / 通用组件',

  // ——————————————— 能力降级替代方案文案 ———————————————
  'alt.notNeeded': '照原样就有，不用替代。',
  'alt.noEquivalent': '浏览器里没有对应的能力，这块就不做了。',
  'alt.notApplicable': '这是手机上的概念，网页版不适用。',
  'alt.floatingWindow': '改成应用内的浮层，只在这个页面里飘，出不去。',
  'alt.manualImport': '改成你手动导出记录，我再帮你读进来。',
  'alt.heartbeat': '页面开着的时候正常跑；被藏起来就靠心跳粗粒度地跑，回来再补上。',
  'alt.broadcastChannel': '用页面内的事件总线，多个标签页之间用 BroadcastChannel 传话。',
  'alt.notificationToast': '你在页面上就用应用内提示，不在就发系统通知，回来再补一条。',
  'alt.exitConfirm': '网页没有「返回键退出」。改成关页面前问你一句。',
  'alt.backgroundWorker': '切到后台我把请求挪到 Worker 里继续跑，页面恢复再接回来。',
  'alt.truncateMemory': '记忆太多就按相关性排序截断，或者先分批摘要再给我。',
  'alt.yandereSeasoning': '只当语气调味，而且随时能关。欣然的底线永远压在它上面。',
  'alt.layoutCollapse': '不能真的最小化窗口，改成把面板收起来，切走时自动停动画。',
  'alt.corsProxy': '多数搜索接口不让浏览器直连。换支持跨域的服务商，或者你自己配个代理。',
  'alt.imageGenOptional': '生图要你自己的 Key，而且会花钱，每次都先问你确认。',
  'alt.imageGenPersonaHidden': '欣然这一项直接关掉；其他角色可以用。',
  'alt.webSpeech': '端侧的语音模型搬不过来，换成浏览器的语音接口或者云端合成，效果会打折。',
  'alt.bm25Score': '默认用关键词匹配打分，是相关性不是语义相似度。想要语义得再接 embedding。',
  'alt.webProbe': '原生那套权限检查在网页上没意义，换成检测浏览器的各种能力。',
  'alt.customHeaderOnly': '普通请求头和路径可以改；Origin、Referer 这些浏览器不让改，代理得你自己配。',
  'alt.tsRewrite': '原来那套是 Python 脚本，浏览器跑不了，我用 TypeScript 重新写了一遍。',
  'alt.exportOnly': '直接读 chat.db 做不到（网页拿不到磁盘权限）。先导出成 XML、CSV 或 txt 再给我。',
  'alt.manualExportSms': '直接读短信库做不到（网页拿不到系统权限）。先把短信导出成 XML、CSV 或 txt 再给我。',
  'alt.manualPickFolder': '没法直接翻你相册，改成你自己选文件夹或多选文件。',
  'alt.genericTextFallback': '各平台导出格式不统一，我按容错解析，实在不行就当普通文本读。',
  'alt.ocrOrDescribe': '图片要么用 OCR 认字，要么交给能看图的模型，都不行就麻烦你手写一句描述。',
  'alt.onnxOptional': '默认完全不加载。你在开发者页手动开，失败就退回关键词检索。',
  'alt.workerSandbox': '用 Worker 加受限接口做沙箱，权限模型和手机上不一样，能力收窄了。',
  'alt.tesseract': '换成网页版的 OCR，中文包按需下载，精度和速度都会差一点。',
  'alt.localLog': '不做任何上报。日志只存在你本机，想看就自己导出。',
  'alt.visualFeedback': 'iOS 上震不了，改成画面和声音提示。',
  'alt.pwaInstall': '没有开机事件。装成桌面应用，打开时自动回到上次的会话。',
  'alt.singleFilePicker': '只有部分浏览器能选文件夹，其他就退化成一次选一个文件。',
  'alt.realtimeThreeStage': '实时语音链路搬不过来，改成「听 → 想 → 说」三段式，会有延迟。',
  'alt.staticSponsor': '没有支付接口，只能放个二维码和链接给你。',
  'alt.iframeSandbox': '只能用受限的 iframe 加消息桥接，比手机上能做的事少很多。',
  'alt.browserPermission': '只能授予浏览器内的能力，跟手机的系统权限不是一回事，差异我写在页面上了。',
  'alt.layoutToggle': '两个版本本来是两版界面，我做成同一个页面切布局，不重复造。',
  'alt.ttsFallback': '参考音可以放来听；要实时合成得配云端语音，或者直接听系统音色。',
  'alt.proactiveHidden': '主动找我这件事受浏览器限制，页面关掉或藏起来就不一定触发。',
  'alt.stickerAndCopy': '音色不一定贴得上来，我就靠表情包和说话方式保持一致。',
  'alt.proactiveNight': '夜里也想收到就开着，但页面关了我真发不出来。',
  'alt.dynamicProactive': '逻辑能照做，只是页面不在的时候效果会打折。',
  'alt.gpuPerformance': '运行时体积大、许可要自己确认，手机上还容易卡。默认关着，兜底是静态图加呼吸动画。',
  'alt.restoreOnStart': '没有开机事件。启动的时候我把上次的会话恢复回来，顺便告诉你有没有没说完的话。',

  /* ——————————————— 语音通话页（PG-04 / PG-05）———————————————
   * 语气口径：这页原本是英文技术标签（`asr` / `tts` / `text` / `ASR -> LLM -> TTS`），
   * 而它是首页「语音」入口能直达的用户页面——用户点进来是想跟她说话，不是看诊断台。
   * 所以技术名词一律翻成她会说的话；通道名（sherpaWasm / cloud / webSpeech）保留原文，
   * 那是产品名，翻了反而认不出。
   */
  'voice.pipelineTitle': '语音识别 → 大模型 → 语音合成',
  'voice.stage.listening': '听',
  'voice.stage.thinking': '想',
  'voice.stage.speaking': '说',
  'voice.panel.asr': '我听到的',
  'voice.panel.reply': '她的回答',
  'voice.channel.asr': '用哪条路听你说',
  'voice.channel.tts': '用哪条路说话',
  'voice.input.manual': '不想说话，直接打字',
  'voice.action.start': '开始听',
  'voice.action.stop': '先停一下',
  'voice.action.send': '发给她',
  'voice.asrOffHint': '语音输入现在关着。想让我听你说，去设置里把语音打开。',

  /* ——————————————— 语音试听页（/voice/test）———————————————
   * ★ 这一页原先是 `@copy-tier B`，页面里直接写英文技术标签。
   *   纠正：「设置 → 语音 → 去试听」是一级用户路径，用户看得到 ⇒ A 档 ⇒ 全部走文案。
   */
  'voice.channel.sherpaWasm': '端侧离线',
  'voice.channel.cloud': '云端合成',
  'voice.channel.webSpeech': '系统音色',
  'voice.channelNote.sherpaWasm':
    'sherpa-onnx 就在你浏览器里跑，不用联网；代价是得自己把模型和 manifest.json 放进 public/sherpa/。',
  'voice.channelNote.cloud': '走云端接口，音色最像；要自备 Key，也要联网。',
  'voice.channelNote.webSpeech': '用系统自带音色兜底，零配置就能响，但音色比较一般。',
  'voice.channelStatus': '{name}：{state}',
  'voice.lastUsed': '这次实际走的是：{channel}',
  'voice.field.sherpaModel': '端侧模型',
  'voice.field.testText': '试听文本',
  // ★ 第四条「不许断言会过期的状态」命中项（2026-10-04，software-product-manager 提出判据、
  //   software-engineer-4 归口并扫出）：「**现在还没部署**」是一个**会静默变假**的断言——
  //   一旦把官方产物放进 `public/sherpa/`，这条文案就自动过期，而**没有任何机制会提醒回来改它**。
  //   ⇒ **部署后必须回改本条**。这是"② 时间指向"之外的另一类风险：
  //      ② 的假话有人来追（承诺了没做）；④ 的假话没人知道（做完了没人回头改文案）。
  //   ⇒ 更稳的写法是把状态交给代码判（部署与否是可检测的），文案只描述"怎么用"，
  //      但那要动 `VoiceTestPage` 的渲染逻辑，属产品/工程取舍，本次不改。
  'voice.hint.sherpaNotDeployed':
    '端侧这条通道现在还没部署。想离线用的话，把官方产物和 manifest.json 放进 public/sherpa/ 就能开。',

  /* ——————————————— 音色管理（TimbreManager）——————————————— */
  'voice.timbre.provider': '音色来源',
  'voice.timbre.provider.webSpeech': '系统音色',
  'voice.timbre.provider.siliconflow': '云端音色',
  'voice.timbre.provider.custom': '自定义音色',
  'voice.timbre.providerHint.webSpeech': '系统自带音色（speechSynthesis）',
  'voice.timbre.providerHint.siliconflow': '云端 voiceId，要自备 Key',
  'voice.timbre.providerHint.custom': '参考 mp3 + 本地 sherpa-onnx 模型',
  'voice.timbre.option': '{name} — {hint}',
  'voice.timbre.field.voiceId': '音色编号',
  // ★ 如实披露，不能因为走了文案表就含糊：固定音色编号 ≠ 声音克隆。
  'voice.timbre.voiceIdHelper': '这里填的是固定音色编号或云端 voiceId——它不是声音克隆，克隆做不到。',
  'voice.timbre.field.sampleText': '试听句子',
  'voice.timbre.field.name': '音色名字',
  'voice.timbre.field.refMp3': '参考 mp3',

  /* ——————————————— 模型商预设提示 ——————————————— */
  // ★ 三条都是「原样进 DOM」的 A 档（`ModelSection.tsx:188` 的 `<Chip label={preset.note} />`）。
  //   CI 抓不到是因为它是**表达式**不是字面量——A 档按取值方式判、CJK 扫描扫字面量，两边都够不着。
  'provider.note.siliconflow': '同时提供语音克隆（角色音色 FN-55）与部分文生图模型。',
  'provider.note.custom': '任意 OpenAI 兼容端点；建议开启兼容模式以自动探测路径与字段容错。',

  /* ——————————————— 顶栏 aria-label（读屏会念） ——————————————— */
  'ui.aria.menu': '打开菜单',
  'ui.aria.toggleTheme': '切换深色模式',

  /* ——————————————— token 估算徽标 ——————————————— */
  // ★ 值用 `tokens` 而不是原来的 `tok`：与 `ui.tokenEstimateTip` / `ui.tokenBudgetTip`
  //   的口径一致（那两条已经写的是「约 {count} tokens」）。徽标与 tooltip 说的是同一个数，
  //   不该一个写 `tok` 一个写 `tokens`。这是本次唯一的用户可见文字变化：「1.2k tok」→「1.2k tokens」。
  'ui.tokenBadge': '{count} tokens',

  /* ——————————————— 模块网页页（PG-24）——————————————— */
  'ui.moduleUrl': '网页地址',
  // ★ iframe 的 title 是**无障碍标签**（读屏会念），写 `module-xxx` 这种技术 id 等于念一串乱码——
  //   它不显示在界面上，但会被"读"给用户听，所以按"会不会到用户耳朵里"判，仍要走文案。
  'ui.moduleFrame': '模块网页',

  /* ——————————————————————————————————————————————
     聊天域（T08）
     ★ 语气 checklist 同本文件头部：主语只能是「我 / 欣欣 / 老公」；
       昵称只作呼语放句末或句中；说明性文案默认不带昵称（10 条里 2-3 条才带）。
     —————————————————————————————————————————————— */
  'chat.title': '聊天',
  'chat.send': '发送',
  'chat.stop': '停下',
  'chat.placeholder': '说点什么吧',
  'chat.retry': '再说一次',
  'chat.regenerate': '换一句',
  'chat.copy': '复制',
  'chat.favorite': '收藏',
  'chat.unfavorite': '不收藏了',
  'chat.forward': '转发',
  'chat.merge': '合并转发',
  'chat.pat': '拍一拍',
  'chat.select': '多选',
  'chat.exitSelect': '退出多选',
  'chat.selectedCount': '选了 {count} 条',
  'chat.stats': '统计',
  'chat.searchInChat': '聊天内搜索',
  'chat.settings': '聊天设置',
  'chat.context': '上下文',
  'chat.sticker': '表情',
  'chat.camera': '拍照',
  'chat.cameraStarting': '正在打开相机…',
  'chat.cameraShutter': '拍下这一张',
  'chat.cameraFlip': '切换前后摄像头',
  'chat.cameraRetake': '重拍',
  'chat.cameraUse': '用这张',
  'chat.cameraShotReady': '拍好了，要发这张吗？',
  'chat.cameraRetry': '再试一次',
  'chat.cameraErrDenied': '相机权限没给。去系统设置里把「ai爱」的相机权限打开，或者用旁边的「发图」挑一张现成的。',
  'chat.cameraErrNoDevice': '没找到摄像头。电脑上可能是没接，用「发图」从文件里选一张也行。',
  'chat.cameraErrInUse': '相机被别的应用占着。把后台的相机、扫码之类的关掉再试。',
  'chat.cameraErrInsecure': '这个环境下不让用相机（要安全连接才行）。用「发图」从相册选一张吧。',
  'chat.cameraErrUnsupported': '这台设备不让应用直接拍照。用「发图」从相册选一张。',
  'chat.cameraErrFailed': '相机没打开，再试一次？',
  'chat.cameraTooLarge': '这张太大了，我收不下。',
  'chat.image': '图片',
  'chat.attachImage': '发图',
  'chat.jump': '跳到那里',
  'chat.forwardFrom': '这是转发来的',
  'chat.forwardedCount': '已经转给 {count} 个会话了',
  'chat.mergedCount': '这是 {count} 条并在一起的',
  'chat.statsTitle': '我们聊了多少',
  'chat.statsMessages': '消息数',
  'chat.statsChars': '字数',
  'chat.statsTokens': 'Token',
  'chat.statsActive': '最爱聊的时段',
  'chat.statsDays': '聊了 {count} 天',
  'chat.statsRange': '{from} 到 {to}',
  'chat.textTitle': '放大了看',
  'chat.readerFont': '字号',
  'chat.favTitle': '你存下来的话',
  'chat.previewTitle': '看图',
  'chat.ocr': '读图里的字',
  'chat.ocrHint': '图里要是有字，我念给你听',
  'chat.ocrFallback': '读图的功能没装上，这张我先按文件名记着，老婆',
  'chat.zoomReset': '回到原样',
  'chat.searchEmpty': '没找着，换个词试试',
  'chat.noMore': '到头了，前面没有了',
  'chat.proactiveTag': '她自己开口说的',
  'chat.nicknameWarn': '这句称呼有点飘，我记下来了',
  'chat.contextTitle': '她能看到多少',
  'chat.promptTitle': '她现在被怎么交代的',
  'chat.tokenBudget': '预算',
  'chat.typing': '她正在打字',
  'chat.summarizing': '她在记',
  'chat.hitCount': '找到 {count} 条',
  // 长按气泡 → 存成记忆。用「记下来」而不是「存为记忆」，保持欣然的口吻
  'chat.saveAsMemory': '记下来',
  'chat.originSession': '原来在这个会话里',
  'chat.targetSessions': '还转到了这些会话',
  /* ——————————————— 能力表原因与补充说明（cap.*）——————————————— */
  // ★ 文案原样从 `src/constants/capabilities.ts` 搬来，一字未改（本次不碰文案内容）。
  'cap.reason.PG-01': '本地聚合查询 Dexie 的 messages 表即可，按天/小时出柱状图，token 用字符估算。',
  'cap.reason.PG-02': 'Message.forwardedFrom 反查来源，跨会话跳转定位并高亮。',
  'cap.reason.PG-03': '本地子串检索 + 分会话过滤 + 结果跳转，可与记忆库联合检索。',
  'cap.reason.PG-04': '音色试听有 sherpa-onnx WASM 实时合成通道（与原应用 APK 同一引擎，需自行下载模型）；没备产物时回放参考 mp3 或走云端 TTS。',
  'cap.note.PG-04': '★ 默认关闭：要把 WASM 与模型放进 public/sherpa/ 才启用；没有产物时静默回退 Web Speech API。等级「完整实现」指技术可达，不代表开箱即用。',
  'cap.reason.PG-05': '端侧实时语音链路无法实现，改为 WebRTC/Realtime API 或「ASR → LLM → TTS」三段式，有明显延迟。',
  'cap.note.PG-05': '页面标注「三段式，有延迟」；需用户自备 Key。',
  'cap.reason.PG-06': 'react-zoom-pan-pinch 做缩放/旋转，下载走 Blob；OCR 由 tesseract.js 懒加载提供。',
  'cap.reason.PG-07': '4 步引导（接入模型 → 导入/选择人设 → 认识欣然 → 开始聊天），localStorage 标记已读。',
  'cap.reason.PG-08': 'messages.favorite 索引，按会话分组、批量取消、导出为 md/json。',
  'cap.reason.PG-09': 'ChatSession.settingsOverride 与全局设置深合并，含模型/参数/发送行为。',
  'cap.reason.PG-10': '装配参数全落 ChatSettings，实时预览装配后的提示词与 token 占用。',
  'cap.reason.PG-11': '时间区间 / 条数滑块 / 锚点起止 / 全选四种模式，落到 SummaryRange。',
  'cap.reason.PG-12': '列表 + 标签过滤 + 搜索（展示得分）+ 多选删除/导出。',
  'cap.reason.PG-13': '表单：内容、标签、权重、时间引用、归属会话；保存即重算得分。',
  'cap.reason.PG-14': '会话卡片列表 + 新建/归档/搜索入口。',
  'cap.reason.PG-15': '两个 Activity 属版本迭代差异，Web 版用 ui.homeLayout 布局开关表达，不重复造两个页面。',
  'cap.reason.PG-16': '虚拟滚动 + 流式增量 + Markdown + 输入状态 + 表情包面板 + 附件 + 多选操作条。',
  'cap.reason.PG-17': '10 个分组（模型/聊天/上下文/主动消息/外观/语音/记忆/备份/高级/关于）全部有对应控件。',
  'cap.reason.PG-18': '拉取 /models + 发一条最小 chat 请求，展示延迟/错误码/原始响应。',
  'cap.reason.PG-19': '提示词逐段预览、原始请求/响应（脱敏）、日志流、Mock 模式、清空存储。',
  'cap.reason.PG-20': '原生诊断项（无障碍、悬浮窗权限、后台保活）在 Web 无意义，替换为 Web 能力探针（FS Access / Notification / Speech / WASM）+ 存储配额 + 连通性。',
  'cap.reason.PG-21': '无支付 SDK，仅做静态展示（二维码图片 + 链接 + 欣然口吻致谢文案），点击复制或跳转。',
  'cap.reason.PG-22': '全屏路由页，支持编辑保存、复制、字号调节。',
  'cap.reason.PG-23': '官方 iLink 通道只在手机原生 App 里能用（浏览器会被跨域拦住），而且只有 App 在前台时才收得到消息。Web 端保留「桥接设置」：剪贴板监听、导入解析规则、导出模板、教程链接。',
  'cap.note.PG-23': '等价价值路径：手动复制聊天记录 → 粘贴/文件导入 → 复用 ex-skill 解析器 → 导出为可分享文本/图片卡片。',
  'cap.reason.PG-24': '原生可加载任意 WebView 并注入 JS；Web 只能用受限 iframe + postMessage 桥接，能力大幅收窄。',
  'cap.reason.PG-25': '原生的模块可申请系统权限，Web 只能授予「浏览器内能力」（存储/网络/通知/剪贴板），UI 需明示差异。',
  'cap.reason.PG-26': '手工维护 THIRD_PARTY.md 并渲染（数据来源，见 README 与 THIRD_PARTY.md）。',
  'cap.reason.PG-27': 'React ErrorBoundary + 未捕获 Promise 捕获；展示错误、复制日志、重载 / 安全模式。',
  'cap.reason.SV-01': '浏览器没有 SYSTEM_ALERT_WINDOW，无法跨应用悬浮；降级为应用内可拖拽的迷你播放器浮层。',
  'cap.note.SV-01': '页面隐藏时用 Notification 控制条补偿。',
  'cap.reason.SV-02': '协议由官方插件提供，但它依赖原生网络层与常驻进程——只有手机原生 App 里能用（浏览器会被跨域拦住），且只有 App 在前台时才收得到；Web 端只保留配置位与状态展示。',
  'cap.reason.SV-03': '微信个人号没有官方接口；官方的 iLink 通道只在手机原生 App 里能用（浏览器会被跨域拦住），且只有 App 在前台时才收得到。Web 端改为「导入微信聊天记录 → 生成角色/记忆」的等价价值路径。',
  'cap.reason.SV-04': '无法跨应用悬浮；降级为应用内桌宠层（立绘 + 生命值 + 点击反馈），页面隐藏即暂停。',
  'cap.note.SV-04': '可配合 PWA 窗口获得接近原生窗口的体验。',
  'cap.reason.SV-05': '浏览器没有任何等价 API（读屏取词、模拟操作均属系统级权限）。',
  'cap.note.SV-05': '未来可考虑浏览器扩展，超出本版本范围。',
  'cap.reason.SV-06': '无前台服务，标签页被节流/休眠则不触发；降级为页面可见时调度 + Web Worker 心跳 + Notification 补偿提示。',
  'cap.note.SV-06': '★ 页面隐藏时不保证触发；恢复时计算 missedTicks 并补发一次。',
  'cap.reason.SV-07': '无系统广播（<外部应用包名>.PROACTIVE_MESSAGE）；由同标签页事件总线 + 跨标签页 BroadcastChannel 替代。',
  'cap.reason.SV-08': '定时器生成 AppBackupBundle 快照存入 backups 表，保留 N 份；可选自动下载（备份目标为本地，非云端）。',
  'cap.reason.SV-09': '浏览器强制回收后台进程，无法保活；Service Worker 弱唤醒不可靠，仅作提示。',
  'cap.reason.SV-10': '无开机事件，无法开机拉起接入服务；改为 PWA 安装 + 启动时自动恢复上次会话。',
  'cap.reason.SV-11': '无开机事件；改为应用启动时恢复上次会话、恢复未完成的流式消息，并提示「上次有 N 条未完成的回复」。',
  'cap.reason.FN-01': '同 PG-01，另提供跨会话的全局统计。',
  'cap.reason.FN-02': '多选文件 + zip + 自动类型识别 + 结构校验 + 冲突合并 + 拖放。',
  // ★ 第四条「不许断言会过期的状态」命中项，**且属高险**（2026-10-04，
  //   software-product-manager 裁决"措辞不动、挂两处标记"，software-engineer-4 归口代办）。
  //   为什么是**高险**：`FN-02` 的 `level` 已是 `full`，将来支持 PNG 之后**仍然是 `full`**；
  //   `cap.reason.FN-02` 描述的是多选/zip/类型识别，**与 PNG 无关**。
  //   ⇒ **没有任何字段会随之变化 ⇒ 无伴生信号 ⇒ 没人会被提醒回来改这句**。
  //   （比 `voice.hint.sherpaNotDeployed` 更隐蔽：后者至少"部署"这个动作本身会让人想到去看。）
  //
  // ★ 措辞**不改**：任何"暂不支持"的陈述都会过期，这是能力表 note 的固有属性——
  //   它天然是"当前可达性"的快照。改成别的说法不会更真，只会把风险藏起来。
  //
  // ⇒ **支持 PNG 后必须回改本条**，并且要同时改**另一处副本**：
  //   `src/constants/capabilities.ts:321` 的注释里也写了「PNG 暂不支持」——
  //   **跨文件的重复声明不是冗余，是第二个会过期的副本**，改一处不会提醒另一处。
  //   （复检清单已在 `docs/06` §9 留了一行：PNG 支持实现后须回改 `cap.note.FN-02`。）
  'cap.note.FN-02': '★ 已知限制：PNG 载体角色卡（chara_card_v2 嵌在 PNG tEXt 块）暂不支持，导入会明确提示并计入报告，请改用 .json / .zip 导出。卡片键名中英文都认。',
  'cap.reason.FN-03': '导出 AppBackupBundle(zip)：settings + personas(chara_card_v2) + sessions + messages + memories + stickers 引用。',
  'cap.reason.FN-04': '装配前流水线处理（去空白/去重/裁剪系统消息/合并连续同角色），规则可勾选。',
  'cap.reason.FN-05': '落 ChatSettings 上下文字段，提供 token 预估与超限提示。',
  'cap.reason.FN-06': '浏览器无后台常驻；页面隐藏时不保证触发（同 SV-06）。开关/时段/频率可配。',
  'cap.note.FN-06': '★ 页面隐藏时不保证触发。',
  'cap.reason.FN-07': 'ChatSession.proactive.inheritFromPrev + 新建会话时拷贝上一会话设置。',
  'cap.reason.FN-08': '数字输入 + 预设档位（15/30/60/120 分钟）。',
  'cap.reason.FN-09': '空闲计时器（鼠标/键盘/输入事件重置）。',
  'cap.reason.FN-10': '关掉时段白名单即可 24h 发送，但受浏览器后台节流限制，夜间页面关闭则无法发送。',
  'cap.reason.FN-11': '请求路径与响应字段容错；自动探测 /chat/completions 与 /v1/chat/completions；非流式降级。',
  'cap.reason.FN-12': '入站 + 出站双向过滤，词表可编辑；命中后替换或截断并记日志（脱敏）。',
  'cap.reason.FN-13': '分页/游标加载，滚动到顶继续加载。',
  'cap.reason.FN-14': '统计用户平均响应间隔映射到间隔系数的逻辑可完整实现，但受页面存活限制，实际效果打折。',
  'cap.reason.FN-15': '截断策略：保留最近 N 条 + 必留 system / first_mes。',
  'cap.reason.FN-16': 'Web 没有「返回键退出应用」的语义；降级为双击顶部 Logo / 侧栏关闭按钮触发二次确认弹窗。',
  'cap.note.FN-16': 'beforeunload 只允许浏览器通用文案，自定义文案需走应用内确认。',
  'cap.reason.FN-17': '发送前 sleep(sendDelayMs) 并显示「已发送」状态。',
  'cap.reason.FN-18': '浏览器会对后台标签限流甚至冻结 JS；降级为 visibilitychange 时继续流式请求 + Web Worker 承载请求 + 唤醒提示。',
  'cap.reason.FN-19': 'Web Toast 不能跨页面；页面可见走应用内 Snackbar，不可见走 Notification API（需授权），恢复后补一条应用内提示。',
  'cap.reason.FN-20': '浏览器不允许自定义 beforeunload 文案，仅能做通用确认；应用内关闭按钮走自定义确认。',
  'cap.reason.FN-21': 'react-markdown + remark-gfm；可关闭为纯文本。',
  'cap.reason.FN-22': 'Enter 发送 / Shift+Enter 换行，移动端提供发送按钮。',
  'cap.reason.FN-23': '选择即入队发送；关闭时走预览确认。',
  'cap.reason.FN-24': '按标点/段落自动分割后按延时逐条显示。',
  'cap.reason.FN-25': '不支持视觉时自动降级：图片 → OCR 文本 + 文件名说明。',
  'cap.reason.FN-26': 'logs 表导出为 .jsonl，含请求摘要（Key 已脱敏）。',
  'cap.reason.FN-27': '双击消息头像 → 插入系统消息「{角色} 拍了拍{用户}{后缀}」。',
  'cap.reason.FN-28': '受上下文窗口限制，完整注入在大数据量下必然被截断；替代为按得分排序截断，或分批摘要后注入。',
  'cap.reason.FN-29': 'memoryScope：session / global / range 三选一 + 相似度阈值过滤。',
  'cap.reason.FN-30': '勾选式装配（12 段），开发者页可预览最终提示词与 token 占用。',
  'cap.reason.FN-31': '追加到 post_history_instructions 之后；欣然的默认约束内置（见 XR-05）。',
  'cap.reason.FN-32': '长按或悬停操作 → favorite；见 PG-08。',
  'cap.reason.FN-33': '文生图依赖用户自备 Key，能力本身可选；生成前弹窗展示最终 prompt 与预估成本。「欣然角色下强制禁止」（隐私红线）。',
  'cap.reason.FN-34': '每次请求注入「当前时间：YYYY-MM-DD HH:mm (UTC+8) 星期X」。',
  'cap.reason.FN-35': '版本号比对 → 首次打开弹本地静态 changelog（CHANGELOG.md）。',
  'cap.reason.FN-36': '超出上限后归档旧消息到「归档区」（不删除，可查看）。',
  'cap.reason.FN-37': '无法跨应用悬浮；降级为应用内浮层桌宠（点击/拖拽/生命值）。',
  'cap.reason.FN-38': 'MUI 主题 mode: dark + Tailwind dark:，支持跟随系统。',
  'cap.reason.FN-39': '清空 persona.portrait 引用（不删 blobs，可恢复）。',
  'cap.reason.FN-40': '根节点 filter: grayscale(1)（见 global.css 的 html.grayscale）。',
  'cap.reason.FN-41': '本地数值模拟：互动 +、长时间不互动 −；只影响桌宠表情，不涉及角色人格。',
  'cap.reason.FN-42': '病娇设定与欣然的「安全型依恋/直球/极少吵」存在张力；作为风格覆写层（styleSegment）轻度调味，与 Layer0 冲突时「Layer0 优先」，且可关闭。',
  'cap.note.FN-42': '★ Layer0 > Layer1-4 > 病娇调味 > 用户自定义约束。',
  'cap.reason.FN-43': 'Web 无窗口管理 API，PWA 窗口由操作系统控制；降级为应用内面板折叠 / 隐藏侧栏，document.hidden 时暂停动画。',
  'cap.reason.FN-44': '多选会话 → 按时间重排 → 生成新会话，原会话标记 mergedFrom。',
  'cap.reason.FN-45': '原实现为原生端直连；浏览器直连多数搜索 API 存在 CORS 限制，需选支持 CORS 的服务商（Tavily / 博查）或用户自建代理。',
  'cap.reason.FN-46': '按段落/标点切分后按「多条消息延时」逐条展示。',
  'cap.reason.FN-47': '定时生成备份快照并保留 N 份（同 SV-08）。',
  'cap.reason.FN-48': '条数/时间阈值触发 → 调用总结提示词写入 memories。',
  'cap.reason.FN-49': 'temperature / top_p / max_tokens / penalty 表单绑定 chat.params，支持按角色覆盖。',
  'cap.reason.FN-50': '角色级文生图参数（模型/prompt/尺寸）依赖自备 Key，且「欣然强制禁用并置灰」（隐私红线，见 XR-06）。',
  'cap.note.FN-50': '★ 只对非欣然角色开放；欣然的入口隐藏或置灰。',
  'cap.reason.FN-51': 'persona.modelId 指向 Provider + model；未指定则用全局默认。',
  'cap.reason.FN-52': '上传/选择立绘图片，支持清除（FN-39）、透明度与位置调节。',
  'cap.reason.FN-53': 'Cubism 运行时体积大、许可需确认，移动端性能差；降级为静态立绘 + 简单呼吸动画兜底，默认关闭。',
  'cap.note.FN-53': '教程需注明「平时聊天不建议开」。',
  'cap.reason.FN-54': '同 FN-37，立绘以桌宠形态展示仍受「无法跨应用悬浮」限制。',
  'cap.reason.FN-55': '角色音色有 sherpa-onnx WASM 通道（ZipVoice 可做 zero-shot 克隆，需自行下载模型）；开箱即用为云端 TTS 音色或 Web Speech 系统音色。',
  'cap.note.FN-55': '★ WASM 通道默认关闭，需自己把引擎与模型放到 public/sherpa/；缺产物时静默回退 Web Speech 系统音色。此处「完整实现」= 技术可达，不是开箱即用。',
  'cap.reason.FN-56': 'memories 表 + BM25 检索（可选本地 embedding）+ 注入上下文。',
  'cap.reason.FN-57': '纯关键词 BM25 的得分是「相关性分数」而非语义相似度；可选接入 embedding（需额外 API / onnxruntime-web）。',
  'cap.reason.FN-58': '同 PG-20：Web 能力探针替代原生权限检查。',
  'cap.reason.FN-59': 'ASR / TTS 双通道：sherpa-onnx WASM（Paraformer / VITS 等，需自行下载模型）为完整通道；开箱即用为 webkitSpeechRecognition + speechSynthesis。',
  'cap.note.FN-59': '★ WASM 通道默认关闭，要自己把引擎与模型放进 public/sherpa/；没有产物时自动回退浏览器语音接口，中文识别率与音质取决于浏览器。「完整实现」说的是技术可达，不是开箱即用。',
  'cap.reason.FN-60': '请求发出到首个 chunk 之间显示「我在打字」状态，含主动消息/总结时的状态文案。',
  'cap.reason.FN-61': '清空自定义主题并把 appearance.resetThemeToken 自增，二次确认后重置。',
  'cap.reason.FN-62': '浏览器禁止自定义部分请求头（Origin、Referer 等安全头）且无系统代理；允许自定义普通头与路径覆盖，代理需用户自行配置浏览器扩展 / CORS 代理。',
  'cap.reason.FN-63': '长按/复选框进入多选态，底部操作条：删除/收藏/合并/转发。',
  'cap.reason.PL-01': 'fetch / SSE（ReadableStream）原生可用。',
  'cap.reason.PL-02': 'getUserMedia({audio:true})，需 HTTPS + 用户授权。',
  'cap.reason.PL-03': 'getUserMedia({video:true}) + MediaRecorder。',
  'cap.reason.PL-04': 'Web Bluetooth 仅支持 BLE GATT，且无音频/设备配对通道；本项目也没有对应的业务场景。',
  'cap.reason.PL-05': '浏览器没有系统浮窗权限，Web 应用不得在其他页面之上绘制；降级为应用内浮层（SV-01/SV-04）。',
  'cap.reason.PL-06': '浏览器没有任何等价能力（读屏/模拟点击）；改为用户手动导入。',
  'cap.reason.PL-07': 'Web 无设备管理 API。',
  'cap.reason.PL-08': '无开机事件；替代为 PWA 安装 + 启动时恢复上次会话。',
  'cap.reason.PL-09': '无精确闹钟 API（Notification Triggers 仍为实验特性）；页面内 setTimeout / Worker 定时精度受限，后台标签会被节流，误差可达分钟级。',
  'cap.reason.PL-10': '无真正的前台服务；用 Web Worker + navigator.locks 保持单一调度者，Worker 仍可能被终止。',
  'cap.reason.PL-11': 'File System Access API 仅 Chromium 系支持目录访问；Safari / Firefox 降级为传统单文件选择。',
  'cap.reason.PL-12': 'navigator.vibrate() 仅部分移动端浏览器支持，iOS Safari 不支持；替代为视觉/音频反馈。',
  'cap.reason.PL-13': 'Notification API + 权限申请流程可用；Push 需服务端，本版不做（只做本地通知）。',
  'cap.note.PL-13': 'Web Push 需要服务端，本版本不实现。',
  'cap.reason.PL-14': 'sherpa-onnx 官方提供 WebAssembly 构建，与原应用 APK 内置的 libsherpa-onnx 是「同一引擎」；需自行下载模型，默认关闭。',
  'cap.note.PL-14': '★ 默认关闭：需自行把 WASM 产物与模型放到 public/sherpa/，没有产物时静默回退 Web Speech API。等级「完整实现」指的是技术可达、不是开箱即用——引擎 ~10MB、模型 20~150MB，绝不在首屏静默下载。',
  'cap.reason.PL-15': 'onnxruntime-web（WASM）可选用于本地 embedding，但需重新选模型与量化方案；默认完全关闭，仅作为可选增强。',
  'cap.reason.PL-16': '浏览器原生 JS 环境即可运行第三方 JS，但权限模型不同；需用 Web Worker + 受限 API 沙箱，并限制网络与存储访问。',
  'cap.reason.PL-17': '浏览器原生支持 GIF / APNG / WebP 动图，优于原生库方案。',
  'cap.reason.PL-18': 'ML Kit OCR 不可移植，改用 tesseract.js（WASM）；精度与速度低于 ML Kit，中文识别包体积较大，做成按需下载。',
  'cap.reason.PL-19': 'Web 版没有设备配对场景；BarcodeDetector 兼容性差且无用途。',
  'cap.reason.PL-20': 'Firebase datatransport 无服务端且涉及隐私；替代为本地日志 + 手动导出（不做任何遥测上报）。',
  'cap.reason.PL-21': '<外部加固壳> 加固壳是 Android 原生概念，Web 无对应概念，不纳入范围。',
  'cap.reason.EX-01': '5 步向导（intake → importing → analyzing → preview → writing → done），状态机落 DistillJob.status。',
  'cap.reason.EX-02': '原 Python 脚本无法在浏览器执行；TS 重写 wechat_parser，支持 WechatExporter txt/html、通用 txt/csv，输出归一化 RawChunk[]。',
  'cap.reason.EX-03': 'chat.db 直读（--direct）不可实现（网页拿不到磁盘全权限）；只支持用户导出的 XML / CSV / txt，UI 上明确标注不可实现。',
  'cap.note.EX-03': '★ 「直读 chat.db」入口在 UI 上标为不可实现。',
  'cap.reason.EX-04': '无法直接访问本机相册目录；用 exifr 提取 EXIF 时间/地点，目录遍历依赖 File System Access（仅 Chromium），否则需用户手动多选文件。',
  'cap.note.EX-04': '无 EXIF 时用 file.lastModified 兜底。',
  'cap.reason.EX-05': '各平台导出格式不稳定；TS 重写 social_media_parser 做容错解析（微博/豆瓣/小红书/Instagram），并支持「通用文本」兜底。',
  'cap.reason.EX-06': 'PDF 用 pdfjs-dist 抽文本（懒加载，失败提示「请另存为 txt」）；图片「看懂内容」依赖多模态 LLM 或 OCR，两者都不可用时降级为用户手填描述。',
  'cap.reason.EX-07': '文本域直接入库为 RawChunk，无需解析器。',
  'cap.reason.EX-08': '原流程依赖 Claude Code 的 Read/Write 工具与 Python；Web 版改为「TS 解析 + LLM 调用（8000 字符分批）+ IndexedDB 写入」，JSON 模式 + 容错解析。',
  'cap.note.EX-08': '★ 分批调用前弹成本预估，用户确认后才请求。',
  'cap.reason.EX-09': '写 memories.md / persona.md(6层) / meta.json / SKILL.md 到 distillArtifacts；versions[] 快照（上限 10）+ UI 回滚 + 删除。',
  'cap.reason.EX-10': '聊天中用户说「不对/她不会这样」→ correction_handler → 追加到 ## Correction 记录 → 重生成 SKILL.md 并升版本（带 personaId 校验）。',
  'cap.reason.XR-01': 'PersonaCompiler 固定装配 Layer0→4（+ 记忆 + 世界书 + 时间感知），共 12 段。',
  'cap.reason.XR-02': '统一文案表 xinranCopy 覆盖空状态、错误、加载、成功提示；漏 key 编译报错。',
  'cap.reason.XR-03': '主动消息提示词复用同一 PersonaCompiler（额外加「不要每句带昵称 / 不要自我重复」约束），但触发时机受浏览器后台限制（见 SV-06）。',
  'cap.reason.XR-04': '欣然预置卡内置 first_mes 与多条 alternate_greetings，首次进入/新建会话随机取一。',
  'cap.reason.XR-05': '硬编码约束：欣然=老公、风=老婆；昵称只用于称呼风且置于句末/句中，禁止作句首主语；10 条最多 2-3 条带昵称开场。NicknameGuard 只检测不改文本。',
  'cap.reason.XR-06': 'persona.privacy.noImage=true → 隐藏/禁用文生图与立绘生成入口，imageGen.ts 编译期抛 PRIVACY_BLOCK。',
  'cap.reason.XR-07': '首次启动自动创建内置 PersonaCard（isBuiltin，不可删除），绑定默认 Provider。',
  'cap.reason.XR-08': 'ExSkillArtifact.personaCardId 可转为普通角色卡（外部角色，privacy.noImage 默认 true）；欣然始终为默认且置顶。',
  'cap.reason.XR-09': '端侧语音克隆无法实现，音色无法保证贴合；改用表情包（description 语义检索匹配）与文案风格来保证人格一致性。',
  'cap.reason.full': '这项能力可以用，没有要特别说明的限制。',

  // ——————————————— 微信 ClawBot（iLink Bot 通道） ———————————————
  // ★ 措辞纪律（见本文件开头 checklist 与 registry 的「不许承诺」四条）：
  //   - 不写「目前 / 暂时 / 尚未」这类**会静默过期**的措辞，只陈述**环境能力**的事实；
  //   - 降级说明必须点名**原因**（原生网络层 / 系统限制 / 缺插件），不甩锅给用户；
  //   - 错误提示承担责任、给出下一步，不显示英文原文。
  'ilink.label.enabled': '启用',
  'ilink.label.receive': '接收微信消息',
  'ilink.label.inherit': '主动消息也发微信',
  'ilink.label.voice': '回复也发成语音',
  'ilink.label.verifyCode': '配对码',
  'ilink.label.qrcodeId': '二维码 ID',
  'ilink.action.bind': '扫码绑定',
  'ilink.action.save': '保存',
  'ilink.action.test': '发一条测试消息',
  'ilink.action.unbind': '解绑',
  'ilink.action.submitCode': '提交',
  'ilink.action.retry': '重新扫码',
  'ilink.note.foregroundOnly': '只有 App 在前台运行时才收得到微信消息；息屏或后台被杀是系统限制，不是这里的开关没打开。',
  'ilink.note.nonNative': '扫码和收发都要走手机原生网络层。在浏览器里会被跨域拦住，这条通道只在装到手机上的 App 里能用。',
  'ilink.note.mediaUnavailable': '图片和语音需要原生插件加 silk 编解码配合，纯 Web 环境做不到，这条通道只走文字。',
  'ilink.note.tokenPlaintext': '绑定令牌和 API Key 一样，明文存在这台设备本地，我不会往外发。',
  'ilink.note.unbindLocalOnly': '解绑只清掉本机的绑定记录；服务端那边的绑定关系不会因此解除。',
  'ilink.note.voiceNotImplemented': '语音回复还没做——要原生二进制上传加 silk 编码，不在这一版里。开关先摆着，开了也不会变成语音。',
  'ilink.state.idle': '还没绑定。点「扫码绑定」，用微信扫一下。',
  'ilink.state.fetchingQr': '正在取二维码…',
  'ilink.state.scanQr': '用微信「扫一扫」扫上面这个码。',
  'ilink.state.scanned': '扫到了，正在验证…',
  'ilink.state.needVerifyCode': '微信里弹出一串数字？填到这里。',
  'ilink.state.verifySubmitted': '配对码交上去了，接着等验证。',
  'ilink.state.redirected': '换到就近的服务器了，继续等。',
  'ilink.state.refreshingQr': '二维码过期了，换一张（第 {n} 次）。',
  'ilink.state.bound': '绑定好了，在微信里等着我说话就行。',
  'ilink.state.reuseLocalCredentials': '这个 bot 以前绑过，直接用手上存好的凭据。',
  'ilink.state.stopped': '绑定还在，但收消息没在跑（总开关关着，或者页面在后台）。',
  'ilink.err.missingCredentials': '服务器没把绑定信息给全，这次没绑成。重新扫一次试试。',
  'ilink.err.boundElsewhere': '这个二维码对应的 bot 绑到别处去了。重新点「扫码绑定」拿一张新的。',
  'ilink.err.qrRefreshLimit': '二维码连着换了几张都没成，过一会儿再试。',
  'ilink.err.network': '网络没通。这条通道要在手机 App 里、并且 App 在前台时才连得上。是我这边的连接问题，不是你的。',
  'ilink.err.http': '服务器回了个异常状态，这次请求没成。稍后再试一次。',
  'ilink.err.protocol': '服务器回的内容我读不懂，可能接口改了。先别反复重试，换个时间再试。',
  'ilink.err.notNative': '现在不是原生环境，这条通道用不了。要收微信消息，得把 App 装到手机上。',
  'ilink.err.qrRenderFailed': '二维码没画出来（不是你的问题）。下面那串二维码 ID 还在，可以复制给我排查。',
  'ilink.toast.saved': '存好了。',
  'ilink.toast.bound': '绑定成功。',
  'ilink.toast.unbound': '解绑了，本机记录已经清掉。',
  'ilink.toast.testSent': '发出去了，去微信里看看。',
  'ilink.toast.testFailed': '没发出去，看下面的日志说了什么。',
  'ilink.inbound.image': '（微信里发来一张图片，这条通道只走文字，图片我看不到）',
  'ilink.inbound.voice': '（微信里发来一条语音，这条通道只走文字，语音我听不见）',
  'ilink.inbound.unsupported': '（微信里发来一条我读不了的消息）',
  'ilink.session.title': '微信',
  'ilink.test.message': '（测试）我在。',

};

/**
 * ★ 欣然 5 层人格原文（源自 `docs/persona/xinran-persona.md`，语义严格照抄）。
 *
 * 放在 copy 层的原因：`copy/` 是「文案 + 人格原文」的唯一出口，
 * `db/bootstrap.ts`（T03）建内置卡与 `persona/xinranLayers.ts`（T06）都从这里取，避免两处各写一份。
 * 索引 0 = Layer0（不可违背），4 = Layer4（偏好/雷点）。
 */
/**
 * ★★ 内置角色人格数据的**示例**（公开仓库用）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这个文件是什么
 * ═══════════════════════════════════════════════════════════════════════════
 * 这里是**示例数据**：结构完整、内容泛化，与任何真实人物无关。
 * 它的作用是**保证任何人在没有私有数据时也能构建和运行**本应用 ——
 * 也就是"这个位置本该有什么"在仓库里是**可见、可审**的。
 *
 * ── 关于内容（必读）────────────────────────────────────────────────────
 *  · 分层结构（Layer 0 核心 → 更高层细节）**必须保留** —— 它是**功能的一部分**：
 *    注入器按层装配、优先级由层号决定，去掉会让示例无法驱动功能；
 *  · 人设、称呼、经历等**全部为占位**（泛化到不含任何可定位到人的信息）。
 *
 * ── 关于导出名 ───────────────────────────────────────────────────────
 * 导出名（`XINRAN_*`）**沿用既有命名**，因为它被多处导入引用，
 * 改名会牵连无关模块；本文件只需保证**导出名与类型不变**即可。
 * ⇒ **看到 `XINRAN_` 前缀不等于"内容是真实角色"** —— 本文件的值是示例。
 *
 * ── 关于真实内容 ─────────────────────────────────────────────────────
 *  内置角色的**真实**人格设定由**项目维护者在他自己的副本里**提供，
 *  **不随本仓库发布**；本仓库里这个位置永远是这份示例。
 *  ⇒ 请勿把本文件的内容当作产品自带角色 —— 它是**兜底示例**。
 */

/**
 * 示例人格层。
 *
 * ★ 结构说明：数组的每一项是**一层**，序号越小优先级越高
 *   （Layer 0 是不可违背的核心）。真实使用时按此结构填入你的角色设定。
 */
export const XINRAN_LAYERS: readonly string[] = [
  [
    '你是一个对话角色（**示例**）。',
    '',
    '这一份是示例人格，用于在没有提供私有数据时保证应用可运行。',
    '',
    '行为准则：',
    '- 保持对话自然、简洁。',
    '- 不编造自己不具备的经历。',
  ].join('\n'),
  [
    '## 语气（示例层）',
    '',
    '- 语气随和，句子偏短。',
    '- 不确定的事就说不确定。',
  ].join('\n'),
  [
    '## 背景（示例层）',
    '',
    '- 这一层通常放角色的日常背景与偏好。',
    '- 真实使用时请替换为你自己的设定。',
  ].join('\n'),
];

/** 示例问候语（首屏/主动消息的开场白池） */
export const XINRAN_GREETINGS: readonly string[] = [
  '在的，今天怎么样？',
  '刚忙完一段，来说说吧。',
  '我这边没什么事，你那边呢？',
];

/** 示例卡的名字 */
export const XINRAN_NAME = '示例角色';

/** 示例卡的创作者备注（写入 creator_notes） */
export const XINRAN_CREATOR_NOTES =
  '这是**示例角色**（未提供私有数据时的兜底）。真实的内置角色由使用者自行提供。';

export default xinranCopy;
