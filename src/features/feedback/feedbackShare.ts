import { copyText, downloadJSON, downloadText } from '@/lib/download';
import { formatTimeAware } from '@/lib/time';
import type { FeedbackItem } from '@/types/feedback';
import { ENV_FIELDS, envLabel, envValue } from './feedbackEnv';
import { FEEDBACK_TEXT, fb, kindText, statusText } from './feedbackCopy';

/**
 * ★ 反馈的「交出去」通道（2026-10-04）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这是整个功能**唯一真正能把反馈交到开发者手上**的地方
 * ═══════════════════════════════════════════════════════════════════════════
 * 应用没有服务端，所以「提交」只等于"存进本机数据库"。真正的交付靠这里：
 *
 *   ① **分享**（`navigator.share`）—— 在 Android WebView / Chrome 里会拉起
 *      系统分享面板，用户可以选微信、邮箱、记事本……这是**最顺的一条路**。
 *   ② **复制**（`copyText`）—— 兜底。`navigator.share` 在桌面浏览器、部分
 *      WebView、以及非安全上下文里都可能不存在；**复制永远可用**。
 *   ③ **导出**（下载 .txt / .json）—— 批量交付，以及"先存着，回头一起发"。
 *
 * ★★ 为什么分享失败**不是**错误弹窗而是提示改用复制：
 *   分享失败的原因绝大多数不在用户身上（浏览器不支持 / 用户点了取消），
 *   弹一个红色错误框只会让人觉得"这个功能坏了"。
 *   ⇒ 失败时一律给一句"用复制也一样"，把路留着。
 *   唯一的例外是复制也失败 —— 那确实没法子了，如实说。
 */

/** 单条反馈 → 可读文本（用于分享 / 复制 / 导出） */
export function formatFeedbackItem(item: FeedbackItem, seq?: number): string {
  const lines: string[] = [];
  const head = FEEDBACK_TEXT['fb.share.header'];
  lines.push(seq === undefined ? head : `${head} 第 ${seq} 条`);
  lines.push(FEEDBACK_TEXT['fb.share.divider']);
  lines.push(`${fb('fb.label.kind')}：${kindText(item.kind)}`);
  lines.push(`${fb('fb.label.submittedAt')}：${formatTimeAware(item.createdAt)}`);
  if (item.contact) {
    lines.push(fb('fb.share.contactLine', { contact: item.contact }));
  }
  lines.push('');
  lines.push(item.content);

  // 环境快照：空字段**不产出行**，避免出现「平台：（空）」
  const envLines = ENV_FIELDS.map((field) => {
    const raw = item.env[field];
    if (!raw) return '';
    return `${envLabel(field)}：${envValue(field, raw)}`;
  }).filter((line) => line !== '');
  if (envLines.length > 0) {
    lines.push('');
    lines.push(`— ${fb('fb.label.envTitle')} —`);
    lines.push(...envLines);
  }
  return lines.join('\n');
}

/** 多条反馈 → 一个文本包 */
export function formatFeedbackBundle(items: readonly FeedbackItem[]): string {
  const parts = items.map((it, i) => formatFeedbackItem(it, i + 1));
  return parts.join(`\n\n${FEEDBACK_TEXT['fb.share.divider']}\n\n`);
}

/** 导出的文件名（带日期，便于区分多次导出） */
function exportStamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export type ShareOutcome = 'shared' | 'copied' | 'failed';

/**
 * 把一段文本交出去：**先试系统分享，不行就复制**。
 *
 * ★ `navigator.share` 不存在时**不要**判成失败去报错 —— 那是正常情况
 *   （桌面浏览器就没有）。直接走复制，并返回 `'copied'` 让调用方提示"复制好了"。
 * ★ 用户**主动取消**分享（`AbortError`）也走复制：
 *   取消了不等于想复制，但给一份在剪贴板上总比什么都不给好，
 *   而且提示语是"复制好了"，不会让他以为东西发出去了。
 */
export async function shareOrCopy(text: string, title: string): Promise<ShareOutcome> {
  const nav = navigator as Navigator & {
    share?: (data: { title?: string; text?: string }) => Promise<void>;
  };
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title, text });
      return 'shared';
    } catch {
      /* 取消 / 不支持 / 无权限 —— 一律落到复制 */
    }
  }
  const copied = await copyText(text);
  return copied ? 'copied' : 'failed';
}

/** 批量导出为 .txt（人读） */
export function exportFeedbackText(items: readonly FeedbackItem[]): string | null {
  if (items.length === 0) return null;
  const name = `ai-ai-feedback-${exportStamp()}.txt`;
  downloadText(formatFeedbackBundle(items), name);
  return name;
}

/** 批量导出为 .json（机器读 / 备份 / 将来想导回） */
export function exportFeedbackJson(items: readonly FeedbackItem[]): string | null {
  if (items.length === 0) return null;
  const name = `ai-ai-feedback-${exportStamp()}.json`;
  downloadJSON(
    {
      // ★ 带上导出时间与条数：一个裸数组文件过两个月就没人知道是什么时候导的了
      exportedAt: new Date().toISOString(),
      count: items.length,
      /** ★ 明确标注这是"本机"的一份，不是服务端的全量（免得误当成收件箱） */
      scope: 'local-device',
      items,
    },
    name,
  );
  return name;
}

/** 详情面板用：一行状态摘要 */
export function statusSummary(item: FeedbackItem): string {
  return `${kindText(item.kind)} · ${statusText(item.status)}`;
}
