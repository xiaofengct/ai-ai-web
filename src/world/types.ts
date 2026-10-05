/**
 * ★★ 世界设定包（World Pack）—— 「角色的生活」，与「人格」分开存放。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 为什么需要这个模块（2026-10-04）
 * ═══════════════════════════════════════════════════════════════════════════
 * 核对用户提供的设定后确认：内置的欣然只有**人格**，没有**生活** ——
 * 她知道自己是"夜班族、新闻从业者、爱打 Warframe"，
 * 但不知道自己在哪家电视台、家住哪、明天上什么班、朋友叫什么、生日几号。
 * 详见 `docs/15-内置欣然设定覆盖核对报告.md`。
 *
 * 用户随后明确：**排班与世界逻辑只在内置版有；不内置版要留导入窗口**。
 * 于是需要一套能同时支撑两边的结构：
 *
 *   - **内置版**：直接内置一份（`builtinWorlds.ts`），首次启动即生效；
 *   - **不内置版**：用户导入自己的世界文档（`.md` / `.json`），
 *     由 `parseWorldDoc()` **识别**并**加载**。
 *
 * ── 两条设计原则（决定了下面所有字段的取舍）────────────────────────
 *
 * **① 能算的就别让模型猜。**
 *   "今天是白班还是夜班"是一个**确定性**问题（锚点 + 周期 = 唯一答案）。
 *   把它交给 LLM 推理，会出现两种坏结果：算错、或者每次算得不一样。
 *   ⇒ 凡是有明确算法的（排班、静默时段、活跃时段、概率门）都进**结构化字段**，
 *     由 `schedule.ts` 计算 —— 而不是写成一段文字让模型读。
 *
 * **② 算不了的老实当文本。**
 *   像"休息日可能去已脱敏吃火锅"这种带**随机性与叙事性**的内容，
 *   强行结构化既表达不全、也没必要。它们以**世界书条目**（带关键词触发）
 *   注入提示词，由模型在合适的时机自然引用。
 *   ⇒ 两类内容共存，各走各的通道，不混为一谈。
 *
 * ★ 这套结构**不追求覆盖用户的全部设定**，只追求"能被正确识别的那部分真的生效"。
 *   识别不到的内容不会被丢弃，而是原样保留为文本条目 —— 见 `report` 字段。
 */

/** 班次名。内置欣然用的是「白班 / 夜班 / 休息」，但字段本身不限值（导入可能不同） */
export type ShiftName = string;

/**
 * 排班规则：**锚点 + 周期**。
 *
 * 周期是"按天循环的班次序列"，例：
 *   锚点 2026-09-05、周期 ['白班','夜班','休息','休息','休息']
 *   ⇒ 09-05 白班、09-06 夜班、09-07/08/09 休息、09-10 又回到白班
 *
 * ★ 为什么用"锚点 + 数组"而不是"每星期几上什么班"：
 *   原设定就是 5 天一轮**循环**（不是按星期），周期长度任意、班次名任意。
 *   锚点 + 数组能无歧义表达任意长度的循环，也不需要为"5 天轮"写特例。
 */
export interface ScheduleRule {
  /** 周期第 1 天的日期（`YYYY-MM-DD`，本地时区） */
  anchorDate: string;
  /** 按天循环的班次序列，长度即周期长度 */
  cycle: readonly ShiftName[];
}

/** 一天的时段区间（`HH:mm`，24 小时制） */
export interface TimeWindow {
  from: string;
  to: string;
}

/**
 * 世界的"作息规则"。
 *
 * ★ 三个时段字段的区别（容易混）：
 *   - `quietHours`：**绝对静默**，这段时间连主动消息都不发（内置欣然：23:00–07:59）；
 *   - `activeHours`：**按班次**定义的活跃窗口（白班 09–21 等）——
 *     它约束的是"她这个班次的作息"，比静默更细；
 *   - `gate`：**概率门**，过了时段还要掷一次骰子才真发。
 *   三者是**串联**关系：静默 → 活跃 → 概率，全部通过才发。
 */
export interface WorldRhythm {
  /** 绝对静默时段（跨午夜时 `from > to`，如 23:00–07:59） */
  quietHours?: TimeWindow;
  /** 按班次名给出的活跃时段 */
  activeHours?: Readonly<Record<ShiftName, TimeWindow>>;
  /**
   * 概率门：`随机数(0-99) >= threshold` 才允许发。
   * 内置欣然源设定里这个值有过 40% 与 70% 两种写法（见 docs/15 §3.1），
   * 这里以"文档为准的 60"作默认，并留 `gateNote` 记录取值理由。
   */
  gate?: { threshold: number; note?: string };
}

/**
 * 世界书条目 —— 走**文本注入**通道。
 *
 * ★ 直接复用 `CharacterBookEntry` 的形状（`keys` / `content` / `enabled` /
 *   `insertion_order`），因为最终就是要塞进 `card.character_book.entries`，
 *   由已有的 `worldBookSegment` 消费。**不新造第二套世界书格式**。
 */
export interface WorldEntry {
  /** 触发关键词。留空 = 常驻（每次都注入） */
  keys: string[];
  /** 注入正文 */
  content: string;
  /** 条目名（给人看，便于在 UI 里辨认；不注入） */
  comment?: string;
}

/** 识别报告：让"导入后到底生效了什么"变成**可见**的 */
export interface WorldParseReport {
  /** 成功抽成结构化规则的项（这些是**真的会算**的） */
  recognized: string[];
  /** 只作为文本条目保留的项（这些靠模型在合适时机引用） */
  textOnly: string[];
  /** 有疑问、需要人看一眼的地方（如"找到了两个不同的概率门阈值"） */
  warnings: string[];
}

/** 世界设定包 */
export interface WorldPack {
  /** 结构版本（将来改结构时便于迁移） */
  version: 1;
  /** 来源：内置 / 导入 */
  source: {
    kind: 'builtin' | 'imported';
    /** 内置写标识名；导入写原文件名（便于用户认出来源） */
    name: string;
    importedAt?: string;
  };
  /** 一句话概括这个世界（可选，展示用） */
  summary?: string;
  /** 可计算的作息规则 */
  rhythm: WorldRhythm;
  /** 可计算的排班规则 */
  schedule?: ScheduleRule;
  /** 文本世界书条目 */
  entries: WorldEntry[];
  /** 解析报告（内置包也有，说明它包含什么） */
  report: WorldParseReport;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 类型守卫与工具
 * ══════════════════════════════════════════════════════════════════════════ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `HH:mm` 格式校验 */
export function isClockTime(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.trim());
}

/** `YYYY-MM-DD` 格式校验（不校验日期真实性，交给 Date 兜） */
export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

/**
 * 宽松校验一个对象是不是可用的 WorldPack。
 *
 * ★ 为什么"宽松"：导入的是**用户的文件**，格式不可能完全可控。
 *   与其严格拒绝（用户拿到一句"格式不对"什么也做不了），
 *   不如尽力救回可用部分、把问题写进 `report.warnings`。
 *   真正硬性的只有 `version` 与 `entries`/`rhythm` 的存在性。
 */
export function isWorldPack(v: unknown): v is WorldPack {
  if (!isRecord(v)) return false;
  if (v.version !== 1) return false;
  if (!isRecord(v.rhythm)) return false;
  if (!Array.isArray(v.entries)) return false;
  return true;
}

/** 世界包是否"有内容"（空包不该被启用） */
export function isWorldPackUsable(pack: WorldPack | undefined | null): boolean {
  if (!pack) return false;
  return pack.entries.length > 0 || Boolean(pack.schedule) || Boolean(pack.rhythm.quietHours);
}
