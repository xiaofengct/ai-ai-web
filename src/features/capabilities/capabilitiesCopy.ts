/**
 * ★ 能力总览域文案补充表（沿用 `settingsCopy.ts` 的域内表模式）。
 *
 * ============ 为什么有这张表 ============
 * 架构文档 §6.8 要求「面向用户的文案唯一出口 = `src/copy/xinran.ts`」，
 * 而 `src/copy/` 现已归口 software-engineer-4，**本域不直接改动它**。
 * 本页（能力总览）专有名词走 `cl()`，已收录的通用键（`gate.*` / `alt.*`）仍走 `t()`。
 *
 * 后续合并进 `src/copy/xinran.ts` 时只需整体搬运本表，再把 `cl()` 换成 `t()`。
 *
 * ============ 语气 ============
 * 这页是给「想知道为什么做不了」的人看的，所以**说明性优先、甜度降低**：
 * 不撒娇、不甩锅，把原因和替代方案讲清楚即可。
 */

/** 能力总览域文案表（`as const` 让 key 有字面量类型，写错直接编译报错） */
export const CAPABILITY_TEXT = {
  /* ——————————————— 页面级 ——————————————— */
  'page.capabilities.title': '能力总览',
  'page.capabilities.desc': '哪些能做、哪些做不了、做不了的话我拿什么补上，都写在这儿。不藏着。',
  'page.capabilities.source': '数据来自能力表（{n} 项），是功能可行性的唯一口径。',

  /* ——————————————— 筛选 / 检索 ——————————————— */
  'ui.search': '搜一下',
  'ui.searchPlaceholder': 'ID / 名字 / 原因',
  'ui.level': '程度',
  'ui.all': '全部',
  'ui.reset': '清掉筛选',
  'ui.count': '{n} 项',

  /* ——————————————— 分组名（group 是数据标识，这里是它的显示名）——————————————— */
  // ★ 这 6 条原先直接拿 `CapabilityMeta.group` 的字面量当标题渲染（`{group}`），
  //   虽然不是英文，但同样是「A 档出口的非取值函数字面量」，故收进本表。
  //   下面那张 `GROUP_LABEL` 是 `Record<group, key>`，将来新增第 7 个分组会**编译报错**，
  //   不会出现「分组没名字只能显示 key」的静默降级。
  'ui.group.page': '页面',
  'ui.group.backend': '后台能力',
  'ui.group.settings': '设置项',
  'ui.group.platform': '平台能力',
  'ui.group.distill': '蒸馏',
  'ui.group.xinran': '欣然人格',

  /* ——————————————— 程度四档 ——————————————— */
  'level.full': '能做',
  'level.partial': '做一半',
  'level.alternative': '换条路',
  'level.unavailable': '做不了',

  /* ——————————————— 条目字段 ——————————————— */
  'label.reason': '为什么',
  'label.alternative': '我拿什么补',
  'label.note': '补充说明',
  'label.noAlternative': '没有替代品，这一项在这儿就是没有。',

  /* ——————————————— 状态 ——————————————— */
  'empty.filtered': '这个条件下没有对得上的，放宽一点试试。',
  'stat.missing': '未收录 {n} 项',
  'stat.shown': '当前显示 {n} 项',
} as const;

/** 能力总览域文案 key 联合类型（由表推导，写错编译报错） */
export type CapabilityTextKey = keyof typeof CAPABILITY_TEXT;

/** 取能力总览域文案（缺失时返回 key 本身，便于定位） */
export function cl(key: CapabilityTextKey): string {
  return CAPABILITY_TEXT[key] ?? key;
}

/**
 * 取能力总览域文案并替换变量（`{n}` → vars.n）。
 * 与 `copy/index.ts` 的 `t()` 行为保持一致。
 */
export function clv(key: CapabilityTextKey, vars: Record<string, string | number>): string {
  return cl(key).replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}
