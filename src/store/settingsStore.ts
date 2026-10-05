import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_CHAT_SETTINGS,
  SETTINGS_VERSION,
  buildDefaultAppSettings,
  deepMerge,
  migrateSettings,
} from '@/constants/defaults';
import { SK } from '@/constants/storageKeys';
import { writeThemeSnapshot } from '@/theme/modes';
import { appEmitter } from '@/lib/emitter';
import type {
  AppSettings,
  AppearanceSettings,
  ChatSettings,
  LLMProviderConfig,
} from '@/types/settings';
import type { UUID } from '@/types/common';

/**
 * ★ 全局设置 Store（架构文档 §6.6）。
 *
 * 边界：只负责 AppSettings 全量、Provider 列表、会话覆盖读取；
 * **不持有消息数据**，也不直接改别的 store（跨 store 调用走服务层）。
 *
 * 持久化：localStorage `ai-ai.settings.v1`（zustand persist + migrate）。
 */

export interface SettingsState {
  settings: AppSettings;
  /** 是否已完成 hydration（SSR/首帧判断用） */
  hydrated: boolean;

  /** 深合并补丁（递归到普通对象，数组整体替换） */
  patch(partial: DeepPartial<AppSettings>): void;
  /** 更新 chat 分组 */
  setChat(patch: DeepPartial<ChatSettings>): void;
  /** 更新 appearance 分组（同步写主题快照，避免刷新闪烁） */
  setAppearance(patch: Partial<AppearanceSettings>): void;
  /** 新增/更新 Provider */
  upsertProvider(provider: LLMProviderConfig): void;
  /** 删除 Provider（不允许删掉当前激活的） */
  removeProvider(id: UUID): void;
  /** 切换激活 Provider */
  setActiveProvider(id: UUID): void;
  /** 取当前激活 Provider */
  activeProvider(): LLMProviderConfig | undefined;
  /** 全局 + 会话覆盖 → 有效 ChatSettings */
  effectiveChat(sessionOverride?: Partial<ChatSettings>): ChatSettings;
  /** 重置为默认 */
  reset(): void;
  /** 重置主题（FN-61：resetThemeToken 自增触发 UI 重置） */
  resetTheme(): void;
}

/** 递归 Partial（只到普通对象层，数组保持原样） */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: buildDefaultAppSettings(),
      hydrated: false,

      patch: (partial) =>
        set((state) => {
          const next = deepMerge(state.settings, partial);
          // 主题相关字段变化时同步写首屏快照（index.html 内联脚本读它）
          if (partial.appearance) writeThemeSnapshot(next.appearance);
          appEmitter.emit('settings:changed', { keys: Object.keys(partial as object) });
          return { settings: next };
        }),

      setChat: (patch) =>
        set((state) => ({
          settings: {
            ...state.settings,
            chat: deepMerge(state.settings.chat, patch),
          },
        })),

      setAppearance: (patch) =>
        set((state) => {
          const appearance = { ...state.settings.appearance, ...patch };
          const settings = { ...state.settings, appearance };
          // ★ 同步到 ai-ai.theme.v1，保证刷新不闪白
          writeThemeSnapshot(appearance);
          appEmitter.emit('theme:changed', {
            mode: appearance.darkMode === 'dark' ? 'dark' : appearance.darkMode === 'light' ? 'light' : 'light',
            grayscale: appearance.grayscale,
          });
          return { settings };
        }),

      upsertProvider: (provider) =>
        set((state) => {
          const idx = state.settings.providers.findIndex((p) => p.id === provider.id);
          const providers = [...state.settings.providers];
          if (idx >= 0) providers[idx] = provider;
          else providers.push(provider);
          return { settings: { ...state.settings, providers } };
        }),

      removeProvider: (id) =>
        set((state) => {
          const providers = state.settings.providers.filter((p) => p.id !== id);
          const activeProviderId =
            state.settings.activeProviderId === id
              ? providers[0]?.id ?? ''
              : state.settings.activeProviderId;
          return { settings: { ...state.settings, providers, activeProviderId } };
        }),

      setActiveProvider: (id) =>
        set((state) => ({ settings: { ...state.settings, activeProviderId: id } })),

      activeProvider: () => {
        const s = get().settings;
        return s.providers.find((p) => p.id === s.activeProviderId) ?? s.providers[0];
      },

      /**
       * ★ 全局 + 会话覆盖深合并（PG-09 会话级设置）。
       * 合并规则见 constants/defaults.ts 的 `deepMerge` 注释。
       */
      effectiveChat: (sessionOverride) =>
        deepMerge(get().settings.chat, sessionOverride ?? {}),

      reset: () => {
        const settings = buildDefaultAppSettings();
        writeThemeSnapshot(settings.appearance);
        set({ settings });
      },

      /** FN-61 重置主题：自增 token，由 AppearanceSection 的 useEffect 消费 */
      resetTheme: () =>
        set((state) => ({
          settings: {
            ...state.settings,
            appearance: {
              ...DEFAULT_APPEARANCE_SETTINGS,
              resetThemeToken: state.settings.appearance.resetThemeToken + 1,
            },
          },
        })),
    }),
    {
      name: SK.settings,
      version: SETTINGS_VERSION,
      // 只持久化 settings（hydrated 是运行时状态，不入库）
      partialize: (state) => ({ settings: state.settings }) as unknown as SettingsState,

      /**
       * ★★★ 每次 hydration 都补全缺失字段 —— **这是升级兼容的关键防线**
       * （2026-10-04，修一个真机 P0：老用户升级后整个应用打不开）。
       *
       * ── 现场 ────────────────────────────────────────────────
       * 用户从旧版覆盖安装后打开，拿到的是启动失败面板，面板上写着：
       *     TypeError: Cannot read properties of undefined (reading 'enabled')
       *         at Object.ensureRunning (assets/index-*.js)
       * 即 `settings.ilink` 是 `undefined`，读 `.enabled` 直接抛。
       *
       * ── 为什么 `ilink` 会缺 ──────────────────────────────────
       * `ilink`（微信 ClawBot 通道）是**后来新增**的设置分组，
       * 而老用户 localStorage（`ai-ai.settings.v1`）里存的 JSON **没有这个键**。
       * 于是 `settings.ilink === undefined`。
       *
       * ── 为什么原有的 `migrate` 没兜住（★ 两个 bug 叠加）───────
       * ① **`migrate` 只在 `version` 不匹配时才被 zustand 调用。**
       *    而新增 `ilink` 时 `SETTINGS_VERSION` 仍是 `1`，与老用户存的 `1` 相同
       *    ⇒ **`migrate` 根本没执行** ⇒ 持久化的旧对象被原样采用。
       *    "新增了分组但忘了递增 version"是极易犯的错，**不能把兼容性押在它上面**。
       * ② 就算它执行了，原来的写法也是错的：
       *    `migrateSettings(persisted)` 传的是**整个持久化对象** `{ settings: {...} }`，
       *    而 `migrateSettings` 期望的是 **settings 本身**（`AppSettings`）。
       *    结果会 `deepMerge(fallback, { settings: {...} })` ——
       *    用户的所有设置被**重置回默认值**（顶层字段在 raw 里根本不存在）。
       *    即：这条路径不是"没兜住"，而是"一兜就清空用户数据"。
       *
       * ── 修法：用 `merge` 而不是 `migrate` ─────────────────────
       * `merge` 是 zustand persist 的标准选项，**每次 hydration 都会调用**，
       * 与 version 完全无关 ⇒ 它才是可靠的补全点。
       * 语义也更直白：**"把持久化的东西和当前状态合起来"** ——
       * 而"补齐缺失字段"正是合并该做的事。
       *
       * ★ 顺带记一条约定：**以后新增设置分组，不必记得递增 SETTINGS_VERSION**，
       *   因为这里每次加载都会用 `migrateSettings` 把持久化数据往新默认值上合。
       *   这比"靠人记得改版本号"可靠得多。
       */
      merge: (persisted, current) => {
        // ★ 兼容两种持久化形态：`{ settings }`（partialize 包装）或裸的 AppSettings
        //   （早期版本可能直接存了 settings 本体）。取不到就交给 migrateSettings 用默认值兜。
        const wrapped = persisted as { settings?: unknown } | undefined;
        const raw = wrapped && typeof wrapped === 'object' && 'settings' in wrapped
          ? wrapped.settings
          : persisted;
        return { ...current, settings: migrateSettings(raw) };
      },

      /**
       * 迁移钩子：**只在 version 变化时被调用**（zustand 的语义）。
       * 保留它以免将来真的升 version 时没有落点，但**兼容性不依赖它** —— 见上面的 `merge`。
       * ⚠️ 参数是**整个持久化对象**，必须取 `.settings` 再交给 `migrateSettings`
       *    （这里原来漏了 `.settings`，是个会清空用户设置的隐患，已修）。
       */
      migrate: (persisted) => {
        const wrapped = persisted as { settings?: unknown } | undefined;
        const raw = wrapped && typeof wrapped === 'object' && 'settings' in wrapped
          ? wrapped.settings
          : persisted;
        return { settings: migrateSettings(raw), hydrated: false } as unknown as SettingsState;
      },
    },
  ),
);

// localStorage 是同步存储，`create()` 返回时 hydration 已完成
useSettingsStore.setState({ hydrated: true });
writeThemeSnapshot(useSettingsStore.getState().settings.appearance);

/** 选择器：有效 ChatSettings（会话覆盖可选） */
export const selectEffectiveChat =
  (sessionOverride?: Partial<ChatSettings>) =>
  (state: SettingsState): ChatSettings =>
    deepMerge(state.settings.chat, sessionOverride ?? {});

/** 选择器：当前激活 Provider */
export const selectActiveProvider = (state: SettingsState): LLMProviderConfig | undefined =>
  state.settings.providers.find((p) => p.id === state.settings.activeProviderId) ??
  state.settings.providers[0];

/** 是否已配置可用 Provider（路由守卫用） */
export function hasUsableProvider(): boolean {
  const p = selectActiveProvider(useSettingsStore.getState());
  return Boolean(p && p.baseUrl && p.model);
}

/** 重置 chat 分组到默认（会话级「恢复全局默认」用） */
export function resetChatToDefault(): void {
  useSettingsStore.getState().setChat(DEFAULT_CHAT_SETTINGS);
}

export default useSettingsStore;
