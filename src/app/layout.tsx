import type { Metadata } from 'next';
import '@/app/globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';

export const metadata: Metadata = {
  title: {
    template: '%s | Стандартотворець',
    default: 'Стандартотворець',
  },
  description: 'Платформа управління lifecycle стандартів у робочих групах',
  icons: {
    icon: [
      { url: '/logo.png', type: 'image/png' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: '/logo.png',
  },
};

// Inline script runs before React hydration to avoid theme flash
const themeBootstrap = `
  (function(){
    try {
      var t = localStorage.getItem('theme');
      if (!t && window.matchMedia('(prefers-color-scheme: dark)').matches) t = 'dark';
      if (t === 'dark') document.documentElement.classList.add('dark');
    } catch(e) {}
  })();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
