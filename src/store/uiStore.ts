import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SK } from '@/constants/storageKeys';
import type { CopyKey } from '@/copy/keys';
import type { UUID } from '@/types/common';

/**
 * UI 快照 Store（架构文档 §6.6）：抽屉、首页布局 v1/v2、多选态、临时主题覆写。
 * **不存业务数据**（会话/消息/记忆一律在 Dexie）。
 */

export type MobileTab = 'home' | 'moments' | 'memories' | 'distill' | 'settings';

export interface SnackMessage {
  id: string;
  /** 文案 key（★ 不传字面量） */
  key: CopyKey;
  vars?: Record<string, string | number>;
  severity: 'default' | 'success' | 'error' | 'warning' | 'info';
  durationMs?: number;
}

export interface UiState {
  /** 侧边抽屉是否展开 */
  drawerOpen: boolean;
  /** 首页布局（PG-15） */
  homeLayout: 'v1' | 'v2';
  /** 移动端底部 Tab */
  mobileTab: MobileTab;
  /** 多选态（FN-63） */
  multiSelect: boolean;
  selectedMessageIds: UUID[];
  selectedSessionIds: UUID[];
  /** 当前会话 id（跨页面保持一致，落 localStorage 便于刷新恢复） */
  currentSessionId?: UUID;
  /** 最近访问的角色 id */
  currentPersonaId?: UUID;
  /** 全局加载遮罩 */
  loading: { open: boolean; key: CopyKey; vars?: Record<string, string | number> };
  /** Snackbar 宿主队列 */
  snacks: SnackMessage[];
  /** 临时主题覆写（不落库，刷新即失效） */
  themeOverride?: { dark?: boolean; grayscale?: boolean; yandere?: boolean };
  /** 桌宠浮层位置（SV-04 降级实现） */
  petPosition: { x: number; y: number };
  /** 全屏文本页字号（PG-22） */
  readerFontSize: number;

  setDrawerOpen(open: boolean): void;
  toggleDrawer(): void;
  setHomeLayout(layout: 'v1' | 'v2'): void;
  setMobileTab(tab: MobileTab): void;
  setMultiSelect(on: boolean): void;
  toggleMessageSelected(id: UUID): void;
  toggleSessionSelected(id: UUID): void;
  clearSelection(): void;
  setCurrentSession(id?: UUID): void;
  setCurrentPersona(id?: UUID): void;
  showLoading(key: CopyKey, vars?: Record<string, string | number>): void;
  hideLoading(): void;
  pushSnack(snack: Omit<SnackMessage, 'id'>): string;
  dismissSnack(id: string): void;
  setThemeOverride(override?: UiState['themeOverride']): void;
  /**
   * 「退出确认」对话框是否打开。
   *
   * ★ 为什么要提到应用级（2026-10-04，返回键改造的一部分）：
   *   原先这个对话框的状态在 `TopBar` 的**局部** `useState` 里，
   *   而 `TopBar` 同时又往 `appEmitter` 发 `app:exit-request`
   *   —— 那个事件**全仓没有任何监听方**（死事件），
   *   也就是说「广播一次退出请求」这条路其实一直是断的。
   *   Android 返回键需要复用同一个确认框（不能在顶栏里、而返回键又碰不到），
   *   所以把状态提到这里：谁都能请求，唯一一个对话框负责渲染。
   *
   * ★ 属**运行时状态**，不进 `partialize`（见文件末尾），刷新即复位。
   */
  exitConfirmOpen: boolean;
  /** 请求弹出退出确认（顶栏双击 Logo / Android 返回键在根部时都会调它） */
  requestExitConfirm(open: boolean): void;
  setPetPosition(x: number, y: number): void;
  setReaderFontSize(size: number): void;
}

let snackSeq = 0;

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      drawerOpen: false,
      homeLayout: 'v1',
      mobileTab: 'home',
      multiSelect: false,
      selectedMessageIds: [],
      selectedSessionIds: [],
      currentSessionId: undefined,
      currentPersonaId: undefined,
      loading: { open: false, key: 'loading.default' },
      snacks: [],
      themeOverride: undefined,
      exitConfirmOpen: false,
      petPosition: { x: 0.82, y: 0.7 },
      readerFontSize: 16,

      setDrawerOpen: (open) => set({ drawerOpen: open }),
      toggleDrawer: () => set({ drawerOpen: !get().drawerOpen }),

      setHomeLayout: (layout) => set({ homeLayout: layout }),
      setMobileTab: (tab) => set({ mobileTab: tab }),

      setMultiSelect: (on) => set({ multiSelect: on, ...(on ? {} : { selectedMessageIds: [], selectedSessionIds: [] }) }),

      toggleMessageSelected: (id) =>
        set((state) => ({
          selectedMessageIds: state.selectedMessageIds.includes(id)
            ? state.selectedMessageIds.filter((x) => x !== id)
            : [...state.selectedMessageIds, id],
        })),

      toggleSessionSelected: (id) =>
        set((state) => ({
          selectedSessionIds: state.selectedSessionIds.includes(id)
            ? state.selectedSessionIds.filter((x) => x !== id)
            : [...state.selectedSessionIds, id],
        })),

      clearSelection: () => set({ selectedMessageIds: [], selectedSessionIds: [] }),

      setCurrentSession: (id) => set({ currentSessionId: id }),
      setCurrentPersona: (id) => set({ currentPersonaId: id }),

      showLoading: (key, vars) => set({ loading: { open: true, key, vars } }),
      hideLoading: () => set((state) => ({ loading: { ...state.loading, open: false } })),

      pushSnack: (snack) => {
        snackSeq += 1;
        const id = `snack-${snackSeq}`;
        set((state) => ({ snacks: [...state.snacks, { ...snack, id }] }));
        return id;
      },

      dismissSnack: (id) => set((state) => ({ snacks: state.snacks.filter((s) => s.id !== id) })),

      setThemeOverride: (override) => set({ themeOverride: override }),
      requestExitConfirm: (open) => set({ exitConfirmOpen: open }),
      setPetPosition: (x, y) => set({ petPosition: { x, y } }),
      setReaderFontSize: (size) => set({ readerFontSize: size }),
    }),
    {
      name: SK.ui,
      version: 1,
      // 运行时状态（loading / snacks / themeOverride）不持久化
      partialize: (state) =>
        ({
          drawerOpen: state.drawerOpen,
          homeLayout: state.homeLayout,
          mobileTab: state.mobileTab,
          currentSessionId: state.currentSessionId,
          currentPersonaId: state.currentPersonaId,
          petPosition: state.petPosition,
          readerFontSize: state.readerFontSize,
        }) as unknown as UiState,
    },
  ),
);

/** 选择器 */
export const selectDrawerOpen = (s: UiState): boolean => s.drawerOpen;
export const selectHomeLayout = (s: UiState): 'v1' | 'v2' => s.homeLayout;
export const selectSelectedMessageIds = (s: UiState): UUID[] => s.selectedMessageIds;

export default useUiStore;
