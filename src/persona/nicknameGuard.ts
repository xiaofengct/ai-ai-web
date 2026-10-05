import { NICKNAME_MAX_OPENING, NICKNAME_WINDOW } from '@/constants/limits';
import { log } from '@/store/logStore';
import { USER_NICKNAMES } from './constraints';
import type { Message } from '@/types/chat';
import type { PersonaOrigin } from '@/types/common';

/**
 * ★ 运行期昵称守卫（架构文档 §2 `src/persona/nicknameGuard.ts`、§7.2）。
 *
 * ★★★ 铁律：**只检测、只标注，绝不静默改写 LLM 输出**。
 *   改文本会破坏语义（比如把「想你了，小狗」改成「想你了」还算轻，
 *   把「我是你的小狗」改成「我是你老婆」就直接扭曲了角色），
 *   而且与「不阻断 LLM 输出」的产品取向冲突。
 *   本模块唯一的「写」操作是往 `message.nicknameWarnings` 里挂标注字符串。
 *
 * 四类检测（见 §7.2 表格）：
 * | 类型                 | 触发样例                    |
 * | nickname_as_subject  | 「小狗也爱你」（句首昵称当主语） |
 * | self_ref_mismatch    | 「我是你的小狗」（宠物化自称）  |
 * | role_reversed        | 欣然自称「老婆」/ 称风为「老公」 |
 * | nickname_frequency   | 近 10 条里昵称开场占比 > 0.3   |
 */

export type NicknameViolation =
  | { type: 'nickname_as_subject'; at: number; text: string }
  | { type: 'self_ref_mismatch'; at: number; text: string }
  | { type: 'role_reversed'; at: number; text: string }
  | { type: 'nickname_frequency'; ratio: number };

export interface NicknameGuardApi {
  check(text: string, opts: { origin: PersonaOrigin; history?: Message[] }): NicknameViolation[];
  /** ★ 只标注，不改写文本 */
  annotate(message: Message, violations: NicknameViolation[]): void;
}

/** 守卫策略（设置项 `advanced.nicknameGuardPolicy`） */
export type NicknameGuardPolicy = 'off' | 'log' | 'annotate' | 'retry-once';

/** 默认策略 */
export const DEFAULT_GUARD_POLICY: NicknameGuardPolicy = 'annotate';

/** 句首允许出现的引导字符（引号、括号、表情等不算主语） */
const LEADING_NOISE = /^[「『“"'(（【\[\s*\-—…。·]+/;

/** 判定「昵称后面紧跟的是不是谓语」——是标点/结尾就不算主语 */
const NOT_SUBJECT_AFTER = /^[，。！？、；：,.!?;:\s）)】」』”"']/;

/** 宠物化自称：我/欣欣/老公 + 近距离 + 宠物昵称 */
const SELF_REF_PET = /(我|欣欣|老公)[^。！？!?\n]{0,8}?(小狗|小猫|小猫咪|笨蛋)/g;

/** 拟宠词自称 */
const SELF_REF_PET_SOUND = /(汪汪|喵喵|嗷呜)/g;

/**
 * 欣然自称「老婆」（写反了）。
 * ★ 中间的 `(你|你的|个)?` 是刻意放宽的：「我是你老婆」「我是个老婆」都要命中；
 *   而正确表述「你是我老婆」里，「老婆」前面是「我」，不在可选组里 → 不误报。
 */
const SELF_CALLED_WIFE = /(我|欣欣|老公)[^。！？!?\n]{0,6}?(是|当|做|叫)(你|你的|个)?(老婆|媳妇)/g;

/**
 * 称风为「老公」（写反了）。
 * 同理：「你是我老公」要命中，而正确表述「我是你老公」不命中。
 */
const USER_CALLED_HUSBAND = /(你|风|风风)[^。！？!?\n]{0,6}?(是|当|做|叫)(我|我的)?(老公)/g;

/** 把文本切成句子（保留下标，便于定位 at） */
export function splitSentences(text: string): Array<{ text: string; at: number }> {
  const out: Array<{ text: string; at: number }> = [];
  const pattern = /[^。！？!?\n]+[。！？!?]?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const piece = match[0];
    if (!piece.trim()) continue;
    out.push({ text: piece, at: match.index });
  }
  if (out.length === 0 && text.trim()) out.push({ text, at: 0 });
  return out;
}

/** 去掉句首的引号/括号等噪声，返回「真实开头」与偏移 */
function stripLeading(sentence: string): { head: string; offset: number } {
  let offset = 0;
  let rest = sentence;
  while (true) {
    const m = LEADING_NOISE.exec(rest);
    if (!m || m[0].length === 0) break;
    offset += m[0].length;
    rest = rest.slice(m[0].length);
  }
  return { head: rest, offset };
}

/** 句子是否以「欣然的昵称」开头并当主语 */
export function startsWithNicknameSubject(sentence: string): string | undefined {
  const { head, offset } = stripLeading(sentence);
  for (const nick of USER_NICKNAMES) {
    if (!head.startsWith(nick)) continue;
    const after = head.slice(nick.length);
    // 后面是标点 / 空 → 是呼语（「小狗，过来」），不算主语
    if (after.length === 0 || NOT_SUBJECT_AFTER.test(after)) continue;
    return nick;
  }
  void offset;
  return undefined;
}

/** 收集正则命中的 [下标, 匹配文本] */
function collect(pattern: RegExp, text: string): Array<{ at: number; text: string }> {
  const out: Array<{ at: number; text: string }> = [];
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push({ at: match.index, text: match[0] });
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return out;
}

export class NicknameGuard implements NicknameGuardApi {
  /** 检测一段文本里的昵称/自称违规（不修改 text） */
  check(text: string, opts: { origin: PersonaOrigin; history?: Message[] }): NicknameViolation[] {
    // ★ 外部角色不套欣然的称呼规则（它们的「老婆/小狗」未必是同一层语义）
    if (opts.origin !== 'xinran') return [];
    if (!text || !text.trim()) return [];

    const violations: NicknameViolation[] = [];

    // ① 句首昵称当主语
    for (const sentence of splitSentences(text)) {
      const nick = startsWithNicknameSubject(sentence.text);
      if (nick) {
        violations.push({
          type: 'nickname_as_subject',
          at: sentence.at,
          text: sentence.text.trim().slice(0, 40),
        });
      }
    }

    // ② 宠物化自称 / 拟宠词
    for (const hit of collect(SELF_REF_PET, text)) {
      violations.push({ type: 'self_ref_mismatch', at: hit.at, text: hit.text });
    }
    for (const hit of collect(SELF_REF_PET_SOUND, text)) {
      violations.push({ type: 'self_ref_mismatch', at: hit.at, text: hit.text });
    }

    // ③ 关系写反
    for (const hit of collect(SELF_CALLED_WIFE, text)) {
      violations.push({ type: 'role_reversed', at: hit.at, text: hit.text });
    }
    for (const hit of collect(USER_CALLED_HUSBAND, text)) {
      violations.push({ type: 'role_reversed', at: hit.at, text: hit.text });
    }

    // ④ 昵称开场频率
    if (opts.history && opts.history.length > 0) {
      const ratio = this.openingRatio(opts.history);
      if (ratio > NICKNAME_MAX_OPENING / NICKNAME_WINDOW) {
        violations.push({ type: 'nickname_frequency', ratio });
      }
    }

    return violations;
  }

  /** ★ 只往 message 上挂标注，绝不改 content */
  annotate(message: Message, violations: NicknameViolation[]): void {
    if (violations.length === 0) return;
    const labels = violations.map(describeViolation);
    const merged = [...(message.nicknameWarnings ?? [])];
    for (const label of labels) {
      if (!merged.includes(label)) merged.push(label);
    }
    // ★★ 这里只写 nicknameWarnings；message.content 保持原样
    message.nicknameWarnings = merged;
  }

  /** 近 N 条 assistant 消息里「以昵称开场」的占比 */
  openingRatio(history: readonly Message[]): number {
    const recent = history.filter((m) => m.role === 'assistant').slice(-NICKNAME_WINDOW);
    if (recent.length === 0) return 0;
    let opening = 0;
    for (const m of recent) {
      const first = splitSentences(m.content)[0];
      if (first && startsWithNicknameSubject(first.text)) opening += 1;
    }
    return opening / recent.length;
  }
}

/** 违规 → 中文标注（进 `message.nicknameWarnings`，开发者页/长按菜单展示） */
export function describeViolation(violation: NicknameViolation): string {
  switch (violation.type) {
    case 'nickname_as_subject':
      return `昵称当了句首主语：${violation.text}`;
    case 'self_ref_mismatch':
      return `自称宠物化：${violation.text}`;
    case 'role_reversed':
      return `称呼关系写反：${violation.text}`;
    case 'nickname_frequency':
      return `昵称开场过多：${Math.round(violation.ratio * 100)}%`;
    default:
      return '未知的昵称违规';
  }
}

/** 是否值得自动重试一次（策略 retry-once，只对「写反」和「自称错位」生效） */
export function shouldRetryOnce(violations: readonly NicknameViolation[]): boolean {
  return violations.some((v) => v.type === 'role_reversed' || v.type === 'self_ref_mismatch');
}

/**
 * 按策略处理检测结果。
 * ★ 无论哪种策略都不会改写文本——`retry-once` 是「重新生成一次」而不是「改这一次的输出」。
 */
export function applyGuardPolicy(
  violations: readonly NicknameViolation[],
  policy: NicknameGuardPolicy = DEFAULT_GUARD_POLICY,
): { action: 'none' | 'log' | 'annotate' | 'retry' } {
  if (policy === 'off' || violations.length === 0) return { action: 'none' };
  if (policy === 'log') return { action: 'log' };
  if (policy === 'retry-once' && shouldRetryOnce(violations)) return { action: 'retry' };
  return { action: 'annotate' };
}

/** 检测 + 写日志（脱敏：只记类型与位置，不记整段文本） */
export function checkAndLog(
  text: string,
  opts: { origin: PersonaOrigin; history?: Message[]; policy?: NicknameGuardPolicy; messageId?: string },
): NicknameViolation[] {
  const violations = nicknameGuard.check(text, opts);
  if (violations.length === 0) return violations;
  log.info(
    'persona',
    '昵称守卫命中',
    {
      types: violations.map((v) => v.type),
      policy: opts.policy ?? DEFAULT_GUARD_POLICY,
      messageId: opts.messageId,
    },
    'XR-05',
  );
  return violations;
}

/** 全局单例 */
export const nicknameGuard = new NicknameGuard();

export default nicknameGuard;
