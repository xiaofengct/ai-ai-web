import { AppError } from '@/lib/errors';
import { readText } from '@/lib/file';
import type { RawChunk } from '@/types/distill';
import { extOfName, makeChunk, normalizeTime, shouldSkip, stripHtml, tick } from './common';
import type { ParseInput, ParseOptions, RawParser, SocialPlatform, UnavailableMode } from './types';
import { dt } from '../copy';

/**
 * 社交媒体解析器（TS 重写 `tools/social_media_parser.py`，EX-05）。
 *
 * 支持平台：微博 / 豆瓣 / 小红书 / Instagram / 通用文本。
 * ★ 各平台导出格式**极不稳定**（PRD EX-05），所以这里的原则是：
 *   1. 优先按已知字段结构解析；
 *   2. 结构不认识 → 尝试「任意数组 / 任意含 text 的对象」通用扫描；
 *   3. 还是不行 → 当纯文本按分隔符切分（`alt.genericTextFallback`）。
 *   永远不因为格式不对就报错让用户重导。
 */

export const SOCIAL_PLATFORM_LABEL: Record<SocialPlatform, string> = {
  weibo: '微博',
  douban: '豆瓣',
  xiaohongshu: '小红书',
  instagram: 'Instagram',
  text: '通用文本',
  auto: '自动识别',
};

export const SOCIAL_UNAVAILABLE_MODES: readonly UnavailableMode[] = [
  {
    id: 'social-online-scrape',
    label: '联网抓取她的主页',
    reason: dt('distill.sources.reason.socialOnlineScrape'),
    altKey: 'alt.noEquivalent',
    featureId: 'EX-05',
  },
];

export const socialParser: RawParser = {
  kind: 'social',
  label: '社交媒体导出',
  accept: ['json', 'txt', 'csv', 'html', 'md'],
  featureId: 'EX-05',
  unavailableModes: SOCIAL_UNAVAILABLE_MODES,

  available: () => true,

  parse: async (input: ParseInput, opts: ParseOptions = {}): Promise<RawChunk[]> => {
    const file = input.file;
    if (!file) throw new AppError('PARSE_FAIL', '社交媒体解析器需要文件输入');

    const text = await readText(file);
    tick(opts.onProgress, 0.1);

    const ext = extOfName(file.name);
    const platform: SocialPlatform = input.platform ?? 'auto';

    // 能解析成 JSON 就走结构化路径，否则一律当文本
    const maybeJson = ext === 'json' || looksLikeJson(text);
    if (maybeJson) {
      let data: unknown;
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        return parseSocialText(text, platform, opts);
      }
      const resolved: SocialPlatform = platform === 'auto' ? detectPlatform(data) : platform;
      const items = extractItems(data);
      const chunks = items
        .map((it) => buildPost(resolved, it, opts))
        .filter((c): c is RawChunk => c !== null);
      if (chunks.length > 0) {
        tick(opts.onProgress, 1);
        return chunks;
      }
      // JSON 结构不认识 → 兜底：把整个 JSON 当文本
      return parseSocialText(JSON.stringify(data).slice(0, 50000), 'text', opts);
    }

    return parseSocialText(text, platform === 'auto' ? 'text' : platform, opts);
  },
};

/* ------------------------------ 结构化提取 ------------------------------ */

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

/** 自动识别平台：看顶层键与条目字段 */
function detectPlatform(data: unknown): SocialPlatform {
  if (Array.isArray(data)) return 'text';
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj).map((k) => k.toLowerCase());
  if (keys.includes('statuses') || keys.includes('weibos')) return 'weibo';
  if (keys.includes('posts')) return 'instagram';
  if (keys.includes('douban')) return 'douban';
  return 'text';
}

/** 从各种形状里捞出条目数组（微博 statuses / 小红书 data / IG posts / 裸数组 …） */
function extractItems(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (!isRecord(data)) return [];
  const candidates = ['statuses', 'weibos', 'data', 'posts', 'items', 'list', 'notes', 'records'];
  for (const key of candidates) {
    const v = data[key];
    if (Array.isArray(v)) return v.filter(isRecord);
    if (isRecord(v)) {
      for (const k of candidates) {
        if (Array.isArray(v[k])) return (v[k] as unknown[]).filter(isRecord);
      }
      return [v];
    }
  }
  // 顶层就是一条帖子
  return [data];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function buildPost(platform: SocialPlatform, item: Record<string, unknown>, opts: ParseOptions): RawChunk | null {
  const author = firstStr(item, ['author', 'nickname', 'screen_name', 'name', 'user_name', 'username']);
  const user = isRecord(item.user) ? (item.user as Record<string, unknown>) : undefined;
  const authorName = author || (user ? firstStr(user, ['screen_name', 'nickname', 'name']) : '');
  // target 过滤只在「有作者字段」时生效（很多导出没有作者信息，不能误杀）
  if (opts.target && authorName && !authorName.includes(opts.target)) return null;

  const rawText =
    firstStr(item, ['text', 'content', 'desc', 'abstract', 'body', 'caption', 'title']) ||
    (user ? firstStr(user, ['description']) : '');
  const title = firstStr(item, ['title', 'subject']);
  const desc = firstStr(item, ['desc', 'content', 'text', 'abstract']);
  let text = platform === 'xiaohongshu' && title ? `${title}\n${desc}`.trim() : rawText || desc;
  text = stripHtml(text).trim();

  if (!text || shouldSkip(text)) return null;

  const dateRaw = firstStr(item, ['created_at', 'time', 'date', 'created', 'creation_timestamp', 'timestamp']);
  const date = normalizeTime(dateRaw);
  const likes = firstNum(item, ['attitudes_count', 'likes', 'liked_count', 'like_count', 'favorite_count']);
  const comments = firstNum(item, ['comments_count', 'comments', 'comment_count']);

  return makeChunk('social', {
    ...(date ? { time: date } : {}),
    ...(authorName ? { speaker: authorName } : {}),
    text,
    meta: {
      platform: SOCIAL_PLATFORM_LABEL[platform],
      likes,
      comments,
    },
  });
}

function firstStr(rec: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return '';
}

function firstNum(rec: Record<string, unknown>, keys: readonly string[]): number {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  }
  return 0;
}

/* ------------------------------- 文本兜底 ------------------------------- */

/**
 * 通用文本切分（对应 Python 的 `re.split(r"\n={3,}\n|\n-{3,}\n|\n\n\n+")`）。
 * ★ 容错：切不出条目时整篇当一条；依然保留，绝不丢弃用户内容。
 */
function parseSocialText(text: string, platform: SocialPlatform, opts: ParseOptions): RawChunk[] {
  const entries = text
    .split(/\n={3,}\n|\n-{3,}\n|\n\*{3,}\n|\n\n\n+/)
    .map((s) => s.trim())
    .filter((s) => s && !shouldSkip(s));

  const pool = entries.length > 0 ? entries : [text.trim()].filter(Boolean);
  const chunks: RawChunk[] = pool.map((entry, i) => {
    if (i % 100 === 0) tick(opts.onProgress, i / Math.max(1, pool.length));
    const dateMatch = entry.match(/(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?)/);
    const date = dateMatch ? normalizeTime(dateMatch[1]) : undefined;
    return makeChunk('social', {
      ...(date ? { time: date } : {}),
      text: stripHtml(entry),
      meta: { platform: SOCIAL_PLATFORM_LABEL[platform] },
    });
  });

  tick(opts.onProgress, 1);
  return chunks;
}

export default socialParser;
