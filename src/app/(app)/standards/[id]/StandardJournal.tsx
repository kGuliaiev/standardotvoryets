'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { Inbox, CheckCheck } from 'lucide-react';
import { useLocalStorageState } from '@/lib/useLocalStorageState';
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

// The journal shows a subset of the global notification categories, in a
// fixed order. "Засідання" is omitted because meetings belong to the
// working group, not the standard, so they never reach this feed. Each
// chip carries a hint (tooltip) describing which events fall under it.
const JOURNAL_CATEGORY_ORDER = ['docs', 'tasks', 'comments', 'voting', 'stages', 'digest'];
const JOURNAL_CATEGORIES = JOURNAL_CATEGORY_ORDER.map((key) =>
  CATEGORIES.find((c) => c.key === key),
).filter((c): c is (typeof CATEGORIES)[number] => Boolean(c));

const CATEGORY_HINTS: Record<string, string> = {
  docs: 'Документи: завантаження, правки до тексту та коментарі до документів',
  tasks: 'Призначення доручень і прострочення термінів',
  comments: 'Обговорення стандарту — коментарі та згадки',
  voting: 'Відкриття та закриття голосувань',
  stages: 'Дедлайни етапів та зміна статусу стандарту',
  digest: 'Щотижневий дайджест',
};

// Map a notification to a journal category. Comments/mentions are split
// by where they happened — the link's tab tells us: tab=documents/body
// is a comment/edit on the document text → "Документи"; tab=comments is
// the standard's discussion thread → "Коментарі". Suggestions (правки)
// always belong with the document.
const STAGE_TYPES = new Set([
  'STAGE_DUE_SOON',
  'STAGE_OVERDUE',
  'STAGE_COMPLETED',
  'STANDARD_STATUS_CHANGED',
]);
function journalCategory(n: { type: string; link: string | null }): string {
  const { type } = n;
  if (type === 'DOCUMENT_UPLOADED' || type === 'SUGGESTION_NEW' || type === 'SUGGESTION_RESOLVED') {
    return 'docs';
  }
  if (type === 'COMMENT_ADDED' || type === 'MENTION') {
    const link = n.link ?? '';
    return link.includes('tab=documents') || link.includes('tab=body') ? 'docs' : 'comments';
  }
  if (type === 'TASK_ASSIGNED' || type === 'TASK_OVERDUE') return 'tasks';
  if (type === 'VOTE_OPENED' || type === 'VOTE_CLOSED') return 'voting';
  if (STAGE_TYPES.has(type)) return 'stages';
  if (type === 'WEEKLY_DIGEST') return 'digest';
  return 'comments';
}

export function StandardJournal({ standardId }: { standardId: string }) {
  const router = useRouter();
  const [activeCats, setActiveCats] = useLocalStorageState<string[]>(
    'standard.journal.activeCategories',
    [],
  );

  // Fetch everything for the standard and classify/filter client-side,
  // because the docs↔comments split depends on the link (tab=…), not the
  // coarse notification type, so a server-side type filter can't express it.
  const { data: items, isLoading } = trpc.notification.listForStandard.useQuery({
    standardId,
    limit: 300,
  });

  const utils = trpc.useUtils();
  const markAll = trpc.notification.markStandardRead.useMutation({
    onSuccess: () => {
      void utils.notification.listForStandard.invalidate({ standardId });
      void utils.notification.unreadCount.invalidate();
      void utils.notification.list.invalidate();
    },
  });
  const unreadCount = (items ?? []).filter((n) => n.unread).length;

  const groups = useMemo(() => {
    const filtered =
      activeCats.length === 0
        ? (items ?? [])
        : (items ?? []).filter((n) => activeCats.includes(journalCategory(n)));
    const map = new Map<string, typeof filtered>();
    filtered.forEach((n) => {
      const k = groupLabel(n.createdAt);
      const arr = (map.get(k) ?? []).concat();
      arr.push(n);
      map.set(k, arr);
    });
    return GROUP_ORDER.map((label) => ({ label, items: map.get(label) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [items, activeCats]);

  function toggleCat(key: string) {
    setActiveCats((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  return (
    <div className="space-y-4">
      {/* Filter chips — mirror /notifications. The "Переглянути всі"
          button marks only THIS standard's notifications read for the
          current user (not the whole inbox). */}
      <div className="card p-3">
        <div className="flex items-center gap-2 flex-wrap">
          {unreadCount > 0 && (
            <button
              onClick={() => markAll.mutate({ standardId })}
              disabled={markAll.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-700 text-white hover:bg-blue-800 transition-colors disabled:opacity-50"
              title="Позначити переглянутими всі сповіщення цього стандарту"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Переглянути всі ({unreadCount})
            </button>
          )}
          {JOURNAL_CATEGORIES.map((cat) => {
            const Icon = cat.Icon;
            const active = activeCats.includes(cat.key);
            return (
              <button
                key={cat.key}
                onClick={() => toggleCat(cat.key)}
                title={CATEGORY_HINTS[cat.key]}
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
                  <li
                    key={n.id}
                    className={`group transition-colors ${
                      n.unread ? 'bg-brand-soft/30 hover:bg-brand-soft/50' : ''
                    }`}
                  >
                    <button
                      onClick={() => n.link && router.push(n.link)}
                      disabled={!n.link}
                      className="w-full flex items-start gap-3 px-5 py-3.5 text-left hover:bg-pill/40 disabled:cursor-default"
                    >
                      <span className="relative shrink-0 mt-0.5">
                        <span
                          className={`w-8 h-8 rounded-full inline-flex items-center justify-center bg-pill ${meta.tone}`}
                        >
                          <Icon size={15} />
                        </span>
                        {n.unread && (
                          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-brand ring-2 ring-card" />
                        )}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <p
                            className={`truncate ${
                              n.unread ? 'text-ink font-semibold' : 'text-mid font-medium'
                            }`}
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
