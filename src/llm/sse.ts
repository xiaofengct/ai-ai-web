import { AppError, redact } from '@/lib/errors';
import { log } from '@/store/logStore';
import type { ChatChunk, TokenUsage } from './types';

/**
 * SSE 流式解析（架构文档 §2 `src/llm/sse.ts`）。
 *
 * ★ 验收要点①：`stream()` 必须能正确解析
 *   - `[DONE]` 终止标记；
 *   - **多个 `\n\n` 分隔**（即一次 `read()` 里含多个事件、或一个事件被拆到多次 `read()`）；
 *   - 中途断开（流结束但没收到 `[DONE]`，或网络错误）。
 *
 * 实现要点：
 * 1. 用 `TextDecoder({ stream: true })` 增量解码，避免多字节 UTF-8 字符被切在两次 read 之间而乱码；
 * 2. 事件缓冲区按空行切分，**只处理已完整的事件**，剩下的半截留在 buffer 里等下一次；
 * 3. 单个事件里可能有多条 `data:` 行（少数厂商会拆行），按 `\n` 拼接；
 * 4. JSON 解析失败只跳过该事件（可能是心跳 `: ping` 或非标准注释），不中断整个流；
 * 5. 结束但没见到 `[DONE]` → 调 `onIncomplete`，由上层决定是否降级（compat 的 `fallbackNonStream`）。
 */

/** OpenAI 的流结束标记 */
export const SSE_DONE = '[DONE]';

export interface SSEIterateOptions {
  signal?: AbortSignal;
  /** 流在未收到 `[DONE]` 的情况下结束（中途断开）时回调 */
  onIncomplete?: (reason: string) => void;
  /** 解析到 usage 时回调（便于上层累计 token） */
  onUsage?: (usage: TokenUsage) => void;
}

/** 从一个 SSE 事件块里取出 `data:` 的拼接内容（多行 data 用 \n 连接） */
export function extractEventData(event: string): string {
  const lines = event.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    // 注释行 / 心跳（`: ping`）直接忽略
    if (line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    dataLines.push(line.slice(5).trimStart());
  }
  return dataLines.join('\n');
}

/** 从单个 data 载荷解析出 ChatChunk；返回 null 表示「这一帧没有可输出的增量」 */
export function parseChunkPayload(payload: string): ChatChunk | null {
  const text = payload.trim();
  if (!text) return null;
  if (text === SSE_DONE) {
    return { delta: '', finishReason: 'stop' };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // 非 JSON（心跳、注释、厂商自定义 ping）→ 跳过，不打断流
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;

  const obj = json as Record<string, unknown>;

  // —— 增量文本：优先 OpenAI 形态，再兼容少数厂商的扁平字段 ——
  const choices = Array.isArray(obj.choices) ? (obj.choices as Record<string, unknown>[]) : undefined;
  let delta = '';
  let finishReason: string | null | undefined;

  if (choices && choices.length > 0) {
    const first = choices[0] ?? {};
    const deltaObj = first.delta;
    if (typeof deltaObj === 'string') {
      delta = deltaObj;
    } else if (typeof deltaObj === 'object' && deltaObj !== null) {
      const content = (deltaObj as Record<string, unknown>).content;
      if (typeof content === 'string') delta = content;
    }
    // 部分厂商把整段文本放在 message.content 上（非流式字段误用在流式里）
    if (!delta && typeof first.text === 'string') delta = first.text;
    if (!delta && typeof first.message === 'object' && first.message !== null) {
      const content = (first.message as Record<string, unknown>).content;
      if (typeof content === 'string') delta = content;
    }
    if (typeof first.finish_reason === 'string') finishReason = first.finish_reason;
  } else if (typeof obj.content === 'string') {
    delta = obj.content;
  } else if (typeof obj.text === 'string') {
    delta = obj.text;
  } else if (typeof obj.response === 'string') {
    delta = obj.response;
  }

  if (typeof obj.finish_reason === 'string') finishReason = obj.finish_reason;

  const usage = pickUsage(obj.usage);
  if (delta.length === 0 && !finishReason && !usage) return null;

  return { delta, finishReason: finishReason ?? null, usage };
}

/** usage 字段容错：prompt_tokens / input_tokens 等别名 */
export function pickUsage(raw: unknown): TokenUsage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const u = raw as Record<string, unknown>;
  const num = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = u[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return undefined;
  };
  const promptTokens = num('prompt_tokens', 'input_tokens', 'promptTokens');
  const completionTokens = num('completion_tokens', 'output_tokens', 'completionTokens');
  const totalTokens = num('total_tokens', 'totalTokens');
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}

/**
 * 把 `ReadableStream<Uint8Array>` 解析为 `AsyncIterable<ChatChunk>`。
 * 不抛业务错误：网络层错误由 `fetch` 自身抛出，这里只负责解析与「不完整流」的上报。
 */
export async function* iterateSSE(
  stream: ReadableStream<Uint8Array>,
  options: SSEIterateOptions = {},
): AsyncGenerator<ChatChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let sawDone = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (options.signal?.aborted) break;

      buffer += decoder.decode(value, { stream: true });

      // 空行分隔事件；只处理完整事件，残余留到下一轮
      let sep: EventSeparator | null = findEventSeparator(buffer);
      while (sep !== null) {
        const event = buffer.slice(0, sep.index);
        buffer = buffer.slice(sep.end);
        const payload = extractEventData(event);
        if (payload) {
          if (payload.trim() === SSE_DONE) {
            sawDone = true;
          } else {
            const chunk = parseChunkPayload(payload);
            if (chunk) {
              if (chunk.usage && options.onUsage) options.onUsage(chunk.usage);
              yield chunk;
            }
          }
        }
        sep = findEventSeparator(buffer);
      }
    }

    // 收尾：把最后一段没有分隔符的残余也处理掉（部分实现结尾不加空行）
    buffer += decoder.decode();
    const tail = extractEventData(buffer);
    if (tail) {
      if (tail.trim() === SSE_DONE) sawDone = true;
      else {
        const chunk = parseChunkPayload(tail);
        if (chunk) {
          if (chunk.usage && options.onUsage) options.onUsage(chunk.usage);
          yield chunk;
        }
      }
    }

    if (!sawDone && !options.signal?.aborted) {
      // ★ 中途断开：不抛错（已有内容要保留），交给上层决定是否降级为非流式
      options.onIncomplete?.('stream ended without [DONE]');
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* 已释放 */
    }
  }
}

/** 找到事件分隔符的位置（支持 \n\n 与 \r\n\r\n） */
interface EventSeparator {
  index: number;
  end: number;
}

function findEventSeparator(buffer: string): EventSeparator | null {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return null;
  if (crlf === -1) return { index: lf, end: lf + 2 };
  if (lf === -1) return { index: crlf, end: crlf + 4 };
  // 取靠前的那个（\r\n\r\n 里也含 \n，但 indexOf('\n\n') 对 "\r\n\r\n" 会命中 \n\r\n 之外的位置，
  // 这里统一按更短的 offset 判断，实际上 \r\n\r\n 的 \n\n 出现在 index+1，取 crlf 更准确）
  return crlf <= lf ? { index: crlf, end: crlf + 4 } : { index: lf, end: lf + 2 };
}

/**
 * 从 `Response` 直接解析（含 HTTP 状态校验）。
 * 非 2xx → 按状态码归一化为 AppError 抛出（4xx 不重试、5xx 可重试，见 errors.ts）。
 */
export async function* streamFromResponse(
  response: Response,
  options: SSEIterateOptions = {},
): AsyncGenerator<ChatChunk> {
  if (!response.ok) {
    const body = await safeReadText(response);
    throw new AppError(
      statusToCode(response.status),
      `请求失败（HTTP ${response.status}）`,
      redact({ status: response.status, body }),
    );
  }
  if (!response.body) {
    throw new AppError('LLM_BAD_RESPONSE', '响应没有可读的流（body 为空）', undefined);
  }
  yield* iterateSSE(response.body, options);
}

/** 安全读取响应文本（不抛错，超时/中断时返回空串） */
export async function safeReadText(response: Response, limit = 2000): Promise<string> {
  try {
    const text = await response.text();
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  } catch {
    return '';
  }
}

/** HTTP 状态码 → 错误码（与 lib/errors.ts 的 httpErrorToAppError 保持一致） */
export function statusToCode(status: number): string {
  if (status === 401 || status === 403) return 'LLM_AUTH';
  if (status === 408 || status === 504) return 'LLM_TIMEOUT';
  if (status === 429) return 'LLM_RATE_LIMIT';
  if (status >= 500) return 'LLM_BAD_RESPONSE';
  return 'LLM_BAD_RESPONSE';
}

/** 纯文本形式的 SSE 解析（单测 / 兼容模式下的非流式文本兜底用） */
export function parseSSEText(text: string): ChatChunk[] {
  const out: ChatChunk[] = [];
  const events = text.split(/\r?\n\r?\n/);
  for (const event of events) {
    const payload = extractEventData(event);
    if (!payload) continue;
    const chunk = parseChunkPayload(payload);
    if (chunk) out.push(chunk);
  }
  return out;
}

/** 把若干 chunk 合并成完整文本（非流式降级时把「假流式」收成一句） */
export function joinChunks(chunks: readonly ChatChunk[]): string {
  return chunks.map((c) => c.delta).join('');
}

/** 解析过程中出现非致命问题时写一条 debug 日志（便于开发者页排查） */
export function logSseIssue(message: string, detail?: unknown): void {
  log.debug('llm', message, detail, 'FN-11');
}
