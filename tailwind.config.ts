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
        navy: {
          DEFAULT: '#0F2B6B',
          50: '#EBF0FA',
          100: '#C3D0F0',
          600: '#1A3A8F',
          700: '#0F2B6B',
          900: '#091A44',
        },
        brand: {
          DEFAULT: '#1A56DB',
          soft: '#EEF4FF',
          50: '#EEF4FF',
          100: '#DBEAFE',
          500: '#3B82F6',
          600: '#1A56DB',
          700: '#1D4ED8',
        },
        ink: '#1A2540',
        mid: '#4B5880',
        light: '#8A96B0',
        pill: '#EDF0F7',
        page: '#F5F7FA',
        hairline: '#E5EAF2',
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
