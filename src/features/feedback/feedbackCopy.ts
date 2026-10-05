/**
 * ★ 反馈域文案表（2026-10-04，随「用户反馈入口」一起加）。
 *
 * 落域内表而非主表：全部 key 只被 `features/feedback/**` 与设置页的反馈分区消费，
 * 没有跨域读者。（分工口径同 `stickersCopy.ts` / `momentsCopy.ts`。）
 *
 * ★ 取值函数叫 `fb()`。
 *
 * ★ 全部 key 用**单一 `fb.` 前缀**，不复用 `ui.*` / `ok.*` / `err.*` 这些通用前缀：
 *   那些前缀在 `main` / `settings` / `capabilities` 表里都有人用，
 *   `lint:copyTables` 的**跨表重名检查**会直接报错（`stickersCopy.ts` 踩过两次：
 *   `ok.imported` / `ui.search` / `ui.searchPlaceholder`）。
 *   新表用**自己的命名空间**是唯一干净的做法 —— 共享前缀是历史形成的负担，
 *   新表没有理由再往里加一个。
 *
 * ★ 已在 `src/copy/registry.ts` 登记。加一张表的完整清单是**四处**
 *   （见 `registry.ts` 的 `CopyTableRegistration.id` 注释）：
 *   ① id 联合 ② COPY_TABLES 条目 ③ `check-copy-tables.ts` 的 switch case ④ 本表的 `declaredCount`。
 *   第 ③ 处最容易漏，且漏了**不报类型错**，只会得到一个指不到原因的"声明 N 条，源码实际 0 条"。
 */

export const FEEDBACK_TEXT = {
  /* ——————————————— 提交表单 ——————————————— */
  'fb.form.title': '说点什么',
  'fb.form.desc': '你说的我都能看到。写清楚一点，我才知道该改哪儿。',
  'fb.form.kindLabel': '这是哪一类',
  'fb.form.contentLabel': '具体说说',
  'fb.form.contentPlaceholder': '比如：点进设置就闪退了；或者：想要一个能导出聊天记录的功能。',
  'fb.form.contactLabel': '怎么找你（可以不填）',
  'fb.form.contactPlaceholder': '微信 / QQ / 邮箱，随便哪种',
  'fb.form.contactHint': '只有你留了我才能回你。不留也行，就是我没办法追问细节。',
  'fb.form.envNote': '提交时会顺带带上版本号、构建类型、系统与屏幕尺寸 —— 这些能帮我一眼看出是不是已知的问题。不采集任何身份信息。',
  'fb.form.submit': '交上去',
  'fb.form.submitting': '正在存',
  'fb.form.counter': '还能写 {left} 字',
  'fb.form.tooLong': '超了 {over} 字，删一点再交',

  /* ——————————————— 类型（与 `FEEDBACK_KINDS` 一一对应）——————————————— */
  'fb.kind.bug': '它坏了',
  'fb.kind.idea': '想要个新功能',
  'fb.kind.content': '她说的或做的让我不舒服',
  'fb.kind.other': '其它',

  /* ——————————————— 状态（与 `FEEDBACK_STATUSES` 一一对应）——————————————— */
  'fb.status.new': '没看过',
  'fb.status.read': '看过了',
  'fb.status.resolved': '已经处理',
  'fb.status.wontfix': '看了，不打算改',

  /* ——————————————— 动作 ——————————————— */
  'fb.action.write': '我要反馈',
  'fb.action.copy': '复制这一条',
  'fb.action.share': '发出去',
  'fb.action.exportAll': '导出全部（文本）',
  'fb.action.exportJson': '导出全部（JSON）',
  'fb.action.clearAll': '清空所有反馈',
  'fb.action.openInbox': '打开反馈信箱',
  'fb.action.markRead': '标记看过',
  'fb.action.markResolved': '标记已处理',
  'fb.action.markWontfix': '标记不改',
  'fb.action.note': '写备注',
  'fb.action.saveNote': '存备注',
  'fb.action.delete': '删掉这一条',

  /* ——————————————— 标签与提示 ——————————————— */
  'fb.label.filterStatus': '按状态看',
  'fb.label.all': '全部',
  'fb.label.count': '共 {count} 条',
  'fb.label.unread': '{count} 条没看',
  'fb.label.envTitle': '提交时的环境',
  'fb.label.kind': '类型',
  'fb.label.contact': '联系方式',
  'fb.label.submittedAt': '提交于',
  'fb.label.note': '我的备注',
  'fb.label.notePlaceholder': '给自己留一句，比如"下版修"',

  /* ——————————————— ★ 提示语**不在这张表**，在主表 ———————————————
     ★ 这是本表最容易改错的一处，写在这里免得后人往里加：
       `useSnack` 的入参类型是 `CopyKey`（主表的 key 联合），**域内表的 key 传不进去**。
       所以"提交成功 / 备注保存 / 复制失败 / 分享失败"这四条在 `src/copy/keys.ts` 里
       （`ok.feedbackSaved` / `ok.feedbackNoteSaved` / `err.feedbackCopyFailed` /
        `err.feedbackShareFailed`），不在本表。
       ★ 而"保存成功 / 导出成功 / 删除成功"三句**直接复用主表已有的**
         `ok.saved` / `ok.exported` / `ok.deleted` —— 没有为它们新造 key。
       ★ 第一版曾在这里写了 `fb.ok.*` / `fb.err.copyFailed` 等 8 条，全部**无人消费**
         （类型上就传不进 `useSnack`），已删除。已删的 key 不做占位：
         留着"以后可能用得上"的空 key，就是下一份没人认领的暗账。
  */

  /* ——————————————— 环境快照的字段名 ———————————————
     ★ 这 6 条是**用户看得见**的（提交前那一块"会带上这些"、以及导出文本里的
       `— 提交时的环境 —` 段落），所以必须走文案表，不能硬写在 `feedbackEnv.ts` 里。
       第一版就是硬写的，`lint:copy` 的兜底扫描把 6 条全捞出来了。
   */
  'fb.env.appVersion': '版本号',
  'fb.env.buildFlavor': '构建类型',
  'fb.env.platform': '平台',
  'fb.env.locale': '界面语言',
  'fb.env.viewport': '屏幕尺寸',
  'fb.env.userAgent': 'User-Agent',

  /* ——————————————— 构建形态的名字 ———————————————
     ★ `BUILD_FLAVOR` 是开发标识符（`builtin-xinran` / `standalone`），
       直接摆给用户看没有意义，这里翻成人话。
   */
  'fb.flavor.builtin': '内置欣然版',
  'fb.flavor.standalone': '不内置欣然版',

  /* ——————————————— 空态 ——————————————— */
  'fb.empty.none': '还没有反馈。有想说的就写一条。',
  'fb.empty.filtered': '这个条件下没有。换个筛选看看。',

  /* ——————————————— ★ 边界说明（**固定可见**，不藏在帮助里）———————————————
     ★ 用户明确要求"确保我能够查看和管理用户提交的反馈内容"。
       这个应用**没有服务端**，所以必须把这条通路如实说清楚 ——
       一段含糊的"反馈已提交"会让用户以为它已经发出去了，
       然后他就等着回音，而实际上什么东西都还在他自己手机上。
       把边界写在用户看得见的地方，是唯一诚实的做法（口径同 `stickersCopy.ts` 的 `note.limits`）。

     ★★ **这些文案值里不许写 markdown 强调语法（星号包字）**（2026-10-05 实测踩到）。
       渲染它们的是 `<Typography>` 里逐行 `{line}` 的**纯文本**输出，
       不解析 markdown ⇒ 星号会**连星号一起**显示给用户，
       在真机截图里看得很清楚（截图文件名 12-feedback-step2.png 就是这条的证据）。
       要强调就用中文引号「」—— 它天然是纯文本，且与全文标点风格一致。
       （★ 通用判据：**文案表里存的是"最终显示字符"**，
         任何"给渲染器看的语法"都不该出现在值里。）

     ★ 写这段注释时踩到的坑，记在这里免得重踩（**同一处连踩了两次**）：
       上一版这里写了「截图路径 + 通配符星号」这种写法，星号紧跟斜杠，
       而那两个字符连起来正好是**块注释的结束符** ⇒ 注释在那一行提前终止，
       剩下的路径片段变成代码 ⇒ `tsc` 报 `TS1005 ',' expected`。
       更讽刺的是：**修这条注释时又写了一次同样的序列，于是再报一遍。**
       ⇒ 判据（写下来，因为它反直觉）：
         **块注释里不许出现结束符那两个字符的连写**，
         哪怕它只是路径通配符的一部分、哪怕你正在解释这个坑。
         要举例就描述它（"星号紧跟斜杠"），不要照抄。
         （同族坑：本项目 CDP 注入块里的反引号冲突，一天踩过四次 ——
           都是"注释/字符串里的字符序列会被外层语法吃掉"。）
  */
  'fb.note.local':
    '这条反馈存在「你这台设备上」，不会自己上传到任何地方。\n' +
    '想让它真的到我手上，交完之后点「发出去」或「复制这一条」，\n' +
    '再通过微信、邮箱发给我。',
  'fb.note.inboxScope':
    '这个信箱看的是「这台设备上」的反馈，不是所有人的 —— 应用没有服务端，收不到别人的。\n' +
    '要交给开发者，请用上面的「导出全部」或单条的「复制这一条」。',
  'fb.note.noIdentity': '不采集身份信息：没有设备号、没有账号、没有 IP。',
  'fb.note.clearWarn':
    '会把这台设备上所有反馈连同备注一起删掉，删完找不回来。\n' +
    '还没导出的，先导出再清。',

  /* ——————————————— 反馈信箱（管理页）——————————————— */
  'fb.inbox.title': '反馈信箱',
  'fb.inbox.desc': '这台设备上收到过的反馈。可以改状态、写备注、导出。',
  'fb.inbox.stat': '毛病 {bug} · 想要 {idea} · 内容 {content} · 其它 {other}',

  /* ——————————————— 导出文本的版式 ——————————————— */
  'fb.share.header': '【ai爱 · 反馈】',
  'fb.share.divider': '————————————',
  'fb.share.contactLine': '联系方式：{contact}',
} as const;

export type FeedbackTextKey = keyof typeof FEEDBACK_TEXT;

/** 占位符替换（与 `@/copy` 的 `t()` 同构，域内表自带一份以免反向依赖） */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? match : String(v);
  });
}

/** 取反馈域文案 */
export function fb(key: FeedbackTextKey, vars?: Record<string, string | number>): string {
  return interpolate(FEEDBACK_TEXT[key], vars);
}

/** 类型 → 人话 */
export function kindText(kind: string): string {
  const map: Record<string, FeedbackTextKey> = {
    bug: 'fb.kind.bug',
    idea: 'fb.kind.idea',
    content: 'fb.kind.content',
    other: 'fb.kind.other',
  };
  const key = map[kind];
  return key ? FEEDBACK_TEXT[key] : FEEDBACK_TEXT['fb.kind.other'];
}

/** 状态 → 人话 */
export function statusText(status: string): string {
  const map: Record<string, FeedbackTextKey> = {
    new: 'fb.status.new',
    read: 'fb.status.read',
    resolved: 'fb.status.resolved',
    wontfix: 'fb.status.wontfix',
  };
  const key = map[status];
  return key ? FEEDBACK_TEXT[key] : FEEDBACK_TEXT['fb.status.new'];
}
