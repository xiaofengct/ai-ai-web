import {
  BUILTIN_PROVIDER_IDS,
  DEFAULT_ACTIVE_PROVIDER_ID,
  IMAGE_GEN_PRESETS,
  presetToConfig,
} from './providers';
import { DEFAULT_IDLE_TIMEOUT_MIN } from './limits';
import { deepClone } from '@/lib/clone';
import type {
  AppSettings,
  AppearanceSettings,
  ChatSettings,
  IlinkSettings,
  LLMProviderConfig,
} from '@/types/settings';
import type { UUID } from '@/types/common';

/**
 * ★ 默认设置（架构文档 §2 `constants/defaults.ts`）。
 *
 * 取值原则（无法从加固的 APK 取证，故按 PRD 给出合理默认并在 UI 全量开放配置）：
 * - 保守优先：不默认开启会花钱 / 会打扰用户的开关（自动备份、主动消息、联网搜索）；
 * - 体验优先：默认开 Markdown、回车发送、输入状态、时间感知；
 * - 成本优先：上下文默认 20 条、单次最大 40 条、首屏加载 30 条。
 */

/** 内置欣然卡的固定 ID（bootstrap 用它做幂等判断，重复启动不重复创建） */
export const XINRAN_PERSONA_ID: UUID = 'persona-xinran-builtin';

/** 内置占位表情包的固定 ID */
export const PLACEHOLDER_STICKER_PACK_ID: UUID = 'sticker-pack-placeholder';

/** 默认会话的固定 ID（首次启动建一个，避免空空如也的首屏） */
export const DEFAULT_SESSION_ID: UUID = 'session-default-xinran';

/** AppSettings schema 版本（用于迁移） */
export const SETTINGS_VERSION = 1;

/**
 * ★ 角色隐私默认值（**单一真源**，XR-06 / XR-08 / PRD C5）。
 *
 * 为什么必须有单一真源：之前「新建人设」「导入角色卡」「导出」「DB 迁移」四处
 * 各自写了一份 `{ noImage: ... }` 字面量，其中 `db/migrations.ts` 那份还写反成
 * `noImage: row.origin !== 'xinran'` —— 给欣然算出 **false**，直接违反
 * 「欣然恒为 true」的隐私红线（该迁移尚未启用，属于定时炸弹）。
 * 改为单一真源后，改默认值只需动这一处，不会再出现「改了一处另一处静默失效」。
 *
 * 取值说明：`noImage = true` 是**保守默认**——新建、导入、迁移补字段一律禁止生图，
 * 想放开必须由用户在人设页**显式**打开（`personaRepo.setPrivacy` 对内置卡仍会二次拦截）。
 *
 * ⚠️ 使用处必须展开副本（`{ ...DEFAULT_PERSONA_PRIVACY }`）或只读取其字段，
 *    不要把这个对象直接挂到记录上，否则多处会共享同一个可变对象。
 */
export const DEFAULT_PERSONA_PRIVACY: { noImage: boolean } = { noImage: true };

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  // —— 输入与渲染 ——
  enableMarkdown: true,
  enterToSend: true,
  sendDelayMs: 300,
  multiMessageDelayMs: 800,
  mediaImmediateSend: true,
  autoSplit: true,
  contentFilter: { enabled: false, words: [], mode: 'replace' },
  // ★ `'你的头'` 而非 `'的头'`：suffix 是**完整宾语**，要让句子自足（「欣然 拍了拍你的头」）。
  //   原值 `'的头'` 渲染出「欣然 拍了拍的头」——缺宾语；
  //   而 `settings.hint.patSuffix` 举的例子本身就是「拍了拍你的头」，**默认值须与示例一致**。
  //   ⚠️ 这里是**唯一生效的默认值**——`chatStore.ts` 那句 `settings.patSuffix || '…'` 是兜底，
  //   因本字段恒有值而**永不触发**（改默认值必须改这里，改那里等于没改）。
  patSuffix: '你的头',
  typingIndicator: true,
  // —— 上下文 ——
  contextCount: 20,
  maxMessages: 40,
  loadRange: 30,
  contextClean: {
    removeEmpty: true,
    dedupe: true,
    trimSystem: true,
    mergeConsecutive: false,
  },
  injectControl: {
    system: true,
    worldBook: true,
    memory: true,
    jailbreak: true,
    extras: {},
  },
  promptConstraints: '',
  timeAware: true,
  provideFullMemory: false,
  memoryScope: 'session',
  memoryScoreThreshold: 0.35,
  // —— 主动消息 ——
  proactive: {
    enabled: false,
    inherit: true,
    intervalMin: 30,
    idleTimeoutMin: DEFAULT_IDLE_TIMEOUT_MIN,
    allDay: false,
    dynamic: false,
    quietHours: { from: '23:00', to: '07:00' },
  },
  // —— 后台 ——
  backgroundMessage: false,
  backgroundToast: true,
  backgroundExitConfirm: true,
  doubleBackExit: true,
  // —— 生成 ——
  params: {
    temperature: 0.9,
    topP: 0.95,
    maxTokens: 2048,
    presencePenalty: 0,
    frequencyPenalty: 0,
  },
  imageGen: {
    provider: IMAGE_GEN_PRESETS[0].provider,
    model: IMAGE_GEN_PRESETS[0].model,
    size: IMAGE_GEN_PRESETS[0].size,
    promptTemplate: '{description}，{style}',
    negativePrompt: '',
    confirmBeforeGen: true,
  },
  webSearch: { enabled: false, provider: 'tavily', apiKey: '', topK: 5 },
  /**
   * ★★ 角色主动发动态（2026-10-04 加）。
   *
   * 放在 `ChatSettings`（与 `proactive` 同层）而不是 `AppSettings` 顶层 ——
   * 理由与 `proactive` 完全一致：它属于"她怎么主动说话"这一族行为设置，
   * 两者共享同一套世界闸门，放一起才看得清它们的关系。
   *
   * ★ 默认 **`enabled: false`**：聊天里的主动消息默认关（对齐原应用行为），
   *   动态是**新增能力**且会消耗 token 调模型，必须用户显式打开。
   *   理由完整版见 `types/settings.ts` 的同名字段注释。
   */
  moments: {
    enabled: false,
    intervalMin: 360,
    maxPerDay: 3,
    onlyActiveHours: true,
    allowSticker: true,
    useWorldContext: true,
  },
  autoSummary: { enabled: true, threshold: 40 },
  autoBackup: { enabled: false, intervalHour: 24, keep: 5 },
};

/**
 * ★ 微信 ClawBot（iLink Bot）默认设置。
 *
 * 保守默认：**`enabled: false`**——扫码绑定后由绑定流程显式置 true，
 * 不默认开启会往外发消息的通道。`receive` / `inheritProactive` 默认 true：
 * 它们只在 `enabled` 为真时才有意义，默认跟随用户「接进来就是想收发」的意图。
 *
 * ★ `voiceReply` 默认 false：本仓库未实现媒体发送（见 `IlinkSettings` 注释），
 *   给 true 只会造出一个「开关开着但什么都没发生」的假象。
 */
export const DEFAULT_ILINK_SETTINGS: IlinkSettings = {
  enabled: false,
  receive: true,
  inheritProactive: true,
  voiceReply: false,
  botId: '',
  botToken: '',
  userId: '',
  baseUrl: '',
};

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  darkMode: 'system',
  grayscale: false,
  yandereMode: false,
  portraitClear: false,
  petMode: false,
  petLife: 80,
  windowMinimized: false,
  multiSelect: false,
  homeLayout: 'v1',
  resetThemeToken: 0,
};

/** 默认 Provider 列表（DeepSeek / 硅基流动 / 自定义） */
export function buildDefaultProviders(): LLMProviderConfig[] {
  return [
    presetToConfig('deepseek', BUILTIN_PROVIDER_IDS.deepseek),
    presetToConfig('siliconflow', BUILTIN_PROVIDER_IDS.siliconflow),
    presetToConfig('custom', BUILTIN_PROVIDER_IDS.custom),
  ];
}

export function buildDefaultAppSettings(): AppSettings {
  return {
    version: SETTINGS_VERSION,
    providers: buildDefaultProviders(),
    activeProviderId: DEFAULT_ACTIVE_PROVIDER_ID,
    // ★★ 用项目自己的 `deepClone`，**不要**改成 `structuredClone`（2026-10-04，白屏 P0 根因）。
    //   这里当初写的是 `structuredClone(...)`，而本函数被 `DEFAULT_APP_SETTINGS` 这条
    //   **模块级常量**调用 ⇒ 模块一被 import 就执行。`structuredClone` 是
    //   Chrome / Android System WebView **98+** 才有的 API，用户机器低于该版本 ⇒
    //   抛 `ReferenceError` ⇒ 入口模块求值整体失败 ⇒ React 从未挂载 ⇒ **纯空白屏**。
    //   换成 `@/lib/clone` 后不再有版本门槛（实现只用 ES5 语言特性）。
    //   返回值都是纯数据（POJO / 数组 / 原始值），两实现在这个用法下等价。
    chat: deepClone(DEFAULT_CHAT_SETTINGS),
    appearance: deepClone(DEFAULT_APPEARANCE_SETTINGS),
    // ★ A3′（2026-10-04，software-engineer-4；team-lead **一次性授权**含本行，不改变本文件长期归属）。
    //   `enabled` / `asr` 默认改 true。**逐项「行为零变化」的论证**：
    //   - 改之前，这两个字段**全仓无人读**——唯二读者是 `VoiceSection.tsx:74` / `:89` 的 UI 开关本身
    //     （`settings.voice.enabled` / `.asr` 的消费点已用 grep 逐条点过，无第三人）。
    //   - 改之后，新闸门（`useASR.ts` `start()` 开头）读它们，取 true ⇒ ASR 行为与今天**逐字一致**。
    //   - 所以「改默认值」这一动作对**已存在的**代码路径是恒等的（不读）；对**新增的**闸门是「放行」。
    //     这正是「只改默认值」能叫零变化、而改 `tts` 不能叫零变化的原因。
    //   `tts` **保持 false**：`voice.tts` 有真实消费者（`useTTS.ts:293`、`llm/tts.ts:151`），
    //   动它才会真的改变行为，不在本次授权内。
    voice: { enabled: true, tts: false, asr: true },
    // ★ 微信 ClawBot 通道。深克隆与其它分组同口径——避免多处共享同一个可变对象。
    //   同样走 `deepClone`，理由见上面 `chat` 那一段（白屏 P0）。
    ilink: deepClone(DEFAULT_ILINK_SETTINGS),
    bridge: { clipboardWatch: false, importRules: [], exportTemplate: 'markdown' },
    dev: { rawLog: false, exportLogs: false, mock: false },
    updateNotesSeenVersion: undefined,
    advanced: {},
  };
}

export const DEFAULT_APP_SETTINGS: AppSettings = buildDefaultAppSettings();

/** 默认会话级覆盖（新建会话通常为空，全部继承全局） */
export const DEFAULT_SESSION_OVERRIDE: Partial<ChatSettings> = {};

/* ============================================================
   ★ 设置深合并
   ------------------------------------------------------------
   `ChatSession.settingsOverride` 是 Partial<ChatSettings>，
   与全局 ChatSettings 合并的规则（useSettings / settingsStore.effectiveChat）：
     1. 只对**普通对象**递归合并，数组整体替换（不 concat）——
        contentFilter.words、importRules 这类列表「覆盖即替换」更符合直觉；
     2. undefined 的字段视为「没写」，保留全局值；
       需要「显式清空」时用 null（下面 normalizeOverride 会把它转成 undefined 之外的哨兵）；
     3. 不修改入参，返回新对象（immer 之外的场景也安全）；
     4. Date / RegExp / 函数等非普通对象直接替换。
   ============================================================ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** 深合并：override 覆盖 base（递归到普通对象，数组整体替换） */
export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === null ? base : (override as T)) ?? base;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue; // 没写 → 保留全局
    if (value === null) {
      // null 视为「显式清空」，落为 undefined
      out[key] = undefined;
      continue;
    }
    out[key] = key in out ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

/** 全局 + 会话覆盖 → 有效 ChatSettings */
export function mergeChatSettings(
  globalSettings: ChatSettings,
  override?: Partial<ChatSettings>,
): ChatSettings {
  if (!override) return globalSettings;
  return deepMerge(globalSettings, override);
}

/** 迁移：把旧版本 settings 补齐到当前 schema（缺字段用默认值填） */
export function migrateSettings(raw: unknown): AppSettings {
  const fallback = buildDefaultAppSettings();
  if (!isPlainObject(raw)) return fallback;
  const merged = deepMerge(fallback, raw) as AppSettings;
  merged.version = SETTINGS_VERSION;
  // Provider 列表若缺失或为空，补一组默认预设（避免用户卡在「没模型可用」）
  if (!Array.isArray(merged.providers) || merged.providers.length === 0) {
    merged.providers = fallback.providers;
  }
  // activeProviderId 指向了不存在的 Provider 时，回落到第一个
  if (!merged.providers.some((p) => p.id === merged.activeProviderId)) {
    merged.activeProviderId = merged.providers[0]?.id ?? DEFAULT_ACTIVE_PROVIDER_ID;
  }
  return merged;
}
