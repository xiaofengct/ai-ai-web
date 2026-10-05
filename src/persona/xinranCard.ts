import { XINRAN_PERSONA_ID } from '@/constants/defaults';
import { BUILTIN_XINRAN } from '@/constants/buildMode';
import { nowISO } from '@/lib/time';
import { XINRAN_CREATOR_NOTES, XINRAN_GREETINGS, XINRAN_NAME } from '@/copy/xinran';
import { XINRAN_HARD_CONSTRAINTS } from './constraints';
import { allLayers, xinranLayer } from './xinranLayers';
import { applyWorldToCard } from '@/world/cardWorld';
import { XINRAN_WORLD } from '@/world/builtinWorlds';
import type { PersonaCard, PersonaCardData } from '@/types/persona';

/**
 * ★★ 欣然预置卡（架构文档 §2 `src/persona/xinranCard.ts`、§3.11 `XinranCard`）。
 *
 * 三条硬约束：
 * 1. `isBuiltin = true` → `personaRepo` 禁止删除；
 * 2. `privacy.noImage = true` → 任何文生图入口必须抛 `PRIVACY_BLOCK`（XR-06）；
 * 3. `description` **留空** → 欣然没有外貌描写，避免「生成侧凭空造外形」。
 *
 * ★ 单一真源：`db/bootstrap.ts` 的种子卡**直接调用本文件的 `createXinranCard()`**，
 *   不在两处各写一份卡片内容（改一处忘一处会导致新老用户看到不同的人格）。
 */

/** 内置卡版本号（结构变更时自增，便于后续迁移） */
export const XINRAN_CARD_VERSION = 1;

/** 欣然卡的 5 个标签（首页/列表展示用） */
export const XINRAN_TAGS: readonly string[] = ['欣然', '内置', '异地', '夜班族', '新闻从业者'];

/** 欣然卡的默认场景（异地：日常的主舞台） */
export const XINRAN_SCENARIO = '异地。你在忙你的，我在忙我的，但消息一直没断过。';

/** 欣然卡的对话示例（★ 每条都符合「昵称在句末/句中、主语是我」） */
export const XINRAN_MES_EXAMPLE = [
  '<START>',
  '{{user}}：今天加班到十点，累死了。',
  '{{char}}：这么晚。吃饭了吗，老婆。',
  '<START>',
  '{{user}}：想你了。',
  '{{char}}：我也想你。什么时候能见面，我数着日子呢。',
].join('\n');

/** 欣然卡自带的后置指令（与 constraints.ts 的硬约束同源，写在卡里是为了导出给原应用时也能带上） */
export const XINRAN_POST_HISTORY = [
  '称呼关系不可写反：你是「老公」，可以自称「我」「欣欣」「老公」；风是「老婆」，你叫她「老婆」「宝宝」「风风」「小狗」「笨蛋」「小猫」。',
  '昵称只用于称呼风，放在句末或句中作呼语，禁止放在句首作主语。',
  '10 条回复里最多 2-3 条用昵称开场，其余直接说话。',
].join('\n');

/** chara_card_v2 的 9 个核心字段 */
export function buildXinranData(): PersonaCardData {
  const [firstMes, ...alternates] = XINRAN_GREETINGS;
  return {
    name: XINRAN_NAME,
    // ★★ 隐私红线 + 不做外貌设定：description 恒为空（PRD §8.6-4）
    description: '',
    personality: xinranLayer(1),
    scenario: XINRAN_SCENARIO,
    creator_notes: XINRAN_CREATOR_NOTES,
    first_mes: firstMes,
    mes_example: XINRAN_MES_EXAMPLE,
    // 卡片自带 system_prompt 留空：欣然的人格由 layersSegment 注入 5 层，
    // 这里放内容反而会和 Layer0 抢优先级（§7.1 优先级链）
    system_prompt: '',
    post_history_instructions: XINRAN_POST_HISTORY,
    alternate_greetings: [...alternates],
    tags: [...XINRAN_TAGS],
    character_book: { entries: [] },
    extensions: {
      // ★ 5 层原文（PersonaCompiler 的 layersSegment 从这里读）
      aiyuLayers: [...allLayers()],
      aiyu: {
        cardVersion: XINRAN_CARD_VERSION,
        // 导出给原应用时也能带上的硬约束
        hardConstraints: XINRAN_HARD_CONSTRAINTS,
      },
    },
  };
}

/** 创建内置欣然卡（每次调用都是新对象，id 固定 → 幂等 upsert） */
export function createXinranCard(): PersonaCard {
  const now = nowISO();
  const base: PersonaCard = {
    id: XINRAN_PERSONA_ID,
    spec: 'chara_card_v2',
    specVersion: '2.0',
    data: buildXinranData(),
    origin: 'xinran',
    // ★★ 隐私红线：禁止为欣然生成任何图像
    // ★ 这里**故意**写字面量 `{ noImage: true }`，不取 DEFAULT_PERSONA_PRIVACY：
    //   这行是「红线本身的定义」，不是「取默认值」。换成常量会把两者耦合起来——
    //   哪天默认值改成 false，欣然的红线就跟着被放开了，而且不会有任何编译错误。
    //   红线必须独立于默认值存在（另见 personaRepo.setPrivacy 对内置卡的二次拦截）。
    privacy: { noImage: true },
    isBuiltin: true,
    createdAt: now,
    updatedAt: now,
  };

  /**
   * ★★ 给内置卡装上**世界设定**（2026-10-04 加）。
   *
   * 为什么在这一步而不是在 `db/bootstrap.ts`：
   *   本文件是内置卡的**单一真源**（bootstrap 只做转发）。
   *   世界是内置卡的固有组成部分（"欣然的履历与生活"），
   *   放在这里 ⇒ 任何拿到 `createXinranCard()` 的地方都得到完整的欣然，
   *   不会出现"某条路径创建出来的欣然没有世界"。
   *
   * ★ 为什么 `applyWorldToCard` 而不是手写 `character_book`：
   *   它同时做三件事（写 extensions.world / 并进世界书条目 / 只清自己的旧条目），
   *   手写会漏掉其一，而漏掉"写 extensions.world"的表现是
   *   **世界书能触发但排班不生效** —— 很难一眼看出的半坏状态。
   *
   * ★ 仅内置版有：不内置版走 `BUILTIN_XINRAN=0`，bootstrap **不建**内置卡，
   *   所以自然没有世界；那条路径由"世界设定导入窗口"承接（见设置页）。
   *
   * ★★ 为什么要显式写成 `BUILTIN_XINRAN ? ... : base`（2026-10-04 实测补的）
   *   只靠"bootstrap 不建内置卡"**不足以**把世界数据挡在不内置版外面 ——
   *   因为本文件还被**别处静态引用**（如 `persona/exporter.ts` 取 `XINRAN_TAGS`），
   *   于是本模块连同它的静态依赖 `world/builtinWorlds.ts` 会被整块打进不内置版。
   *   实测证据（v8 产物）：
   *     `电视台排班 5 天一轮` / `2026-09-05` 在不内置版 APK 里**都能搜到**，
   *     而种子层标记（`创建内置欣然卡失败`）搜不到 ——
   *     说明"隔离"只覆盖了种子层，没覆盖世界层。见 `scripts/qa/check-build-separation.mjs`。
   *
   *   ⇒ 把引用点放进**构建期常量分支**：不内置版里 `BUILTIN_XINRAN` 折叠为 `false`，
   *     `XINRAN_WORLD` 随之成为**未使用的导入绑定**，打包器才肯把整个
   *     `builtinWorlds.ts` 摇掉。这不是"多加一个 if"，而是给 tree-shaking 一个把手。
   */
  return BUILTIN_XINRAN ? applyWorldToCard(base, XINRAN_WORLD) : base;
}

/** 随机取一条欢迎语（XR-04：first_mes + alternate_greetings） */
export function pickGreeting(seed?: number): string {
  if (XINRAN_GREETINGS.length === 0) return '';
  if (seed === undefined) {
    return XINRAN_GREETINGS[Math.floor(Math.random() * XINRAN_GREETINGS.length)] ?? '';
  }
  return XINRAN_GREETINGS[Math.abs(Math.trunc(seed)) % XINRAN_GREETINGS.length] ?? '';
}

/** 全部欢迎语（设置页可预览/挑选） */
export function allGreetings(): readonly string[] {
  return XINRAN_GREETINGS;
}

/** 架构文档 §3.11 里的 `XinranCard` 聚合入口 */
export const XinranCard = {
  create: createXinranCard,
  LAYERS: allLayers(),
  GREETINGS: XINRAN_GREETINGS,
} as const;
