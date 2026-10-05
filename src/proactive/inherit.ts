import { sessionRepo } from '@/db/repo/sessionRepo';
import { tryCatchAsync, ok, type Result } from '@/lib/result';
import { nowISO } from '@/lib/time';
import { log } from '@/store/logStore';
import type { ChatSession } from '@/types/chat';
import type { UUID } from '@/types/common';
import type { ChatSettings } from '@/types/settings';

/**
 * 会话级主动消息设置的继承（FN-07 `inheritFromPrev`）。
 *
 * 语义：新建会话时，若上一个会话开了主动消息，就把它的开关 / 间隔 / 话题拷过来，
 * 用户不必每个会话重新配一遍。
 *
 * ★ 边界：
 * - **只拷设置，不拷运行时状态**（`lastProactiveAt` 不继承——新会话还没发过就是没发过）；
 * - 没开继承开关时**不动**目标会话（不写库），避免误改；
 * - 找不到来源会话时返回 `false`，不算错误。
 */

/** 是否开启了继承（读全局设置；会话级 `proactive.inheritFromPrev` 优先） */
export function shouldInherit(chat: ChatSettings, session?: ChatSession): boolean {
  const sessionValue = session?.proactive?.inheritFromPrev;
  if (typeof sessionValue === 'boolean') return sessionValue;
  return chat.proactive.inherit === true;
}

/**
 * 找出「上一个会话」：优先显式指定，否则取除 `excludeId` 之外最近活跃的那一个。
 */
export async function findPreviousSession(excludeId?: UUID): Promise<UUID | undefined> {
  const res = await sessionRepo.listRecent({ includeArchived: false, limit: 5 });
  if (!res.ok) return undefined;
  const hit = res.value.find((s) => s.id !== excludeId);
  return hit?.id;
}

/**
 * 读一个会话（把 `Result` 摊平：读不到就是 `undefined`）。
 * 会话不存在不算错误——继承是「有就继承，没有就算了」的软行为。
 */
async function readSession(sessionId: UUID): Promise<ChatSession | undefined> {
  const res = await sessionRepo.get(sessionId);
  return res.ok ? res.value : undefined;
}

/**
 * 把来源会话的主动消息设置拷到目标会话。
 * @returns 是否真的写入了（`false` = 没开继承 / 没有来源 / 无需改动）
 */
export async function copyProactiveSettings(
  fromSessionId: UUID,
  toSessionId: UUID,
): Promise<Result<boolean>> {
  return tryCatchAsync(async () => {
    const [from, to] = await Promise.all([readSession(fromSessionId), readSession(toSessionId)]);
    if (!from?.proactive || !to) return false;

    const next = {
      enabled: from.proactive.enabled,
      inheritFromPrev: from.proactive.inheritFromPrev,
      intervalMin: from.proactive.intervalMin,
      topic: from.proactive.topic,
      // ★ lastProactiveAt 不继承：新会话的「上次主动」应当是「没有」
      lastProactiveAt: to.proactive?.lastProactiveAt,
    };

    const res = await sessionRepo.setProactive(toSessionId, next);
    if (!res.ok) throw new Error(res.error.message);
    log.info(
      'proactive',
      '新会话继承了上一会话的主动消息设置',
      { from: fromSessionId, to: toSessionId, enabled: next.enabled },
      'FN-07',
    );
    return true;
  }, 'DB_FAILED');
}

/**
 * ★ 新建会话时的入口：自己判断要不要继承、从哪儿继承。
 */
export async function inheritProactive(
  targetSessionId: UUID,
  options: { fromSessionId?: UUID; chat?: ChatSettings } = {},
): Promise<Result<boolean>> {
  return tryCatchAsync(async () => {
    const target = await readSession(targetSessionId);
    if (!target) return false;
    if (options.chat && !shouldInherit(options.chat, target)) return false;

    const from = options.fromSessionId ?? (await findPreviousSession(targetSessionId));
    if (!from || from === targetSessionId) return false;

    const res = await copyProactiveSettings(from, targetSessionId);
    if (!res.ok) throw new Error(res.error.message);
    return res.value;
  }, 'DB_FAILED');
}

/**
 * 开关主动消息（会话级）。
 * ★ 顺带更新 `updatedAt`，让会话列表排序反映这次改动。
 */
export async function setSessionProactiveEnabled(
  sessionId: UUID,
  enabled: boolean,
): Promise<Result<boolean>> {
  return tryCatchAsync(async () => {
    const session = await readSession(sessionId);
    if (!session) return false;
    const res = await sessionRepo.setProactive(sessionId, {
      ...session.proactive,
      enabled,
      inheritFromPrev: session.proactive?.inheritFromPrev,
      intervalMin: session.proactive?.intervalMin,
      topic: session.proactive?.topic,
      lastProactiveAt: session.proactive?.lastProactiveAt,
    });
    if (!res.ok) throw new Error(res.error.message);
    return true;
  }, 'DB_FAILED');
}

/** 记录一次会话级主动消息发出的时间（用于「间隔」判定） */
export async function markSessionProactiveSent(sessionId: UUID): Promise<Result<boolean>> {
  return tryCatchAsync(async () => {
    const session = await readSession(sessionId);
    if (!session) return false;
    const res = await sessionRepo.setProactive(sessionId, {
      ...session.proactive,
      enabled: session.proactive?.enabled ?? true,
      lastProactiveAt: nowISO(),
    });
    if (!res.ok) throw new Error(res.error.message);
    return true;
  }, 'DB_FAILED');
}

/** 取会话级「距上次主动消息多少分钟」（没发过返回 undefined） */
export async function minutesSinceSessionProactive(sessionId: UUID): Promise<number | undefined> {
  const session = await readSession(sessionId);
  const at = session?.proactive?.lastProactiveAt;
  if (!at) return undefined;
  return Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
}

/** 不需要继承时的空操作（保持 API 返回 `Result` 的一致性） */
export function noopInherit(): Result<boolean> {
  return ok(false);
}

export default inheritProactive;
