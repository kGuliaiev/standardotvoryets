'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { toast } from '@/lib/toast';

const LAST_SEEN_KEY = 'notifications.lastSeenAt.v1';
const MAX_POPS_PER_FETCH = 5;

/**
 * Polls notification.list on a timer (15s — fast enough to feel "live", slow
 * enough to be cheap). For every notification newer than the last-seen
 * timestamp (persisted in localStorage so reloads don't replay history, but
 * a new notification that arrived while the tab was closed still pops), fires
 * a top-right toast. Clicking the toast marks that notification read and
 * navigates to its link. Also invalidates `notification.unreadCount` and
 * `notification.list` so the bell badge and /notifications page update at the
 * same moment as the popup, instead of waiting for their own poll cycles.
 */
export function NewNotificationsWatcher() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const markReadMutation = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      void utils.notification.unreadCount.invalidate();
      void utils.notification.list.invalidate();
    },
  });

  // High-water mark of notification.createdAt we've already shown. Initialised
  // from localStorage so a reload doesn't pop notifications the user already
  // saw in a previous session. -Infinity on first ever visit.
  const lastSeenRef = useRef<number>(-Infinity);
  const hydratedRef = useRef(false);

  // Hydrate lastSeenRef once from localStorage (client-only).
  if (!hydratedRef.current && typeof window !== 'undefined') {
    const raw = window.localStorage.getItem(LAST_SEEN_KEY);
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) lastSeenRef.current = parsed;
    }
    hydratedRef.current = true;
  }

  const { data: notifications } = trpc.notification.list.useQuery(
    { limit: 10 },
    {
      refetchInterval: 15_000, // poll every 15s
      refetchIntervalInBackground: false, // pause when tab is hidden
      refetchOnWindowFocus: true,
      refetchOnMount: 'always',
    },
  );

  useEffect(() => {
    if (!notifications || notifications.length === 0) return;

    // Sort by createdAt ascending so we pop oldest → newest (matches arrival order).
    const fresh = [...notifications]
      .map((n) => ({ ...n, _ts: new Date(n.createdAt).getTime() }))
      .filter((n) => n._ts > lastSeenRef.current && !n.read)
      .sort((a, b) => a._ts - b._ts);

    if (fresh.length === 0) {
      // Still bump the high-water mark so subsequent polls don't re-evaluate
      // the same already-read items.
      const maxTs = Math.max(...notifications.map((n) => new Date(n.createdAt).getTime()));
      if (maxTs > lastSeenRef.current) {
        lastSeenRef.current = maxTs;
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(LAST_SEEN_KEY, String(maxTs));
        }
      }
      return;
    }

    // Cap how many we show at once — if the user was away for hours we don't
    // want to flood them with 50 popups.
    const toPop = fresh.slice(-MAX_POPS_PER_FETCH);
    for (const n of toPop) {
      toast.notify({
        title: n.title,
        message: n.body,
        href: n.link ?? '/notifications',
        onClick: () => {
          markReadMutation.mutate({ id: n.id });
          router.push(n.link ?? '/notifications');
        },
      });
    }

    // New items mean the bell badge / /notifications page are stale — refresh
    // them now instead of waiting for their own polls.
    void utils.notification.unreadCount.invalidate();
    void utils.notification.list.invalidate();

    const newest = fresh.at(-1);
    if (newest) {
      lastSeenRef.current = newest._ts;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LAST_SEEN_KEY, String(newest._ts));
      }
    }
  }, [notifications, markReadMutation, router, utils]);

  return null;
}
