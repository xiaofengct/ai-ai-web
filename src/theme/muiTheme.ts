import { createTheme, type Theme, type ThemeOptions } from '@mui/material/styles';
import { THEME_TOKENS } from './themeTokens';
import type { ResolvedMode } from './modes';

/**
 * 由 mode + grayscale + yandereMode 生成 MUI Theme。
 *
 * 说明：
 * - `yandereMode` **只替换色板**，绝不改提示词语气（语气由 persona/styleSegment 负责，见架构文档 §6.7）；
 * - `grayscale` 的根滤镜写在 `global.css` 的 `html.grayscale`，不进 palette；
 * - `importantComponent` 用于隔离 Tailwind preflight 对 MUI 组件内部样式的污染（T01 验收要点④）。
 */

/** 启用 importantComponent 隔离的组件清单 */
const IMPORTANT_COMPONENTS: string[] = [
  'Button',
  'IconButton',
  'TextField',
  'Select',
  'Checkbox',
  'Radio',
  'Switch',
  'Slider',
  'Chip',
  'ListItemButton',
  'InputBase',
  'FormControlLabel',
];

function buildOptions(mode: ResolvedMode, yandere: boolean): ThemeOptions {
  const t = THEME_TOKENS;
  const surface = t.surface[mode];
  const primary = yandere
    ? // 病娇色板：降饱和、偏暗红；保留 contrastText 保证可读
      {
        main: t.yandere[500],
        light: t.yandere[400],
        dark: t.yandere[700],
        contrastText: '#FFFFFF',
      }
    : {
        main: t.primary[500],
        light: t.primary[400],
        dark: t.primary[700],
        contrastText: '#FFFFFF',
      };

  const options = {
    palette: {
      mode,
      primary: { ...primary, 50: t.primary[50], 100: t.primary[100], 200: t.primary[200] },
      secondary: {
        main: t.accent[500],
        light: t.accent[300],
        dark: t.accent[700],
        contrastText: mode === 'dark' ? '#161A22' : '#FFFFFF',
      },
      background: {
        default: surface.bg,
        paper: surface.paper,
      },
      text: {
        primary: surface.text,
        secondary: surface.textSecondary,
        disabled: surface.textDisabled,
      },
      divider: surface.divider,
      success: { main: t.semantic.success },
      warning: { main: t.semantic.warning },
      error: { main: t.semantic.error },
      info: { main: t.semantic.info },
      grey: {
        50: t.ink[50],
        100: t.ink[100],
        200: t.ink[200],
        300: t.ink[300],
        400: t.ink[400],
        500: t.ink[500],
        600: t.ink[600],
        700: t.ink[700],
        800: t.ink[800],
        900: t.ink[900],
      },
    },
    shape: {
      borderRadius: t.radius.md,
    },
    spacing: t.spacingUnit,
    typography: {
      fontFamily: t.font.family,
      fontSize: t.font.sizes.md * 16,
      htmlFontSize: 16,
      h1: { fontSize: `${t.font.sizes.xl + 0.6}rem`, fontWeight: 700 },
      h2: { fontSize: `${t.font.sizes.xl + 0.25}rem`, fontWeight: 700 },
      h3: { fontSize: `${t.font.sizes.xl}rem`, fontWeight: 600 },
      h4: { fontSize: `${t.font.sizes.lg + 0.125}rem`, fontWeight: 600 },
      h5: { fontSize: `${t.font.sizes.lg}rem`, fontWeight: 600 },
      h6: { fontSize: `${t.font.sizes.md + 0.0625}rem`, fontWeight: 600 },
      body1: { fontSize: `${t.font.sizes.md}rem`, lineHeight: 1.7 },
      body2: { fontSize: `${t.font.sizes.sm}rem`, lineHeight: 1.65 },
      caption: { fontSize: `${t.font.sizes.xs}rem`, lineHeight: 1.5 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: surface.bg,
            color: surface.text,
            // 布局交给 Tailwind，这里只保证基础排版
            WebkitFontSmoothing: 'antialiased',
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true, disableRipple: false },
        styleOverrides: { root: { borderRadius: t.radius.lg, textTransform: 'none' } },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: 'none' } },
      },
      MuiTextField: {
        defaultProps: { size: 'small', variant: 'outlined' },
      },
      MuiTooltip: {
        defaultProps: { enterDelay: 300, arrow: true },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: t.radius.lg } },
      },
    },
  };

  return options as ThemeOptions;
}

let cache: { key: string; theme: Theme } | null = null;

/**
 * 生成 MUI Theme（带缓存，避免每次 render 重建）。
 * @param mode    实际明暗模式（由 theme/modes.resolveMode 得出）
 * @param yandere 病娇色板开关（只改色板，不改语气）
 */
export function createAppTheme(mode: ResolvedMode, yandere = false): Theme {
  const key = `${mode}|${yandere ? 'y' : 'n'}`;
  if (cache && cache.key === key) return cache.theme;
  const theme = createTheme(buildOptions(mode, yandere), {
    importantComponent: IMPORTANT_COMPONENTS,
  });
  cache = { key, theme };
  return theme;
}

/** 取当前模式下的气泡配色（组件侧按需直接取 token，不进 MUI palette） */
export function bubbleColors(mode: ResolvedMode) {
  return THEME_TOKENS.bubble[mode];
}

export default createAppTheme;
