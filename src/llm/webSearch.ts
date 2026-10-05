import { AppError, redact, toAppError } from '@/lib/errors';
import { log } from '@/store/logStore';
import { useSettingsStore } from '@/store/settingsStore';
import { WEB_SEARCH_PRESETS } from '@/constants/providers';
import { httpFetch } from './httpTransport';

/**
 * 联网搜索适配器（FN-45）。
 *
 * ★ 现实约束：绝大多数搜索 API **不允许浏览器跨域直连**（无 CORS 头）。
 *   这里只内置**明确支持 CORS** 的两家（Tavily / 博查），
 *   自定义项需要用户自己填一个支持跨域的代理地址。
 *   一旦 `fetch` 抛 TypeError（浏览器里的 CORS / DNS / 断网统一表现），
 *   归一化为 `LLM_CORS`，UI 用 `alt.corsProxy` 引导。
 *
 * 结果形态统一为 `{ title, url, snippet }`，方便 `buildSearchContextBlock()` 直接塞进提示词。
 */

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOptions {
  provider?: string;
  apiKey?: string;
  topK?: number;
  /** 自定义端点地址（provider='custom' 时必填） */
  endpoint?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface SearchPreset {
  provider: string;
  label: string;
  url: string;
  headers: (apiKey: string) => Record<string, string>;
  body: (query: string, topK: number, apiKey: string, includeImages: boolean) => unknown;
  parse: (json: unknown) => SearchResultItem[];
  /**
   * 从响应里抠出**图片直链**（2026-10-04 加，供「联网搜索表情包」用）。
   * ★ 返回空数组 = 这家服务不提供图片结果 —— 调用方据此走"让用户自己粘链接"的兜底，
   *   **不要**让用户以为"搜不出来就是我的关键词不对"。
   */
  parseImages?: (json: unknown) => string[];
}

/**
 * 从响应里找出「结果数组」：优先 `results`，其次 `data`，
 * 再次 `webPages.value`（博查的形状），都没有就空数组。
 */
function collectResultList(obj: Record<string, unknown>, resultsKey: string): unknown[] {
  const direct = obj[resultsKey];
  if (Array.isArray(direct)) return direct;
  const data = obj.data;
  if (Array.isArray(data)) return data;
  const webPages = obj.webPages;
  if (typeof webPages === 'object' && webPages !== null) {
    const value = (webPages as Record<string, unknown>).value;
    if (Array.isArray(value)) return value;
  }
  return [];
}

/** 从各种形状的搜索响应里抠出结果（宽容解析，缺字段就给空串） */
function parseGenericResults(json: unknown, resultsKey = 'results'): SearchResultItem[] {
  if (typeof json !== 'object' || json === null) return [];
  const obj = json as Record<string, unknown>;
  const list = collectResultList(obj, resultsKey);

  const out: SearchResultItem[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title : typeof rec.name === 'string' ? rec.name : '';
    const url = typeof rec.url === 'string' ? rec.url : typeof rec.link === 'string' ? rec.link : '';
    const snippet =
      typeof rec.content === 'string'
        ? rec.content
        : typeof rec.snippet === 'string'
          ? rec.snippet
          : typeof rec.summary === 'string'
            ? rec.summary
            : '';
    if (title || url || snippet) out.push({ title, url, snippet });
  }
  return out;
}

const PRESETS: readonly SearchPreset[] = [
  {
    provider: 'tavily',
    label: 'Tavily',
    url: 'https://api.tavily.com/search',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (query, topK, apiKey, includeImages) => ({
      api_key: apiKey,
      query,
      max_results: topK,
      search_depth: 'basic',
      include_answer: false,
      // ★ 「联网搜索表情包」时打开：Tavily 会额外返回一个 `images` 数组（图片直链）。
      //   默认不开 —— 普通联网搜索用不上图，白占响应体。
      ...(includeImages ? { include_images: true } : null),
    }),
    parse: (json) => parseGenericResults(json, 'results'),
    /**
     * Tavily 的图片结果在顶层 `images`（字符串数组）。
     * ★ 宽容解析：也接受 `{ url }` 对象形态 —— 服务端换过两次形状，
     *   写死不认会有一次静默失效（本次实现里已经因为同类原因改过一轮）。
     */
    parseImages: (json) => {
      if (typeof json !== 'object' || json === null) return [];
      const raw = (json as Record<string, unknown>).images;
      if (!Array.isArray(raw)) return [];
      return raw
        .map((x) => {
          if (typeof x === 'string') return x;
          if (typeof x === 'object' && x !== null) {
            const rec = x as Record<string, unknown>;
            return typeof rec.url === 'string' ? rec.url : '';
          }
          return '';
        })
        .filter((u) => u !== '');
    },
  },
  {
    provider: 'bocha',
    label: '博查',
    url: 'https://api.bochaai.com/v1/web-search',
    headers: (apiKey) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }),
    body: (query, topK) => ({ query, count: topK, summary: true }),
    parse: (json) => {
      // 博查把结果放在 data.webPages.value 里
      if (typeof json !== 'object' || json === null) return [];
      const data = (json as Record<string, unknown>).data;
      if (typeof data === 'object' && data !== null) {
        return parseGenericResults(data as Record<string, unknown>, 'webPages');
      }
      return parseGenericResults(json, 'results');
    },
    // ★ 博查的 `web-search` 接口**不返回图片**（它另有 image-search 端点，需要单独配置）。
    //   这里**故意不实现** parseImages，而不是"实现一个永远返回空的函数"——
    //   前者让调用方走"这家不提供图"的明确分支，后者会让界面说"没搜到结果"，
    //   把一个能力缺失伪装成一次搜索失败。
  },
];

/** 取预设（未知 provider 回落 Tavily） */
export function getSearchPreset(provider: string): SearchPreset | undefined {
  return PRESETS.find((p) => p.provider === provider);
}

/** 已内置的搜索服务商列表（设置页下拉用） */
export function listSearchProviders(): Array<{ provider: string; label: string; topK: number }> {
  return WEB_SEARCH_PRESETS.map((p) => ({ provider: p.provider, label: p.label, topK: p.topK }));
}

/** 执行搜索；返回统一形态的结果数组 */
export async function webSearch(query: string, options: WebSearchOptions = {}): Promise<SearchResultItem[]> {
  const q = query.trim();
  if (!q) return [];

  const store = useSettingsStore.getState();
  const cfg = store.settings.chat.webSearch;
  const provider = options.provider ?? cfg.provider ?? 'tavily';
  const apiKey = options.apiKey ?? cfg.apiKey ?? '';
  const topK = options.topK ?? cfg.topK ?? 5;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const preset = getSearchPreset(provider);
  const url = options.endpoint ?? preset?.url ?? '';
  if (!url) {
    throw new AppError('LLM_NO_PROVIDER', '自定义搜索服务还没填接口地址', undefined);
  }
  if (!apiKey && provider !== 'custom') {
    throw new AppError('LLM_AUTH', '搜索服务还没填密钥', redact({ provider }));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = preset
      ? preset.headers(apiKey)
      : { 'Content-Type': 'application/json', Authorization: apiKey ? `Bearer ${apiKey}` : '' };
    const body = preset ? preset.body(q, topK, apiKey, false) : { query: q, topK };

    const res = await httpFetch(url, {
      method: 'POST',
      headers,
      body,
      timeoutMs,
      signal: options.signal ?? controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AppError('LLM_BAD_RESPONSE', `搜索服务返回 HTTP ${res.status}`, redact({ status: res.status, text: text.slice(0, 200) }));
    }
    const json = (await res.json()) as unknown;
    const items = (preset?.parse(json) ?? parseGenericResults(json)).slice(0, topK);
    log.info('llm', '联网搜索完成', redact({ provider, count: items.length }), 'FN-45');
    return items;
  } catch (e) {
    const err = toAppError(e, 'LLM_CORS');
    log.warn('llm', '联网搜索失败', redact({ code: err.code, message: err.message }), 'FN-45');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 把搜索结果拼成可注入提示词的文本块 */
export function buildSearchContextBlock(items: readonly SearchResultItem[]): string {
  if (items.length === 0) return '';
  const lines = items.map((item, i) => {
    const title = item.title.trim() || item.url;
    const snippet = item.snippet.trim();
    return `[${i + 1}] ${title}${item.url ? `（${item.url}）` : ''}${snippet ? `\n${snippet}` : ''}`;
  });
  return ['【联网搜索结果】以下来自实时搜索，按需取用，不要编造未出现在下面的内容：', ...lines].join('\n');
}

/**
 * ★★ 搜图：走同一套搜索服务，但要**图片直链**（2026-10-04 加，供「联网搜索表情包」用）。
 *
 * ── 为什么要单独一个函数，而不是给 `webSearch()` 加个返回值 ─────────────
 *   两者的**失败语义不同**：
 *   · 普通搜索"没结果" = 这个词不好搜，换个词；
 *   · 搜图"没图" = 这家服务**根本不提供图片**，换词也没用。
 *   ⇒ 用一个 `supportsImages` 标志把后者显式表达出来，
 *     界面才能说对那句话（"这家搜索不提供图片"而不是"没搜到"）。
 *
 * ── 返回的图片链接**不能直接用**，必须过 `stickerSearch` 的校验 ──────────
 *   本函数只负责"拿到一串 URL"，**不做**协议/域名/尺寸判断 ——
 *   那是安全策略，属于 `features/stickers/stickerSearch.ts`（见那里的说明）。
 *   把校验放在这里会让 `llm/` 层承载业务安全策略，层次不对。
 */
export interface ImageSearchOutcome {
  urls: string[];
  /** 当前搜索服务是否支持返回图片。false ⇒ 界面应引导用户改用"粘贴图片链接" */
  supportsImages: boolean;
  provider: string;
}

export async function webSearchImages(
  query: string,
  options: WebSearchOptions = {},
): Promise<ImageSearchOutcome> {
  const q = query.trim();
  const store = useSettingsStore.getState();
  const cfg = store.settings.chat.webSearch;
  const provider = options.provider ?? cfg.provider ?? 'tavily';

  if (!q) return { urls: [], supportsImages: true, provider };

  const preset = getSearchPreset(provider);
  // 没有 `parseImages` ⇒ 这家不提供图。**不抛错**（不是异常，是能力边界）
  if (!preset?.parseImages) {
    return { urls: [], supportsImages: false, provider };
  }

  const apiKey = options.apiKey ?? cfg.apiKey ?? '';
  const topK = options.topK ?? Math.max(cfg.topK ?? 5, 8);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const url = options.endpoint ?? preset.url;

  if (!apiKey && provider !== 'custom') {
    throw new AppError('LLM_AUTH', '搜索服务还没填密钥', redact({ provider }));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await httpFetch(url, {
      method: 'POST',
      headers: preset.headers(apiKey),
      body: preset.body(q, topK, apiKey, true),
      timeoutMs,
      signal: options.signal ?? controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AppError(
        'LLM_BAD_RESPONSE',
        `搜索服务返回 HTTP ${res.status}`,
        redact({ status: res.status, text: text.slice(0, 200) }),
      );
    }
    const json = (await res.json()) as unknown;
    const urls = preset.parseImages(json);
    log.info('llm', '联网搜图完成', redact({ provider, count: urls.length }), 'FN-45');
    return { urls, supportsImages: true, provider };
  } catch (e) {
    const err = toAppError(e, 'LLM_CORS');
    log.warn('llm', '联网搜图失败', redact({ code: err.code, message: err.message }), 'FN-45');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
