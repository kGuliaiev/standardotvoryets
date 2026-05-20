'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Inbox } from 'lucide-react';
import { useLocalStorageState } from '@/lib/useLocalStorageState';
import type { NotificationType } from '@prisma/client';
import {
  CATEGORIES,
  TYPE_META,
  FALLBACK_TYPE_META,
  groupLabel,
  timeOfDay,
  fullDateTime,
  GROUP_ORDER,
} from '@/lib/notifications-ui';

/**
 * Per-standard "Журнал" — a chronological feed of every notification
 * about this standard (across all recipients, de-duplicated), with the
 * same category filter chips as the global /notifications page. Unlike
 * that page this is a read-only cross-user view, so there's no
 * read/unread state — clicking an item just navigates to its target.
 */
export function StandardJournal({ standardId }: { standardId: string }) {
  const router = useRouter();
  const [activeCats, setActiveCats] = useLocalStorageState<string[]>(
    'standard.journal.activeCategories',
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

  const { data: items, isLoading } = trpc.notification.listForStandard.useQuery({
    standardId,
    types: typeFilter.length > 0 ? typeFilter : undefined,
    limit: 300,
  });

  const groups = useMemo(() => {
    const map = new Map<string, NonNullable<typeof items>>();
    (items ?? []).forEach((n) => {
      const k = groupLabel(n.createdAt);
      const arr = (map.get(k) ?? []).concat();
      arr.push(n);
      map.set(k, arr);
    });
    return GROUP_ORDER.map((label) => ({ label, items: map.get(label) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [items]);

  function toggleCat(key: string) {
    setActiveCats((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  return (
    <div className="space-y-4">
      {/* Filter chips — mirror /notifications (category filters only;
          unread state is meaningless in a cross-user feed). */}
      <div className="card p-3">
        <div className="flex items-center gap-2 flex-wrap">
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

      {/* Feed */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-light text-sm">Завантаження…</div>
        ) : groups.length === 0 ? (
          <div className="py-16 text-center text-light text-sm">
            <Inbox className="w-10 h-10 mx-auto mb-3 opacity-60" />
            {activeCats.length > 0 ? 'За цим фільтром нічого немає' : 'Журнал порожній'}
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
                  <li key={n.id} className="group transition-colors">
                    <button
                      onClick={() => n.link && router.push(n.link)}
                      disabled={!n.link}
                      className="w-full flex items-start gap-3 px-5 py-3.5 text-left hover:bg-pill/40 disabled:cursor-default"
                    >
                      <span
                        className={`shrink-0 mt-0.5 w-8 h-8 rounded-full inline-flex items-center justify-center bg-pill ${meta.tone}`}
                      >
                        <Icon size={15} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="truncate text-ink font-semibold">{n.title}</p>
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
