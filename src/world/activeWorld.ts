/**
 * 取"当前角色"的世界包 —— 供主动消息、提示词装配等**非 React 环境**消费。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么需要单独一个模块（不直接在消费点读 store）
 * ═══════════════════════════════════════════════════════════════════════════
 * 有两个消费点，它们的取数路径**不一样**，容易各写一份而彼此漂移：
 *
 *   - **主动消息**（`proactive/scheduler.ts`）在**定时器回调**里跑，
 *     不是 React 渲染期，所以只能用 `usePersonaStore.getState()` 这种**一次性读**；
 *   - **提示词装配**（`persona/segments/*`）在渲染链路里，但 `PersonaCompiler`
 *     被约定为**不依赖 DB**，世界包由调用方从卡里带进去。
 *
 * 两者都需要"当前是谁的世界"，且都要求**读不到就当没有**（不能抛错）。
 * ⇒ 统一到这里，一处实现、两处复用。
 *
 * ★ 缓存策略：**不缓存**。
 *   读的是内存里的 store 数组（不是 DB），代价可忽略；
 *   而缓存会带来"用户换了角色/导入了世界，主动消息还在用旧的"这种难查的问题。
 *   这类"每次都便宜、缓存反而危险"的读，就该每次实读。
 */

import { usePersonaStore } from '@/store/personaStore';
import { worldOfCard } from './cardWorld';
import type { WorldPack } from './types';
import type { PersonaCard } from '@/types/persona';

/** 当前角色卡（无角色 → undefined） */
export function activeWorldCard(): PersonaCard | undefined {
  try {
    const { personas, currentId } = usePersonaStore.getState();
    if (personas.length === 0) return undefined;
    return personas.find((p) => p.id === currentId) ?? personas[0];
  } catch {
    // store 还没初始化好（极早期调用）→ 当作没有，绝不抛错拖垮调用方
    return undefined;
  }
}

/**
 * 当前角色的世界包。
 *
 * ★ 返回 `undefined` 表示"没有世界约束" ⇒ 下游按**旧行为**放行
 *   （见 `schedule.ts` 的 `evaluateWorldGate`：无世界包即 `noWorld` 放行）。
 *   这是刻意的：不内置版用户没导入世界时，主动消息必须照常工作，
 *   不能因为"没有世界设定"就整个不发了。
 */
export function activeWorldPack(): WorldPack | undefined {
  return worldOfCard(activeWorldCard());
}

/**
 * 手动刷新钩子（占位，供将来引入缓存时用）。
 * 现在不缓存 ⇒ 这里是空实现；保留是为了让调用点的意图（"这里需要最新值"）显式。
 */
export function refreshActiveWorld(): void {
  /* 目前无缓存，无需刷新 */
}
