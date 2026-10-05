import type { ISODate, UUID } from './common';

/**
 * ★★ 用户反馈（2026-10-04 新增）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 先说清楚**这个功能能做到什么、做不到什么**（决定了整个设计）
 * ═══════════════════════════════════════════════════════════════════════════
 * 本应用是**纯前端 APK**，没有服务端。所以反馈只有一条真实通路：
 *
 *   用户提交 → 存在**他自己手机**的 IndexedDB 里
 *            → 他点「分享 / 复制」→ 通过微信、邮箱等方式**发给你**
 *
 * ★ 这意味着一个必须写进文档、也必须写进界面的事实：
 *   **用户不主动发出来，你就收不到。** 应用内那个「反馈信箱」看的是
 *   **这台设备上**的反馈，不是"所有用户的反馈"。
 *
 * ★ 为什么不做成"静默上传"：没有服务端就得上传到一个第三方地址，
 *   那属于未经用户同意的数据外发 —— 本应用的一贯口径是不做这种事
 *   （见 `stickersCopy.ts` 的 `note.limits`：同样把做不到的说清楚）。
 *   所以这里**明确走"用户知情的分享"**，并在界面上如实说明。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 为什么单独一张表、不复用 `messages` / `logs`
 * ───────────────────────────────────────────────────────────────────────────
 * 反馈是**用户写给开发者**的东西，语义上和"对话内容"完全无关：
 * 它不是消息（不该进上下文窗口、不该被记忆库检索、不该参与 token 预算），
 * 也不是日志（日志是应用自己写的诊断数据，用户看不到也不该改）。
 * ⇒ 单独一张表，让"反馈不是聊天"成为**存储层面的事实**，而不是注释里的约定。
 */

/**
 * 反馈类型。
 * ★ 分四类是为了让你**一眼分拣**：`bug` 优先处理，`idea` 攒着看，
 *   `content`（内容/人设不合适）涉及人格边界，`other` 兜底。
 *   不做更细的分类：类型越细，用户选错的概率越高，反而降低信息质量。
 */
export type FeedbackKind = 'bug' | 'idea' | 'content' | 'other';

/**
 * 处理状态（**只有本机可见**，用户改不改都行）。
 * ★ `wontfix` 刻意保留：把"不打算改"单列一档，比塞进"已解决"诚实 ——
 *   `resolved` 是"改了"，`wontfix` 是"看了，不改"。混在一起等于说谎。
 */
export type FeedbackStatus = 'new' | 'read' | 'resolved' | 'wontfix';

/**
 * 提交时的环境快照（**自动采集，用户不用填**）。
 *
 * ★ 为什么要自动带：反馈里最常见的一句是"它坏了"，而"它"是什么环境下的
 *   几乎永远缺失。这些字段能让你一眼判断"是不是那个已知的黑屏包"。
 * ★ **不采集任何身份信息**：没有设备 ID、没有 IP、没有账号。
 *   只取"用户代理里本来就有的公开信息"（平台/浏览器版本）。
 *   `userAgent` 是唯一可能偏长的字段，在导出时也会提示用户可自行删改。
 */
export interface FeedbackEnv {
  /** 应用版本（`import.meta.env.VITE_APP_VERSION`，取自 package.json） */
  appVersion: string;
  /** 构建形态：内置欣然 / 不内置欣然 —— 排查时**第一个要看**的字段 */
  buildFlavor: string;
  /** 平台粗分类：android / ios / desktop / web */
  platform: string;
  /** 原始 UA（用户可自行删改后再发） */
  userAgent: string;
  /** 界面语言 */
  locale: string;
  /** 视口尺寸（布局类问题必需） */
  viewport: string;
}

export interface FeedbackItem {
  id: UUID;
  kind: FeedbackKind;
  /** 正文（提交时必填，`trim()` 后不得为空；上限见 `MAX_FEEDBACK_LENGTH`） */
  content: string;
  /** 联系方式（可选，用户自愿填；**不校验格式**——填微信/QQ/邮箱都行） */
  contact?: string;
  env: FeedbackEnv;
  status: FeedbackStatus;
  /** 你的处理备注（本机可见；导出时会带上，方便你隔几天回来接着看） */
  adminNote?: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** 类型枚举（顺序即界面上的顺序） */
export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['bug', 'idea', 'content', 'other'];

/** 状态枚举（顺序即筛选器上的顺序） */
export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = ['new', 'read', 'resolved', 'wontfix'];

/**
 * 正文长度上限。
 * ★ 定 2000 而不是无限：反馈框里贴一整篇聊天记录没人会读，
 *   而且超长文本导出后排版会散。到上限时界面会**明确提示还剩多少字**，
 *   不是静默截断 —— 静默截断是最容易被骂的一种做法。
 */
export const MAX_FEEDBACK_LENGTH = 2000;

/** 联系方式长度上限（同上，防粘贴事故） */
export const MAX_FEEDBACK_CONTACT_LENGTH = 120;

/** 处理备注长度上限 */
export const MAX_FEEDBACK_NOTE_LENGTH = 500;

/** 类型 → 展示名（**只是 id → 文案 key 的映射**，文案本体在 `feedbackCopy.ts`） */
export const FEEDBACK_KIND_KEYS = {
  bug: 'fb.kind.bug',
  idea: 'fb.kind.idea',
  content: 'fb.kind.content',
  other: 'fb.kind.other',
} as const satisfies Record<FeedbackKind, string>;

/** 状态 → 展示名（同上） */
export const FEEDBACK_STATUS_KEYS = {
  new: 'fb.status.new',
  read: 'fb.status.read',
  resolved: 'fb.status.resolved',
  wontfix: 'fb.status.wontfix',
} as const satisfies Record<FeedbackStatus, string>;
