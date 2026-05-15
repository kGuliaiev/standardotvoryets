'use client';

import { type Session } from 'next-auth';
import { Bell, Search, Sun, Moon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { useTheme } from '@/components/providers/ThemeProvider';

interface TopbarProps {
  session: Session;
}

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Дашборд',
  '/standards': 'Стандарти',
  '/working-groups': 'Робочі групи',
  '/meetings': 'Засідання',
  '/tasks': 'Завдання',
  '/notifications': 'Сповіщення',
  '/admin': 'Адміністрування',
};

export function Topbar({ session: _session }: TopbarProps) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const { data: unreadCount } = trpc.notification.unreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  // Find the title by longest matching prefix
  const title =
    Object.entries(PAGE_TITLES)
      .filter(([key]) => pathname.startsWith(key))
      .sort(([a], [b]) => b.length - a.length)[0]?.[1] ?? '';

  const hasUnread = (unreadCount ?? 0) > 0;

  return (
    <header className="h-[54px] bg-card border-b border-hairline flex items-center gap-4 px-6 shrink-0">
      {/* Page title */}
      <h1 className="text-[15px] font-bold text-navy min-w-0 truncate">{title}</h1>

      <div className="flex-1" />

      {/* Search */}
      <div className="relative hidden md:flex items-center">
        <Search size={15} className="absolute left-3 text-light pointer-events-none" />
        <input
          type="search"
          placeholder="Пошук стандартів…"
          className="pl-9 pr-4 py-1.5 bg-page border border-hairline rounded-[10px] text-sm text-ink placeholder:text-light focus:outline-none focus:border-brand transition-all w-60"
        />
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggle}
        className="w-[34px] h-[34px] flex items-center justify-center text-mid hover:text-ink hover:bg-pill rounded-[10px] transition-colors"
        title={theme === 'dark' ? 'Світла тема' : 'Темна тема'}
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      {/* Notifications bell */}
      <Link
        href="/notifications"
        className="relative w-[34px] h-[34px] flex items-center justify-center text-mid hover:text-ink hover:bg-pill rounded-[10px] transition-colors"
      >
        <Bell size={18} />
        {hasUnread && (
          <span className="absolute top-1.5 right-1.5 min-w-[16px] h-[16px] px-1 bg-red-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center">
            {(unreadCount ?? 0) > 9 ? '9+' : unreadCount}
          </span>
        )}
      </Link>
    </header>
  );
}
