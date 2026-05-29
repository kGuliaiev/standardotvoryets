'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { toast } from '@/lib/toast';

const MAX_POPS_PER_FETCH = 5;

/**
 * Polls notification.list on a timer (15s). The first fetch silently records
 * every currently-known notification id as "seen" so a reload doesn't replay
 * history. Every subsequent fetch pops any unread id that wasn't in that set,
 * capped to MAX_POPS_PER_FETCH so a backlog doesn't flood the UI.
 *
 * Clicking the popup marks that notification read and navigates to its link.
 * We also invalidate `notification.unreadCount` and `notification.list` the
 * moment a popup fires so the bell badge and the /notifications page update
 * in lock-step with the popup, instead of waiting for their own poll cycles.
 */
export function NewNotificationsWatcher() {
  const router = useRouter();
  const utils = trpc.useUtils();
  // Destructure `mutate` — the only referentially stable handle from
  // useMutation. The full mutation *object* re-identifies on every state
  // transition (idle→pending→…), which would otherwise force this useEffect
  // to re-run via the deps array even when nothing about the data changed.
  const { mutate: markRead } = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      void utils.notification.unreadCount.invalidate();
      void utils.notification.list.invalidate();
    },
  });

  const seenIdsRef = useRef<Set<string>>(new Set());
  const initialisedRef = useRef(false);

  const { data: notifications } = trpc.notification.list.useQuery(
    { limit: 10 },
    {
      refetchInterval: 15_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      refetchOnMount: 'always',
    },
  );

  useEffect(() => {
    if (!notifications) return;

    // First fetch — record current state as baseline; do NOT pop. This is what
    // keeps reloads from re-firing every notification the user already saw.
    if (!initialisedRef.current) {
      for (const n of notifications) seenIdsRef.current.add(n.id);
      initialisedRef.current = true;
      return;
    }

    // Subsequent fetches: pop every previously-unseen unread item.
    let popped = 0;
    for (const n of notifications) {
      if (seenIdsRef.current.has(n.id)) continue;
      seenIdsRef.current.add(n.id);
      if (n.read) continue;
      if (popped >= MAX_POPS_PER_FETCH) continue;
      const link = n.link ?? '/notifications';
      toast.notify({
        title: n.title,
        message: n.body,
        href: link,
        onClick: () => {
          markRead({ id: n.id });
          router.push(link);
        },
      });
      popped += 1;
    }

    if (popped > 0) {
      void utils.notification.unreadCount.invalidate();
      void utils.notification.list.invalidate();
    }
  }, [notifications, markRead, router, utils]);

  return null;
}
