'use client';

import { type Session } from 'next-auth';
import { Bell, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface TopbarProps {
  session: Session;
}

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Дашборд',
  '/standards': 'Стандарти',
  '/meetings': 'Засідання',
  '/tasks': 'Завдання',
  '/notifications': 'Сповіщення',
  '/admin': 'Адміністрування',
};

export function Topbar({ session: _session }: TopbarProps) {
  const pathname = usePathname();

  // Find the title by longest matching prefix
  const title =
    Object.entries(PAGE_TITLES)
      .filter(([key]) => pathname.startsWith(key))
      .sort(([a], [b]) => b.length - a.length)[0]?.[1] ?? '';

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center gap-4 px-6 shrink-0">
      {/* Page title */}
      <h1 className="text-base font-semibold text-slate-800 min-w-0 truncate">{title}</h1>

      <div className="flex-1" />

      {/* Search */}
      <div className="relative hidden md:flex items-center">
        <Search size={15} className="absolute left-3 text-slate-400 pointer-events-none" />
        <input
          type="search"
          placeholder="Пошук стандартів..."
          className="pl-9 pr-4 py-1.5 bg-slate-100 border border-transparent rounded-xl text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-all w-56"
        />
      </div>

      {/* Notifications bell */}
      <Link
        href="/notifications"
        className="relative w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
      >
        <Bell size={18} />
        {/* Unread badge — will be dynamic once notification router is wired */}
        <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
      </Link>
    </header>
  );
}
