import type { Config } from 'tailwindcss';

/**
 * Tailwind 配置。
 *
 * ★ 色板单一真源是 `src/theme/themeTokens.ts`；
 *   这里按架构文档 §6.7 的要求「以字面量重复一份」——因为 Tailwind 配置由 PostCSS/Node 侧加载，
 *   无法可靠地 import src 下的 TS 模块。**任何色值改动必须同步两处**（见注释标记「与 themeTokens.ts 同步」）。
 *
 * 职责分工：MUI 负责组件样式，Tailwind 只负责布局（flex / grid / gap / padding / margin）与响应式。
 */
const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // —— 与 themeTokens.ts 同步 ——
      colors: {
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
        accent: {
          100: '#FFEAF0',
          300: '#FFB3C6',
          500: '#FF8FA8',
          700: '#C75C78',
        },
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
      },
      borderRadius: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
      },
      fontFamily: {
        sans: [
          '"PingFang SC"',
          '"Microsoft YaHei"',
          '"Noto Sans SC"',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'translateY(0) scale(1)' },
          '50%': { transform: 'translateY(-4px) scale(1.012)' },
        },
        patRipple: {
          '0%': { opacity: '0.55', transform: 'scale(0.6)' },
          '100%': { opacity: '0', transform: 'scale(1.8)' },
        },
      },
      animation: {
        breathe: 'breathe 4s ease-in-out infinite',
        'pat-ripple': 'patRipple 520ms ease-out forwards',
      },
    },
  },
  plugins: [],
  corePlugins: {
    // 保留 preflight（与 MUI CssBaseline 共存；MUI 侧用 importantComponent 隔离）
    preflight: true,
  },
};

export default config;
