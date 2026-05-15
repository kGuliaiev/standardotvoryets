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
          50: '#EFF5FF',
          100: '#DBEAFE',
          500: '#3B82F6',
          600: '#1A56DB',
          700: '#1D4ED8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
};

export default config;
