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
  Users,
  FolderKanban,
  FileText,
  MessageSquare,
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
  type LucideIcon,
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { cn, getInitials } from '@/lib/utils';
import { useLocalStorageState } from '@/lib/useLocalStorageState';

interface SidebarProps {
  session: Session;
}

type BadgeTone = 'brand' | 'rose' | 'amber' | 'gray';
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number | null;
  badgeTone?: BadgeTone;
  disabled?: boolean;
}
interface NavSection {
  label: string;
  items: NavItem[];
}

const BADGE_CLS: Record<BadgeTone, string> = {
  brand: 'bg-[#ECFDF5] text-[#065F46]',
  rose: 'bg-red-500 text-white',
  amber: 'bg-[#FFF7E6] text-[#92400E]',
  gray: 'bg-pill text-mid',
};

export function Sidebar({ session }: SidebarProps) {
  const pathname = usePathname();
  const memberships = session.user.memberships ?? [];
  const [collapsed, setCollapsed] = useLocalStorageState<boolean>('sidebar.collapsed', false);

  const { data: counts } = trpc.dashboard.navCounts.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  // Unread discussions = comments newer than the timestamp written when the
  // user last opened /discussions. Falls back to "no badge" if never visited.
  const [discussionsLastVisit] = useLocalStorageState<string | null>(
    'discussions.lastVisit.v1',
    null,
  );
  const { data: discussionsUnread } = trpc.comment.unreadCountForUser.useQuery(
    { since: discussionsLastVisit ? new Date(discussionsLastVisit) : null },
    { refetchInterval: 60_000, enabled: !!discussionsLastVisit },
  );

  const sections: NavSection[] = [
    {
      label: 'ГОЛОВНЕ',
      items: [
        { href: '/dashboard', label: 'Дашборд', icon: LayoutDashboard },
        { href: '/working-groups', label: 'Робочі групи', icon: FolderKanban },
        {
          href: '/standards',
          label: 'Стандарти',
          icon: BookOpen,
          badge: counts?.standardsActive ?? null,
          badgeTone: 'brand',
        },
      ],
    },
    {
      label: 'ЗАСІДАННЯ',
      items: [
        {
          href: '/meetings',
          label: 'Засідання',
          icon: Calendar,
          badge: counts?.meetingsUpcoming ?? null,
          badgeTone: counts?.meetingsUpcoming ? 'rose' : 'gray',
        },
        {
          href: '/protocols',
          label: 'Протоколи',
          icon: FileText,
          badge: counts?.minutesPending ?? null,
          badgeTone: counts?.minutesPending ? 'amber' : 'gray',
        },
      ],
    },
    {
      label: 'РОБОТА',
      items: [
        {
          href: '/tasks',
          label: 'Завдання',
          icon: CheckSquare,
          badge: counts?.tasksOpenForMe ?? null,
          badgeTone: counts?.tasksOpenForMe ? 'rose' : 'gray',
        },
        {
          href: '/discussions',
          label: 'Обговорення',
          icon: MessageSquare,
          badge: discussionsUnread?.count ?? null,
          badgeTone: discussionsUnread?.count ? 'rose' : 'gray',
        },
        { href: '/reports', label: 'Звіт', icon: BarChart3 },
      ],
    },
  ];

  if (session.user.globalRole === 'ADMIN' || session.user.globalRole === 'DIRECTOR') {
    sections.push({
      label: 'АДМІН',
      items: [
        ...(session.user.globalRole === 'ADMIN'
          ? [
              {
                href: '/admin/users',
                label: 'Користувачі',
                icon: Users,
              } satisfies NavItem,
            ]
          : []),
        { href: '/admin/settings', label: 'Налаштування', icon: Settings },
        {
          href: '/notifications',
          label: 'Сповіщення',
          icon: Bell,
          badge: counts?.unreadNotifications ?? null,
          badgeTone: counts?.unreadNotifications ? 'rose' : 'gray',
        },
      ],
    });
  } else {
    const lastSection = sections[sections.length - 1];
    if (lastSection) {
      lastSection.items.push({
        href: '/notifications',
        label: 'Сповіщення',
        icon: Bell,
        badge: counts?.unreadNotifications ?? null,
        badgeTone: counts?.unreadNotifications ? 'rose' : 'gray',
      });
    }
  }

  return (
    <aside
      className={cn(
        'bg-card border-r border-hairline flex flex-col shrink-0 overflow-hidden transition-[width] duration-200',
        collapsed ? 'w-[64px]' : 'w-[228px]',
      )}
    >
      {/* Brand + collapse toggle */}
      <div
        className={cn(
          'flex items-center border-b border-hairline',
          collapsed ? 'justify-center px-2 py-4' : 'gap-2.5 px-4 py-4',
        )}
      >
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Розгорнути меню' : 'Згорнути меню'}
          className="w-8 h-8 bg-navy rounded-[10px] flex items-center justify-center shrink-0 hover:opacity-90 transition-opacity"
        >
          <svg width="16" height="16" viewBox="0 0 22 22" fill="none">
            <path
              d="M3 5h16M3 11h16M3 17h10"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {!collapsed && (
          <>
            <span className="text-navy font-extrabold text-sm leading-tight flex-1">
              Стандарто-творець
            </span>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title="Згорнути меню"
              className="p-1 rounded text-mid hover:text-ink hover:bg-pill transition-colors"
            >
              <ChevronsLeft size={16} />
            </button>
          </>
        )}
      </div>

      {/* Nav */}
      <nav
        className={cn(
          'flex-1 py-4 overflow-y-auto scrollbar-thin space-y-5',
          collapsed ? 'px-2' : 'px-3',
        )}
      >
        {sections.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <div className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-[0.8px] text-light">
                {section.label}
              </div>
            )}
            {collapsed && <div className="mb-2 mx-2 h-px bg-hairline first:hidden" aria-hidden />}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                const showBadge = typeof item.badge === 'number' && item.badge > 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'group flex items-center rounded-[10px] text-sm transition-colors relative',
                      collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-2 py-2',
                      isActive
                        ? 'bg-brand-soft text-brand font-semibold'
                        : 'text-ink hover:bg-pill',
                    )}
                  >
                    <Icon
                      size={collapsed ? 18 : 16}
                      className={cn(
                        'shrink-0',
                        isActive ? 'text-brand' : 'text-mid group-hover:text-ink',
                      )}
                    />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {showBadge &&
                      (collapsed ? (
                        <span
                          className={cn(
                            'absolute top-1 right-1 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-bold inline-flex items-center justify-center',
                            BADGE_CLS[item.badgeTone ?? 'gray'],
                          )}
                        >
                          {item.badge}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            'min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-bold inline-flex items-center justify-center',
                            BADGE_CLS[item.badgeTone ?? 'gray'],
                          )}
                        >
                          {item.badge}
                        </span>
                      ))}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {/* User's WGs */}
        {memberships.length > 0 && (
          <div>
            {!collapsed && (
              <div className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-[0.8px] text-light">
                МОЇ РГ
              </div>
            )}
            <div className="space-y-0.5">
              {memberships.map((m) => (
                <Link
                  key={m.workingGroupId}
                  href={`/working-groups/${m.workingGroupId}`}
                  title={collapsed ? `${m.workingGroup.code} (${m.role})` : undefined}
                  className={cn(
                    'group flex items-center rounded-[10px] text-xs text-mid hover:bg-pill hover:text-ink transition-colors',
                    collapsed ? 'justify-center px-0 py-1.5' : 'gap-2.5 px-2 py-1.5',
                  )}
                >
                  <span
                    className={cn('rounded-full shrink-0', collapsed ? 'w-2.5 h-2.5' : 'w-2 h-2')}
                    style={{ backgroundColor: m.workingGroup.color }}
                  />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate font-mono">{m.workingGroup.code}</span>
                      <span className="text-[9px] text-light shrink-0 uppercase">
                        {m.role.slice(0, 3)}
                      </span>
                    </>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* User block */}
      <div className={cn('border-t border-hairline', collapsed ? 'p-2' : 'p-3')}>
        <Link
          href="/profile"
          title={collapsed ? `${session.user.name} — профіль` : undefined}
          className={cn(
            'flex items-center rounded-[10px] hover:bg-pill transition-colors',
            collapsed ? 'justify-center p-1 mb-1' : 'gap-2.5 mb-2 px-1 py-1',
          )}
        >
          <div className="w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center text-xs font-bold shrink-0">
            {getInitials(session.user.name ?? 'U')}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-ink text-xs font-semibold truncate">{session.user.name}</p>
              <p className="text-light text-[10px] truncate">{session.user.email}</p>
            </div>
          )}
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          title={collapsed ? 'Вийти' : undefined}
          className={cn(
            'flex items-center w-full text-mid hover:text-ink text-xs transition-colors rounded-[10px] hover:bg-pill',
            collapsed ? 'justify-center p-2' : 'gap-2 px-2 py-1.5',
          )}
        >
          <LogOut size={collapsed ? 16 : 13} />
          {!collapsed && 'Вийти'}
        </button>
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            title="Розгорнути меню"
            className="mt-1 flex items-center justify-center w-full p-2 text-mid hover:text-ink hover:bg-pill rounded-[10px] transition-colors"
          >
            <ChevronsRight size={16} />
          </button>
        )}
      </div>
    </aside>
  );
}
