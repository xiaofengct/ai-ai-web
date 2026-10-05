/**
 * ★ 表情包域文案表（2026-10-04，随「表情包导入 / 联网搜索」一起加）。
 *
 * 落域内表而非主表：全部 key 只被 `features/stickers/**` 与 `features/chat/StickerPicker`
 * 消费，没有跨域读者。（分工口径同 `settingsCopy.ts` / `memoryCopy.ts`。）
 *
 * ★ 取值函数叫 `vs()` —— `sl` / `ml` / `mo` / `pl` 都已被其它域占用。
 *   同名函数分属不同模块不会编译报错，但会让"这个 `sl` 是哪张表"要靠看 import 才知道。
 *
 * ★ 已在 `src/copy/registry.ts` 登记。加一张表的完整清单是**四处**
 *   （见 `registry.ts` 的 `CopyTableRegistration.id` 注释）：
 *   ① id 联合 ② COPY_TABLES 条目 ③ `check-copy-tables.ts` 的 switch case ④ 新表本身。
 *   第 ③ 处最容易漏，且漏了**不报类型错**，只会得到一个指不到原因的"实际 0 条"。
 */

export const STICKERS_TEXT = {
  /* ——————————————— 分页 ——————————————— */
  'tab.mine': '我的表情',
  'tab.search': '联网找',

  /* ——————————————— 通用 ——————————————— */
  'ui.import': '导入表情包',
  'ui.importing': '正在导入',
  'ui.searching': '正在搜',
  'ui.searchingHint': '在搜索服务那边找图，稍等一下',
  'ui.addPicked': '加入我的（{count}）',
  'ui.addManual': '收下这张',
  'ui.showRejected': '有 {count} 张没收（看看为什么）',
  'ui.deletePack': '删掉这包',

  /* ——————————————— 标签与提示 ——————————————— */
  'label.packs': '已有的包',
  'label.packCount': '{count} 张',
  'label.candidates': '搜到 {count} 张，点一下选中',
  'label.manualUrl': '也可以直接粘图片链接（找不到就自己贴一张的地址）',
  'hint.panelNote': '搜到的图只存链接，原图删了就会变回文字。',
  'hint.importShape': '支持多张图片或一个 .zip；单张别超过 {mb} MB，一次最多 {max} 张。',

  /* ——————————————— 空态 ——————————————— */
  'empty.packs': '还没有表情包。导入几张，我说话会更有表情。',
  'note.noImageYet': '内置的表情只有名字没有图，所以显示成文字了。导入几张真的图片，它们就会变成图。',

  /* ——————————————— 联网找（`sk.*` 独立命名空间）———————————————
     ★ 为什么这几个 key 用 `sk.` 前缀、而不是复用通用的 `ui.*` / `ok.*`：
       第一版就是复用了 `ui.search` / `ui.searchPlaceholder` / `ok.imported`，
       结果 `lint:copyTables` 的**跨表重名检查**直接报错 ——
       它们与主表（`ok.*`）和能力表（`ui.*`）撞了同名 key。
       ★ 这条检查是刻意的：跨表重名会让"某个 key 到底属于哪张表"变得含糊，
         域内表的边界一旦模糊，就退化成"散落各处的第二份真相"。
       ⇒ 新表用**自己的命名空间**，是唯一干净的做法。
  */
  'sk.search': '搜一下',
  'sk.searchPlaceholder': '比如：猫 生气',
  'sk.imported': '收下 {count} 张。',

  /* ——————————————— 失败（**分类**，不混成一句）——————————————— */
  'err.nothingToImport': '这次没读到能用的图片。',
  'err.skipTooLarge': '太大了，收不下',
  'err.skipBadFormat': '格式我不认（要 png / jpg / gif / webp）',
  'err.skipTooMany': '超过一次能收的上限',
  'err.skipWriteFailed': '存的时候出错了',
  'err.skipUnzipFailed': '这个 zip 解不开，可能坏了',
  'err.skipEmpty': '这个包里没有图片',
  'err.searchNoImage': '搜到了页面，但没拿到能直接用的图片直链。换个词，或者直接在下面粘一张图的链接。',
  'err.needSearchKey': '搜索服务还没填密钥。去「设置 → 模型 → 联网搜索」填一个，我才能出去找。',
  'err.searchCors': '图的来源不让浏览器直接读（跨域被挡）。换个服务，或者直接粘图片链接。',
  'err.searchTimeout': '搜索服务太久没回话，我先停了。再来一次。',
  'err.searchFailed': '这次没搜成。可能是网络或者服务的问题，等会儿再试。',
  'err.stickerDbFailed': '本地存储出了点问题，是我没处理好。',

  /* ——————————————— ★ 边界说明（**固定可见**，不藏在帮助里）———————————————
     ★ 用户明确要求"说明内容安全处理逻辑"。所以这里**必须把做不到的说清楚**——
       一段只说"我们做了 X/Y/Z 过滤"的说明，会让人以为它是完整的审核，
       从而放松警惕。而实际上：远程图拿不到像素，**做不到内容识别**。
       把边界写在用户看得见的地方，是这个功能唯一诚实的做法。
  */
  'note.limits':
    '关于联网找图，说清楚几件事：\n' +
    '· 只会收 https 的图片直链，来源域名在屏蔽名单里的直接不要。\n' +
    '· 我没法检查图里的内容 —— 别人的图我读不到像素，只能看链接本身。\n' +
    '· 所以搜出来的每一张都要你自己点一下才会收下，我不替你决定。\n' +
    '· 收的是链接不是图本身：哪天原图删了，这张就会变回文字。\n' +
    '· 想稳定用，就导入到本地来。',
} as const;

export type StickerTextKey = keyof typeof STICKERS_TEXT;

/** 占位符替换（与 `@/copy` 的 `t()` 同构，域内表自带一份以免反向依赖） */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? match : String(v);
  });
}

/** 取表情包域文案 */
export function vs(key: StickerTextKey, vars?: Record<string, string | number>): string {
  return interpolate(STICKERS_TEXT[key], vars);
}

/** 导入跳过原因 → 人话（与 `stickerImport.ts` 的 `StickerImportSkipReason` 一一对应） */
export function importSkipText(reason: string): string {
  const map: Record<string, StickerTextKey> = {
    tooLarge: 'err.skipTooLarge',
    badFormat: 'err.skipBadFormat',
    tooMany: 'err.skipTooMany',
    writeFailed: 'err.skipWriteFailed',
    unzipFailed: 'err.skipUnzipFailed',
    empty: 'err.skipEmpty',
  };
  const key = map[reason];
  return key ? STICKERS_TEXT[key] : STICKERS_TEXT['err.nothingToImport'];
}

/** 错误码 → 人话（**分类**，用户据此知道该改什么） */
export function stickerErrorText(code: string): string {
  switch (code) {
    case 'LLM_AUTH':
      return STICKERS_TEXT['err.needSearchKey'];
    case 'LLM_CORS':
      return STICKERS_TEXT['err.searchCors'];
    case 'LLM_TIMEOUT':
      return STICKERS_TEXT['err.searchTimeout'];
    case 'DB_FAILED':
      return STICKERS_TEXT['err.stickerDbFailed'];
    default:
      return STICKERS_TEXT['err.searchFailed'];
  }
}
