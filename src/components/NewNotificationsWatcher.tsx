'use client';

import { useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc/client';
import { toast } from '@/lib/toast';

/**
 * Mounted once in the authenticated layout. Polls `notification.list` on a
 * timer; when a new notification id appears in the result, pops it as a
 * top-right toast (5s, click-through to its link). On first load it silently
 * marks all currently-known notifications as "seen" — only ones arriving
 * **after** mount cause a popup, so reloading the page doesn't re-replay
 * everything the user already saw on /notifications.
 */
export function NewNotificationsWatcher() {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initialisedRef = useRef(false);

  const { data: notifications } = trpc.notification.list.useQuery(
    // Keep the window small — we only need to know what's new.
    { limit: 10 },
    {
      refetchInterval: 30_000, // poll every 30s
      refetchIntervalInBackground: false, // pause when the tab is hidden
      refetchOnWindowFocus: true,
    },
  );

  useEffect(() => {
    if (!notifications) return;

    if (!initialisedRef.current) {
      // First successful fetch — record the current state as the baseline,
      // do NOT pop anything. Avoids a flood of "new!" toasts on reload.
      for (const n of notifications) seenIdsRef.current.add(n.id);
      initialisedRef.current = true;
      return;
    }

    // Subsequent fetches: pop every unread item we haven't seen yet.
    for (const n of notifications) {
      if (seenIdsRef.current.has(n.id)) continue;
      seenIdsRef.current.add(n.id);
      if (n.read) continue; // user has already read it elsewhere — don't pop
      toast.notify({
        title: n.title,
        message: n.body,
        href: n.link ?? '/notifications',
      });
    }
  }, [notifications]);

  return null;
}
