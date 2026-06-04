import type { Config } from 'tailwindcss';

/**
 * AI Centrum-thema is via CSS-vars. Tailwind heeft hier alleen de
 * primary/accent-mapping nodig om bestaande utility-classes (`bg-primary-500`,
 * `text-accent`) door te laten verwijzen naar `var(--theme-*)`.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Theme-tokens als CSS-vars (zie src/styles.css)
        bg: 'var(--theme-bg)',
        sidebar: 'var(--theme-sidebar)',
        panel: 'var(--theme-panel)',
        card: 'var(--theme-card)',
        card2: 'var(--theme-card2)',
        border: 'var(--theme-border)',
        muted: 'var(--theme-muted)',
        accent: {
          DEFAULT: 'var(--theme-accent)',
          secondary: 'var(--theme-accent-secondary)',
          subtle: 'var(--theme-accent-subtle)',
          border: 'var(--theme-accent-border)',
        },
        text: 'var(--theme-text)',
        success: 'var(--theme-success)',
        danger: 'var(--theme-danger)',
        warning: 'var(--theme-warning)',
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
