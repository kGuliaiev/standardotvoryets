import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Сторінку не знайдено',
};

/**
 * Custom 404. Without this, Next.js falls back to its built-in English page on
 * a black background — jarring inside a Ukrainian, themeable app (QA F-5).
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-blue-50 via-white to-blue-50 dark:from-slate-900 dark:via-blue-950 dark:to-slate-900">
      <div className="text-center max-w-md">
        <p className="text-[64px] font-extrabold text-brand leading-none">404</p>
        <h1 className="text-xl font-semibold text-ink mt-2">Сторінку не знайдено</h1>
        <p className="text-sm text-mid mt-3">
          Можливо, посилання застаріло або сторінку перенесли. Поверніться на головну й оберіть
          потрібний розділ.
        </p>
        <div className="mt-6 inline-flex">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            На головну
          </Link>
        </div>
      </div>
    </div>
  );
}
