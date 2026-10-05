import { useMemo } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { deepMerge } from '@/constants/defaults';
import { usePersonaStore } from '@/store/personaStore';
import type { ChatSettings, LLMProviderConfig } from '@/types/settings';
import type { UUID } from '@/types/common';

/**
 * ★ 读取有效设置（架构文档 §5 T04 验收要点②）：
 *   全局设置 + 会话覆盖**深合并**。
 *
 * 合并规则见 `constants/defaults.ts` 的 `deepMerge`（数组整体替换、undefined 视为没写）。
 */

/** 取全局 + 会话覆盖后的有效 ChatSettings */
export function useSettings(sessionOverride?: Partial<ChatSettings>): ChatSettings {
  const chat = useSettingsStore((s) => s.settings.chat);
  return useMemo(() => deepMerge(chat, sessionOverride ?? {}), [chat, sessionOverride]);
}

/** 只取全局 ChatSettings（不合并会话覆盖） */
export function useGlobalSettings(): ChatSettings {
  return useSettingsStore((s) => s.settings.chat);
}

/** 取当前激活的 Provider */
export function useActiveProvider(): LLMProviderConfig | undefined {
  return useSettingsStore((s) => {
    const list = s.settings.providers;
    return list.find((p) => p.id === s.settings.activeProviderId) ?? list[0];
  });
}

/** 取外观设置 */
export function useAppearance() {
  return useSettingsStore((s) => s.settings.appearance);
}

/**
 * 会话级有效设置：
 * 会话数据在 Dexie 里，这里只接受调用方传入的 override，
 * 避免在 hook 里直接查库（保持 hook 纯粹、可测）。
 */
export function useEffectiveChat(override?: Partial<ChatSettings>): ChatSettings {
  const chat = useSettingsStore((s) => s.settings.chat);
  return useMemo(() => deepMerge(chat, override ?? {}), [chat, override]);
}

/** 当前角色的模型覆盖（FN-51）：角色指定了 modelId 就用角色的 */
export function useModelOverride(personaId?: UUID): LLMProviderConfig | undefined {
  const provider = useActiveProvider();
  const persona = usePersonaStore((s) => s.personas.find((p) => p.id === personaId));
  return useMemo(() => {
    if (!persona?.modelId) return provider;
    // modelId 形如 `{providerId}::{model}` 时按 Provider 覆盖；否则只覆盖模型名
    const sep = persona.modelId.includes('::') ? '::' : ':';
    const idx = persona.modelId.indexOf(sep);
    if (idx === -1) return provider ? { ...provider, model: persona.modelId } : provider;
    return provider;
  }, [persona?.modelId, provider]);
}

export default useSettings;
