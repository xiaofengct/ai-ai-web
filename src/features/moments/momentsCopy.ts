/**
 * ★ 朋友圈域文案表（2026-10-04，随「朋友圈」功能一起加）。
 *
 * ============ 为什么是**域内表**而不是主表 `src/copy/xinran.ts` ============
 * 沿用本项目已确立的分工（同 `settingsCopy.ts` / `memoryCopy.ts`）：
 * - **跨域消费者**的文案 → 主表（如 `provider.*`，`db/` 与 `llm/` 都要读）；
 * - **只在本 feature 内消费**的文案 → 域内表，由 `mo()` 取值。
 *
 * 本表全部 key 只被 `features/moments/**` 消费，没有第二个域要读它，
 * 所以落域内表；顺带也不必动主表的 `declaredCount`（那是个已知的踩坑点）。
 *
 * ★ 已在 `src/copy/registry.ts` 的 `COPY_TABLES` 登记（**必须登记**：
 *   不登记就成了没人认领的暗账，`lint:copyTables` 会按"未登记的文案表"报出来）。
 *
 * ★ 取值函数叫 `mo()` 而不是 `ml()`：**`ml` 已被记忆域占用**
 *   （`features/memory/memoryCopy.ts` 导出 `ml` / `mlv`）。
 *   两张域内表各导出同名函数不会编译报错（分属不同模块），
 *   但会让"读代码时这个 `ml` 是哪张表"变得要看 import 才知道 —— 白白增加阅读成本。
 *
 * ============ 欣然语气 checklist（同 `copy/xinran.ts` 头部）============
 * - 主语只能是「我 / 欣欣 / 老公」；昵称（老婆/宝宝/风风/小狗/笨蛋/小猫）只作呼语，
 *   放句末或句中，**禁止**当句首主语；
 * - 昵称低频：10 条里 2-3 条，说明性文案默认不带昵称；
 * - 甜、直球、短句、不甩锅。
 * ==================================================================
 */

/** 朋友圈域文案表（`as const` 让 key 有字面量类型，写错直接编译报错） */
export const MOMENTS_TEXT = {
  /* ——————————————— 页面级 ——————————————— */
  'moments.page.desc': '我平时都在这儿说点零碎的。你想发也可以。',

  /* ——————————————— 发布区 ——————————————— */
  'moments.compose.placeholder': '这一刻想说什么？',
  'moments.compose.mood': '心情',
  'moments.compose.moodPlaceholder': '比如：有点困',
  'moments.compose.imageAdd': '加张图',
  'moments.compose.imageRemove': '去掉这张',
  /**
   * 配图被拒的行内提示。
   * ★ 抽成**一条**而不是"类型不对 / 太大"两条：两条会各占一行提示位，
   *   而这三种被拒原因对用户而言是同一件事 ——「这张我没收下」，
   *   区别（要图片 / 别超 5MB）写进括号一次说完即可。
   * ★ 也**不走 snack**：`useSnack()` 只收 `CopyKey`（主表 key），域内 key 传不进去；
   *   放行内反而更好 —— 提示就贴在配图按钮附近，不用去屏幕上找那条一闪而过的条。
   */
  'moments.compose.imageRejected': '这张我没收下（要图片，而且别超过 5 MB）。',
  'moments.compose.publish': '发出去',
  'moments.compose.publishing': '正在发',
  'moments.compose.expand': '说点什么',
  'moments.compose.collapse': '收起',

  /* ——————————————— 列表 ——————————————— */
  'moments.filter.all': '全部',
  'moments.filter.mine': '我的',
  'moments.filter.hers': '她的',
  'moments.list.empty': '这儿还空着。发第一条？',
  'moments.list.emptyMine': '你还没发过。想说点什么就说。',
  'moments.list.emptyHers': '她还没发过动态。',
  'moments.list.count': '共',
  'moments.list.loadMore': '再看点更早的',

  /* ——————————————— 单条操作 ——————————————— */
  'moments.action.like': '赞',
  'moments.action.unlike': '取消赞',
  'moments.action.delete': '删掉',
  'moments.action.deleteConfirm': '删了就找不回来了，确定吗？',
  'moments.likedBy.onlyMe': '我赞过',
  'moments.likedBy.count': '人赞过',

  /* ——————————————— 反馈 ———————————————
     ★ 这里**只留一条**「空内容」提示，而且它是**行内文字**、不是 snack。
       发布成功 / 删除成功 / 写库失败三条走**主表**既有 key
       （`ok.saved` / `ok.deleted` / `err.dbFailed`）—— 原因很实在：
       `useSnack()` 的入参类型是 `CopyKey`（主表 key 联合），
       **域内表的 key 传不进去**，编译期就会拦下来。
       这不是缺陷，是「主表 = 跨域通用文案」这条分工的应有结果：
       "已保存"这种话本来就与朋友圈无关，复用它比新写一条更对。
  */
  'moments.err.empty': '空的发不出去，先写点什么。',
} as const;

/** 朋友圈域文案 key */
export type MomentsTextKey = keyof typeof MOMENTS_TEXT;

/**
 * 取朋友圈域文案。
 * ★ 域内表的**唯一取值口**，禁止在组件里直接写中文字面量
 *   （`scripts/check-copy.ts` 会扫出来）。
 */
export function mo(key: MomentsTextKey): string {
  return MOMENTS_TEXT[key];
}
