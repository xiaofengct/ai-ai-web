import { AppError } from '@/lib/errors';
import type { DistillStatus } from '@/types/distill';

/**
 * DistillJob 状态机（架构文档 §4.7 + PRD EX-01）。
 *
 * ```
 *   [*] --> intake: 用户进入蒸馏向导
 *   intake --> importing: Step1 三问完成，进入 Step2
 *   importing --> analyzing: 原材料解析完成（或跳过）
 *   importing --> intake: 返回修改基础信息
 *   analyzing --> preview: 双线分析 + 生成草案完成
 *   analyzing --> failed: LLM 调用失败 / 解析失败
 *   preview --> analyzing: 用户要求调整（重新生成）
 *   preview --> writing: 用户确认
 *   preview --> importing: 用户要补充原材料
 *   writing --> done: 产物写入 + v1 快照完成
 *   writing --> failed: 写入失败
 *   failed --> analyzing: 重试
 *   failed --> intake: 重置作业
 *   done --> analyzing: 追加原材料（merger 增量合并，先 backup 版本）
 *   done --> preview: 对话纠正（correction → 追加记录 → 升版本）
 *   done --> [*]: 删除作业（/delete-ex 等价）
 * ```
 *
 * ★ 关键约束（§4.7 note）：每次进入 done 前必须先 backup 当前版本；
 *   versions[] 超过 MAX_VERSIONS(10) 自动清理最旧。
 */

/** 允许的转移：from → to[] */
export const DISTILL_TRANSITIONS: Readonly<Record<DistillStatus, readonly DistillStatus[]>> = {
  intake: ['importing', 'failed'],
  importing: ['analyzing', 'intake', 'failed'],
  analyzing: ['preview', 'failed', 'importing'],
  preview: ['writing', 'analyzing', 'importing', 'failed'],
  writing: ['done', 'failed', 'preview'],
  done: ['analyzing', 'preview', 'failed'],
  failed: ['analyzing', 'intake', 'importing'],
};

/** 状态 → 向导步骤（1~5）；failed / done 不在向导内 */
export const STEP_OF_STATUS: Readonly<Record<DistillStatus, number | undefined>> = {
  intake: 1,
  importing: 2,
  analyzing: 3,
  preview: 4,
  writing: 5,
  done: undefined,
  failed: undefined,
};

/** 步骤 → 状态 */
export const STATUS_OF_STEP: Readonly<Record<number, DistillStatus>> = {
  1: 'intake',
  2: 'importing',
  3: 'analyzing',
  4: 'preview',
  5: 'writing',
};

/** 向导总步数（EX-01：Step1 信息录入 → Step5 写入） */
export const TOTAL_STEPS = 5;

export const DISTILL_STATUSES: readonly DistillStatus[] = [
  'intake', 'importing', 'analyzing', 'preview', 'writing', 'done', 'failed',
];

/** 是否允许 from → to */
export function canTransition(from: DistillStatus, to: DistillStatus): boolean {
  if (from === to) return true;
  return DISTILL_TRANSITIONS[from]?.includes(to) ?? false;
}

/** 校验转移，非法时抛 AppError('IMPORT_INVALID')（防御式：状态机不允许被 UI 绕过） */
export function assertTransition(from: DistillStatus, to: DistillStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError('IMPORT_INVALID', `蒸馏状态机不允许 ${from} → ${to}`, { from, to });
  }
}

/**
 * ★ 「进入 done 前必须先 backup」的守卫。
 * 由 store / artifactWriter 在进入 done 之前调用，防止漏存档导致回滚链断裂。
 */
export function requiresBackupBefore(from: DistillStatus, to: DistillStatus): boolean {
  return to === 'done' && from !== 'done';
}

/** 当前状态所在的步骤（不在向导内时返回 undefined） */
export function stepOf(status: DistillStatus): number | undefined {
  return STEP_OF_STATUS[status];
}

/** 下一步 / 上一步状态（用于向导的「下一步」按钮推导目标状态） */
export function nextStatus(status: DistillStatus): DistillStatus | undefined {
  const step = STEP_OF_STATUS[status];
  if (step === undefined) return undefined;
  if (step >= TOTAL_STEPS) return 'done';
  return STATUS_OF_STEP[step + 1];
}

export function prevStatus(status: DistillStatus): DistillStatus | undefined {
  const step = STEP_OF_STATUS[status];
  if (step === undefined || step <= 1) return undefined;
  return STATUS_OF_STEP[step - 1];
}

/** 是否已经完成（产物可查看） */
export function isTerminal(status: DistillStatus): boolean {
  return status === 'done';
}

/** 是否处于错误态 */
export function isFailed(status: DistillStatus): boolean {
  return status === 'failed';
}

/** 向导里是否允许点「下一步」 */
export function canGoNext(status: DistillStatus): boolean {
  return STEP_OF_STATUS[status] !== undefined && STEP_OF_STATUS[status]! < TOTAL_STEPS;
}

export function canGoPrev(status: DistillStatus): boolean {
  const step = STEP_OF_STATUS[status];
  return step !== undefined && step > 1;
}
