import type { Metadata } from 'next';
import '@/app/globals.css';

export const metadata: Metadata = {
  title: {
    template: '%s | Стандартотворець',
    default: 'Стандартотворець',
  },
  description: 'Платформа управління lifecycle стандартів у робочих групах',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
