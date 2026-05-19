'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { Avatar } from '@/components/ui/Avatar';
import { RankBadge } from '@/components/ui/RankBadge';
import { useLocalStorageState } from '@/lib/useLocalStorageState';
import { MessageSquare, Sparkles, Reply, PenSquare } from 'lucide-react';
import { renderMentions } from '@/components/ui/MentionTextarea';

const STORAGE_KEY = 'discussions.lastVisit.v1';

function timeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'щойно';
  if (min < 60) return `${min} хв тому`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} год тому`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day} ${day === 1 ? 'день' : day < 5 ? 'дні' : 'днів'} тому`;
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function DiscussionsFeed() {
  const utils = trpc.useUtils();
  const { data: comments, isLoading } = trpc.comment.feedForUser.useQuery(
    { limit: 80 },
    { refetchOnMount: 'always', staleTime: 0 },
  );
  const [lastVisit, setLastVisit] = useLocalStorageState<string | null>(STORAGE_KEY, null);

  // Mark "new since previous visit", then on unmount update the timestamp so
  // returning to this page starts a new "since" window.
  const lastVisitDate = useMemo(() => (lastVisit ? new Date(lastVisit) : null), [lastVisit]);

  const newCount = useMemo(() => {
    if (!comments || !lastVisitDate) return 0;
    return comments.filter((c) => new Date(c.createdAt) > lastVisitDate).length;
  }, [comments, lastVisitDate]);

  useEffect(() => {
    if (!comments) return;
    // Defer the lastVisit bump until after first paint so the new-badges
    // stay visible during this session.
    const t = setTimeout(() => {
      setLastVisit(new Date().toISOString());
      // refresh sidebar badge
      void utils.dashboard.navCounts.invalidate();
    }, 4000);
    return () => clearTimeout(t);
  }, [comments, setLastVisit, utils]);

  // Group by standard
  const grouped = useMemo(() => {
    if (!comments) return [];
    const map = new Map<
      string,
      {
        standard: (typeof comments)[number]['standard'];
        items: typeof comments;
      }
    >();
    for (const c of comments) {
      const k = c.standard.id;
      const entry = map.get(k);
      if (entry) {
        entry.items.push(c);
      } else {
        map.set(k, { standard: c.standard, items: [c] });
      }
    }
    // Sort groups by newest comment in each (already sorted desc, so first item wins)
    return Array.from(map.values()).sort((a, b) => {
      const ad = new Date(a.items[0]!.createdAt).getTime();
      const bd = new Date(b.items[0]!.createdAt).getTime();
      return bd - ad;
    });
  }, [comments]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Обговорення</h1>
          <p className="text-sm text-mid mt-1">
            Останні коментарі по стандартах ваших робочих груп
          </p>
        </div>
        <div className="flex items-center gap-3">
          {newCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-rose-500 text-white">
              <Sparkles className="w-3.5 h-3.5" />
              {newCount} нових
            </span>
          ) : (
            <span className="text-xs text-light">{comments?.length ?? 0} коментарів</span>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="bg-card rounded-xl border border-hairline p-12 text-center text-light text-sm">
          Завантаження…
        </div>
      ) : grouped.length === 0 ? (
        <div className="bg-card rounded-xl border border-hairline p-12 text-center text-light text-sm">
          <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-base font-semibold text-mid mb-1">Поки що обговорень немає</p>
          <p>Залиште перший коментар на сторінці будь-якого стандарту</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => {
            const groupHasNew =
              !!lastVisitDate && g.items.some((c) => new Date(c.createdAt) > lastVisitDate);
            return (
              <div
                key={g.standard.id}
                className={`bg-card rounded-xl border overflow-hidden transition-colors ${
                  groupHasNew ? 'border-rose-300 dark:border-rose-700' : 'border-hairline'
                }`}
              >
                <div className="px-5 py-3 border-b border-hairline flex items-center justify-between gap-3 flex-wrap">
                  <Link
                    href={`/standards/${g.standard.id}`}
                    className="flex items-center gap-2.5 min-w-0 hover:text-brand transition-colors"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: g.standard.workingGroup.color }}
                    />
                    <span className="font-mono text-xs text-mid font-semibold">
                      {g.standard.workingGroup.code}
                    </span>
                    <span className="text-light">·</span>
                    <span className="font-mono text-xs text-light">{g.standard.code}</span>
                    <span className="text-light">·</span>
                    <span className="text-sm font-semibold text-ink truncate">
                      {g.standard.title}
                    </span>
                  </Link>
                  <div className="flex items-center gap-2">
                    {groupHasNew && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                        Нові коментарі
                      </span>
                    )}
                    <Link
                      href={`/standards/${g.standard.id}?tab=comments&compose=1`}
                      className="text-xs font-semibold text-brand hover:underline inline-flex items-center gap-1"
                    >
                      <PenSquare className="w-3.5 h-3.5" />
                      Написати на стандарт
                    </Link>
                  </div>
                </div>
                <ul className="divide-y divide-hairline">
                  {g.items.map((c) => {
                    const isNew = !!lastVisitDate && new Date(c.createdAt) > lastVisitDate;
                    return (
                      <li
                        key={c.id}
                        className={`px-5 py-3 flex items-start gap-3 transition-colors ${
                          isNew ? 'bg-rose-50/60 dark:bg-rose-900/15' : ''
                        }`}
                      >
                        <Avatar
                          name={c.author.name}
                          avatarUrl={c.author.avatarUrl ?? undefined}
                          size="sm"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <RankBadge rank={c.author.rank} variant="icon" />
                            <span className="text-sm font-semibold text-ink">{c.author.name}</span>
                            {isNew && (
                              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-rose-500 text-white">
                                NEW
                              </span>
                            )}
                            <span className="text-[11px] text-light ml-auto">
                              {timeAgo(new Date(c.createdAt))}
                            </span>
                          </div>
                          <p className="text-sm text-ink mt-1 leading-relaxed whitespace-pre-wrap break-words">
                            {renderMentions(c.body)}
                          </p>
                          <div className="mt-1.5">
                            <Link
                              href={`/standards/${g.standard.id}?tab=comments&reply=${c.id}`}
                              className="text-[11px] text-brand hover:underline inline-flex items-center gap-1 font-semibold"
                            >
                              <Reply className="w-3.5 h-3.5" />
                              Відповісти
                            </Link>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
