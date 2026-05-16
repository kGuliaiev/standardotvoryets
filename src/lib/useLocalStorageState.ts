/**
 * useState-like hook that persists the value to localStorage.
 *
 * SSR-safe: returns the default value during first render on the server, then
 * hydrates from localStorage on the client (avoiding hydration mismatches by
 * always rendering the default on first paint).
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

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

  const setAndPersist = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
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
