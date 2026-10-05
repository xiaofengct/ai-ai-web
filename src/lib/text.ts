/**
 * 文本工具（架构文档 §2 `lib/text.ts`）：
 * 自动分割（FN-46 按标点/段落）、清洗（FN-04）、截断、相似度（Jaccard，记忆去重用）。
 */

/** 句子结束标点（中英文） */
const SENTENCE_END = /([。！？!?…]+["'”’）)\]]*)|([.!?]+(?:\s|$))/g;

/**
 * 自动分割：把长回复拆成多条（FN-46）。
 * 规则：优先按段落（\n\n）切，其次按句子结束标点切；单条不超过 maxChars。
 */
export function splitIntoMessages(text: string, maxChars = 220): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  // 先按段落切
  let chunks = trimmed.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (chunks.length <= 1) {
    // 再按句子切
    chunks = splitBySentence(trimmed);
  }

  // 合并过短的相邻片段，避免碎成一堆
  return packChunks(chunks, maxChars);
}

/** 按句子结束标点切分，保留标点 */
export function splitBySentence(text: string): string[] {
  const out: string[] = [];
  let last = 0;
  SENTENCE_END.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const piece = text.slice(last, end).trim();
    if (piece) out.push(piece);
    last = end;
  }
  const tail = text.slice(last).trim();
  if (tail) out.push(tail);
  return out.length ? out : [text];
}

/** 把片段装箱：相邻短片段合并，但不超过 maxChars */
function packChunks(chunks: readonly string[], maxChars: number): string[] {
  const out: string[] = [];
  let buf = '';
  for (const c of chunks) {
    if (!buf) {
      buf = c;
      continue;
    }
    if (buf.length + c.length + 1 <= maxChars) {
      buf = `${buf}\n${c}`;
    } else {
      out.push(buf);
      buf = c;
    }
  }
  if (buf) out.push(buf);
  // 仍然过长的（无标点的超长串）硬切
  return out.flatMap((s) => (s.length > maxChars * 2 ? hardSplit(s, maxChars * 2) : [s]));
}

function hardSplit(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** 清洗文本（FN-04 上下文清洗的「去空白」部分） */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 截断（带省略号） */
export function truncate(text: string, max: number, ellipsis = '…'): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - ellipsis.length))}${ellipsis}`;
}

/** 生成会话标题（取首条有效内容的前 N 字） */
export function makeTitle(text: string, max = 20): string {
  const oneLine = cleanText(text).replace(/\n/g, ' ');
  return truncate(oneLine, max) || '新的聊天';
}

/** 生成消息预览（去 Markdown 标记） */
export function makePreview(text: string, max = 60): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, '[代码]')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(plain, max);
}

/** 分词（CJK 按 2-gram，ASCII 按词）—— BM25 / Jaccard 共用 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const cjkParts = lower.match(/[㐀-䶿一-鿿]+/g) ?? [];
  const asciiParts = lower.match(/[a-z0-9_]+/g) ?? [];
  const grams: string[] = [];
  for (const seg of cjkParts) {
    if (seg.length === 1) grams.push(seg);
    for (let i = 0; i < seg.length - 1; i += 1) grams.push(seg.slice(i, i + 2));
  }
  return [...grams, ...asciiParts];
}

/** Jaccard 相似度（记忆去重 FN-57 / memory/dedupe.ts 用） */
export function jaccard(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/** 高亮关键词（搜索结果展示用，返回片段数组） */
export function highlightSnippets(text: string, keyword: string, radius = 30): string[] {
  if (!keyword) return [];
  const out: string[] = [];
  const lower = text.toLowerCase();
  const target = keyword.toLowerCase();
  let from = 0;
  while (from < text.length) {
    const idx = lower.indexOf(target, from);
    if (idx === -1) break;
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + target.length + radius);
    out.push(`${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`);
    from = idx + target.length;
    if (out.length >= 5) break;
  }
  return out;
}

/** 转义正则元字符 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 统计字数（中文按字，英文按词） */
export function countChars(text: string): number {
  return Array.from(text.trim()).length;
}

/**
 * 从一段自由文本里抠出 URL（2026-10-04 加，供「粘贴图片链接」用）。
 *
 * ★ 为什么要这个"宽容"的版本：用户复制链接时经常会**连上下文一起复制**
 *   （"这张图不错 https://x.com/a.png 收下了"），或者从聊天记录里带出引号、
 *   末尾标点。要求用户精确到"只粘 URL 本身"是不合理的 ——
 *   而 `new URL()` 对带尾巴的字符串会直接抛错，表现为"链接格式不对"，
 *   用户看不出问题出在哪（他明明粘对了）。
 *
 * ★ 实现上刻意**不用一个复杂的正则**：先粗筛候选（去掉常见包裹字符），
 *   再交给 `new URL()` 做严格校验 —— 校验交给标准库，本函数只负责"切出候选"。
 *   一个试图同时完成"切分 + 校验"的正则必然又长又错。
 */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // 粗筛：http(s) 开头，到空白/引号/中文标点/右括号为止
  const re = /https?:\/\/[^\s"'`<>()[\]{}，。、；：！？（）【】《》“”‘’]+/gi;
  for (const match of text.matchAll(re)) {
    // 去掉末尾可能粘连的英文标点（句号/逗号/分号/右括号）
    let raw = match[0].replace(/[.,;:!?)\]}]+$/, '');
    if (raw === '') continue;
    try {
      new URL(raw);
    } catch {
      continue; // 标准库说不是 URL ⇒ 不算候选（**校验归标准库**）
    }
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}
