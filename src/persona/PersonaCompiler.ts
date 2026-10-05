import { CONTEXT_RESERVE, DEFAULT_CONTEXT_WINDOW } from '@/constants/limits';
import { estimateTokens } from '@/lib/token';
import { AppError } from '@/lib/errors';
import { useSettingsStore } from '@/store/settingsStore';
import { toLLMMessages } from '@/llm/adapter/multimodal';
import { assertImageAllowed } from '@/llm/imageGen';
import { SEGMENT_BUILDERS } from './segments';
import { isSegmentEnabled, SEGMENT_LABELS, SEGMENT_ORDER, type PromptContext } from './promptTypes';
import type { ChatSession, Message } from '@/types/chat';
import type { ChatSettings, PromptInjectControl } from '@/types/settings';
import type { PersonaCard } from '@/types/persona';
import type { MemoryHit, SummaryRange } from '@/types/memory';
import type { LLMMessage } from '@/llm/types';
import type { PromptBuildInput, PromptBuildResult, PromptSegment } from '@/types/prompt';

/**
 * ★★ 唯一提示词出口（架构文档 §2 `src/persona/PersonaCompiler.ts`、§7.1）。
 *
 * 约定：
 * - **12 段固定顺序**装配，逐段可开关（FN-30），段之间用 `\n\n---\n\n` 连接；
 * - 编译器**不依赖 DB**：记忆检索结果由调用方通过 `memoryHits` 注入；
 * - 输出 `segments` 明细供 `PromptPreview` 逐段查看与临时开关（开发者页 / 上下文设置页）；
 * - 病娇开关来自外观设置（`appearance.yandereMode`），由本类读 store 后派生到 ctx；
 * - **不含蒸馏提示词**：蒸馏产物是外部角色（PRD C2），唯一真源是
 *   `src/distill/prompts/index.ts` 的 `buildDistillPrompt()`。
 *   ★ 这里曾内置过一份蒸馏模板常量与配套方法（零调用，且与 6 层口径冲突），
 *   已按 EPIC-B 验收 B-05 删除——**不要再往本类加蒸馏模板**，否则就是两份真相。
 */

/** 段之间的分隔符 */
export const SEGMENT_SEPARATOR = '\n\n---\n\n';

export class PersonaCompiler {
  /** 是否把「被关闭的段」也保留在 segments 里（开发者页预览要用 enabled=false 的条目） */
  private readonly keepDisabled: boolean;

  constructor(options: { keepDisabled?: boolean } = {}) {
    this.keepDisabled = options.keepDisabled ?? true;
  }

  /** 主入口：装配聊天提示词 */
  build(input: PromptBuildInput): PromptBuildResult {
    const ctx = this.createContext(input, 'chat');
    return this.assemble(ctx);
  }

  /** 总结提示词（PG-11 / FN-48）：要求模型输出结构化 JSON 记忆条目 */
  buildSummary(input: {
    persona: PersonaCard;
    range: SummaryRange;
    messages: Message[];
    settings: ChatSettings;
    now?: Date;
  }): PromptBuildResult {
    const payload = buildSummaryPayload(input.messages, input.range);
    const ctx = this.createContext(
      {
        persona: input.persona,
        settings: input.settings,
        history: [],
        userInput: payload,
        // ★ 总结时关掉记忆注入：否则「用记忆生成记忆」会自我强化、越总结越走样
        overrides: { memory: false, extras: { memory: false } },
        kind: 'summary',
      },
      'summary',
      input.now,
    );
    ctx.extraConstraints = [
      '只输出 JSON 数组，不要任何解释、不要代码块标记。',
      '每条记忆 20~80 字，写「事实」不写评价。',
      '不要复述对话原文，提炼可长期复用的信息。',
    ];
    return this.assemble(ctx);
  }

  /** 主动消息提示词（PG-12 / XR-09）：短文本、非流式 */
  buildProactive(input: {
    persona: PersonaCard;
    session: ChatSession;
    settings: ChatSettings;
    recent: Message[];
    topic?: string;
    now?: Date;
  }): PromptBuildResult {
    const ctx = this.createContext(
      {
        persona: input.persona,
        session: input.session,
        settings: input.settings,
        history: input.recent,
        userInput: input.topic
          ? `（现在没有新消息）请你主动发起一条消息，话题方向：${input.topic}`
          : '（现在没有新消息）请你主动发起一条消息，像平时一样自然地开口。',
        kind: 'proactive',
      },
      'proactive',
      input.now,
    );
    ctx.extraConstraints = [
      '只输出一句话，不超过 40 字，不要解释、不要加引号。',
      '像微信消息一样自然开口，不要写「（欣然）」这类前缀。',
    ];
    return this.assemble(ctx);
  }

  /**
   * ★★ 动态生成提示词（2026-10-04 加）：让她发一条「朋友圈」。
   *
   * ── 与 `buildProactive()` 的三处**刻意不同**（不是复制粘贴改两句）──
   *   ① **不注入历史消息**（`history: []`）：
   *      动态不是"接着上文说"，而是"此刻想发点什么"。
   *      把最近的聊天记录塞进去，模型会写出"你刚才说的那个…"——
   *      那是**对话**，发到朋友圈里语义就错了（公开广播里出现私聊指代）。
   *   ② **不传 session**：动态不属于任何会话（`Moment` 类型里刻意没有 sessionId）。
   *      传了会让 `createContext` 走会话相关的分支（会话覆盖设置等），
   *      而那条路径对"广播"没有意义。
   *   ③ **约束是不同的**：主动消息"一句话不超过 40 字、像微信消息"；
   *      动态允许长一点（≤120 字）、允许有情绪、**不要求对谁说话**。
   *
   * ★ 但**人格层照常注入**（这是继承 `createContext` 的关键）：
   *   语气、口头禅、世界观都由那 5 层决定 —— 用户要求"内容需符合角色人设与语气"，
   *   靠的就是这一步，而不是另写一套人格描述。
   */
  buildMoment(input: {
    persona: PersonaCard;
    settings: ChatSettings;
    /** 今天是什么日子/什么班次之类的情境提示（可选，来自世界设定） */
    situation?: string;
    /** 近期发过的动态（用于"别重复"约束），只取摘要文本 */
    recentMoments?: readonly string[];
    now?: Date;
  }): PromptBuildResult {
    const lines = ['（现在没有人跟你说话）你想在自己的动态里发一条。'];
    if (input.situation) lines.push(`你现在的情况：${input.situation}`);
    if (input.recentMoments && input.recentMoments.length > 0) {
      lines.push(
        `你最近已经发过这些，别重复：${input.recentMoments.map((m) => `「${m}」`).join('、')}`,
      );
    }

    const ctx = this.createContext(
      {
        persona: input.persona,
        settings: input.settings,
        // ★ 刻意空历史（理由见上 ①）
        history: [],
        userInput: lines.join('\n'),
        kind: 'moment',
      },
      'moment',
      input.now,
    );
    ctx.extraConstraints = [
      '只输出动态正文，不超过 120 字，不要解释、不要加引号、不要写「（欣然）」这类前缀。',
      '这是**公开动态**，不是对某个人说话 —— 不要出现"你"、不要把私聊内容写进来。',
      '像日常随手发的那种：一句话、一个念头、一点情绪，不要写成小作文。',
      // ★ 允许（并鼓励）用语气词与短句，让动态读起来像真人随手发的
      '可以有语气词、可以断句、可以有点情绪。',
    ];
    return this.assemble(ctx);
  }

  /** ★ 隐私红线校验：noImage=true 时抛 AppError('PRIVACY_BLOCK') */
  assertImageAllowed(persona: PersonaCard): void {
    assertImageAllowed(persona);
  }

  /* ============================================================
     内部实现
     ============================================================ */

  /** 构造 PromptContext（合并 overrides、算预算、派生病娇开关） */
  private createContext(
    input: PromptBuildInput,
    kind: PromptContext['kind'],
    now?: Date,
  ): PromptContext {
    const overrides = input.overrides ?? {};
    const base = input.settings.injectControl;
    const inject: PromptInjectControl = {
      system: overrides.system ?? base.system,
      worldBook: overrides.worldBook ?? base.worldBook,
      memory: overrides.memory ?? base.memory,
      jailbreak: overrides.jailbreak ?? base.jailbreak,
      extras: { ...(base.extras ?? {}), ...(overrides.extras ?? {}) },
    };

    const maxTokens = input.settings.params.maxTokens;
    const contextWindow = this.contextWindow();
    const total = Math.max(512, contextWindow - maxTokens - CONTEXT_RESERVE);

    return {
      persona: input.persona,
      session: input.session,
      settings: input.settings,
      history: input.history ?? [],
      userInput: input.userInput,
      memoryHits: input.memoryHits,
      yandereMode: this.yandereMode(),
      inject,
      extraConstraints: [...(overrides.extraConstraints ?? [])],
      kind,
      budget: { contextWindow, maxTokens, reserve: CONTEXT_RESERVE, total, used: 0 },
      warnings: [],
      now: now ?? new Date(),
    };
  }

  /** 上下文窗口（取当前 Provider 配置，拿不到就用兜底常量） */
  private contextWindow(): number {
    try {
      const provider = useSettingsStore.getState().activeProvider();
      return provider?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    } catch {
      return DEFAULT_CONTEXT_WINDOW;
    }
  }

  /** 病娇模式（外观设置） */
  private yandereMode(): boolean {
    try {
      return useSettingsStore.getState().settings.appearance.yandereMode === true;
    } catch {
      return false;
    }
  }

  /** 按 12 段顺序装配 → system 文本 + messages */
  private assemble(ctx: PromptContext): PromptBuildResult {
    const segments: PromptSegment[] = [];
    const enabledContents: string[] = [];

    for (const builder of SEGMENT_BUILDERS) {
      const built = builder.build(ctx);
      const enabled = isSegmentEnabled(ctx, builder.id);

      if (!built) {
        // 段本身没有内容（如卡里没写 scenario）→ 不进列表，开发者页也不会显示空段
        continue;
      }

      const segment: PromptSegment = { ...built, enabled };

      // 被关掉的段也记进明细（开发者页要靠它做「临时开关」预览）；
      // `keepDisabled=false` 时只保留真正注入的段（内存敏感场景用）
      if (enabled || this.keepDisabled) segments.push(segment);

      if (!enabled) continue;

      // ★ 预算守卫：除了 Layer0 所在的人格分层段，其余段超出预算就停
      const cost = built.tokenEstimate;
      if (ctx.budget.used + cost > ctx.budget.total && builder.id !== 'personaLayers') {
        ctx.warnings.push(`提示词超出预算（${ctx.budget.total} token），已停止注入后续段落`);
        segments[segments.length - 1] = { ...segment, enabled: false };
        continue;
      }
      ctx.budget.used += cost;
      enabledContents.push(built.content);
    }

    // ★ 补齐 12 行明细：没有内容的段（如卡里没写 world_book）也要出现在 `segments` 里，
    //   否则开发者页 / 上下文设置页就没法对这一段做「临时开关」预览。
    if (this.keepDisabled) {
      const present = new Set(segments.map((s) => s.id));
      for (const id of SEGMENT_ORDER) {
        if (present.has(id)) continue;
        segments.push({
          id,
          label: SEGMENT_LABELS[id],
          enabled: false,
          content: '',
          tokenEstimate: 0,
          order: SEGMENT_ORDER.indexOf(id) + 1,
        });
      }
      segments.sort((a, b) => a.order - b.order);
    }

    const system = enabledContents.join(SEGMENT_SEPARATOR);
    const messages = this.buildMessages(ctx, system);

    const historyTokens = ctx.history.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    const inputTokens = ctx.userInput ? estimateTokens(ctx.userInput) : 0;
    const tokenEstimate = estimateTokens(system) + historyTokens + inputTokens;

    if (tokenEstimate > ctx.budget.total) {
      ctx.warnings.push(
        `本次请求估算 ${tokenEstimate} token，已超过预算 ${ctx.budget.total}，可能触发上下文截断`,
      );
    }

    return {
      system,
      messages,
      segments,
      tokenEstimate,
      warnings: [...ctx.warnings],
    };
  }

  /** 组装完整请求体：system + 历史 + 当前输入 */
  private buildMessages(ctx: PromptContext, system: string): LLMMessage[] {
    const out: LLMMessage[] = [];
    if (system.trim()) out.push({ role: 'system', content: system });

    // 历史消息：同步转换（附件走文字降级，真正的图片由 chatStore 在发送前升级）
    out.push(...toLLMMessages(ctx.history));

    if (ctx.userInput && ctx.userInput.trim()) {
      out.push({ role: 'user', content: ctx.userInput });
    }
    return out;
  }
}

/** 全局单例 */
export const personaCompiler = new PersonaCompiler();

export default PersonaCompiler;

/** 把「待总结的消息 + 范围」拼成提示词载荷 */
export function buildSummaryPayload(messages: readonly Message[], range: SummaryRange): string {
  const rangeText = describeRange(range);
  const body = messages
    .map((m) => `${m.role === 'user' ? '风' : '欣然'}：${m.content}`)
    .join('\n');
  return [
    `【总结范围】${rangeText}`,
    '【对话内容】',
    body || '（本次没有可总结的内容）',
    '',
    '请把上面这段对话提炼成记忆条目，输出 JSON 数组：[{ "content": "...", "tags": ["..."], "score": 0.8 }]',
  ].join('\n');
}

/** 总结范围的人类可读描述 */
function describeRange(range: SummaryRange): string {
  switch (range.mode) {
    case 'time':
      return `按时间：${range.from ?? '不限'} ~ ${range.to ?? '不限'}`;
    case 'count':
      return `按条数：最近 ${range.count ?? 0} 条`;
    case 'anchor':
      return `按锚点：${range.anchorStartId ?? '?'} → ${range.anchorEndId ?? '?'}`;
    case 'all':
      return '全部';
    default:
      return '未指定';
  }
}

/** 便捷函数：非类场景（store 之外）偶尔直接用 */
export function buildPrompt(input: PromptBuildInput): PromptBuildResult {
  return personaCompiler.build(input);
}

/** 便捷函数：隐私红线校验 */
export function assertNoImage(persona: PersonaCard): void {
  assertImageAllowed(persona);
}

/** 供外部复用：抛出的错误统一是 AppError（PRIVACY_BLOCK） */
export function tryAssertImageAllowed(persona: PersonaCard): boolean {
  try {
    assertImageAllowed(persona);
    return true;
  } catch (e) {
    if (e instanceof AppError) return false;
    throw e;
  }
}

/** 记忆检索结果的便捷注入（调用方算好 score 后传进来） */
export function withMemoryHits(
  input: PromptBuildInput,
  hits: readonly MemoryHit[],
): PromptBuildInput {
  return { ...input, memoryHits: [...hits] };
}
