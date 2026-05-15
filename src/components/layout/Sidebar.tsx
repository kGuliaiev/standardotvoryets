'use client';

import { type Session } from 'next-auth';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  LayoutDashboard,
  BookOpen,
  Calendar,
  CheckSquare,
  Bell,
  Settings,
  LogOut,
  ChevronDown,
} from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';
import { useState } from 'react';

interface SidebarProps {
  session: Session;
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { href: '/standards', label: 'Стандарти', icon: BookOpen },
  { href: '/meetings', label: 'Засідання', icon: Calendar },
  { href: '/tasks', label: 'Завдання', icon: CheckSquare },
  { href: '/notifications', label: 'Сповіщення', icon: Bell },
];

export function Sidebar({ session }: SidebarProps) {
  const pathname = usePathname();
  const [wgExpanded, setWgExpanded] = useState(true);
  const memberships = session.user.memberships ?? [];

  return (
    <aside className="w-56 bg-navy-700 flex flex-col shrink-0 overflow-hidden">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/10">
        <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center shrink-0">
          <svg width="16" height="16" viewBox="0 0 22 22" fill="none">
            <path
              d="M3 5h16M3 11h16M3 17h10"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <span className="text-white font-semibold text-sm leading-tight">Стандарто-творець</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto scrollbar-thin">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/10 hover:text-white/90',
              )}
            >
              <Icon size={16} className="shrink-0" />
              {label}
            </Link>
          );
        })}

        {/* Working groups */}
        {memberships.length > 0 && (
          <div className="mt-4 pt-4 border-t border-white/10">
            <button
              onClick={() => setWgExpanded((v) => !v)}
              className="flex items-center justify-between w-full px-3 py-1.5 text-white/40 text-xs font-semibold uppercase tracking-wider hover:text-white/60 transition-colors"
            >
              Робочі групи
              <ChevronDown
                size={12}
                className={cn('transition-transform', wgExpanded ? 'rotate-180' : '')}
              />
            </button>
            {wgExpanded && (
              <div className="mt-1 space-y-0.5">
                {memberships.map((m) => (
                  <div
                    key={m.workingGroupId}
                    className="flex items-center gap-2.5 px-3 py-1.5 text-white/60 text-xs"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: m.workingGroup.color }}
                    />
                    {m.workingGroup.code}
                    <span className="text-white/30 text-[10px] ml-auto">{m.role.slice(0, 3)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Admin link */}
        {session.user.globalRole === 'ADMIN' && (
          <div className="mt-2 pt-2 border-t border-white/10">
            <Link
              href="/admin"
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                pathname.startsWith('/admin')
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/10 hover:text-white/90',
              )}
            >
              <Settings size={16} className="shrink-0" />
              Адмін
            </Link>
          </div>
        )}
      </nav>

      {/* User info + logout */}
      <div className="p-3 border-t border-white/10">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
            {getInitials(session.user.name ?? 'U')}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-medium truncate">{session.user.name}</p>
            <p className="text-white/40 text-[10px] truncate">{session.user.email}</p>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-white/50 hover:text-white/80 text-xs transition-colors rounded-lg hover:bg-white/10"
        >
          <LogOut size={13} />
          Вийти
        </button>
      </div>
    </aside>
  );
}
