'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Check, CheckCheck, Inbox } from 'lucide-react';
import { useLocalStorageState } from '@/lib/useLocalStorageState';
import type { NotificationType } from '@prisma/client';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  CATEGORIES,
  TYPE_META,
  FALLBACK_TYPE_META,
  groupLabel,
  timeOfDay,
  fullDateTime,
  GROUP_ORDER,
} from '@/lib/notifications-ui';

export function NotificationsList() {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [unreadOnly, setUnreadOnly] = useLocalStorageState<boolean>(
    'notifications.unreadOnly',
    false,
  );
  const [activeCats, setActiveCats] = useLocalStorageState<string[]>(
    'notifications.activeCategories',
    [],
  );

  const typeFilter: NotificationType[] = useMemo(() => {
    if (activeCats.length === 0) return [];
    const set = new Set<NotificationType>();
    for (const cat of CATEGORIES) {
      if (activeCats.includes(cat.key)) cat.types.forEach((t) => set.add(t));
    }
    return Array.from(set);
  }, [activeCats]);

  const { data: notifications, isLoading } = trpc.notification.list.useQuery({
    limit: 200,
    unreadOnly,
    types: typeFilter.length > 0 ? typeFilter : undefined,
  });

  const markReadMutation = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      void utils.notification.list.invalidate();
      void utils.notification.unreadCount.invalidate();
    },
  });
  const markAllReadMutation = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      void utils.notification.list.invalidate();
      void utils.notification.unreadCount.invalidate();
    },
  });

  const unread = notifications?.filter((n) => !n.read) ?? [];

  // Group by day bucket
  const groups = useMemo(() => {
    const map = new Map<string, typeof notifications>();
    (notifications ?? []).forEach((n) => {
      const k = groupLabel(n.createdAt);
      const arr = (map.get(k) ?? []).concat();
      arr.push(n);
      map.set(k, arr);
    });
    // Maintain a logical order
    return GROUP_ORDER.map((label) => ({ label, items: map.get(label) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [notifications]);

  function toggleCat(key: string) {
    setActiveCats((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function openNotification(id: string, link: string | null) {
    if (!notifications) return;
    const n = notifications.find((x) => x.id === id);
    if (n && !n.read) markReadMutation.mutate({ id });
    if (link) router.push(link);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Сповіщення"
        subtitle={unread.length > 0 ? `${unread.length} непрочитаних` : undefined}
        actions={
          unread.length > 0 && (
            <button
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-hairline text-mid hover:bg-pill transition-colors disabled:opacity-50"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Прочитати всі
            </button>
          )
        }
      />

      {/* Filter chips */}
      <div className="card p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setUnreadOnly(false)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              !unreadOnly ? 'bg-blue-700 text-white' : 'text-mid hover:bg-pill'
            }`}
          >
            Всі
          </button>
          <button
            onClick={() => setUnreadOnly(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              unreadOnly ? 'bg-blue-700 text-white' : 'text-mid hover:bg-pill'
            }`}
          >
            Непрочитані
          </button>
          <span className="w-px h-5 bg-hairline mx-1" />
          {CATEGORIES.map((cat) => {
            const Icon = cat.Icon;
            const active = activeCats.includes(cat.key);
            return (
              <button
                key={cat.key}
                onClick={() => toggleCat(cat.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  active ? 'bg-brand-soft text-brand' : 'text-mid hover:bg-pill'
                }`}
              >
                <Icon size={13} />
                {cat.label}
              </button>
            );
          })}
          {activeCats.length > 0 && (
            <button
              onClick={() => setActiveCats([])}
              className="text-[11px] text-light hover:text-mid underline underline-offset-2"
            >
              скинути
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-light text-sm">Завантаження…</div>
        ) : groups.length === 0 ? (
          <div className="py-16 text-center text-light text-sm">
            <Inbox className="w-10 h-10 mx-auto mb-3 opacity-60" />
            {unreadOnly || activeCats.length > 0
              ? 'За цим фільтром нічого немає'
              : 'Сповіщень немає'}
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {groups.flatMap((g) => [
              <li
                key={`g-${g.label}`}
                className="bg-page px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-light"
              >
                {g.label}
              </li>,
              ...g.items.map((n) => {
                const meta = TYPE_META[n.type] ?? FALLBACK_TYPE_META;
                const Icon = meta.Icon;
                const isToday = groupLabel(n.createdAt) === 'Сьогодні';
                return (
                  <li
                    key={n.id}
                    className={`group transition-colors ${
                      n.read ? '' : 'bg-brand-soft/30 hover:bg-brand-soft/50'
                    }`}
                  >
                    <button
                      onClick={() => openNotification(n.id, n.link ?? null)}
                      className="w-full flex items-start gap-3 px-5 py-3.5 text-left hover:bg-pill/40"
                    >
                      <div className="relative shrink-0 mt-0.5">
                        <span
                          className={`w-8 h-8 rounded-full inline-flex items-center justify-center bg-pill ${meta.tone}`}
                        >
                          <Icon size={15} />
                        </span>
                        {!n.read && (
                          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-brand ring-2 ring-card" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <p
                            className={`truncate ${n.read ? 'text-mid font-medium' : 'text-ink font-semibold'}`}
                          >
                            {n.title}
                          </p>
                          <span
                            className="text-[11px] text-light shrink-0"
                            title={fullDateTime(n.createdAt)}
                          >
                            {isToday ? timeOfDay(n.createdAt) : fullDateTime(n.createdAt)}
                          </span>
                        </div>
                        {n.body && (
                          <p className="text-sm text-mid mt-0.5 line-clamp-2 whitespace-pre-line">
                            {n.body}
                          </p>
                        )}
                      </div>
                      {!n.read && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            markReadMutation.mutate({ id: n.id });
                          }}
                          className="opacity-0 group-hover:opacity-100 text-mid hover:text-brand p-1.5 rounded hover:bg-pill transition-all"
                          title="Позначити прочитаним"
                        >
                          <Check className="w-4 h-4" />
                        </span>
                      )}
                    </button>
                  </li>
                );
              }),
            ])}
          </ul>
        )}
      </div>
    </div>
  );
}
