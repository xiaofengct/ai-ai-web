import { newId } from '@/lib/id';
import { nowISO } from '@/lib/time';
import { AppError, toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { llmClient } from '@/llm/client';
import { personaCompiler } from '@/persona/PersonaCompiler';
import type { Message } from '@/types/chat';
import type { PersonaCard } from '@/types/persona';
import type { ChatSettings } from '@/types/settings';
import type { MemoryEntry, SummaryRange } from '@/types/memory';

/**
 * ★ 自动 / 手动总结（架构文档 §2 `src/memory/summarizer.ts`、§3.10 `MemorySummarizer`）。
 *
 * 流程：`PersonaCompiler.buildSummary()` 装提示词 → `llmClient.complete()`（**非流式**，要结构化输出）
 * → 解析 JSON → 容错 → 产出 `MemoryEntry[]`。
 *
 * ★ 容错三道（小模型很爱在 JSON 外面裹东西）：
 * 1. 去掉 ```json 代码围栏；
 * 2. 截取第一个 `[` 到最后一个 `]`；
 * 3. 仍然失败 → 退化为「整段按行切成若干条」，**绝不因为解析失败就丢掉这次总结**。
 */

export interface SummarizeArgs {
  persona: PersonaCard;
  messages: Message[];
  range: SummaryRange;
  settings: ChatSettings;
  signal?: AbortSignal;
  /** 覆盖默认模型（蒸馏时用分析模型） */
  model?: string;
}

interface RawMemoryItem {
  /** 部分模型会写成 text / memory 而不是 content，这里一并容忍 */
  content?: unknown;
  text?: unknown;
  memory?: unknown;
  tags?: unknown;
  score?: unknown;
  timeRef?: unknown;
}

export class MemorySummarizerImpl {
  /** 总结一段对话 → 记忆条目（**不落库**，落库交给 `memory/dedupe.ts`） */
  async summarize(args: SummarizeArgs): Promise<MemoryEntry[]> {
    if (args.messages.length === 0) return [];

    const built = personaCompiler.buildSummary({
      persona: args.persona,
      range: args.range,
      messages: args.messages,
      settings: args.settings,
    });

    let text = '';
    try {
      text = await llmClient.complete({
        messages: built.messages,
        params: { ...args.settings.params, temperature: 0.3, maxTokens: 2048 },
        responseFormat: 'json',
        stream: false,
        signal: args.signal,
        ...(args.model ? { model: args.model } : {}),
      });
    } catch (e) {
      const err = toAppError(e);
      log.warn('memory', '总结失败', { code: err.code }, 'FN-48');
      throw err;
    }

    const items = parseMemoryJson(text);
    const sessionId = args.messages[0]?.sessionId;
    const sourceIds = args.messages.map((m) => m.id);
    const now = nowISO();

    return items.map((item) => ({
      id: newId(),
      sessionId,
      personaId: args.persona.id,
      content: item.content,
      tags: item.tags,
      score: item.score ?? 0.8,
      sourceMessageIds: sourceIds,
      timeRef: item.timeRef ?? now,
      createdAt: now,
      updatedAt: now,
    }));
  }
}

/** 全局单例 */
export const memorySummarizer = new MemorySummarizerImpl();

export default memorySummarizer;

/**
 * 解析模型返回的 JSON 记忆数组。
 * 抛 `PARSE_FAIL` 只在「连一个 `[` 都找不到」时——那种情况确实没法救。
 */
export function parseMemoryJson(text: string): Array<{ content: string; tags: string[]; score?: number; timeRef?: string }> {
  const cleaned = stripCodeFence(text);
  const slice = extractJsonArray(cleaned);

  if (slice) {
    try {
      const parsed = JSON.parse(slice) as unknown;
      if (Array.isArray(parsed)) {
        const out = normalizeItems(parsed);
        if (out.length > 0) return out;
      }
    } catch {
      // 落到下面的「按行退化」
    }
  }

  // 退化：按行切，每行一条（去序号、去引号、去 markdown 列表符号）
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*·\d]+[.、)）]?\s*/, '').replace(/^["'「」【】\[\]]+|["'「」【】\[\]]+$/g, '').trim())
    .filter((line) => line.length >= 4 && !line.startsWith('```'));

  if (lines.length === 0) {
    throw new AppError('PARSE_FAIL', '总结结果里没有可解析的记忆条目', { preview: text.slice(0, 200) });
  }
  return lines.map((line) => ({ content: line.slice(0, 200), tags: [] }));
}

/** 去掉 ```json / ``` 围栏 */
export function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/** 截取第一个 `[` 到最后一个 `]`（含） */
export function extractJsonArray(text: string): string | undefined {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return undefined;
  return text.slice(start, end + 1);
}

/** 把模型给的任意形状收敛成标准条目 */
function normalizeItems(parsed: readonly unknown[]): Array<{ content: string; tags: string[]; score?: number; timeRef?: string }> {
  const out: Array<{ content: string; tags: string[]; score?: number; timeRef?: string }> = [];

  for (const raw of parsed) {
    if (typeof raw === 'string') {
      const content = raw.trim();
      if (content) out.push({ content, tags: [] });
      continue;
    }
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as RawMemoryItem;

    const content = typeof item.content === 'string'
      ? item.content.trim()
      : typeof item.text === 'string'
        ? item.text.trim()
        : typeof item.memory === 'string'
          ? item.memory.trim()
          : '';
    if (!content) continue;

    const tags = Array.isArray(item.tags)
      ? item.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
      : typeof item.tags === 'string' && item.tags.trim()
        ? item.tags.split(/[,，、\s]+/).filter(Boolean)
        : [];

    const score = typeof item.score === 'number' && Number.isFinite(item.score)
      ? Math.min(1, Math.max(0, item.score))
      : undefined;

    const timeRef = typeof item.timeRef === 'string' ? item.timeRef : undefined;

    out.push({ content: content.slice(0, 500), tags, score, timeRef });
  }

  return out;
}
