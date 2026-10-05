import type { UUID } from './common';
import type { ImageGenSettings } from './persona';
import type { MemoryScope } from './memory';

export interface LLMProviderConfig {
  id: UUID;
  /** DeepSeek / 硅基流动 / 自定义 */
  name: string;
  baseUrl: string;
  /** localStorage（可选 AES-GCM 加密） */
  apiKey?: string;
  model: string;
  headers?: Record<string, string>;
  pathOverrides?: { chat?: string; models?: string; image?: string; tts?: string };
  /** FN-11 兼容模式 */
  compatMode: boolean;
  /** FN-25 多模态兼容模式 */
  multimodalCompatMode: boolean;
  /** FN-62 超时 */
  timeoutMs: number;
  /** 用于 token 预算 */
  contextWindow: number;
}

/** ★ FN-30 逐段注入控制 */
export interface PromptInjectControl {
  system: boolean;
  worldBook: boolean;
  memory: boolean;
  jailbreak: boolean;
  /** 逐段开关（见 PromptSegmentId） */
  extras: Partial<Record<string, boolean>>;
}

export interface ChatSettings {
  // —— 输入与渲染 ——
  enableMarkdown: boolean;
  enterToSend: boolean;
  sendDelayMs: number;
  multiMessageDelayMs: number;
  mediaImmediateSend: boolean;
  autoSplit: boolean;
  contentFilter: { enabled: boolean; words: string[]; mode: 'replace' | 'truncate' };
  patSuffix: string;
  typingIndicator: boolean;
  // —— 上下文 ——
  contextCount: number;
  maxMessages: number;
  loadRange: number;
  contextClean: {
    removeEmpty: boolean;
    dedupe: boolean;
    trimSystem: boolean;
    mergeConsecutive: boolean;
  };
  injectControl: PromptInjectControl;
  promptConstraints: string;
  timeAware: boolean;
  provideFullMemory: boolean;
  memoryScope: MemoryScope;
  memoryScoreThreshold: number;
  // —— 主动消息 ——
  proactive: {
    enabled: boolean;
    inherit: boolean;
    intervalMin: number;
    idleTimeoutMin: number;
    allDay: boolean;
    dynamic: boolean;
    /** 非全天候时生效 */
    quietHours?: { from: string; to: string };
  };
  // —— 后台 ——
  backgroundMessage: boolean;
  backgroundToast: boolean;
  backgroundExitConfirm: boolean;
  doubleBackExit: boolean;
  // —— 生成 ——
  params: {
    temperature: number;
    topP: number;
    maxTokens: number;
    presencePenalty: number;
    frequencyPenalty: number;
  };
  imageGen: ImageGenSettings & { confirmBeforeGen: boolean };
  webSearch: { enabled: boolean; provider: string; apiKey?: string; topK: number };
  /**
   * ★★ 角色主动发动态（2026-10-04 加）。
   *
   * 「她会自己发朋友圈」是**用户请求的新能力**，不是原应用的功能，
   * 所以它不在 141 项能力表里（见 `docs/18` 第五节）。
   *
   * ── 为什么默认 `enabled: false`（要用户显式打开）──────────────────────
   *   这是"她会自己说话"里**最外放**的一种：聊天里的主动消息只有你看到，
   *   而动态是**留在时间线上**的东西（还会消耗 token 调模型）。
   *   默认打开等于"用户装完就开始花他的额度"，不可接受。
   *   ⇒ 默认关，用户自己开。**这是逐个功能判断的结果，不是统一策略**：
   *     聊天里的主动消息默认开（对齐原应用）、动态默认关（新增能力）。
   */
  moments: {
    /** 是否允许角色自动发动态 */
    enabled: boolean;
    /** 两条动态之间至少隔多少分钟（防止短时间内连发） */
    intervalMin: number;
    /** **每天最多几条**（硬上限）—— 与间隔是"与"关系，两条同时满足才发 */
    maxPerDay: number;
    /**
     * 是否只在她的**活跃时段**发（沿用世界设定的排班）。
     * ★ 打开时，夜班日的白天她不会发动态 —— 因为她那个点在睡觉。
     *   这是世界设定与动态功能的**交叉点**，也是"动态像真的"的关键。
     */
    onlyActiveHours: boolean;
    /** 发动态时是否允许配表情包 */
    allowSticker: boolean;
    /** 生成动态时把「今天什么班次」之类的世界情境一并告诉模型 */
    useWorldContext: boolean;
  };
  autoSummary: { enabled: boolean; threshold: number };
  autoBackup: { enabled: boolean; intervalHour: number; keep: number };
}

/**
 * ★ 微信 ClawBot（微信官方 iLink Bot 平台）通道设置。
 *
 * 这一组字段描述的是「把角色接进微信」这条通道的**配置与凭据**，
 * 运行时状态（登录进度、收消息循环、context_token 缓存）**不在这里**，
 * 而在 `src/store/ilinkStore.ts`（内存态，不入库）。
 *
 * ★★ 安全边界（不许美化，写清楚）：
 *   - `botToken` / `botId` / `userId` 随 `AppSettings` 一起**明文**写进
 *     localStorage（`ai-ai.settings.v1`）。本仓库当前**没有**对它们做任何加密，
 *     与 Provider 的 `apiKey` 是**同一等级**的处理——不要以为它被保护了。
 *   - 日志侧统一走 `redact()`，`botToken` 命中 `token` 模式会被打成 `***`，
 *     但那只保护**日志**，不保护 localStorage。
 *
 * ★ 字段语义：
 *   - `enabled`  : 总开关。为 false 时收消息循环立即退出，也不再发消息。
 *   - `receive`  : 是否接收微信消息（关掉仍可发，用于「只让她推、不让她收」）。
 *   - `inheritProactive` : 主动消息（`src/proactive`）是否同步发一份到微信。
 *   - `voiceReply`: 回复是否发成语音。★ 本仓库**未实现**媒体发送链路
 *     （需原生二进制 HTTP 插件 + silk 编解码），该开关当前无实际效果，
 *     设置页应据实置灰，不要假装可用。
 *   - `baseUrl`  : 运行期基址。空串表示用默认基址；扫码途中若服务端下发
 *     IDC 重定向（`scaned_but_redirect`），这里会被写成重定向后的地址并被持久化。
 */
export interface IlinkSettings {
  enabled: boolean;
  receive: boolean;
  inheritProactive: boolean;
  voiceReply: boolean;
  /** 服务端下发；用于展示与排查 */
  botId: string;
  /** ★ 等价于凭据。明文存储，理由见上方注释 */
  botToken: string;
  /** 绑定的微信用户 id（服务端下发；缺省时收首条消息时补全） */
  userId: string;
  /** 运行期基址；空串 = 用 `ILINK_BASE_DEFAULT` */
  baseUrl: string;
}

export interface AppearanceSettings {
  darkMode: 'system' | 'light' | 'dark';
  grayscale: boolean;
  yandereMode: boolean;
  portraitClear: boolean;
  petMode: boolean;
  petLife: number;
  windowMinimized: boolean;
  multiSelect: boolean;
  homeLayout: 'v1' | 'v2';
  /** FN-61 重置主题：自增触发重置 */
  resetThemeToken: number;
}

export interface AppSettings {
  /** schema 版本，用于迁移 */
  version: number;
  providers: LLMProviderConfig[];
  activeProviderId: UUID;
  chat: ChatSettings;
  appearance: AppearanceSettings;
  voice: { enabled: boolean; tts: boolean; asr: boolean; defaultTimbreId?: UUID };
  /**
   * ★ 微信 ClawBot（iLink Bot 平台）通道。见 `IlinkSettings` 的注释
   * （尤其「凭据明文」这条边界）。
   */
  ilink: IlinkSettings;
  bridge: { clipboardWatch: boolean; importRules: string[]; exportTemplate: string };
  dev: { rawLog: boolean; exportLogs: boolean; mock: boolean };
  updateNotesSeenVersion?: string;
  advanced: Record<string, unknown>;
}
