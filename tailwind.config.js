/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx,html}',
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        void: 'var(--bg-void)',
        surface: 'var(--bg-surface)',
        elevated: 'var(--bg-elevated)',
        invert: 'var(--bg-invert)',
        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        muted: 'var(--text-muted)',
        hair: 'var(--line-hair)',
        strong: 'var(--line-strong)',
        amber: 'var(--accent-amber)',
        volt: 'var(--accent-volt)',
        crimson: 'var(--accent-crimson)',
        cyan: 'var(--accent-cyan)',
      },
      borderRadius: {
        sm: '2px',
      },
    },
  },
  plugins: [],
};
