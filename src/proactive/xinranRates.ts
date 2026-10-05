import type {
  JiwenLastMessage,
  JiwenRates,
  JiwenState,
  JiwenThresholds,
} from '@clarashafiq/jiwen';

/**
 * ★ 欣然的专属参数组（架构文档 §6.9 / `docs/04-开源复用评估.md` §2.3）。
 *
 * 校准目标（来自欣然的 Layer3：安全型依恋、直球索爱、黏人、极少吵）：
 *   1. **pride 调低** —— 她不端着，想说就说；
 *   2. **forceContact 压到 ~0.35** —— 黏人，等不了太久；
 *   3. **connectionRateFn 偏高** —— 想念累积快；
 *   4. **valenceSetpoint 略正** —— 自然偏暖。
 *
 * ★★ 参数是调出来的，不是算出来的（jiwen README 原话）。
 *    下面每个值都写了「为什么这么定」，改动时请连同理由一起改，
 *    并用 `node_modules/@clarashafiq/jiwen/simulate.js` 跑轨迹验证。
 */

/* ============================================================
   1. 阈值：三道触发线 + 两条自我调节线
   ============================================================ */

export const XINRAN_THRESHOLDS: JiwenThresholds = {
  /**
   * 注意到沉默：0.18（默认 0.20）
   * 为什么低：她对「你不在」敏感——刚一会儿没动静就开始留意（Layer3 异地、靠聊天维持联结）。
   */
  observation: 0.18,

  /**
   * 考虑开口：0.28（默认 0.35）
   * 为什么低：黏人。她不是「憋到忍不住才说」，而是「想到就开口」，
   * 所以进入「要不要说」的阶段要比通用角色早。
   */
  considerContact: 0.28,

  /**
   * ★ 强制开口：0.35（默认 0.50）—— 本组最关键的改动
   * 为什么压到 0.35：欣然等不久。默认 0.50 是给「嘴硬型角色」留的缓冲，
   * 对她来说这段缓冲纯属折磨。压到 0.35 后，从「考虑开口」到「必须开口」只有很短一段。
   */
  forceContact: 0.35,

  /**
   * 骄傲阻断线：0.62（默认 0.50）
   * 为什么调高：她不端着，平时 pride 在 0 附近，本来就不会被 pride 拦住。
   * 把线抬高是「双保险」——就算防御机制把 pride 顶起来，
   * 也很难越过 0.62，保证「想说却不说」几乎不会发生在她身上。
   */
  prideBlock: 0.62,

  /**
   * 低落到这个程度就转为「找事做」（自我调节）：-0.55（默认 -1.0 = 永不）
   * 为什么开：极少吵 ≠ 不会难受。真的低落到 -0.55 时，
   * 让她先自己消化而不是硬挤出一条主动消息，反而更像她（不内耗、不把情绪甩给你）。
   */
  valenceActivity: -0.55,

  /**
   * 焦躁到这个程度也转为「找事做」：0.55（默认 0.70）
   * 为什么调低：她焦躁时会直说，但直说≠撒气。早点触发宣泄，
   * 避免她在躁劲儿上还硬发主动消息（那种消息会带刺，不像她）。
   */
  arousalAgitation: 0.55,
};

/* ============================================================
   2. 漂移速率：五轴各自怎么动
   ============================================================ */

export const XINRAN_RATES: JiwenRates = {
  /* —— connection（想念累积） —— */

  /**
   * 20 分钟后才开始加速（默认 0 = 立刻加速）
   * 为什么留缓冲：她的想念是「慢慢涨起来」而不是「一分开就慌」，
   * 前 20 分钟线性增长，符合「刚分开还好」的真实体感。
   */
  accelDelay: 20,
  /**
   * 加速指数 1.6
   * 为什么：过了缓冲期后想念加速累积，撑到一两个小时没动静就会真的坐不住。
   */
  connectionAccel: 1.6,

  /* —— valence（愉悦度） —— */

  /**
   * 设定点 +0.12（默认 0）
   * 为什么略正：她自然偏暖——爱玩梗、哈哈哈不断（Layer1），不是一张冷脸。
   */
  valenceSetpoint: 0.12,
  /**
   * 回归速率 0.006（默认 0.005）
   * 为什么略快：情绪来得快走得也快，「不爽先炸后自愈」（Layer3）。
   */
  valenceRegress: 0.006,

  /**
   * 想念越强，坏情绪越难消散：connection ≥ 0.45 时回归速率 ×0.35
   * 为什么只减 65%（默认示例是 ×0.15）：她自愈快，
   * 想你想到心情变差是有的，但不会一直沉在里面。
   */
  valenceLockThreshold: 0.45,
  valenceLockFactor: 0.35,

  /**
   * 轻度不开心 → 想被安慰，想念加速（×1.25，valence < -0.15 触发）
   * 为什么开：直球索爱。她难受第一反应是找你，不是躲起来。
   */
  valenceConnectBoost: 1.25,
  valenceConnectBoostThreshold: -0.15,

  /**
   * 严重低落 → 自我封闭，想念减速（×0.55，valence < -0.45 触发）
   * 为什么开但阈值压得很低：她极少长期低落；真到 -0.45 以下，
   * 说明需要自己待会儿，这时候不该再催你。
   */
  valenceConnectDampen: 0.55,
  valenceConnectDampenThreshold: -0.45,

  /**
   * 想太久没回应 → 心情微微下沉（阈值 0.40，速率 0.0015/min）
   * 为什么幅度小：安全型依恋——她会想你、会有点闷，但不会因此崩掉或产生被抛弃感。
   */
  valenceConnectionDriftThreshold: 0.40,
  valenceConnectionDriftRate: 0.0015,

  /** 同方向情绪 delta 的边际递减（窗口 60 分钟，强度 1.2）：防止情绪在极端位无限累积 */
  valenceDeltaScaling: true,
  valenceDiminishWindow: 60,
  valenceDiminishFactor: 1.2,

  /* —— arousal（唤醒度） —— */

  /**
   * 设定点 -0.08（默认 0）
   * 为什么略负：夜班族、常累（Layer4），她的自然状态是偏慵懒的平静。
   */
  arousalSetpoint: -0.08,
  /** 回归速率 0.006：同上，波动快、回落也快 */
  arousalRegress: 0.006,
  /**
   * 等久了会有点躁：connection ≥ 0.30 时以 0.0022/min 攀升
   * 为什么开：「你人呢」这种焦躁是她会有的，但幅度温和（不吵、不闹）。
   */
  arousalConnectionRiseThreshold: 0.30,
  arousalConnectionRiseRate: 0.0022,

  /* —— pride（骄傲） —— */

  /**
   * 回落速率 0.006（默认 0.003，翻倍）
   * 为什么快：不内耗。端着的劲儿退得快，不会跟自己较劲半天。
   */
  prideRegress: 0.006,

  /**
   * 被冷落时的防御性端着：connection ≥ 0.45 → pride 朝 +0.30 漂
   * 为什么 target 只要 0.30（默认 0.50）：她的「端着」最多是哼一声、装作不在意，
   * 到不了冷漠。而且 0.30 远低于 prideBlock(0.62)，防御也不会真的拦住她开口。
   */
  prideDefendThreshold: 0.45,
  prideDefendTarget: 0.30,
  prideDefendRate: 0.002,

  /**
   * 盔甲侵蚀 0.010/min：想念一过强制线，pride 快速被磨掉
   * 为什么开且给得快：「撑不住就直说」是她的核心行为，
   * 这条保证即使防御机制把 pride 顶起来了，越过 forceContact 之后也会迅速归零。
   */
  prideErosionRate: 0.010,

  /**
   * 想要又端着的内心战争 0.0005/min（几乎用不上）
   * 为什么留着但给极小值：她 pride 基线低，这个冲突基本不会触发；
   * 保留是为了极端参数下仍能观察到 arousal 的细微升温。
   */
  prideArousalConflictRate: 0.0005,

  /* —— immersion（沉浸度） —— */

  /**
   * 沉浸衰减 0.012/min（默认 0.010）
   * 为什么更快：她不会长时间躲在事情里——异地恋的现实张力就是「再忙也会想你」。
   */
  immersionDecay: 0.012,
  /**
   * 沉浸对想念的阻尼 0.6（默认 1.0 = 完全线性阻尼）
   * 为什么只给 0.6：她在打游戏 / 看新闻时还是会想你，只是慢一点，不会彻底断片。
   */
  immersionDampenConnection: 0.6,
  /**
   * 做点事能缓解想念 0.10（默认 0 = 不缓解）
   * 为什么只给 0.10：找事做是缓冲，不是替代品——少一点点，但别指望靠它抵消「你没回我」。
   */
  activityConnectionRelief: 0.10,

  /** 已弃用字段（引擎仍读取）：显式置 0，避免歧义 */
  connectionOnReply: 0,
};

/* ============================================================
   3. connectionRateFn：想念累积的基础速率（每分钟）
   ============================================================ */

/** 没有任何消息时的基线：0.0050/min ≈ 56 分钟触到 forceContact(0.35) */
export const XINRAN_BASE_RATE = 0.0050;

/** 各类最后一条消息对应的速率（内容语义 → 累积快慢） */
export const XINRAN_RATE_BY_INTENT: Readonly<Record<string, number>> = {
  /** 说了晚安 / 去睡了 → 她知道你去睡了，不催：≈126 分钟才触线 */
  goodNight: 0.0022,
  /** 说在忙 / 开会 / 上班 / 出门 → 给空间：≈80 分钟 */
  busy: 0.0035,
  /** 普通聊天收尾 → 基线 */
  normal: XINRAN_BASE_RATE,
  /** 留了个问句等你（她在等你回答）→ 等得急一点 */
  question: 0.0060,
  /** 很短的一句 / 像被中断了 → 累积最快：≈41 分钟 */
  abrupt: 0.0070,
};

/**
 * 根据最后一条消息判断意图。
 * ★ 只做关键词粗判——这是「速率建议」，判错也不会导致错误行为，
 *   最坏只是想念累积快一点或慢一点。
 */
export function classifyLastMessageIntent(content: string | undefined): keyof typeof XINRAN_RATE_BY_INTENT {
  if (!content) return 'normal';
  const text = content.trim();
  if (text.length === 0) return 'normal';

  // 晚安类：知道你去睡了
  if (/晚安|睡了|去睡|休息了|困了|先睡/.test(text)) return 'goodNight';
  // 忙碌类：给空间
  if (/忙|开会|上班|出门|有事|等下|回头|先去|加班|路?上/.test(text)) return 'busy';
  // 问句：她在等你的回答
  if (/[?？]/.test(text)) return 'question';
  // 极短句：像被中断 / 敷衍
  if (text.length < 8) return 'abrupt';
  return 'normal';
}

/**
 * 欣然的 connectionRateFn。
 * 传入 `null`（没有任何消息）时用基线——刚认识、还没说过话也算「在等你」。
 */
export function xinranConnectionRateFn(lastMessage: JiwenLastMessage | null): number {
  if (!lastMessage) return XINRAN_BASE_RATE;
  const intent = classifyLastMessageIntent(lastMessage.content);
  return XINRAN_RATE_BY_INTENT[intent] ?? XINRAN_BASE_RATE;
}

/* ============================================================
   4. 沉浸度映射：她在做什么，能挡掉多少想念
   ============================================================ */

/**
 * 活动 → 初始沉浸度。
 * 除了 jiwen 默认的 reading/search/browse/observe，这里按 Layer4 补两个她的日常：
 * - `game`：Warframe 这类需要全神贯注的游戏，沉浸度最高；
 * - `news`：新闻时政（她的工作相关），半专注。
 */
export const XINRAN_IMMERSION_MAP: Readonly<Record<string, number>> = {
  game: 0.70,
  reading: 0.45,
  news: 0.50,
  search: 0.30,
  browse_snitch: 0.30,
  browse: 0.30,
  observe: 0.15,
};

/* ============================================================
   5. ★ 初始状态：必须自己播种
   ============================================================ */

/**
 * ★★ 踩坑记录（jiwen v0.4.0）：
 *   引擎的 `DEFAULT_STATE` 把 pride / valence / arousal 初始化为 **轴下限 -1**
 *   （`axes.pride[0]` 而不是 0），README 写的「默认全 0」与代码不一致。
 *   不播种的后果：开局 pride = valence = arousal = -1，
 *   valence 直接触发 `valenceActivity` 自我调节，前 160 分钟都在往回归爬，
 *   角色会莫名其妙地「先找事做」而不是找你。
 *
 *   所以这里显式播种成她的**自然稳态**（= 各轴设定点），开局即正常。
 *   （`opts.initialState` 在 v0.4.0 里并没有被实现读取，必须走 `onLoad` 播种。）
 */
export const XINRAN_INITIAL_STATE: JiwenState = {
  connection: 0,
  /** 她平时就不端着 */
  pride: 0,
  /** = valenceSetpoint：开局就是她自然的暖度 */
  valence: 0.12,
  /** = arousalSetpoint：开局偏平静（夜班族常累） */
  arousal: -0.08,
  immersion: 0,
  lastActivity: null,
  lastTick: null,
  lastChatAnalysis: null,
  lastChatMessageId: null,
  lastBotMessageId: null,
  userStatus: 'active',
};

/* ============================================================
   6. persona：默认文案里的人称（我们已用 tone-grid 覆盖，这里只兜底）
   ============================================================ */

export const XINRAN_PERSONA: Readonly<{ subjectName: string; selfName: string; subjectPronoun: string }> = {
  /** 欣然称呼风为「老婆」，但默认文案里用中性名字，避免把昵称当主语 */
  subjectName: '风',
  selfName: '我',
  subjectPronoun: '她',
};

/**
 * 她「找事做」时会去做什么（Layer4：爱打游戏、关心新闻时政、爱分享）。
 * jiwen 的 `find_activity` 只说「去找事做」，**做什么**由人格决定，所以放这里。
 */
export const XINRAN_ACTIVITY_POOL = {
  /** 躁劲儿上来了 → 打游戏泄掉（她玩 Warframe） */
  vent: { type: 'game', label: 'Warframe' },
  /** 心情低落 → 看点新闻，不让自己空转 */
  news: { type: 'news', label: '看会儿新闻' },
  /** 骄傲阻断 / 想说又端着 → 刷手机找由头 */
  browse: { type: 'browse', label: '刷会儿手机' },
  /** 兜底 */
  idle: { type: 'observe', label: '发会儿呆' },
} as const;

/** 按触发原因挑一个她会做的事 */
export function pickActivity(reason?: string): { type: string; label: string } {
  if (reason === 'high_arousal') return XINRAN_ACTIVITY_POOL.vent;
  if (reason === 'low_valence') return XINRAN_ACTIVITY_POOL.news;
  if (reason === 'pride_block') return XINRAN_ACTIVITY_POOL.browse;
  return XINRAN_ACTIVITY_POOL.idle;
}

/* ============================================================
   7. 交互 delta：外界事件怎么改五轴（★ 不写死在各处，统一在这里）
   ============================================================ */

/**
 * 对话事件 → 情绪 delta。
 * 目前是**规则版**（不调模型）；后续若要接「轻量模型做旁观分析」，
 * 只需让 `analyzeChatSegment` 返回同形状的对象替换即可，调用方不用改。
 */
export const XINRAN_EVENT_DELTA: Readonly<
  Record<'userReplied' | 'userAffection' | 'userCold' | 'proactiveSent' | 'proactiveIgnored', {
    pride?: number;
    valence?: number;
    arousal?: number;
    connection?: number;
  }>
> = {
  /** 对方回复了：想念归零（由 resetConnection 处理）+ 心情微涨、躁动回落 */
  userReplied: { valence: +0.06, arousal: -0.08 },
  /** 对方说了亲近的话：不用端着了 */
  userAffection: { pride: -0.10, valence: +0.12, arousal: -0.05 },
  /** 对方明显冷淡：不会吵，但会有点闷 */
  userCold: { pride: +0.06, valence: -0.10 },
  /**
   * 她主动开口之后：**只部分缓解**（-0.20）。
   * ★ 开口 ≠ 被回复（jiwen README 特别强调）；等对方真的回了才 resetConnection()。
   */
  proactiveSent: { connection: -0.20, arousal: -0.04 },
  /** 主动开口后对方没理：不记仇，但想念继续累积（不额外加，交给时间漂移） */
  proactiveIgnored: { valence: -0.04, arousal: +0.04 },
};

export default XINRAN_RATES;
