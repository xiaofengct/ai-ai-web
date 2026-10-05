/**
 * ★★ 联网搜索表情包 —— 结果校验与筛选（2026-10-04 加）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这个文件存在的唯一理由：**把"能显示"和"能收下"分开**
 * ═══════════════════════════════════════════════════════════════════════════
 * `llm/webSearch.ts` 的 `webSearchImages()` 返回的是一串**完全未校验的 URL**。
 * 那串东西不能直接入库、也不能直接渲染，因为：
 *   · `javascript:` / `data:` 伪协议可以执行代码或塞进任意内容；
 *   · `http://` 明文可被中间人替换成任何图；
 *   · 超大图会让 WebView 内存爆掉（一张 8000×8000 的 PNG 解码后是 250MB）；
 *   · 有明确的成人内容域名不该出现在"表情包搜索结果"里。
 *
 * ── ★★ 内容安全：必须如实说明**做不到**什么 ──────────────────────────────
 * **无法做像素级内容审核。** 原因是技术性的、无法绕过：
 *   跨域图片一旦画进 `<canvas>`，画布会被标记为 **tainted**，
 *   `getImageData()` 直接抛 SecurityError —— 拿不到像素，也就无从判断内容。
 *   要拿像素就得先下载（`fetch`），而那需要对方发 CORS 头，绝大多数图床不发。
 *
 * ⇒ 所以本模块只能做**四道**能做的关，并在界面上**明确告诉用户**：
 *   ① 协议白名单：只收 `https:`（挡明文篡改，也挡 `javascript:`/`data:` 伪协议）
 *   ② 域名黑名单：成人/盗图站直接剔除
 *   ③ 疑似直链校验：URL 路径要像图片（扩展名或图床特征），否则大概率是网页不是图
 *   ④ **用户逐张点选**，不做"搜到什么就自动入库"
 *
 * ★ 换个说法：这条路定位是**"用户主动挑选自己要用的表情"**，不是自动采集。
 *   最终"这张图适不适合"的判断在用户手上 —— 这不是推卸责任，
 *   而是**能力边界**：既然拿不到像素，任何声称"已自动审核"的说法都是假的。
 *   假的安全承诺比没有承诺更危险（用户会据此放松警惕）。
 */

/** 协议白名单：只收 https */
const ALLOWED_PROTOCOLS = new Set(['https:']);

/**
 * 域名黑名单（**子串匹配**，覆盖子域）。
 *
 * ★ 这份名单**不求全**（没人能穷举），求的是"挡住最常见的几类"：
 *   成人内容站、已知图库站（大量同类图刷屏）、以及明显的追踪/短链跳转站。
 * ★ 每条都写清理由 —— 一条不知为何存在的黑名单规则，
 *   将来没人敢删，而它可能早已失效或误伤。
 */
const DOMAIN_BLOCKLIST: readonly { pattern: string; why: string }[] = [
  // 成人内容（表情包搜索最容易撞上的一类）
  { pattern: 'pornhub', why: '成人内容站' },
  { pattern: 'xvideos', why: '成人内容站' },
  { pattern: 'xnxx', why: '成人内容站' },
  { pattern: 'redtube', why: '成人内容站' },
  { pattern: 'onlyfans', why: '成人内容站' },
  { pattern: 'hentai', why: '成人内容站' },
  { pattern: 'nhentai', why: '成人内容站' },
  { pattern: 'rule34', why: '成人内容站' },
  { pattern: 'e-hentai', why: '成人内容站' },
  { pattern: 'danbooru', why: '含成人内容的图库' },
  { pattern: 'gelbooru', why: '含成人内容的图库' },
  // 短链/跳转站：拿到的 URL 不是终态，图会失效或跳到任意页面
  { pattern: 'bit.ly', why: '短链，指向不确定' },
  { pattern: 't.co/', why: '短链，指向不确定' },
  { pattern: 'dwz.cn', why: '短链，指向不确定' },
];

/** 图床/常见图片 CDN 的域名特征（命中则**放宽**扩展名要求） */
const LIKELY_IMAGE_HOSTS: readonly string[] = [
  'imgur',
  'i.pinimg',
  'pinimg',
  'giphy',
  'tenor',
  'gstatic',
  'twimg',
  'sinaimg',
  'hdslb',
  'zhimg',
  'qpic',
  'alicdn',
  'jd.com',
  '360buyimg',
  'qlogo',
];

export type StickerCandidateReject =
  | 'badProtocol'
  | 'blockedDomain'
  | 'notAnImage'
  | 'duplicate'
  | 'malformed';

export interface StickerSearchCandidate {
  url: string;
  /** 文件名（从 URL 末段推；仅用于入库时的条目名） */
  fileName?: string;
  /** 展示用域名（不显示完整 URL —— 又长又难看，用户只需要知道来自哪家） */
  host: string;
  /** 默认语义标签（用户可改） */
  description: string;
}

export interface StickerSearchReport {
  /** 可选的候选 */
  candidates: StickerSearchCandidate[];
  /** 被剔除的明细（界面在"展开详情"里给出 —— 不静默丢弃） */
  rejected: Array<{ url: string; reason: StickerCandidateReject }>;
  /** 当前搜索服务是否支持返回图片 */
  supportsImages: boolean;
}

/** 解析 URL 并取域名（失败返回 null） */
function safeHost(raw: string): { url: URL; host: string } | null {
  try {
    const u = new URL(raw);
    return { url: u, host: u.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

function isBlocked(host: string): boolean {
  return DOMAIN_BLOCKLIST.some((b) => host.includes(b.pattern));
}

function isLikelyImageHost(host: string): boolean {
  return LIKELY_IMAGE_HOSTS.some((h) => host.includes(h));
}

/** URL 路径是否像图片（扩展名判断） */
function looksLikeImagePath(pathname: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(pathname);
}

/**
 * 校验一批 URL，产出可选候选。
 *
 * @param urls  `webSearchImages()` 返回的原始链接
 * @param query 用户搜的词，用于生成默认语义标签
 * @param limit 最多返回多少张（**默认 24**：一屏能看完，也避免一次加塞太多）
 */
export function screenStickerUrls(
  urls: readonly string[],
  query: string,
  limit = 24,
): StickerSearchReport {
  const candidates: StickerSearchCandidate[] = [];
  const rejected: StickerSearchReport['rejected'] = [];
  const seen = new Set<string>();

  for (const raw of urls) {
    if (candidates.length >= limit) break;
    const trimmed = raw.trim();

    const parsed = safeHost(trimmed);
    if (!parsed) {
      rejected.push({ url: trimmed, reason: 'malformed' });
      continue;
    }
    const { url, host } = parsed;

    // ① 协议白名单
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
      rejected.push({ url: trimmed, reason: 'badProtocol' });
      continue;
    }
    // ② 域名黑名单
    if (isBlocked(host)) {
      rejected.push({ url: trimmed, reason: 'blockedDomain' });
      continue;
    }
    // ③ 像不像图片：已知图床放宽（它们的 URL 常没有扩展名，如 giphy 的 `/media/xxx/giphy.gif` 有，
    //    但 imgur 的 `i.imgur.com/abc` 没有）
    if (!looksLikeImagePath(url.pathname) && !isLikelyImageHost(host)) {
      rejected.push({ url: trimmed, reason: 'notAnImage' });
      continue;
    }
    // ④ 去重（同一张图可能被多个结果引用）
    const key = url.origin + url.pathname;
    if (seen.has(key)) {
      rejected.push({ url: trimmed, reason: 'duplicate' });
      continue;
    }
    seen.add(key);

    candidates.push({
      url: trimmed,
      host,
      fileName: url.pathname.split('/').pop() || 'remote',
      // ★ 默认标签 = 用户搜的词。这是**零成本且可预期**的选择：
      //   我们看不到图，猜不出"这张是生气还是开心"，但"用户搜什么就标什么"
      //   至少保证标签与用户意图一致，而且用户能在管理页改。
      //   自动瞎猜（比如从 URL 里抠 `angry`）反而会出现"搜猫却标成生气"这种错标签。
      description: query.trim() || '表情',
    });
  }

  return { candidates, rejected, supportsImages: true };
}

/**
 * 校验**用户手动粘贴**的图片链接。
 *
 * ★ 这条路必须留 —— 它是**唯一可靠**的路径：
 *   搜索引擎返回的图片取决于搜索服务是否支持（博查就不支持），
 *   而用户自己找到的图一定是他想要的。被墙、没配 Key、服务不提供图……
 *   这些情况下"粘贴链接"永远可用。
 */
export function validateManualUrl(raw: string): { ok: true; url: string; host: string } | { ok: false; reason: StickerCandidateReject } {
  const parsed = safeHost(raw.trim());
  if (!parsed) return { ok: false, reason: 'malformed' };
  const { url, host } = parsed;
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return { ok: false, reason: 'badProtocol' };
  if (isBlocked(host)) return { ok: false, reason: 'blockedDomain' };
  return { ok: true, url: raw.trim(), host };
}

/** 供界面显示"被挡掉的原因"（人话，不是枚举名） */
export const REJECT_REASON_TEXT: Record<StickerCandidateReject, string> = {
  badProtocol: '不是 https 链接',
  blockedDomain: '来源域名在屏蔽名单里',
  notAnImage: '看着不像图片直链（更可能是个网页）',
  duplicate: '重复的图',
  malformed: '链接格式不对',
};

/** 供界面说明"为什么这家搜不到图" */
export const NO_IMAGE_PROVIDER_TEXT =
  '当前搜索服务不提供图片结果（它只返回网页）。换个服务，或者直接在下面粘贴图片链接。';
