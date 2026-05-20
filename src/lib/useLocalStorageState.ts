/**
 * useState-like hook that persists the value to localStorage.
 *
 * SSR-safe: returns the default value during first render on the server, then
 * hydrates from localStorage on the client (avoiding hydration mismatches by
 * always rendering the default on first paint).
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

// Same-tab broadcast so every hook instance for a given key stays in sync.
// The native `storage` event only fires in *other* tabs, so without this an
// in-tab write (e.g. the discussions page bumping `discussions.lastVisit.v1`)
// wouldn't reach another live instance (e.g. the sidebar's unread badge),
// and that badge would never clear until a full reload.
const SYNC_EVENT = 'local-storage-state-sync';

interface SyncDetail {
  key: string;
  value: unknown;
}

export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(defaultValue);

  // Hydrate from localStorage after first render
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        setValue(JSON.parse(raw) as T);
      }
    } catch {
      // localStorage may be unavailable (private mode, quota); silently ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Keep all instances of this key in sync: same tab (custom event) and
  // other tabs (native storage event).
  useEffect(() => {
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent<SyncDetail>).detail;
      if (detail?.key === key) setValue(detail.value as T);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      try {
        setValue(e.newValue !== null ? (JSON.parse(e.newValue) as T) : defaultValue);
      } catch {
        // ignore
      }
    };
    window.addEventListener(SYNC_EVENT, onSync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SYNC_EVENT, onSync);
      window.removeEventListener('storage', onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setAndPersist = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
          window.dispatchEvent(
            new CustomEvent<SyncDetail>(SYNC_EVENT, { detail: { key, value: resolved } }),
          );
        } catch {
          // ignore
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, setAndPersist];
}
