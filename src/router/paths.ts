import type { CopyKey } from '@/copy/keys';
import type { MobileTab } from '@/store/uiStore';

/**
 * ★ 路由路径常量与构造器（架构文档 §2 `router/paths.ts`）。
 *
 * 约定：
 * - **这里是路由形状的唯一真源**：新增页面必须先在 `ROUTE` 里登记，`router/index.tsx` 只负责装配；
 * - 带参路径统一用 `:id` / `:jobId` / `:assetId` / `:memoryId` 命名，
 *   跳转一律走 `to.*()` 构造器（禁止在组件里手拼 `/chat/${id}`）；
 * - 文案 key 放在 `titleKey` 里走 `copy/xinran.ts`，TopBar 用它渲染标题。
 */

/** ★ 路由表（29 条 = 28 条具名路由 + 1 条兜底 `*`） */
export const ROUTE = {
  /** 首页（PG-14，v1/v2 两种布局） */
  home: '/',
  /** 首次启动引导（PG-07） */
  guide: '/guide',
  /** 主聊天（PG-16） */
  chat: '/chat/:id',
  /** 聊天统计（PG-01） */
  chatStats: '/chat/:id/stats',
  /** 聊天内搜索（PG-03） */
  chatSearch: '/chat/:id/search',
  /** 聊天设置（PG-09） */
  chatSettings: '/chat/:id/settings',
  /** 上下文设置（PG-10） */
  chatContext: '/chat/:id/context',
  /** 转发溯源详情（PG-02） */
  forward: '/forward/:id',
  /** 全屏文本（PG-22） */
  text: '/text/:id',
  /** 记忆库（PG-12） */
  memories: '/memories',
  /** 记忆编辑（PG-13） */
  memoryEdit: '/memories/:id/edit',
  /** 蒸馏作业列表（EX-01） */
  distill: '/distill',
  /** 蒸馏作业详情 */
  distillJob: '/distill/:jobId',
  /** 媒体预览（PG-06） */
  preview: '/preview/:assetId',
  /** 收藏夹（PG-08） */
  favorites: '/favorites',
  /**
   * 朋友圈（2026-10-04 新增）。
   * ★ 这是**新增功能**，不对应原应用的任何一条能力项 ——
   *   所以它不在「141 项能力表」里，也不需要 `<CapabilityGate>`。
   *   （能力表是"对齐原应用"的清单；朋友圈是用户后来加的需求，两者不同源。）
   */
  moments: '/moments',
  /** 语音测试（PG-04） */
  voiceTest: '/voice/test',
  /** 实时语音通话（PG-05） */
  voiceCall: '/voice/call',
  /** 全局设置（PG-17） */
  settings: '/settings',
  /** 连接测试（PG-18） */
  settingsConnection: '/settings/connection',
  /** 开发者选项（PG-19） */
  settingsDeveloper: '/settings/developer',
  /** 诊断（PG-20） */
  settingsDiagnosis: '/settings/diagnosis',
  /** 打赏/鸣谢（PG-21） */
  settingsSponsor: '/settings/sponsor',
  /** 第三方许可（PG-26） */
  settingsSdk: '/settings/sdk',
  /** 桥接设置（PG-23 → 微信不可实现的降级页） */
  settingsBridge: '/settings/bridge',
  /**
   * 反馈信箱（2026-10-04 新增）。
   * ★ 同「朋友圈」：这是**新增功能**，不对应原应用的任何一条能力项，
   *   所以不在「141 项能力表」里，也不需要 `<CapabilityGate>`。
   * ★ 为什么不给它一个底部 Tab：5 项已经是 Material 底部导航的**建议上限**
   *   （见下面 `MOBILE_TABS` 的注释），再加就得重新设计导航。
   *   而反馈是**低频**行为，从设置页进完全够 —— 低频功能不该占一级入口。
   */
  settingsFeedback: '/settings/feedback',
  /** 沙箱模块（PG-24） */
  module: '/module/:id',
  /** 模块权限清单（PG-25） */
  modulePermission: '/module/:id/permission',
  /** 能力总览（141 项能力表的整体出口，PM 验收 §8 的 6 项静默缺失由本页统一暴露） */
  capabilities: '/capabilities',
  /** 兜底：未匹配路由 → CrashPage */
  notFound: '*',
} as const;

export type RouteName = keyof typeof ROUTE;

/** ★ 验收要点①自检：路由总数必须是 30 */
export const ROUTE_COUNT: number = Object.keys(ROUTE).length;

/** 期望路由数（具名 29 条 + 兜底 1 条；新增页面时同步 +1） */
export const EXPECTED_ROUTE_COUNT = 30;

/** 路径构造器（带参路由禁止手工拼接） */
export const to = {
  home: (): string => ROUTE.home,
  guide: (): string => ROUTE.guide,
  chat: (id: string): string => `/chat/${encodeURIComponent(id)}`,
  chatStats: (id: string): string => `/chat/${encodeURIComponent(id)}/stats`,
  chatSearch: (id: string): string => `/chat/${encodeURIComponent(id)}/search`,
  chatSettings: (id: string): string => `/chat/${encodeURIComponent(id)}/settings`,
  chatContext: (id: string): string => `/chat/${encodeURIComponent(id)}/context`,
  forward: (id: string): string => `/forward/${encodeURIComponent(id)}`,
  text: (id: string): string => `/text/${encodeURIComponent(id)}`,
  memories: (): string => ROUTE.memories,
  memoryEdit: (id: string): string => `/memories/${encodeURIComponent(id)}/edit`,
  distill: (): string => ROUTE.distill,
  distillJob: (jobId: string): string => `/distill/${encodeURIComponent(jobId)}`,
  preview: (assetId: string): string => `/preview/${encodeURIComponent(assetId)}`,
  favorites: (): string => ROUTE.favorites,
  moments: (): string => ROUTE.moments,
  voiceTest: (): string => ROUTE.voiceTest,
  voiceCall: (): string => ROUTE.voiceCall,
  settings: (): string => ROUTE.settings,
  settingsConnection: (): string => ROUTE.settingsConnection,
  settingsDeveloper: (): string => ROUTE.settingsDeveloper,
  settingsDiagnosis: (): string => ROUTE.settingsDiagnosis,
  settingsSponsor: (): string => ROUTE.settingsSponsor,
  settingsSdk: (): string => ROUTE.settingsSdk,
  settingsBridge: (): string => ROUTE.settingsBridge,
  settingsFeedback: (): string => ROUTE.settingsFeedback,
  module: (id: string): string => `/module/${encodeURIComponent(id)}`,
  modulePermission: (id: string): string => `/module/${encodeURIComponent(id)}/permission`,
  capabilities: (): string => ROUTE.capabilities,
} as const;

/** 侧边导航项（图标在 SideNav 里按 labelKey 映射，避免与 paths 层耦合 UI） */
export interface NavItem {
  /** 目标路径（无参路由） */
  path: string;
  /** 标题文案 key */
  labelKey: CopyKey;
}

/** 桌面端侧边导航：首页 / 朋友圈 / 记忆 / 蒸馏 / 设置 */
export const NAV_ITEMS: readonly NavItem[] = [
  { path: ROUTE.home, labelKey: 'nav.home' },
  // ★ 朋友圈（2026-10-04 加）：放在首页之后 —— 它是"看内容"的一级入口，
  //   与「记忆 / 蒸馏」这类"管理数据"的工具区别明显，排在它们前面更合阅读顺序。
  { path: ROUTE.moments, labelKey: 'nav.moments' },
  { path: ROUTE.memories, labelKey: 'nav.memories' },
  { path: ROUTE.distill, labelKey: 'nav.distill' },
  { path: ROUTE.settings, labelKey: 'nav.settings' },
];

/**
 * 移动端底部 Tab（决策 A8）：五项，与 `uiStore.mobileTab` 的联合类型对应。
 * 只对二级页面根路径生效，`/settings/connection` 这类子页会被归到 `settings`。
 *
 * ★ 为什么从 4 项加到 5 项：新增的「朋友圈」需要一级入口。
 *   5 项是 Material 底部导航的**建议上限**，超了就要改用「更多」菜单。
 *   当前正好压线，再多一个功能就得重新设计导航（不是继续往这里加）。
 */
export const MOBILE_TABS: readonly { tab: MobileTab; path: string; labelKey: CopyKey }[] = [
  { tab: 'home', path: ROUTE.home, labelKey: 'nav.home' },
  { tab: 'moments', path: ROUTE.moments, labelKey: 'nav.moments' },
  { tab: 'memories', path: ROUTE.memories, labelKey: 'nav.memories' },
  { tab: 'distill', path: ROUTE.distill, labelKey: 'nav.distill' },
  { tab: 'settings', path: ROUTE.settings, labelKey: 'nav.settings' },
];

/** 路径 → 标题文案 key（按**更精确者优先**排列，先看参数段数量） */
const TITLE_RULES: readonly (readonly [string, CopyKey])[] = [
  [ROUTE.chatStats, 'nav.chat'],
  [ROUTE.chatSearch, 'nav.chat'],
  [ROUTE.chatSettings, 'nav.chat'],
  [ROUTE.chatContext, 'nav.chat'],
  [ROUTE.memoryEdit, 'nav.memories'],
  [ROUTE.settingsConnection, 'settings.group.model'],
  [ROUTE.settingsDeveloper, 'settings.group.advanced'],
  [ROUTE.settingsDiagnosis, 'settings.group.advanced'],
  [ROUTE.settingsSponsor, 'nav.about'],
  [ROUTE.settingsSdk, 'nav.about'],
  [ROUTE.settingsBridge, 'settings.group.advanced'],
  // ★ 反馈信箱的顶栏标题。放在 `settingsBridge` 之后：
  //   `TITLE_RULES` 是**按顺序取第一个命中**的，`/settings/feedback` 与
  //   其它 `/settings/*` 的段数不同（3 段 vs 2 段），不会互相遮挡；
  //   列在这里只是为了和同一族的其它子页排在一起。
  [ROUTE.settingsFeedback, 'nav.feedback'],
  [ROUTE.distillJob, 'nav.distill'],
  [ROUTE.modulePermission, 'settings.group.advanced'],
  [ROUTE.chat, 'nav.chat'],
  [ROUTE.forward, 'nav.chat'],
  [ROUTE.text, 'nav.chat'],
  [ROUTE.preview, 'nav.chat'],
  [ROUTE.memories, 'nav.memories'],
  [ROUTE.distill, 'nav.distill'],
  [ROUTE.settings, 'nav.settings'],
  [ROUTE.favorites, 'nav.favorites'],
  [ROUTE.moments, 'nav.moments'],
  [ROUTE.voiceTest, 'settings.group.voice'],
  [ROUTE.voiceCall, 'settings.group.voice'],
  [ROUTE.guide, 'nav.home'],
  [ROUTE.module, 'settings.group.advanced'],
  [ROUTE.home, 'nav.home'],
];

/** 把带 `:param` 的路由模式与真实路径比对（段数相同 + 静态段相等） */
function matchPattern(pattern: string, pathname: string): boolean {
  const p = pattern.split('/').filter(Boolean);
  const a = pathname.split('/').filter(Boolean);
  if (p.length !== a.length) return false;
  return p.every((seg, i) => seg.startsWith(':') || seg === a[i]);
}

/** 由当前 pathname 反查标题文案 key（TopBar 用；未命中回落到应用名） */
export function resolveTitleKey(pathname: string): CopyKey {
  const hit = TITLE_RULES.find(([pattern]) => matchPattern(pattern, pathname));
  return hit ? hit[1] : 'app.title';
}

/**
 * 判断导航项是否处于激活态。
 * 首页只精确匹配（否则所有路径都命中 `/`），其余按「自身 + 子路径」匹配。
 */
export function isActivePath(pathname: string, target: string): boolean {
  if (target === ROUTE.home) return pathname === ROUTE.home;
  return pathname === target || pathname.startsWith(`${target}/`);
}
