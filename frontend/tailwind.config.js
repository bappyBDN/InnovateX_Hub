const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: v('ink'), muted: v('ink-muted') },
        canvas: v('canvas'),
        surface: v('surface'),
        line: v('line'),
        primary: { DEFAULT: v('primary'), soft: v('primary-soft'), fg: v('primary-fg') },
        spark: { DEFAULT: v('spark'), soft: v('spark-soft'), ink: v('spark-ink') },
        success: { DEFAULT: v('success'), soft: v('success-soft') },
        warning: { DEFAULT: v('warning'), soft: v('warning-soft') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft') },
        info: { DEFAULT: v('info'), soft: v('info-soft') },
        neutral: { soft: v('neutral-soft') },
      },
      fontFamily: {
        sans: ['"Noto Sans"', '"Noto Sans Bengali"', 'system-ui', '"Segoe UI"', 'sans-serif'],
      },
      borderRadius: { control: '6px', panel: '10px', dialog: '14px' },
      maxWidth: { content: '1280px', reading: '760px' },
      boxShadow: { float: '0 8px 24px rgb(15 23 32 / 0.14)' },
    },
  },
  plugins: [],
};
