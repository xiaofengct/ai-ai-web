import { SK } from '@/constants/storageKeys';

/**
 * 深色模式解析（T01）。
 *
 * - `system / light / dark` → 实际 `light | dark`；
 * - 监听 `prefers-color-scheme`，跟随系统时实时切换；
 * - 首屏防闪烁由 `index.html` 的内联脚本完成，它**只读** `ai-ai.theme.v1` 这一项，
 *   因此这里写入快照时也必须只写 `{ darkMode, grayscale }` 两个字段（见 writeThemeSnapshot）。
 */

export type ThemeModeSetting = 'system' | 'light' | 'dark';
export type ResolvedMode = 'light' | 'dark';

export interface ThemeSnapshot {
  darkMode: ThemeModeSetting;
  grayscale: boolean;
}

export const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = {
  darkMode: 'system',
  grayscale: false,
};

/** 读取主题快照（首屏只读这一项，失败时回落到默认值，绝不抛错阻塞启动） */
export function readThemeSnapshot(): ThemeSnapshot {
  try {
    const raw = localStorage.getItem(SK.theme);
    if (!raw) return { ...DEFAULT_THEME_SNAPSHOT };
    const parsed = JSON.parse(raw) as Partial<ThemeSnapshot>;
    return {
      darkMode: parsed.darkMode ?? DEFAULT_THEME_SNAPSHOT.darkMode,
      grayscale: parsed.grayscale ?? DEFAULT_THEME_SNAPSHOT.grayscale,
    };
  } catch {
    return { ...DEFAULT_THEME_SNAPSHOT };
  }
}

/** 写入主题快照（只写两个字段，保持与 index.html 内联脚本的契约） */
export function writeThemeSnapshot(snapshot: ThemeSnapshot): void {
  try {
    localStorage.setItem(
      SK.theme,
      JSON.stringify({
        darkMode: snapshot.darkMode,
        grayscale: snapshot.grayscale,
      } satisfies ThemeSnapshot),
    );
  } catch {
    /* 隐私模式下 localStorage 可能不可写，忽略 */
  }
}

/** 系统是否偏好深色 */
export function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 把用户设置解析为实际模式 */
export function resolveMode(setting: ThemeModeSetting = 'system'): ResolvedMode {
  if (setting === 'dark') return 'dark';
  if (setting === 'light') return 'light';
  return prefersDark() ? 'dark' : 'light';
}

/** 把 dark / grayscale 套到 <html> 根节点（grayscale 用 CSS filter，见 global.css） */
export function applyRootClasses(mode: ResolvedMode, grayscale: boolean): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.classList.toggle('grayscale', grayscale);
  root.style.colorScheme = mode;
}

/** 监听系统主题变化，返回取消函数 */
export function watchSystemTheme(onChange: (mode: ResolvedMode) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (e: MediaQueryListEvent): void => onChange(e.matches ? 'dark' : 'light');
  // Safari < 14 只有 addListener
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }
  mql.addListener(handler);
  return () => mql.removeListener(handler);
}
