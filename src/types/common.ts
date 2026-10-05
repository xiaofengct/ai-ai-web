import type { AppError } from '@/lib/errors';

/**
 * 通用基础类型（架构文档 §3.1）。
 *
 * 说明：`AppError` 的实现实体在 `src/lib/errors.ts`（避免两处各定义一个 class），
 * 这里做一次再导出，保证「所有跨文件类型都能从 `src/types/` 取到」的约定成立。
 */

export type UUID = string;
/** ISO 8601 UTC 字符串 */
export type ISODate = string;
export type Millis = number;

/** 能力可行性：full 可完整实现 / partial 部分实现 / alternative 需替代实现 / unavailable 不可实现 */
export type CapabilityLevel = 'full' | 'partial' | 'alternative' | 'unavailable';

/** 角色来源：欣然内置 / 外部（导入或蒸馏产物） */
export type PersonaOrigin = 'xinran' | 'external';

/** 统一结果类型：所有 repo 方法返回 Result<T> 或抛 AppError（架构文档 §5 T03 验收要点④） */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

/** AppError 再导出（实体定义在 @/lib/errors） */
export { AppError } from '@/lib/errors';
