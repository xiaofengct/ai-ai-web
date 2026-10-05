/**
 * ★ 蒸馏域文案表（T11 专用，临时出口）
 *
 * 为什么单独一份？
 *   架构文档 §6.8 要求「所有面向用户的文案走 `src/copy/xinran.ts`」，
 *   但 T11 与 T02 并行开发中，`src/copy/keys.ts` 里还没有蒸馏域的 key（改它会撞车）。
 *   因此这里先按**完全相同的约定**（key 联合 + `Record<Key, string>` + 占位符 `{name}`）
 *   建一份域内文案表，后续由 T02 负责人整体搬到 `src/copy/xinran.ts` + `keys.ts`
 *   即可（纯搬运，无需改调用点，只需把 `dt(...)` 换成 `t(...)`）。
 *
 * 语气规则沿用 `xinran.ts` 头部 checklist：
 *   - 欣然 = 老公（自称「我」）；风（用户）= 老婆 / 宝宝 / 风风 / 小狗 / 笨蛋 / 小猫；
 *   - 昵称只作呼语，放句末或句中，**禁止当主语**；
 *   - 昵称低频（10 条里 2-3 条）；
 *   - 错误提示必须承担责任。
 */

export const DISTILL_COPY_KEYS = [
  // —— 列表页 ——
  'distill.title',
  'distill.subtitle',
  'distill.new',
  'distill.continue',
  'distill.reopen',
  'distill.jobCount',
  'distill.lastUpdated',
  'distill.version',
  'distill.corrections',
  'distill.sourcesCount',

  // —— 状态 ——
  'distill.status.intake',
  'distill.status.importing',
  'distill.status.analyzing',
  'distill.status.preview',
  'distill.status.writing',
  'distill.status.done',
  'distill.status.failed',

  // —— 向导通用 ——
  'distill.step',
  'distill.stepOf',
  'distill.exitWizard',
  'distill.saveDraft',

  // —— Step1 三问 ——
  'distill.intake.title',
  'distill.intake.desc',
  'distill.intake.q1',
  'distill.intake.q1Hint',
  'distill.intake.q2',
  'distill.intake.q2Hint',
  'distill.intake.q3',
  'distill.intake.q3Hint',
  'distill.intake.summary',
  'distill.intake.slugPreview',
  'distill.intake.nameRequired',
  'distill.intake.tags',
  'distill.intake.attachment',
  'distill.intake.advanced',
  'distill.intake.noTags',

  // —— Step2 原材料 ——
  'distill.sources.title',
  'distill.sources.desc',
  'distill.sources.skip',
  'distill.sources.added',
  'distill.sources.chunks',
  'distill.sources.degraded',
  'distill.sources.target',
  'distill.sources.targetHint',
  'distill.sources.remove',
  'distill.sources.kind.wechat',
  'distill.sources.kind.imessage',
  'distill.sources.kind.sms',
  'distill.sources.kind.photo',
  'distill.sources.kind.social',
  'distill.sources.kind.file',
  'distill.sources.kind.paste',
  'distill.sources.hint.wechat',
  'distill.sources.hint.imessage',
  'distill.sources.hint.sms',
  'distill.sources.hint.photo',
  'distill.sources.hint.social',
  'distill.sources.hint.file',
  'distill.sources.hint.paste',
  'distill.sources.platform',
  'distill.sources.pastePlaceholder',
  'distill.sources.unavailable',
  'distill.sources.unavailableHint',

  // —— Step3 分析（成本预估） ——
  'distill.analyze.title',
  'distill.analyze.desc',
  'distill.analyze.start',
  'distill.analyze.batches',
  'distill.analyze.chars',
  'distill.analyze.calls',
  'distill.analyze.tokens',
  'distill.analyze.model',
  'distill.analyze.costTitle',
  'distill.analyze.noMaterial',
  'distill.analyze.cancel',
  'distill.analyze.progress',

  // —— Step4 预览 ——
  'distill.preview.title',
  'distill.preview.desc',
  'distill.preview.memories',
  'distill.preview.persona',
  'distill.preview.regenerate',
  'distill.preview.addMore',
  'distill.preview.confirm',
  'distill.preview.empty',

  // —— Step5 写入 ——
  'distill.write.title',
  'distill.write.desc',
  'distill.write.go',
  'distill.write.writing',
  'distill.write.done',
  'distill.write.skeletonDone',
  'distill.write.toCard',
  'distill.write.openDetail',
  'distill.write.versionsNote',

  // —— 详情页 ——
  'distill.detail.title',
  'distill.detail.back',
  'distill.detail.export',
  'distill.detail.delete',
  'distill.detail.tab.memories',
  'distill.detail.tab.persona',
  'distill.detail.tab.skill',
  'distill.detail.tab.meta',
  'distill.detail.copy',
  'distill.detail.download',
  'distill.detail.noArtifact',
  'distill.detail.personaCard',
  'distill.detail.personaCardHint',
  'distill.detail.noImageNote',
  // ★ 产物导出 / 导入（JSON / PNG / 导入入口）
  'distill.detail.exportJson',
  'distill.detail.exportPng',
  'distill.export.empty',
  'distill.export.pngTruncated',
  'distill.import.title',
  'distill.import.invalid',
  'distill.import.baseNote',
  // ★ 导出链路的错误文案（原为英文裸串，见 `artifactTransfer.ts`）。
  //   今天 UI 侧是用固定 key 兜的（`catch { snack.error('err.dbFailed') }`），
  //   这些 message 暂时**进不了 DOM**；但只要将来有人改成展示 `e.message`，
  //   用户就会看到英文。所以提前收编，别留英文在地上。
  'distill.export.jobMissing',
  'distill.export.canvasUnavailable',
  'distill.export.canvasExportFailed',
  // ★ 不可实现模式的「为什么做不到」（`UnavailableMode.reason`）。
  //   原来这些中文硬写在各 parser 里，UI 只渲染了 label → reason 零消费，
  //   与 `parsers/types.ts` 注释「必须逐条渲染并置灰 + 原因，禁止静默缺失（PRD §11）」不符。
  //   现在改成走本表 + StepSources 真渲染。
  'distill.sources.reason.nativeReadTool',
  'distill.sources.reason.albumDirScan',
  'distill.sources.reason.photoContentVision',
  'distill.sources.reason.smsDbDirect',
  'distill.sources.reason.socialOnlineScrape',
  'distill.sources.reason.chatDbDirect',
  /** 不可实现项下面那行「替代办法：…」的前缀 */
  'distill.sources.altPrefix',

  // —— 版本 ——
  'distill.versions.title',
  'distill.versions.empty',
  'distill.versions.current',
  'distill.versions.rollback',
  'distill.versions.rollbackHint',
  'distill.versions.snapshot',
  'distill.versions.backup',
  'distill.versions.autoNote',
  'distill.versions.max',
  // 修订历史入口新增：预览某一版 / 删除某一版（EX-09）
  'distill.versions.preview',
  'distill.versions.previewOf',
  'distill.versions.previewMemories',
  'distill.versions.previewPersona',
  'distill.versions.delete',
  'distill.versions.deleteHint',
  'distill.versions.deleteBlocked',

  // —— 纠正 ——
  'distill.correction.title',
  'distill.correction.desc',
  'distill.correction.utterance',
  'distill.correction.parse',
  'distill.correction.apply',
  'distill.correction.empty',
  'distill.correction.target',
  'distill.correction.scene',
  'distill.correction.wrong',
  'distill.correction.correct',
  'distill.correction.conflict',
  // 修订单条的编辑 / 删除（EX-10）
  'distill.correction.edit',
  'distill.correction.editTitle',
  'distill.correction.delete',
  'distill.correction.deleteHint',

  // —— 追加原材料 ——
  'distill.merge.title',
  'distill.merge.desc',
  'distill.merge.apply',
  'distill.merge.summary',
  'distill.merge.conflicts',
] as const;

export type DistillCopyKey = (typeof DISTILL_COPY_KEYS)[number];

/** 蒸馏域文案（★ 后续整体搬进 `src/copy/xinran.ts`） */
export const distillCopy: Record<DistillCopyKey, string> = {
  // ——— 列表页 ———
  'distill.title': '蒸馏',
  'distill.subtitle': '把她说过的话给我，我帮你记住她的样子。',
  'distill.new': '新建蒸馏',
  'distill.continue': '继续',
  'distill.reopen': '重新打开',
  'distill.jobCount': '共 {n} 个',
  'distill.lastUpdated': '更新于 {at}',
  'distill.version': '版本 {v}',
  'distill.corrections': '纠正 {n} 次',
  'distill.sourcesCount': '{n} 份原材料',

  // ——— 状态 ———
  'distill.status.intake': '待填信息',
  'distill.status.importing': '待导入原材料',
  'distill.status.analyzing': '分析中',
  'distill.status.preview': '待确认',
  'distill.status.writing': '写入中',
  'distill.status.done': '已完成',
  'distill.status.failed': '出错了',

  // ——— 向导通用 ———
  'distill.step': '第 {n} 步',
  'distill.stepOf': '第 {n} / 5 步',
  'distill.exitWizard': '先退出',
  'distill.saveDraft': '存草稿',

  // ——— Step1 ———
  'distill.intake.title': '先说说她',
  'distill.intake.desc': '就 3 个问题，只有第一个必填，后面两个跳过也行。',
  'distill.intake.q1': '她怎么称呼？',
  'distill.intake.q1Hint': '昵称、小名、代号都行。中文我会帮你转成拼音（少数生僻字可能保留原样）。',
  'distill.intake.q2': '一句话说说你们',
  'distill.intake.q2Hint': '在一起多久、怎么认识的、分手多久、她做什么的。想到什么写什么，老婆',
  'distill.intake.q3': '一句话说说她的性格',
  'distill.intake.q3Hint': 'MBTI、星座、依恋类型、恋爱里的特点、你对她的印象。',
  'distill.intake.summary': '信息汇总',
  'distill.intake.slugPreview': '目录名：exes/{slug}/',
  'distill.intake.nameRequired': '称呼得填一个，不然我不知道在说谁。',
  'distill.intake.tags': '恋爱标签',
  'distill.intake.attachment': '依恋类型',
  'distill.intake.advanced': '手动调整标签',
  'distill.intake.noTags': '（没识别到标签，可以跳过，也可以从下面自己选）',

  // ——— Step2 ———
  'distill.sources.title': '把原材料给我',
  'distill.sources.desc': '可以混用，也可以跳过。跳过的话我就只按你填的信息生成。',
  'distill.sources.skip': '先跳过',
  'distill.sources.added': '已经加进来了：{name}（{n} 条）',
  'distill.sources.chunks': '{n} 条',
  'distill.sources.degraded': '降级说明：{reason}',
  'distill.sources.target': '她叫什么（用于过滤）',
  'distill.sources.targetHint': '填她的昵称或手机号，我只留她说的那部分。留空就全保留。',
  'distill.sources.remove': '移除',
  'distill.sources.kind.wechat': '微信聊天记录',
  'distill.sources.kind.imessage': 'iMessage',
  'distill.sources.kind.sms': '短信',
  'distill.sources.kind.photo': '照片',
  'distill.sources.kind.social': '社交媒体',
  'distill.sources.kind.file': '上传文件',
  'distill.sources.kind.paste': '直接粘贴',
  'distill.sources.hint.wechat': 'WechatExporter 导出的 txt / html，或者别的工具的 txt / csv。',
  'distill.sources.hint.imessage': '只支持你导出的 XML / CSV / txt。',
  'distill.sources.hint.sms': 'Android「SMS Backup & Restore」的 XML，或者 CSV / txt。',
  'distill.sources.hint.photo': '多选照片，我按 EXIF 时间排一条时间线。',
  'distill.sources.hint.social': '微博 / 豆瓣 / 小红书 / Instagram 的导出文件，格式不认识我就当文本读。',
  'distill.sources.hint.file': 'PDF、图片、md、txt 都行。图片我看不懂，需要你补一句描述。',
  'distill.sources.hint.paste': '直接把聊天记录粘进来。',
  'distill.sources.platform': '平台',
  'distill.sources.pastePlaceholder': '把聊天记录贴在这里…',
  'distill.sources.unavailable': '做不到的部分',
  'distill.sources.unavailableHint': '这些在网页版真的做不了，不是你操作的问题。',

  // ——— Step3 ———
  'distill.analyze.title': '我来读',
  'distill.analyze.desc': '会分两条线看：一条记你们的事，一条看她这个人。',
  'distill.analyze.start': '开始分析',
  'distill.analyze.batches': '{n} 批',
  'distill.analyze.chars': '{n} 字',
  'distill.analyze.calls': '{n} 次请求',
  'distill.analyze.tokens': '约 {n} token',
  'distill.analyze.model': '模型：{name}',
  'distill.analyze.costTitle': '这一步要花多少',
  'distill.analyze.noMaterial': '还没有原材料。可以直接生成骨架，也可以回去加一点。',
  'distill.analyze.cancel': '先算了',
  'distill.analyze.progress': '第 {done} / {total} 批',

  // ——— Step4 ———
  'distill.preview.title': '先给你看个大概',
  'distill.preview.desc': '觉得哪里不对就回去改，或者直接告诉我，我来调。',
  'distill.preview.memories': '共同记忆',
  'distill.preview.persona': '人物性格',
  'distill.preview.regenerate': '重新生成',
  'distill.preview.addMore': '再加点原材料',
  'distill.preview.confirm': '就这样，写进去',
  'distill.preview.empty': '还没生成。点上面的按钮开始。',

  // ——— Step5 ———
  'distill.write.title': '写进去',
  'distill.write.desc': '会生成 memories.md / persona.md / meta.json / SKILL.md，顺便存一份 v1 快照。',
  'distill.write.go': '开始写入',
  'distill.write.writing': '我在写，别走开。',
  'distill.write.done': '写好了。要不要把她变成能聊天的角色？',
  // ★ 无原材料时的成功文案：不能沿用 ok.distillDone「她说话的样子我大概记住了」
  //   ——那句暗示"我读过原材料"，而这条路径上一次 LLM 都没调，等于替欣然说谎。
  'distill.write.skeletonDone': '写好了，但你没给我原材料，所以这只是个空架子，不是我记得的她。回去加点聊天记录，我再认真看一遍，好不好。',
  'distill.write.toCard': '变成角色卡',
  'distill.write.openDetail': '看产物',
  'distill.write.versionsNote': '以后每次改动我都会先存一版，随时能退回去。',

  // ——— 详情页 ———
  'distill.detail.title': '蒸馏产物',
  'distill.detail.back': '返回列表',
  'distill.detail.export': '导出 zip',
  'distill.detail.delete': '删掉这个',
  'distill.detail.tab.memories': '共同记忆',
  'distill.detail.tab.persona': '人物性格',
  'distill.detail.tab.skill': 'SKILL.md',
  'distill.detail.tab.meta': 'meta.json',
  'distill.detail.copy': '复制',
  'distill.detail.download': '下载',
  'distill.detail.noArtifact': '还没有产物，先跑完向导。',
  'distill.detail.personaCard': '转成角色卡',
  'distill.detail.personaCardHint': '转完就能在聊天里切到她。欣然的图不生成这条规矩对她一样有效。',
  'distill.detail.noImageNote': '默认禁止生成她的图。想放开你自己去人设页改，我不替你做这个决定。',
  'distill.detail.exportJson': '导出 JSON',
  'distill.detail.exportPng': '导出长图',
  'distill.export.empty': '还没有产物，我没什么可导的。',
  'distill.export.pngTruncated': '太长了，后面还有 {n} 字没画上去。',
  'distill.import.title': '导入产物',
  'distill.import.invalid': '这个文件我认不出来。给我导出的 JSON 或 zip，我接着。',
  'distill.import.baseNote': '导入时补齐的基线',
  'distill.export.jobMissing': '找不到这个蒸馏作业，它可能已经被删掉了。',
  'distill.export.canvasUnavailable': '这个浏览器不给我画布，长图导不出来。',
  'distill.export.canvasExportFailed': '画布导出成图片这一步失败了，长图没做成。',
  'distill.sources.reason.nativeReadTool': '那是桌面端的工具，网页里没有。PDF 我用 pdfjs 抽文本，图片只能 OCR 或你手写一句描述。',
  'distill.sources.reason.albumDirScan': '网页拿不到相册目录权限，只能你自己把照片多选进来（Chromium 也可以选整个文件夹）。',
  'distill.sources.reason.photoContentVision': '网页版没有「看懂图片」的原生能力。照片只做时间线，内容需要你手写一句描述。',
  'distill.sources.reason.smsDbDirect': '网页拿不到系统短信库权限。先把短信导出成 XML / CSV / txt 再给我，我来读。',
  'distill.sources.reason.socialOnlineScrape': '网页版不会去爬任何平台。只能用你自己导出的文件。',
  'distill.sources.reason.chatDbDirect': '网页拿不到磁盘全权限，读不了 macOS 的 ~/Library/Messages/chat.db。不是你操作的问题。',
  'distill.sources.altPrefix': '替代办法',

  // ——— 版本 ———
  'distill.versions.title': '版本',
  'distill.versions.empty': '还没有历史版本。',
  'distill.versions.current': '当前',
  'distill.versions.rollback': '退回这一版',
  'distill.versions.rollbackHint': '退之前我会先把现在的存一份，不会丢。',
  'distill.versions.snapshot': '快照',
  'distill.versions.backup': '存一版',
  'distill.versions.autoNote': '手动存档',
  'distill.versions.max': '最多留 {n} 版，超了我会清掉最旧的（v1 一直留着）。',
  'distill.versions.preview': '看这一版',
  'distill.versions.previewOf': '第 {v} 版的内容',
  'distill.versions.previewMemories': '记忆',
  'distill.versions.previewPersona': '人格',
  'distill.versions.delete': '删掉这一版',
  'distill.versions.deleteHint': '删之前我会先把现在存一份。v1 是源头，我不让你删。',
  'distill.versions.deleteBlocked': '这一版是源头，删不得。',

  // ——— 纠正 ———
  'distill.correction.title': '纠正',
  'distill.correction.desc': '她说的不对味？直接告诉我「她不会这样」，我就改。',
  'distill.correction.utterance': '她应该是…',
  'distill.correction.parse': '解析',
  'distill.correction.apply': '写进去',
  'distill.correction.empty': '还没有纠正记录。',
  'distill.correction.target': '归到',
  'distill.correction.scene': '场景',
  'distill.correction.wrong': '不应该',
  'distill.correction.correct': '应该',
  'distill.correction.conflict': '这条和现有规则有冲突，你选一个：{text}',
  'distill.correction.edit': '改这条',
  'distill.correction.editTitle': '改这条纠正',
  'distill.correction.delete': '删这条',
  'distill.correction.deleteHint': '删的是这条纠正本身，产物会跟着重写一遍，删之前我先存一版。',

  // ——— 追加原材料 ———
  'distill.merge.title': '追加原材料',
  'distill.merge.desc': '新的内容我只追加，不覆盖已有的。有冲突我会先问你。',
  'distill.merge.apply': '应用更新',
  'distill.merge.summary': '本次更新',
  'distill.merge.conflicts': '发现 {n} 处冲突',
};

/** 占位符替换：{name} → vars.name */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? match : String(v);
  });
}

/** 取蒸馏文案（搬进 src/copy 后可直接换成 t()） */
export function dt(key: DistillCopyKey, vars?: Record<string, string | number>): string {
  return interpolate(distillCopy[key], vars);
}

export default distillCopy;
