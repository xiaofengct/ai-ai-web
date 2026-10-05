/**
 * 世界文档解析器 —— 从用户的世界设定文件里**识别**出可用部分。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这个模块要解决的核心问题
 * ═══════════════════════════════════════════════════════════════════════════
 * 用户的原话是「让用户可以自行导入排班与世界逻辑的设定，并**确保导入后能被正确识别和加载**」。
 * 关键词是**识别**。用户的文件是**给人读的 markdown**（如 `virtual-world.md`），
 * 里面既有能算的（排班锚点、静默时段、概率门），也有算不了的（城市列表、朋友、活动表）。
 *
 * ⇒ 本模块负责把"人写的文档"切成两类：
 *     ① **能算的** → 抽成结构化字段（`schedule` / `rhythm`）⇒ 由 `schedule.ts` 计算；
 *     ② **算不了的** → 切成世界书条目（带关键词）⇒ 注入提示词，由模型在合适时机引用。
 *   并把结果写成**识别报告**，让用户看到"导入后到底生效了什么"。
 *
 * ── 两条设计原则 ─────────────────────────────────────────────────────
 *
 * **① 宁可少识别，不可错识别。**
 *   抽取规则只认**有明确写法**的东西（如「锚点：2026-09-05」）。
 *   写法不认识就不抽，把那一节原样留作文本条目，并在报告里说明。
 *   理由：抽错比不抽更糟 —— 不抽只是"这段没生效"，
 *   抽错会让她算错班次、或在错误的时间静默，而且**看不出来是错的**。
 *
 * **② 冲突要说出来，不要默默挑一个。**
 *   用户给的资料里确实存在自相矛盾（`SKILL.md` 写概率门 70%，
 *   `virtual-world.md` 写 40%）。这种情况**必须写进报告的 warnings**，
 *   而不是随便取一个让用户以为识别成功。详见 `docs/15` §3.1。
 *
 * ★ 本解析器**不依赖任何三方库**，纯正则 + 行扫描。
 *   理由：它要在浏览器与 Node 两处跑，且输入是用户文件（不可控），
 *   依赖越少越不容易在边界上炸。
 */

import { isClockTime, isIsoDate } from './types';
import type { ShiftName, TimeWindow, WorldEntry, WorldPack } from './types';

/* ══════════════════════════════════════════════════════════════════════════
 * 通用小工具
 * ══════════════════════════════════════════════════════════════════════════ */

/** 统一各种"看起来像破折号"的字符，便于写较松的正则 */
function normalizeDashes(s: string): string {
  // – (en dash) — (em dash) ～ ~ 一律换成 -
  return s.replace(/[\u2013\u2014\uff5e~]/g, '-');
}

/**
 * 统一各种箭头为 `->`。
 *
 * ★★ 必须与 `normalizeDashes` **分开**做（踩过一次真 bug）。
 *   用户的文档里 `→` 用得极多（「白班一天 → 夜班一天 → 休息三天」、
 *   「cycle == 1 → 白班」）。我最初图省事把 `→` 也并进"破折号归一化"换成 `-`，
 *   结果所有找 `->` 的正则**全部失配** ⇒ 两份文件的排班都抽不到。
 *   而且症状很隐蔽：静默、概率门都识别正常，只有排班是空的 ——
 *   看起来像"这两份文档没写排班"，实际是解析器把分隔符吃掉了。
 *
 * ★ 顺序：先 `normalizeArrows` 再 `normalizeDashes`。
 *   反过来也安全（dashes 不动 `-`），但固定顺序更不容易写错。
 */
function normalizeArrows(s: string): string {
  return s.replace(/[\u2192\u2794\u279c\u27f6\u21d2\u27a1]/g, '->');
}

/** 先箭头后破折号 */
function normalizeAll(s: string): string {
  return normalizeDashes(normalizeArrows(s));
}

/** 从一行里取所有 `YYYY-MM-DD` */
function allDates(line: string): string[] {
  const out: string[] = [];
  const re = /\d{4}-\d{2}-\d{2}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[0]);
  return out;
}

/**
 * 把人类写的 `:59` 端点翻译成半开区间的整点。
 *
 * ★★ 为什么需要这一步（不是一个可有可无的修饰）：
 *   时间窗在本项目里是**半开区间 `[from, to)`**（标准且有歧义最小）。
 *   而人写文档时，"到 08:00 为止（不含 08:00）"常常写成 `07:59` ——
 *   用户的世界文档就是 `23:00–07:59`。
 *   如果照抄成 `to = '07:59'`，在 `[from, to)` 语义下 **07:59 这一分钟就不是静默的**，
 *   与文档意图不符；更麻烦的是**内置包与解析结果会对不上**
 *   （内置包写 08:00、解析出来是 07:59），而两者本该表达同一件事。
 *
 * ⇒ 统一约定：**`:59` 视为"到下一个整点为止"**，规范化为下一小时的 `:00`。
 *   例外：`23:59` 保持原样 —— 下一个整点是 `24:00`，不是合法的 `HH:mm`；
 *   差一分钟可以忽略，且这种写法很少用于跨午夜的静默窗。
 *
 * ★ 这个转换**是有意为之的语义解释，不是"顺手把数字加一"**。
 *   如果文档确实想要"静默到 07:59 整"，那它该写 `07:58`。
 */
function normalizeWindowEnd(to: string): string {
  const m = /^(\d{2}):59$/.exec(to);
  if (!m) return to;
  const h = Number(m[1]);
  if (h >= 23) return to; // 23:59 保持（24:00 不是合法 HH:mm）
  return `${String(h + 1).padStart(2, '0')}:00`;
}

/**
 * 解析"时间区间"，兼容三种写法：
 *   `23:00–07:59`（带分）
 *   `09–21`（只有小时，补 `:00`）
 *   `09:00-21:00`
 * 返回 null 表示这行里没有可用的区间。
 */
export function parseTimeRange(raw: string): TimeWindow | null {
  const s = normalizeDashes(raw);
  // 先试带分钟的
  const withMin = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(s);
  if (withMin) {
    const from = `${withMin[1].padStart(2, '0')}:${withMin[2]}`;
    const to = normalizeWindowEnd(`${withMin[3].padStart(2, '0')}:${withMin[4]}`);
    if (isClockTime(from) && isClockTime(to)) return { from, to };
  }
  // 再试只有小时的（`09-21` / `9-21`）
  // ★ 加边界断言：避免把 `2026-09-05` 这种日期误当区间 ——
  //   不带边界的 `\d{1,2}-\d{1,2}` 会在日期里匹配到 `09-05`。
  const hourOnly = /(?:^|[^\d\-:])(\d{1,2})\s*-\s*(\d{1,2})(?![\d\-:])/.exec(s);
  if (hourOnly) {
    const h1 = Number(hourOnly[1]);
    const h2 = Number(hourOnly[2]);
    if (h1 <= 23 && h2 <= 24) {
      const from = `${String(h1).padStart(2, '0')}:00`;
      const to = h2 === 24 ? '23:59' : `${String(h2).padStart(2, '0')}:00`;
      if (isClockTime(from) && isClockTime(to)) return { from, to };
    }
  }
  return null;
}

/** 中文数字 → 阿拉伯数字（只处理 1–10，够用） */
function cnNumber(s: string): number | null {
  const map: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  const t = s.trim();
  if (/^\d+$/.test(t)) return Number(t);
  return map[t] ?? null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * ① 排班：锚点 + 周期
 * ══════════════════════════════════════════════════════════════════════════ */

interface ExtractedSchedule {
  anchorDate: string;
  cycle: ShiftName[];
  /** 这份排班是从哪一行读出来的（报告里回显，便于用户核对） */
  evidence: string;
}

/**
 * 抽取排班规则。支持三种常见写法：
 *
 *   A. 「锚点：2026-09-05（周六）＝本周期第 1 天 ＝ 白班」
 *      + 「cycle == 1 → 白班 / cycle == 2 → 夜班 / cycle ∈ {3,4,5} → 休息」
 *   B. 「锚点 2026-09-05 = 白班」
 *      + 「白班一天 → 夜班一天 → 休息三天」
 *   C. 只有锚点，周期从「白班/夜班/休息」的出现顺序推断
 */
export function extractSchedule(text: string): ExtractedSchedule | null {
  const lines = text.split(/\r?\n/);

  /* —— 找锚点：要求同一行里同时出现"锚点"与日期 —— */
  let anchorDate: string | null = null;
  let anchorLine = '';
  for (const line of lines) {
    if (!/锚点/.test(line)) continue;
    const ds = allDates(line);
    if (ds.length > 0 && isIsoDate(ds[0])) {
      anchorDate = ds[0];
      anchorLine = line.trim();
      break;
    }
  }
  if (!anchorDate) return null;

  /* —— 找周期 —— */
  const body = normalizeAll(text);

  // 写法 B：`白班一天 -> 夜班一天 -> 休息三天`（箭头链）
  // ★ `休息N天` 要展开成 N 个「休息」，否则 5 天周期会被压成 3 天，
  //   班次会整体错位 —— 这是最容易犯且最不易察觉的错。
  // ★ 兼容 `->` 与单个 `-`：有些文档写「白班 - 夜班 - 休息」。
  const arrow = /白班[^\n]{0,8}?(?:->|-)[^\n]{0,8}?夜班[^\n]{0,8}?(?:->|-)[^\n]{0,8}?休息\s*([一二两三四五六七八九十\d]*)\s*天/.exec(body);
  let cycle: ShiftName[] | null = null;
  if (arrow) {
    const n = cnNumber(arrow[1] || '一') ?? 1;
    cycle = ['白班', '夜班', ...Array.from({ length: Math.max(1, Math.min(n, 30)) }, () => '休息')];
  }

  // 写法 A：`cycle == 1 -> 白班` / `cycle ∈ {3,4,5} -> 休息`
  if (!cycle) {
    const mapping = new Map<number, ShiftName>();
    for (const line of lines) {
      const cyc = normalizeAll(line);
      /*
       * ★ 班次名只取「连续的中文/字母」，并允许前面有 `**`。
       *   踩过的坑：最初写 `([^\s，,。]+)`，遇到
       *     `cycle ∈ {3,4,5} → **休息**（第 1/2/3 天休息）`
       *   会一路吃到空格 ⇒ 抓到 `休息（第`，周期里就出现三个
       *   `"休息（第"` 这种脏值 —— 而且它**不等于** `休息`，
       *   于是 `activeHours['休息']` 匹配不上周期里的名字，
       *   "该班次没有活跃窗" ⇒ 回落到"不拦" ⇒ 静默悄悄失效。
       */
      const NAME = '[\\u4e00-\\u9fa5A-Za-z]{1,8}';
      // `cycle == 1 -> 白班`
      let m = new RegExp(`cycle\\s*==\\s*(\\d+)\\s*->\\s*\\*{0,2}\\s*(${NAME})`, 'i').exec(cyc);
      if (m) {
        const idx = Number(m[1]);
        const name = m[2].trim();
        if (idx >= 1 && idx <= 60 && name) mapping.set(idx, name);
        continue;
      }
      // `cycle ∈ {3,4,5} -> 休息`
      m = new RegExp(`cycle\\s*[∈]\\s*\\{([\\d,\\s]+)\\}\\s*->\\s*\\*{0,2}\\s*(${NAME})`, 'i').exec(cyc);
      if (m) {
        const name = m[2].trim();
        for (const part of m[1].split(',')) {
          const idx = Number(part.trim());
          if (idx >= 1 && idx <= 60 && name) mapping.set(idx, name);
        }
      }
    }
    if (mapping.size > 0) {
      const max = Math.max(...mapping.keys());
      cycle = [];
      for (let i = 1; i <= max; i += 1) cycle.push(mapping.get(i) ?? '休息');
    }
  }

  if (!cycle || cycle.length === 0) return null;

  /*
   * ★ 一致性自检：锚点行若写了"＝白班"这类表述，应与周期第 1 天一致。
   *   不一致说明我们抽错了（或文档本身矛盾）—— 返回 null 让上层降级为
   *   "只当文本"，并在报告里说明。宁可不算，也不要算错。
   */
  const anchorShiftWord = /(白班|夜班|休息)/.exec(anchorLine);
  if (anchorShiftWord && cycle[0] !== anchorShiftWord[1]) {
    return null;
  }

  return { anchorDate, cycle, evidence: anchorLine };
}

/* ══════════════════════════════════════════════════════════════════════════
 * ② 深夜静默
 * ══════════════════════════════════════════════════════════════════════════ */

export function extractQuietHours(text: string): TimeWindow | null {
  for (const line of text.split(/\r?\n/)) {
    if (!/静默|不主动发|不打扰/.test(line)) continue;
    const w = parseTimeRange(line);
    if (w) return w;
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * ③ 按班次的活跃时段
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 抽取"白班 09–21、夜班 21–08、休息日 08–23"这类按班次的活跃窗。
 *
 * ★★ 这里踩过一个很隐蔽的坑：**日期被当成时间区间**。
 *   用户文档里有一行排班示例：
 *     `- 例：2026-09-05=白班，09-06=夜班，09-07/08/09=休息，09-10=白班（循环）。`
 *   最初的正则允许班次名后跟最多 12 个非数字字符，于是它匹配到
 *     「白班，**09-06**」⇒ 解析成 `白班 09:00–06:00`
 *     「夜班，**09-07**」⇒ `夜班 09:00–07:00`
 *   这两个值**看上去完全合理**（09:00–06:00 像跨午夜的班），
 *   所以一旦生效，她会整天都不发消息，而原因根本看不出来。
 *
 * ⇒ 修法：班次名与时间区间之间**只允许空格与中文顿号**，
 *   不允许逗号/括号/斜杠/等号等"分句符号"。
 *   这样：
 *     命中  `白班 09-21`（空格）✓
 *     命中  `夜班在岗 21-08`（CJK 词 + 空格）✓
 *     不命中 `白班，09-06`（逗号 = 换了一个分句）✗
 *     不命中 `休息日常去（高铁/飞机2-4小时`（括号/斜杠）✗
 */
const BETWEEN_SHIFT_AND_TIME = '[^\\d\\n，,。、（）()【】\\[\\]{}|:：;；/]{1,8}';

export function extractActiveHours(text: string): Record<ShiftName, TimeWindow> | null {
  const out: Record<string, TimeWindow> = {};
  const body = normalizeAll(text);

  const candidates: Array<{ key: ShiftName; re: RegExp }> = [
    { key: '白班', re: new RegExp(`白班${BETWEEN_SHIFT_AND_TIME}(\\d{1,2}(?::\\d{2})?\\s*-\\s*\\d{1,2}(?::\\d{2})?)`) },
    { key: '夜班', re: new RegExp(`夜班${BETWEEN_SHIFT_AND_TIME}(\\d{1,2}(?::\\d{2})?\\s*-\\s*\\d{1,2}(?::\\d{2})?)`) },
    { key: '休息', re: new RegExp(`休息(?:日)?${BETWEEN_SHIFT_AND_TIME}(\\d{1,2}(?::\\d{2})?\\s*-\\s*\\d{1,2}(?::\\d{2})?)`) },
  ];
  for (const c of candidates) {
    const m = c.re.exec(body);
    if (!m) continue;
    const w = parseTimeRange(m[1]);
    if (w) out[c.key] = w;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * ④ 概率门
 * ══════════════════════════════════════════════════════════════════════════ */

export interface GateExtraction {
  threshold: number;
  /** 所有找到的阈值（用于发现矛盾） */
  all: number[];
  /** 找到阈值的那一行 */
  evidence: string;
}

export function extractGate(text: string): GateExtraction | null {
  const all: number[] = [];
  let evidence = '';
  for (const line of text.split(/\r?\n/)) {
    if (!/随机数/.test(line)) continue;
    const m = /随机数\s*[^\d\n]{0,6}?(\d{1,3})/.exec(line);
    if (!m) continue;
    const v = Number(m[1]);
    if (v < 0 || v > 100) continue;
    all.push(v);
    if (!evidence) evidence = line.trim();
  }
  if (all.length === 0) return null;
  const uniq = [...new Set(all)].sort((a, b) => a - b);
  // ★ 多个不同阈值时取**保守的那个**（更大 = 门更严 = 更不容易打扰用户），
  //   并把矛盾写进 warnings —— 不默默二选一。
  return { threshold: Math.max(...uniq), all: uniq, evidence };
}

/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ 世界书条目：按标题切分
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 判断某节是否应该**常驻注入**（不靠关键词触发）。
 *
 * ★ 判据：影响"每天的日常行为"的节必须常驻 ——
 *   时间系统、工作节奏、排班。
 *   如果把它们做成关键词触发，那么用户不提"班次"二字时她就不记得自己在上班，
 *   会出现"她刚说在台里盯播，转头又问你今天周末去哪玩"这类矛盾。
 */
function isResidentSection(title: string): boolean {
  return /时间系统|工作节奏|排班|作息|职业|基础锚点/.test(title);
}

/**
 * 从一段正文里抽出**加粗的专名**作为关键词候选。
 *
 * ★ 为什么这么做（不是投机取巧，是贴着文档的实际写法）：
 *   用户的 `virtual-world.md` 里地名、人名**一律加粗**：
 *     `[已脱敏]`
 *     `- **已脱敏**：大学闺蜜，朝阳区，活动范围三里屯/五道营/798/朝阳公园`
 *   所以从 `**...**` 里取词，命中率远高于"从标题猜"。
 *
 * ★ 为什么标题猜不出来：标题是 `虚拟世界地图` / `休息日常去（高铁/飞机2-4小时内可达）`
 *   这类**概括性描述**，而真正会出现在对话里的触发词是**城市名与人名**。
 *   拿标题当关键词，用户说"我下周想去已脱敏"时命中不了。
 */
function boldTokens(body: string, limit = 12): string[] {
  const out: string[] = [];
  const re = /\*\*([^*\n]{1,16})\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const t = m[1].trim();
    // 过滤掉"不是专名"的加粗（纯符号、超长句、含标点的短语）
    if (t.length < 2 || t.length > 10) continue;
    if (/[，,。；;：:（）()【】\[\]{}|/—\-]/.test(t)) continue;
    if (!/[\u4e00-\u9fa5A-Za-z]/.test(t)) continue;
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 按 `##` / `###` 标题把文档切成世界书条目。
 *
 * `keys` 由三处合成（去重、按长度≥2 过滤）：
 *   ① 标题本身（去掉括号注释后）
 *   ② 标题括号里的内容（常是具体地名，如「主场（北京石景山区）」）
 *   ③ **正文里的加粗专名**（城市名、人名 —— 见 `boldTokens` 的说明）
 *
 * ★ 关键词命中是**大小写不敏感的子串匹配**（见 `worldBookSegment`），
 *   所以多给几个词只提高命中率、不会误伤；
 *   但也不能滥给（每个条目都有 token 预算），故上限 12 个。
 */
export function splitSections(text: string): WorldEntry[] {
  const lines = text.split(/\r?\n/);
  const sections: Array<{ title: string; level: number; body: string[] }> = [];

  for (const line of lines) {
    const h = /^(#{2,4})\s+(.*)$/.exec(line);
    if (h) {
      sections.push({ title: h[2].trim(), level: h[1].length, body: [] });
      continue;
    }
    if (sections.length > 0) sections[sections.length - 1].body.push(line);
  }

  const entries: WorldEntry[] = [];
  for (const s of sections) {
    const body = s.body.join('\n').trim();
    /*
     * ★ 正文为空就跳过 —— 但要注意「空」有两种：
     *   ① 这一节真的什么都没写（跳过，正确）；
     *   ② 这一节下面全是 `###` 子标题（如 `## 虚拟世界地图` 紧跟 `### 主场…`），
     *      正文确实为空，但**它的子节会各自成为条目**。
     *   所以跳过不会丢内容，只是单纯的父标题不单独成条。
     */
    if (!body) continue;

    // 标题本身也算内容：把标题写回正文，模型才知道这一节的语境
    const content = `## ${s.title}\n${body}`;

    let keys: string[];
    if (isResidentSection(s.title)) {
      keys = []; // 常驻
    } else {
      const cleanTitle = s.title
        .replace(/[（(][^）)]*[）)]/g, ' ')
        .replace(/[：:].*$/, ' ')
        .replace(/[★*_`]/g, ' ')
        .trim();
      const parenParts: string[] = [];
      const parenRe = /[（(]([^）)]+)[）)]/g;
      let pm: RegExpExecArray | null;
      while ((pm = parenRe.exec(s.title)) !== null) {
        for (const p of pm[1].split(/[\/、,，]/)) {
          const t = p.trim();
          if (t.length >= 2 && t.length <= 12) parenParts.push(t);
        }
      }
      const titleParts = cleanTitle.split(/[\s/、,，]+/).filter((k) => k.length >= 2);

      keys = [...new Set([cleanTitle, ...titleParts, ...parenParts, ...boldTokens(body)])]
        .filter((k) => k.length >= 2 && k.length <= 12)
        .slice(0, 12);
    }

    entries.push({ keys, content, comment: s.title });
  }
  return entries;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 主入口
 * ══════════════════════════════════════════════════════════════════════════ */

export interface ParseWorldOptions {
  /** 原文件名（记进 `source.name`，便于用户认出来源） */
  fileName?: string;
  /** 覆盖来源类型（内置包构造时用） */
  kind?: 'builtin' | 'imported';
}

/**
 * 把一份世界文档（markdown）解析成 `WorldPack`。
 *
 * ★ 无论识别成功多少，**一定返回一个可用对象**（至少含文本条目），
 *   并把"识别到什么 / 只当文本 / 有疑问"写进 `report`。
 *   理由：用户导入一份文件后，最怕的是"什么都没有、也不说为什么"。
 */
export function parseWorldDoc(raw: string, opts: ParseWorldOptions = {}): WorldPack {
  const text = (raw ?? '').replace(/\r\n/g, '\n');
  const recognized: string[] = [];
  const textOnly: string[] = [];
  const warnings: string[] = [];

  /* —— 排班 —— */
  const schedule = extractSchedule(text);
  if (schedule) {
    recognized.push(`排班：锚点 ${schedule.anchorDate}，周期 ${schedule.cycle.join(' → ')}`);
  } else {
    warnings.push('没有识别到排班规则（需要同时有「锚点：YYYY-MM-DD」与「白班/夜班/休息」的周期写法）——排班将不生效，相关内容已作为文本保留。');
  }

  /* —— 静默 —— */
  const quietHours = extractQuietHours(text);
  if (quietHours) {
    recognized.push(`深夜静默：${quietHours.from}–${quietHours.to}`);
  }

  /* —— 活跃时段 —— */
  const activeHours = extractActiveHours(text);
  if (activeHours) {
    recognized.push(`活跃时段：${Object.entries(activeHours).map(([k, v]) => `${k} ${v.from}–${v.to}`).join('、')}`);
  }

  /* —— 概率门 —— */
  const gate = extractGate(text);
  if (gate) {
    recognized.push(`概率门：随机数 ≥ ${gate.threshold}`);
    if (gate.all.length > 1) {
      warnings.push(
        `文档里有多个不同的概率门阈值（${gate.all.join('、')}），已取最保守的 ${gate.threshold}。` +
          `如需改，请在导入后手动调整。`,
      );
    }
  }

  /* —— 世界书条目 —— */
  const entries = splitSections(text);
  const resident = entries.filter((e) => e.keys.length === 0).length;
  if (entries.length > 0) {
    textOnly.push(`世界书条目 ${entries.length} 条（其中 ${resident} 条常驻注入，其余按关键词触发）`);
  }

  /* —— 内容太少时提醒 —— */
  if (!schedule && !quietHours && entries.length === 0) {
    warnings.push('这份文件里没有找到可识别的世界设定（既没有排班/静默规则，也没有分节内容）。请确认导入的是世界设定文档。');
  }

  return {
    version: 1,
    source: {
      kind: opts.kind ?? 'imported',
      name: opts.fileName ?? 'world.md',
      ...(opts.kind === 'builtin' ? {} : { importedAt: new Date().toISOString() }),
    },
    rhythm: {
      ...(quietHours ? { quietHours } : {}),
      ...(activeHours ? { activeHours } : {}),
      ...(gate ? { gate: { threshold: gate.threshold, note: gate.evidence } } : {}),
    },
    ...(schedule ? { schedule: { anchorDate: schedule.anchorDate, cycle: schedule.cycle } } : {}),
    entries,
    report: { recognized, textOnly, warnings },
  };
}

/**
 * 从 JSON 文本解析世界包。
 *
 * ★ 两条路径都要有：用户可能拿到我们导出的 `.json`（结构完整），
 *   也可能只有一份手写的 `.md`（靠 `parseWorldDoc` 识别）。
 *   先试 JSON，不是 JSON 再当 markdown —— 这条判断放在调用方（`loadWorldFromText`）。
 */
export function loadWorldFromJson(raw: string, fileName?: string): WorldPack | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isWorldPackLike(parsed)) return null;
  const p = parsed as Partial<WorldPack>;
  return {
    version: 1,
    source: {
      kind: 'imported',
      name: fileName ?? p.source?.name ?? 'world.json',
      importedAt: new Date().toISOString(),
    },
    ...(p.summary ? { summary: p.summary } : {}),
    rhythm: (p.rhythm ?? {}) as WorldPack['rhythm'],
    ...(p.schedule ? { schedule: p.schedule } : {}),
    entries: (p.entries ?? []) as WorldEntry[],
    report: p.report ?? { recognized: [], textOnly: [], warnings: [] },
  };
}

/** JSON 形态的宽松校验（只要求"像"，细节交给上层容错） */
function isWorldPackLike(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return r.version === 1 && typeof r.rhythm === 'object' && r.rhythm !== null && Array.isArray(r.entries);
}

/**
 * 统一入口：**先当 JSON，不是再当 markdown**。
 *
 * ★ 顺序不能反：markdown 解析器对任何文本都能返回一个"至少有条目"的结果，
 *   所以如果先跑 markdown，一份合法 JSON 会被错误地当成"一整篇没有标题的文本"，
 *   结果结构化字段全丢、只剩一个大条目 —— 表现为"导入成功但排班没生效"。
 */
export function loadWorldFromText(raw: string, fileName?: string): WorldPack {
  const asJson = loadWorldFromJson(raw, fileName);
  if (asJson) return asJson;
  return parseWorldDoc(raw, { fileName });
}
