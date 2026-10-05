/**
 * ★ 设计系统单一真源。
 *
 * - MUI 的 `createTheme()`（`theme/muiTheme.ts`）从这里派生；
 * - Tailwind 的 `theme.extend.colors`（`tailwind.config.ts`）**以字面量重复一份**并标注同步，
 *   因为 Tailwind 配置由 PostCSS/Node 侧加载，无法可靠 import src 下的 TS 模块。
 *   **改色值必须同步两处。**
 *
 * 职责分工（架构文档 §6.7）：MUI 负责组件样式，Tailwind 只负责布局与响应式。
 */

/** 5 档色阶（50/300/500/700/900 之外的档位按需存在） */
export interface ColorScale {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
}

export interface SemanticColor {
  success: string;
  warning: string;
  error: string;
  info: string;
}

export interface SurfaceSet {
  bg: string;
  paper: string;
  elevated: string;
  divider: string;
  text: string;
  textSecondary: string;
  textDisabled: string;
}

export interface ThemeTokens {
  /** 圆角：xs=4 sm=8 md=12 lg=16 xl=24 */
  radius: { xs: number; sm: number; md: number; lg: number; xl: number };
  /** 字号（rem） */
  font: {
    family: string;
    monoFamily: string;
    sizes: { '2xs': number; xs: number; sm: number; md: number; lg: number; xl: number };
  };
  /** 间距基准（px），MUI spacing 用 8 的倍数体系 */
  spacingUnit: number;
  /** 主色（欣然粉） */
  primary: ColorScale;
  /** 点缀色（桃） */
  accent: { 100: string; 300: string; 500: string; 700: string };
  /** 病娇色板（FN-42，仅替换色板，**不改提示词语气**） */
  yandere: { 100: string; 300: string; 400: string; 500: string; 700: string; 900: string };
  /** 中性灰阶 */
  ink: ColorScale;
  semantic: SemanticColor;
  surface: { light: SurfaceSet; dark: SurfaceSet };
  /** 消息气泡 */
  bubble: {
    light: { user: string; assistant: string; userText: string; assistantText: string };
    dark: { user: string; assistant: string; userText: string; assistantText: string };
  };
  /** 布局尺寸 */
  layout: {
    topBarHeight: number;
    sideNavWidth: number;
    mobileTabsHeight: number;
    maxContentWidth: number;
  };
  /** 动画时长（ms） */
  motion: { fast: number; normal: number; slow: number };
}

export const THEME_TOKENS: ThemeTokens = {
  radius: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },

  font: {
    family:
      '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, -apple-system, "Segoe UI", sans-serif',
    monoFamily: '"JetBrains Mono", Menlo, Consolas, monospace',
    sizes: { '2xs': 0.6875, xs: 0.75, sm: 0.875, md: 1, lg: 1.125, xl: 1.375 },
  },

  spacingUnit: 8,

  // —— 与 tailwind.config.ts 同步 ——
  primary: {
    50: '#FFF1F4',
    100: '#FFE0E7',
    200: '#FFC2CF',
    300: '#FF93A8',
    400: '#FF5F80',
    500: '#F0395F',
    600: '#D21F49',
    700: '#A91539',
    800: '#7E1030',
    900: '#5C0C25',
  },
  accent: { 100: '#FFEAF0', 300: '#FFB3C6', 500: '#FF8FA8', 700: '#C75C78' },
  yandere: {
    100: '#FFE3EA',
    300: '#E2708F',
    400: '#C1476B',
    500: '#8E1B3A',
    700: '#5C0F26',
    900: '#330615',
  },
  ink: {
    50: '#F7F7F8',
    100: '#EEEFF2',
    200: '#DCDFE5',
    300: '#C2C7D0',
    400: '#8E96A6',
    500: '#6B7385',
    600: '#4E5566',
    700: '#39404F',
    800: '#252A36',
    900: '#161A22',
  },

  semantic: { success: '#2E9E6B', warning: '#D98A12', error: '#D32F49', info: '#2F6FD0' },

  surface: {
    light: {
      bg: '#F7F7F8',
      paper: '#FFFFFF',
      elevated: '#FFFFFF',
      divider: 'rgba(22,26,34,0.10)',
      text: '#161A22',
      textSecondary: '#6B7385',
      textDisabled: '#C2C7D0',
    },
    dark: {
      bg: '#161A22',
      paper: '#1E232D',
      elevated: '#252A36',
      divider: 'rgba(255,255,255,0.10)',
      text: '#F2F3F5',
      textSecondary: '#A7AEBD',
      textDisabled: '#5C6474',
    },
  },

  bubble: {
    light: {
      user: '#FFE0E7',
      assistant: '#FFFFFF',
      userText: '#5C0C25',
      assistantText: '#161A22',
    },
    dark: {
      user: '#5C0C25',
      assistant: '#252A36',
      userText: '#FFE0E7',
      assistantText: '#F2F3F5',
    },
  },

  layout: {
    topBarHeight: 56,
    sideNavWidth: 240,
    mobileTabsHeight: 56,
    maxContentWidth: 960,
  },

  motion: { fast: 120, normal: 220, slow: 380 },
};

/** 便捷取值：spacing(n) = n * 8px */
export const spacing = (n: number): number => n * THEME_TOKENS.spacingUnit;

export default THEME_TOKENS;
