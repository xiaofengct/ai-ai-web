/**
 * 世界设定模块统一出口。
 *
 * 分层（自下而上）：
 *   types.ts          —— 数据结构（WorldPack / 排班 / 时段 / 条目）
 *   schedule.ts       —— **纯计算**：按日期算班次、判静默/活跃、掷概率门
 *   parseWorldDoc.ts  —— 从用户文档**识别**出上述结构（导入用）
 *   builtinWorlds.ts  —— 内置欣然的世界（仅内置版播种）
 *   cardWorld.ts      —— 读写：世界包 ↔ 角色卡
 *   activeWorld.ts    —— 取"当前角色"的世界包（供主动消息等消费）
 */

export * from './types';
export * from './schedule';
export * from './parseWorldDoc';
export * from './cardWorld';
export { activeWorldPack, activeWorldCard, refreshActiveWorld } from './activeWorld';

/*
 * ★★ 这里**故意不** `export * from './builtinWorlds'`（2026-10-04 修正）。
 *
 * 原因：桶文件（barrel）会把被重导出的模块**拉进每一个 import 了本桶的产物**，
 * 而 `builtinWorlds.ts` 装的是**只该给内置版**的世界数据（排班锚点、12 条世界书条目）。
 * 一旦经桶暴露，任何一处 `import { ... } from '@/world'` 都会把它带进不内置版。
 *
 * 实测背景：v8 的**不内置版** APK 里能搜到 `电视台排班 5 天一轮` 与 `2026-09-05`
 * （见 `scripts/qa/check-build-separation.mjs`）。
 *
 * ⇒ 需要内置世界的**只有** `persona/xinranCard.ts` 一处，它按**深路径**导入：
 *      import { XINRAN_WORLD } from '@/world/builtinWorlds'
 *   这样"谁能拿到内置世界"是**看 import 就知道**的，而不是藏在桶后面。
 */
