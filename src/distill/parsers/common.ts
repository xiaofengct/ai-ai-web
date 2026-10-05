import { newId } from '@/lib/id';
import type { RawChunk, RawSourceKind } from '@/types/distill';

/**
 * 解析器公共工具（架构文档 §2 `src/distill/parsers/common.ts`）。
 *
 * 对应 ex-skill 各 `tools/*.py` 里重复出现的逻辑：
 * - 归一化消息行正则（`{时间} {发送人}: {内容}`）
 * - 系统消息 / 媒体占位符过滤
 * - 长消息 / 情感消息 / 日常消息分类（extract_key_content）
 * - CSV 容错解析（不用 PapaParse，避免再加依赖）
 */

/* ------------------------------ 归一化行解析 ------------------------------ */

/**
 * 常见聊天导出行：
 *   2024-01-01 10:00:00 小美: 消息内容
 *   2024/01/01 10:00 小美：消息内容
 *   2024-01-01 10:00 小美  消息内容（部分工具无冒号）
 */
export const MSG_LINE_PATTERN =
  /^(?:\s*\[?)?(?<time>\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?[\s\d:：]*)\]?\s+(?<sender>[^:：\n]{1,40}?)\s*[:：]\s*(?<content>.+)$/;

/** 无冒号变体：2024-01-01 10:00 小美 消息内容 */
export const MSG_LINE_NO_COLON_PATTERN =
  /^(?:\s*\[?)?(?<time>\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?[\s\d:：]*)\]?\s+(?<sender>\S{1,20})\s+(?<content>.+)$/;

/** 纯时间前缀（用于「时间行 + 内容行」混排的导出） */
export const TIME_ONLY_PATTERN = /^\s*\[?\s*(?<time>\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?[\s\d:：]*)\s*\]?\s*$/;

/**
 * ★ 系统消息 / 媒体占位符：一律跳过（ex-skill wechat_parser.py 的 skip_patterns）。
 * 这些占位没有文本信息，喂给 LLM 只会浪费 token（C6）。
 */
export const SKIP_PATTERNS: readonly string[] = [
  '[图片]',
  '[文件]',
  '[撤回了一条消息]',
  '[语音]',
  '[视频]',
  '[表情]',
  '[位置]',
  '[名片]',
  '[链接]',
  '[红包]',
  '[转账]',
  '[动画表情]',
  '[聊天记录]',
  '[通话]',
  '<img',
  '<video',
  '<audio',
  '该消息已撤回',
  '你已添加了',
  '现在可以开始聊天了',
  '以下是新消息',
  '以上为历史消息',
];

/** 是否该跳过（系统消息 / 媒体占位 / 空内容） */
export function shouldSkip(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return SKIP_PATTERNS.some((p) => t.includes(p));
}

/* ------------------------------- CSV 容错解析 ------------------------------- */

/**
 * 极简 CSV 解析：支持引号包裹、引号内逗号、CRLF。
 * 各导出工具方言不一（微信 / iMessage / 短信），这里只保证「不崩 + 合理切分」。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const body = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += ch;
  }
  row.push(field);
  rows.push(row);

  // 去掉全空行
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * CSV → 对象数组（表头宽松匹配：去空格、去 BOM、大小写不敏感）。
 * 找不到任何已知表头时返回空数组，由调用方降级为按列序号猜。
 */
export function csvToRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => normalizeHeader(h));
  return rows.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => {
      if (!h) return;
      rec[h] = (cells[i] ?? '').trim();
    });
    return rec;
  });
}

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]/g, '');
}

/** 从对象里按候选键顺序取第一个非空值（对应 Python 里的 row.get(a) or row.get(b) ...） */
export function pickField(rec: Record<string, string>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = rec[normalizeHeader(k)];
    if (v !== undefined && v.trim() !== '') return v.trim();
  }
  return '';
}

/* -------------------------------- 归一化输出 -------------------------------- */

export interface ChunkInit {
  time?: string;
  speaker?: string;
  text: string;
  meta?: Record<string, unknown>;
}

/** 构造 RawChunk（id 自动生成） */
export function makeChunk(kind: RawSourceKind, init: ChunkInit): RawChunk {
  return {
    id: newId(),
    kind,
    ...(init.time ? { time: init.time } : {}),
    ...(init.speaker ? { speaker: init.speaker } : {}),
    text: init.text,
    ...(init.meta ? { meta: init.meta } : {}),
  };
}

/** 目标过滤：target 为空时保留全部（用户不填昵称也能用） */
export function matchTarget(speaker: string, target?: string): boolean {
  if (!target || !target.trim()) return true;
  const t = target.trim();
  return speaker.includes(t) || t.includes(speaker);
}

/**
 * 时间字符串 → ISO 8601；解析不了就原样返回（不丢信息，LLM 也能读懂）。
 * 支持：2024-01-01 10:00 / 2024/01/01 10:00:00 / 2024年1月1日 / 纯数字毫秒 / 纯数字秒
 */
export function normalizeTime(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;

  // 纯数字：Android 短信是毫秒戳，Instagram 可能是秒戳
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && n > 0) {
      const ms = n > 1e12 ? n : n > 1e9 ? n * 1000 : Number.NaN;
      if (Number.isFinite(ms)) {
        const d = new Date(ms);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
      }
    }
    return s;
  }

  // 2024年1月1日 10:00
  const cn = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?(?:[\sT]*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (cn) {
    const [, y, m, d, hh = '0', mm = '0', ss = '0'] = cn;
    return toISO(`${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}`);
  }

  // 2024-01-01 10:00:00 / 2024/01/01 10:00
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const [, y, m, d, hh = '0', mm = '0', ss = '0'] = iso;
    return toISO(`${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}`);
  }

  // 已经是 ISO 或带时区
  const direct = new Date(s);
  if (!Number.isNaN(direct.getTime()) && /T|Z|[+-]\d{2}:?\d{2}$/.test(s)) {
    return direct.toISOString();
  }

  return s;
}

function pad(v: string | number): string {
  return String(v).padStart(2, '0');
}

function toISO(local: string): string | undefined {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
}

/** 去 HTML 标签（微博正文里混着 <a>、<span>） */
export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/** HTML 实体反转义（DOMParser 兜底路径用） */
export function decodeEntities(s: string): string {
  if (typeof document === 'undefined') return s;
  const el = document.createElement('textarea');
  el.innerHTML = s;
  return el.value;
}

/* ------------------------- 消息分类（extract_key_content） ------------------------- */

/**
 * 情感关键词（ex-skill 三个 parser 里各有一份，这里合并去重后统一维护）。
 * 用于把消息分成长消息 / 情感消息 / 日常消息，喂给 LLM 时权重不同。
 */
export const EMOTIONAL_KEYWORDS: readonly string[] = [
  '想你', '爱你', '喜欢', '讨厌', '生气', '难过', '开心', '高兴',
  '不开心', '委屈', '对不起', '分手', '在一起', '想见你', '好想',
  '心疼', '舍不得', '感动', '幸福', '孤独', '害怕', '担心',
  '吵架', '冷战', '和好', '原谅', '道歉', '伤心', '哭', '吻', '抱抱',
  'miss', 'love', 'sorry', 'happy', 'sad',
];

export interface ClassifiedChunks {
  long: RawChunk[];
  emotional: RawChunk[];
  daily: RawChunk[];
  total: number;
}

/** 分类：长消息（>50 字）→ 情感消息 → 日常消息 */
export function classifyChunks(chunks: readonly RawChunk[]): ClassifiedChunks {
  const long: RawChunk[] = [];
  const emotional: RawChunk[] = [];
  const daily: RawChunk[] = [];
  for (const c of chunks) {
    const text = c.text;
    if (text.length > 50) long.push(c);
    else if (EMOTIONAL_KEYWORDS.some((k) => text.includes(k))) emotional.push(c);
    else daily.push(c);
  }
  return { long, emotional, daily, total: chunks.length };
}

/** chunk → 单行文本（带时间前缀） */
export function chunkToLine(c: RawChunk): string {
  const ts = c.time ? `[${formatShortTime(c.time)}] ` : '';
  const who = c.speaker ? `${c.speaker}：` : '';
  return `${ts}${who}${c.text.replace(/\s*\n\s*/g, ' ⏎ ')}`;
}

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 把分类后的 chunks 渲染成给 LLM 看的「知识文本」（对应 ex-skill 的 format_output）。
 * 顺序 = 长消息 → 情感消息 → 日常消息（截断），保证高价值内容先进入上下文。
 */
export function formatKnowledge(
  chunks: readonly RawChunk[],
  opts: { title?: string; dailyLimit?: number } = {},
): string {
  const { title = '原材料提取结果', dailyLimit = 200 } = opts;
  const { long, emotional, daily, total } = classifyChunks(chunks);
  const lines: string[] = [`# ${title}`, `总条数：${total}`, '', '---', '', '## 长消息（心情/想法类，权重最高）', ''];
  for (const c of long) lines.push(chunkToLine(c), '');
  lines.push('---', '', '## 情感类消息', '');
  for (const c of emotional) lines.push(chunkToLine(c), '');
  lines.push('---', '', '## 日常沟通（风格参考）', '');
  for (const c of daily.slice(0, dailyLimit)) lines.push(chunkToLine(c));
  return lines.join('\n');
}

/* --------------------------------- 其它工具 --------------------------------- */

/** 抛进度（解析器内部分批调用，避免大文件卡死 UI） */
export function tick(onProgress?: (p: number) => void, p = 0): void {
  onProgress?.(Math.max(0, Math.min(1, p)));
}

/** 检查是否已取消 */
export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const e = new Error('aborted');
    e.name = 'AbortError';
    throw e;
  }
}

/** 睡眠一小段，让出主线程（解析上千条消息时不卡 UI） */
export async function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 文件名 → 小写扩展名（不含点） */
export function extOfName(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

/**
 * 按「消息行」解析通用聊天文本（wechat/imessage/sms 共用）。
 * 支持多行消息（续行缩进或纯文本行追加到上一条）。
 */
export function parseMessageLines(
  text: string,
  opts: { target?: string; kind: RawSourceKind; onProgress?: (p: number) => void },
): { chunks: RawChunk[]; rawCount: number; skipped: number; filtered: number } {
  const lines = text.split(/\r?\n/);
  const chunks: RawChunk[] = [];
  let rawCount = 0;
  let skipped = 0;
  let filtered = 0;
  let current: { time?: string; speaker: string; text: string } | null = null;

  const flush = (): void => {
    if (!current) return;
    const content = current.text.trim();
    if (shouldSkip(content)) {
      // 系统消息 / 媒体占位：直接丢弃（ex-skill 行为一致）
      skipped += 1;
    } else if (!matchTarget(current.speaker, opts.target)) {
      // ★ 目标过滤：只留她说的那部分（ex-skill 的 --target 语义），省 token（C6）
      filtered += 1;
    } else {
      chunks.push(
        makeChunk(opts.kind, {
          ...(current.time ? { time: current.time } : {}),
          speaker: current.speaker,
          text: content,
        }),
      );
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    if (i % 500 === 0) tick(opts.onProgress, i / Math.max(1, lines.length));
    const line = lines[i];
    if (!line.trim()) continue;

    const m = MSG_LINE_PATTERN.exec(line);
    if (m?.groups) {
      flush();
      rawCount += 1;
      const time = normalizeTime(m.groups.time ?? '');
      current = {
        ...(time ? { time } : {}),
        speaker: (m.groups.sender ?? '').trim(),
        text: m.groups.content ?? '',
      };
      continue;
    }

    // 行首是日期但没冒号 → 视为新消息（部分导出工具不加冒号）
    const m2 = MSG_LINE_NO_COLON_PATTERN.exec(line);
    if (m2?.groups) {
      flush();
      rawCount += 1;
      const time = normalizeTime(m2.groups.time ?? '');
      current = {
        ...(time ? { time } : {}),
        speaker: (m2.groups.sender ?? '').trim(),
        text: m2.groups.content ?? '',
      };
      continue;
    }

    // 续行：追加到当前消息（ex-skill 里用 "\n" 拼接多行消息）
    if (current) current.text += `\n${line}`;
  }
  flush();
  tick(opts.onProgress, 1);
  return { chunks, rawCount, skipped, filtered };
}
