'use client';

import { type Session } from 'next-auth';
import { Bell, Sun, Moon, Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { useTheme } from '@/components/providers/ThemeProvider';

interface TopbarProps {
  session: Session;
  onOpenMobileMenu?: () => void;
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

export function Topbar({ session: _session, onOpenMobileMenu }: TopbarProps) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const { data: unreadCount } = trpc.notification.unreadCount.useQuery(undefined, {
    // Match the NewNotificationsWatcher poll so the bell badge and the
    // top-right popup arrive together. Watcher also invalidates this query
    // when it sees a new notification, so 15s is just the fallback cadence.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  // Find the title by longest matching prefix
  const title =
    Object.entries(PAGE_TITLES)
      .filter(([key]) => pathname.startsWith(key))
      .sort(([a], [b]) => b.length - a.length)[0]?.[1] ?? '';

  const hasUnread = (unreadCount ?? 0) > 0;

  return (
    <header className="h-[54px] bg-card border-b border-hairline flex items-center gap-3 md:gap-4 px-3 md:px-6 shrink-0">
      {/* Mobile hamburger — opens sidebar drawer on <lg */}
      <button
        type="button"
        onClick={() => onOpenMobileMenu?.()}
        aria-label="Відкрити меню"
        className="lg:hidden w-10 h-10 flex items-center justify-center text-mid hover:text-ink hover:bg-pill rounded-[10px] transition-colors -ml-1"
      >
        <Menu size={20} />
      </button>

      {/* Page title */}
      <h1 className="text-[15px] font-bold text-navy min-w-0 truncate">{title}</h1>

      <div className="flex-1" />

      {/* Search trigger — opens Cmd+K command palette */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event('cmdk:open'))}
        className="inline-flex items-center gap-2 h-9 md:h-9 px-2 md:px-3 rounded-[10px] border border-hairline bg-page text-light hover:text-ink hover:border-mid transition-colors"
        title="Пошук (⌘K)"
      >
        <Search size={15} />
        <span className="hidden md:inline text-sm">Пошук</span>
        <kbd className="hidden md:inline ml-2 text-[10px] font-mono px-1 py-0.5 border border-hairline rounded">
          ⌘K
        </kbd>
      </button>

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
