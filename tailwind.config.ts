import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Token-driven (auto-switch via CSS vars defined in globals.css)
        page: 'var(--c-page)',
        card: 'var(--c-card)',
        hairline: 'var(--c-hairline)',
        pill: 'var(--c-pill)',
        ink: 'var(--c-ink)',
        mid: 'var(--c-mid)',
        light: 'var(--c-light)',
        navy: 'var(--c-navy)',
        brand: {
          DEFAULT: 'var(--c-brand)',
          soft: 'var(--c-brand-soft)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Courier New"', 'monospace'],
      },
      borderRadius: {
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        modal: '0 20px 60px rgba(0,0,0,0.18)',
        toast: '0 8px 24px rgba(0,0,0,0.18)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'pop-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease',
        'pop-up': 'pop-up 0.2s ease',
      },
    },
  },
  plugins: [],
};

export default config;
