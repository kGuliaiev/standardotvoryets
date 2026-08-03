'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Cross-page memory of which task rows have their subtask block
 * expanded. Persists to localStorage per-browser (per-user is
 * implicit — different accounts on the same browser share the
 * storage, but that's fine: it's UX-only, not permission-sensitive).
 *
 * A single Set keyed by task id is stored under one key, so /tasks
 * and the standard's Завдання tab agree — expanding a task on one
 * page keeps it open on the other.
 */
const STORAGE_KEY = 'standartotvorets.expandedTaskIds.v1';

function readStorage(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function writeStorage(ids: Set<string>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    /* quota exceeded / private mode — ignore */
  }
}

export function useExpandedTasks() {
  // SSR-safe: start empty on the server, hydrate from storage after
  // mount. Callers only render the chevron after mount anyway so no
  // visible flash.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setExpanded(readStorage());
  }, []);

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeStorage(next);
      return next;
    });
  }, []);

  /** Set state to the desired ids atomically. Used by expand-all
   *  / collapse-all controls on /tasks. */
  const setAll = useCallback((ids: Iterable<string>) => {
    const next = new Set<string>(ids);
    writeStorage(next);
    setExpanded(next);
  }, []);

  return { isExpanded, toggle, setAll };
}
