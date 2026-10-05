/**
 * `@clarashafiq/jiwen` 的类型声明（MIT，零依赖，纯 JS，无自带 .d.ts）。
 *
 * 为什么手写而不是 `@types/*`：上游没有发布类型，且它是 CJS 单文件；
 * 手写一份薄声明既能拿到强类型，又不会把实现细节钉死（上游升级只需改这里）。
 *
 * 声明内容与 `node_modules/@clarashafiq/jiwen/jiwen.js` v0.4.0 的导出逐项对应。
 */

declare module '@clarashafiq/jiwen' {
  /** 对方状态（由外部推断后写入，见 `setUserStatus`） */
  export type JiwenUserStatus = 'active' | 'busy' | 'away' | 'sleeping';

  /** 触发动作：开口 / 找事做（自我调节）/ 注意到沉默 */
  export type JiwenAction = 'contact' | 'find_activity' | 'observation';

  export interface JiwenActivity {
    type: string;
    label: string;
    at: string;
  }

  /** 五轴状态快照 + 引擎内部记账字段 */
  export interface JiwenState {
    /** 连接需求 0→1：多久没听到对方了 */
    connection: number;
    /** 骄傲 -1→+1：端着还是放软 */
    pride: number;
    /** 愉悦度 -1→+1（Russell 环状模型） */
    valence: number;
    /** 唤醒度 -1→+1：焦躁 ↔ 平静（正交于 valence） */
    arousal: number;
    /** 沉浸度 0→1：正在做事的专注度，也是骄傲的缓冲垫 */
    immersion: number;
    lastActivity: JiwenActivity | null;
    lastTick: string | null;
    lastChatAnalysis: string | null;
    lastChatMessageId: string | number | null;
    lastBotMessageId: string | number | null;
    userStatus: JiwenUserStatus;
  }

  /** `getLastMessage()` 的返回形状（同步回调，引擎内部直接调） */
  export interface JiwenLastMessage {
    id?: string | number;
    content?: string;
    timestamp?: string;
  }

  /** `tick()` 返回的触发项 */
  export interface JiwenTrigger {
    action: JiwenAction;
    reason?: string;
    urgency?: number;
    forced?: boolean;
  }

  /** `applyDelta()` 入参（`mood` 为向后兼容字段，映射到 valence） */
  export interface JiwenDelta {
    pride?: number;
    valence?: number;
    arousal?: number;
    connection?: number;
    /** 已弃用但仍支持：等价于 valence */
    mood?: number;
  }

  /** 漂移速率表（键由引擎定义，值可能是速率 / 阈值 / 开关） */
  export interface JiwenRates {
    [key: string]: number | boolean | undefined;
  }

  /** 阈值表 */
  export interface JiwenThresholds {
    observation: number;
    considerContact: number;
    forceContact: number;
    prideBlock: number;
    valenceActivity: number;
    arousalAgitation: number;
  }

  export interface JiwenOptions {
    initialState?: Partial<JiwenState>;
    axes?: Record<string, [number, number]>;
    rates?: JiwenRates;
    thresholds?: Partial<JiwenThresholds>;
    immersionMap?: Record<string, number>;
    connectionRateFn?: (lastMessage: JiwenLastMessage | null) => number;
    onSave?: (state: JiwenState) => Promise<void> | void;
    onLoad?: () => Promise<JiwenState | null> | JiwenState | null;
    getLastMessage?: () => JiwenLastMessage | null;
    persona?: { subjectName?: string; selfName?: string; subjectPronoun?: string };
    /** 覆盖默认的状态自然语言描述（我们注入 tone-grid） */
    getPromptContext?: (state: JiwenState) => string;
    /** 覆盖默认的说话风格指引（我们注入 tone-grid） */
    getStyleGuidance?: (state: JiwenState) => string;
    /** 长期叙事弧线偏置（可选，失败时不阻断 tick） */
    getSagaBias?: () =>
      | Promise<Partial<Record<'connection' | 'pride' | 'valence' | 'arousal' | 'immersion', number>>>
      | Partial<Record<'connection' | 'pride' | 'valence' | 'arousal' | 'immersion', number>>;
    verbose?: boolean;
    onLog?: (msg: string) => void;
  }

  export interface JiwenEngine {
    load(): Promise<void>;
    save(): Promise<void>;
    /** 推进状态漂移；引擎内部把 minutes 截断到 60，调用方需自行分片 */
    tick(minutesElapsed: number): Promise<JiwenTrigger[]>;
    applyDelta(delta: JiwenDelta): Promise<void>;
    getState(): Promise<JiwenState>;
    /** 同步：内部状态已加载时才有意义，Bridge 里统一先 await getState() */
    getPromptContext(): string;
    getStyleGuidance(): string;
    resetConnection(): Promise<void>;
    setActivity(type: string, label?: string): Promise<void>;
    checkThresholds(): JiwenTrigger[];
    setLastChatMessageId(id: string | number | null): Promise<void>;
    getLastChatMessageId(): Promise<string | number | null>;
    setLastBotMessageId(id: string | number | null): Promise<void>;
    getLastBotMessageId(): Promise<string | number | null>;
    setUserStatus(status: JiwenUserStatus): Promise<void>;
    getUserStatus(): JiwenUserStatus;
    getStateSummary(): string;
    config: {
      axes: Record<string, [number, number]>;
      rates: JiwenRates;
      thresholds: JiwenThresholds;
      immersionMap: Record<string, number>;
      persona: { subjectName: string; selfName: string; subjectPronoun: string };
    };
  }

  export function createJiwen(opts: JiwenOptions): JiwenEngine;
}

declare module '@clarashafiq/jiwen/tone-grid' {
  /** 9 个情绪簇：V×A 象限 + 单轴极端 + 中性 */
  export type ToneCluster =
    | 'excited'
    | 'content'
    | 'agitated'
    | 'depressed'
    | 'neutral'
    | 'sullen'
    | 'restless'
    | 'pleased'
    | 'calm';

  /** pride 档位：1=完全不端着 → 5=全副武装 */
  export type PrideTier = 1 | 2 | 3 | 4 | 5;

  export type ToneProfiles = Partial<Record<ToneCluster, Partial<Record<PrideTier, string[]>>>>;

  export type UrgencyLevel = 'desperate' | 'urgent' | 'aware' | 'none';

  export interface UrgencyBoost {
    proactive: string | null;
    reactive: string | null;
  }

  export interface ToneGridConfig {
    profiles?: ToneProfiles;
    urgencyBoost?: Partial<Record<UrgencyLevel, UrgencyBoost>>;
  }

  export interface ToneGridState {
    connection: number;
    pride: number;
    valence: number;
    arousal: number;
    immersion?: number;
  }

  export interface ToneGrid {
    getUnifiedGuidance(state: ToneGridState, mode: 'proactive' | 'reactive'): string;
    /** 便捷方法：回复对方（reactive 模式） */
    getStyleGuidance(state: ToneGridState): string;
    /** 便捷方法：主动开口（proactive 模式） */
    getPromptContext(state: ToneGridState): string;
    config: { profiles: ToneProfiles; urgency: Record<string, UrgencyBoost> };
  }

  export function createToneGrid(config?: ToneGridConfig): ToneGrid;
  export const DEFAULT_PROFILES: ToneProfiles;
  export const DEFAULT_URGENCY: Record<UrgencyLevel, UrgencyBoost>;
}
