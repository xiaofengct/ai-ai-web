import { create } from 'zustand';
import { personaRepo } from '@/db/repo/personaRepo';
import { XINRAN_PERSONA_ID } from '@/constants/defaults';
import { log } from './logStore';
import { AppError } from '@/lib/errors';
import type { PersonaCard, PersonaCardData } from '@/types/persona';
import type { PersonaOrigin } from '@/types/common';
import type { UUID } from '@/types/common';

/**
 * 人设 Store（架构文档 §6.6）：人设列表、当前角色、导入导出编排。
 * **不编译提示词**（那是 PersonaCompiler 的职责，T06）。
 */

export interface PersonaState {
  personas: PersonaCard[];
  currentId?: UUID;
  loading: boolean;
  /**
   * 是否已完成**至少一次**加载。
   *
   * ★ 为什么需要它（不内置欣然版实测踩坑）：`personas.length === 0` 这句话本身
   *   有两种截然不同的含义 —— **「还没读完」** 与 **「读完了，确实一个都没有」**。
   *   不内置版首启的合法终态是后者（引导用户去导入），但加载**途中**也会是空数组。
   *   只看 `length === 0` 就把两者混为一谈 ⇒ 内置版首启会闪一下
   *   「这里还没有人，导一个人设文件」这种**完全错误**的引导
   *   （内置欣然卡明明在，只是还没从 Dexie 读出来）。
   *   ⇒ 用 `hydrated` 把两种含义分开：只有读完之后的空，才是真的空。
   *
   * 置位时机：`reload()` 的**两条出口**都置 true（含失败）。
   *   失败也置 true 是刻意的：否则读取失败会让 UI 永久停在"加载中"语义，
   *   而用户得不到任何提示；置 true 后至少会渲染出（空的）真实状态，
   *   失败详情另由 `error` 字段 + 调用方的 snack 呈现。
   */
  hydrated: boolean;
  error?: string;

  /** 从库里重新加载（欣然永远排第一） */
  reload(): Promise<void>;
  /** 取当前角色（默认回落到欣然） */
  current(): PersonaCard | undefined;
  /** 切换当前角色 */
  select(id: UUID): void;
  /** 新建外部角色 */
  create(name: string, data?: Partial<PersonaCardData>): Promise<PersonaCard>;
  /** 更新卡片数据 */
  updateData(id: UUID, data: Partial<PersonaCardData>): Promise<void>;
  /** 删除（内置卡会被 repo 拒绝） */
  remove(id: UUID): Promise<void>;
  /** 导入（返回成功/跳过数量） */
  importCards(cards: readonly PersonaCard[]): Promise<{ success: number; skipped: number }>;
  /** 按来源过滤 */
  byOrigin(origin: PersonaOrigin): PersonaCard[];
  /** 隐私红线校验：这张卡能否生图（不能时抛 PRIVACY_BLOCK） */
  assertImageAllowed(id: UUID): void;
}

/**
 * 决定「重新加载之后，当前角色该是谁」。
 *
 * 优先级：**沿用旧选择 → 内置欣然（仅当它真的存在）→ 列表首个 → undefined**
 *
 * ★ 原实现是 `some(prev) ? prev : XINRAN_PERSONA_ID` —— 回落目标**硬编码**，
 *   完全不看这张卡是否真的在列表里。在**不内置欣然版**里这会稳定踩中：
 *     首启列表为空 → 回落成 `XINRAN_PERSONA_ID`（一个**永不存在的幻影 id**）
 *     → 用户导入第一个角色 → `prev` 是那个幻影、列表里也没有欣然
 *     → **`currentId` 依然停在幻影上**，而真角色永远选不中。
 *   后果不是"显示错名字"那么轻：`NewSessionDialog` 用它作默认选中值，
 *   于是新建的会话绑到一个**不存在的角色**上（标题取不到名字、聊天无角色）。
 *   这条路径恰好是用户要求「不内置版可自行导入」的**主路径**。
 *
 * ★ 为什么空列表时返回 `undefined` 而不是继续硬编码：
 *   `currentId?: UUID` 本就是可选类型，语义上「没有角色」就该「没有当前角色」。
 *   返回 undefined 后，下游既有的 `?? personas[0]` 链会正确退化为"没得选"，
 *   从而让 `err.noPersonaToChat` 那类明确提示能够触发 —— 而不是静默绑一个幻影。
 *   已逐个核对下游 6 个消费点，均已有 `??` 或显式 null 兜底。
 */
function pickCurrentId(list: readonly PersonaCard[], prev?: UUID): UUID | undefined {
  if (prev !== undefined && list.some((p) => p.id === prev)) return prev;
  if (list.some((p) => p.id === XINRAN_PERSONA_ID)) return XINRAN_PERSONA_ID;
  return list[0]?.id;
}

export const usePersonaStore = create<PersonaState>()((set, get) => ({
  personas: [],
  currentId: XINRAN_PERSONA_ID,
  loading: false,
  hydrated: false,
  error: undefined,

  reload: async () => {
    set({ loading: true, error: undefined });
    const res = await personaRepo.listAll();
    if (!res.ok) {
      // 失败也置 hydrated：见 interface 里 `hydrated` 的说明（避免 UI 永久停在"加载中"）
      set({ loading: false, hydrated: true, error: res.error.message });
      log.error('db', '加载人设列表失败', res.error, 'XR-07');
      return;
    }
    const list = res.value;
    set({
      personas: list,
      loading: false,
      hydrated: true,
      currentId: pickCurrentId(list, get().currentId),
    });
  },

  current: () => {
    const { personas, currentId } = get();
    return personas.find((p) => p.id === currentId) ?? personas[0];
  },

  select: (id) => set({ currentId: id }),

  create: async (name, data) => {
    const res = await personaRepo.create({ name, data, origin: 'external' });
    if (!res.ok) {
      log.error('db', '创建角色失败', res.error, 'FN-51');
      throw res.error;
    }
    await get().reload();
    return res.value;
  },

  updateData: async (id, data) => {
    const res = await personaRepo.updateData(id, data);
    if (!res.ok) throw res.error;
    await get().reload();
  },

  remove: async (id) => {
    const res = await personaRepo.remove(id);
    if (!res.ok) {
      // 内置卡被拒：把原因直接抛给 UI（走文案 key，不显示英文）
      log.warn('db', '删除角色被拒绝', res.error, 'XR-07');
      throw res.error;
    }
    await get().reload();
  },

  importCards: async (cards) => {
    const res = await personaRepo.importCards(cards);
    if (!res.ok) throw res.error;
    await get().reload();
    return res.value;
  },

  byOrigin: (origin) => get().personas.filter((p) => p.origin === origin),

  assertImageAllowed: (id) => {
    const card = get().personas.find((p) => p.id === id);
    if (!card) throw new AppError('IMPORT_INVALID', '角色不存在', { id });
    // ★ 隐私红线
    personaRepo.assertImageAllowed(card);
  },
}));

/** 选择器：内置欣然卡 */
export const selectXinran = (s: PersonaState): PersonaCard | undefined =>
  s.personas.find((p) => p.id === XINRAN_PERSONA_ID);

/** 选择器：当前角色 */
export const selectCurrentPersona = (s: PersonaState): PersonaCard | undefined =>
  s.personas.find((p) => p.id === s.currentId) ?? s.personas[0];

export default usePersonaStore;
