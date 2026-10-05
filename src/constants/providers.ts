import type { LLMProviderConfig } from '@/types/settings';
import type { UUID } from '@/types/common';
// ★ type-only import：只取类型，不产生运行时依赖，不违反「db / llm / store / persona 零 features 引用」。
import type { CopyKey } from '@/copy/keys';

/**
 * 模型商预设（架构文档 §2 `constants/providers.ts`）。
 *
 * ★ CORS 提示：多数厂商接口**不允许浏览器跨域直连**。
 *   若连接测试报 CORS 错误，请换支持浏览器直连的服务商或自建代理（见 README §2）。
 *
 * ★ 路径覆盖（`pathOverrides`）：DeepSeek / 硅基流动 官方均为 OpenAI 兼容 `/v1/chat/completions`；
 *   自定义 Provider 留空即可，由 `llm/adapter/compat.ts` 自动探测。
 */

/** 内置 Provider 固定 ID（保证 bootstrap 重复启动不重复创建） */
export const BUILTIN_PROVIDER_IDS = {
  deepseek: 'provider-deepseek',
  siliconflow: 'provider-siliconflow',
  custom: 'provider-custom',
} as const;

export type BuiltinProviderKey = keyof typeof BUILTIN_PROVIDER_IDS;

export interface ProviderPreset {
  key: BuiltinProviderKey;
  name: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  contextWindow: number;
  /** 是否需要兼容模式（FN-11） */
  suggestCompatMode: boolean;
  /** 是否支持多模态视觉（FN-25） */
  supportsVision: boolean;
  docsUrl: string;
  /**
   * 预设说明。**走主文案表**（前缀 `provider.note.*`），不要写中文字面量。
   *
   * ★ 为什么是主表不是 `settingsCopy.ts` 域内表：本文件在 `src/constants/`（共享常量层），
   *   实际消费者有四个——`db/bootstrap.ts`、`llm/adapter/multimodal.ts`、`llm/webSearch.ts`、
   *   `features/settings/sections/ModelSection.tsx`。落域内表会让 `db/` 与 `llm/`
   *   两层反过来 import `@/features/**`，直接违反分层硬约束；主表零新增依赖。
   *
   * ★ 会渲染给用户看（`ModelSection.tsx` 的一行 caption），所以是 A 档，必须走 `t()`。
   *
   * ★★ 2026-10-04 改为**可选**：用户看真机截图后指出 DeepSeek 那条说明是多余的，
   *   要求删掉（原文「原作者在教程里提醒：DeepSeek 有时不写记忆库、不遵守生图指令。」）。
   *   ⇒ 删掉那条文案，并把字段改成可选 —— 而不是"留个空串凑数"。
   *     空串会让「有没有这条说明」这件事在类型上不可见，
   *     渲染处也得多写一层 `!== ''` 判断，属于用运行期约定替代类型约定。
   *   没有 `note` 的预设（现在只有 DeepSeek）在界面上**不渲染那一行**，其余预设不受影响。
   */
  note?: CopyKey;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    key: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    /**
     * ★★ 2026-10-04 **重要修正**：原先默认是 `deepseek-chat` ——
     * 而那个 ID **已于 2026-07-24 被 DeepSeek 正式退役，且没有兼容别名**，
     * 现在拿它调 API 会**直接报错**（不是降级、不是静默换模型）。
     *
     * ★ 也就是说：**改动之前，任何用户只要用 DeepSeek 官方接口，
     *   聊天功能是完全不可用的**（一开口就报错）。
     *   这解释了"AI 发不出表情包"里**属于接口的那一部分** ——
     *   连正常回话都做不到，自然更谈不上配图。
     *
     * ── 现在该用哪个 ID（用户的判断是对的）─────────────────────────────
     *   DeepSeek 在 2026-09-10 上线 V4.1-Flash，**API 模型 ID 是 `deepseek-flash`**。
     *   ⚠️ 注意：ID 是 `deepseek-flash`，**不是** `v4.1-flash`
     *      （产品名是"V4.1 Flash"，但短 ID 里没有 `v4.1` 字样）。
     *      这是最容易写错的一处 —— 写错了同样是 4xx。
     *   V4.1-Flash **原生支持视觉**（能看图），所以 `supportsVision` 改成 true。
     *
     * ── 旧 ID 现在会怎样（写清楚，避免用户自己填回去）───────────────────
     *   · `deepseek-chat` / `deepseek-reasoner` —— **退役，调用即报错**
     *   · `deepseek-v4-flash` —— 临时路由到 V4.1-Flash（兼容路径，不建议新用）
     *   · `deepseek-v4-pro` —— 仍是独立的 V4 Pro 0813（未迁到 V4.1）
     */
    defaultModel: 'deepseek-flash',
    models: [
      // 当前官方在售的两个。★ 把 `deepseek-flash` 放在第一位 = 默认项。
      'deepseek-flash',
      'deepseek-v4-pro',
      // 兼容别名（官方说"暂时"路由到 V4.1-Flash）。列出来是因为部分第三方
      // 中转站只认这个名字 —— 让用户能直接选，而不是自己去查该填什么。
      'deepseek-v4-flash',
    ],
    // V4.1-Flash 是 1M 上下文（比旧的 64K 大一个数量级）
    contextWindow: 1_000_000,
    suggestCompatMode: false,
    // ★ 改成 true：V4.1-Flash **原生多模态**（能读图）。
    //   这不是"顺手多给一个 true"—— 它直接决定用户拍的照片能不能被模型看到：
    //   `multimodal.ts` 的 `supportsVision()` 为 true 时才发 `image_url` 内容块，
    //   否则降级成 `[图片：xxx]` 的文字描述。开着才有"看图"的效果。
    supportsVision: true,
    docsUrl: 'https://platform.deepseek.com/',
    // ★ 无 `note`：用户点名删除（见 `note` 字段的注释）。
  },
  {
    key: 'siliconflow',
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    /**
     * ★ 型号清单（2026-10-04 调整）：补上 V4 系列的托管版本与视觉型号。
     *   ★ 这个列表**只用于"下拉里的候选"**，不限制用户手填 ——
     *     第三方平台型号更新很快，写死的清单必然会过时。
     *     所以 `models` 的作用是"给几个能用的常见值"，不是"白名单"。
     */
    models: [
      'Qwen/Qwen2.5-72B-Instruct',
      'Qwen/Qwen2.5-32B-Instruct',
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-V4-Flash',
      'THUDM/glm-4-9b-chat',
      'Qwen/Qwen2.5-VL-72B-Instruct',
    ],
    contextWindow: 32768,
    suggestCompatMode: false,
    supportsVision: false,
    docsUrl: 'https://cloud.siliconflow.cn/',
    note: 'provider.note.siliconflow',
  },
  {
    key: 'custom',
    name: '自定义',
    baseUrl: '',
    defaultModel: '',
    models: [],
    contextWindow: 32768,
    suggestCompatMode: true,
    supportsVision: false,
    docsUrl: '',
    note: 'provider.note.custom',
  },
] as const;

/** 按 key 取预设 */
export function getProviderPreset(key: BuiltinProviderKey): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.key === key) ?? PROVIDER_PRESETS[2];
}

/** 预设 → LLMProviderConfig（seed 用；apiKey 由用户后续填写） */
export function presetToConfig(key: BuiltinProviderKey, id?: UUID): LLMProviderConfig {
  const preset = getProviderPreset(key);
  return {
    id: id ?? BUILTIN_PROVIDER_IDS[key],
    name: preset.name,
    baseUrl: preset.baseUrl,
    apiKey: '',
    model: preset.defaultModel,
    headers: {},
    pathOverrides: {},
    compatMode: preset.suggestCompatMode,
    multimodalCompatMode: false,
    timeoutMs: 60_000,
    contextWindow: preset.contextWindow,
  };
}

/** 默认激活的 Provider */
export const DEFAULT_ACTIVE_PROVIDER_ID: UUID = BUILTIN_PROVIDER_IDS.deepseek;

/** 文生图预设（FN-33 / FN-50；★ 欣然的隐私红线会强制禁用） */
export const IMAGE_GEN_PRESETS = [
  { provider: 'siliconflow', model: 'Kwai-Kolors/Kolors', size: '1024x1024' },
  { provider: 'custom', model: '', size: '1024x1024' },
] as const;

/** 联网搜索预设（FN-45；必须支持 CORS，否则需用户自建代理） */
export const WEB_SEARCH_PRESETS = [
  { provider: 'tavily', label: 'Tavily', topK: 5 },
  { provider: 'bocha', label: '博查', topK: 5 },
  { provider: 'custom', label: '自定义', topK: 5 },
] as const;
