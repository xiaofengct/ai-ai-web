import { log } from '@/store/logStore';
import type { ChatSettings } from '@/types/settings';

/**
 * ★ 内容过滤（FN-12）：入站 / 出站**双向**，词表命中后替换或截断，并记日志。
 *
 * 设计取舍：
 * - 入站（用户说的话）与出站（模型回的话）用同一套词表与模式，但**分开计数**，
 *   便于开发者页看清「拦的是谁的」；
 * - 日志里**不写明文命中词**（只写命中条数与位置），避免日志本身变成敏感内容泄露口；
 * - 过滤只做「文本处理」，不做道德判断，也不阻断发送流程。
 */

export interface FilterConfig {
  enabled: boolean;
  words: string[];
  mode: 'replace' | 'truncate';
}

export type FilterDirection = 'inbound' | 'outbound';

const REPLACEMENT = '***';

export class ContentFilter {
  private config: FilterConfig = { enabled: false, words: [], mode: 'replace' };
  private counters: Record<FilterDirection, number> = { inbound: 0, outbound: 0 };

  /** 更新配置（由设置页 / chatStore 调用） */
  configure(config: Partial<FilterConfig> | ChatSettings['contentFilter']): void {
    const words = (config.words ?? this.config.words).filter((w) => w.trim().length > 0);
    this.config = {
      enabled: config.enabled ?? this.config.enabled,
      words,
      mode: config.mode ?? this.config.mode,
    };
  }

  /** 当前配置快照（只读） */
  snapshot(): FilterConfig {
    return { ...this.config, words: [...this.config.words] };
  }

  /** 命中次数（开发者页展示） */
  hitCount(direction: FilterDirection): number {
    return this.counters[direction];
  }

  resetCounters(): void {
    this.counters = { inbound: 0, outbound: 0 };
  }

  /** 检测命中了哪些词（不做替换） */
  hits(text: string): string[] {
    if (!this.config.enabled || this.config.words.length === 0 || !text) return [];
    const lower = text.toLowerCase();
    return this.config.words.filter((w) => w.trim() && lower.includes(w.trim().toLowerCase()));
  }

  /** 入站过滤：用户发送前 */
  inbound(text: string): string {
    return this.apply(text, 'inbound');
  }

  /** 出站过滤：模型输出渲染前 */
  outbound(text: string): string {
    return this.apply(text, 'outbound');
  }

  private apply(text: string, direction: FilterDirection): string {
    if (!this.config.enabled || !text || this.config.words.length === 0) return text;

    const found = this.hits(text);
    if (found.length === 0) return text;

    this.counters[direction] += found.length;
    // ★ 只记「命中了几条 / 哪个方向」，不记明文（日志脱敏约定 §6.3）
    log.info(
      'llm',
      `内容过滤命中（${direction === 'inbound' ? '入站' : '出站'}）`,
      { direction, count: found.length, mode: this.config.mode },
      'FN-12',
    );

    if (this.config.mode === 'truncate') {
      // 截断模式：从**最靠前**的命中位置切断
      const lower = text.toLowerCase();
      let cutAt = text.length;
      for (const word of this.config.words) {
        const w = word.trim();
        if (!w) continue;
        const idx = lower.indexOf(w.toLowerCase());
        if (idx !== -1 && idx < cutAt) cutAt = idx;
      }
      return text.slice(0, cutAt).trimEnd();
    }

    // 替换模式：全局替换（大小写不敏感）
    let out = text;
    for (const word of this.config.words) {
      const w = word.trim();
      if (!w) continue;
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(escaped, 'gi'), REPLACEMENT);
    }
    return out;
  }
}

/** 全局单例（LLM 层与 chatStore 共用一份计数） */
export const contentFilter = new ContentFilter();

/** 从 ChatSettings 同步配置到单例 */
export function syncContentFilter(settings: ChatSettings): void {
  contentFilter.configure(settings.contentFilter);
}
