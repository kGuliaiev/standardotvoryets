/**
 * Tiny client-side sort utilities used with <SortableHeader>.
 *
 *   const [sort, setSort] = useSort<Row>('name', 'asc');
 *   const rows = useSorted(items, sort, {
 *     name:    (r) => r.name.toLowerCase(),
 *     created: (r) => r.createdAt,
 *   });
 *
 * Accessors return string / number / Date / null. null values always sort
 * to the bottom regardless of direction (so missing values don't clutter
 * the top of an ascending list).
 */
'use client';

import { useState } from 'react';
import type { SortState, SortDir } from '@/components/ui/SortableHeader';

export function useSort<K extends string>(
  defaultKey?: K,
  defaultDir: SortDir = 'asc',
): [SortState<K> | null, (s: SortState<K>) => void] {
  const [sort, setSort] = useState<SortState<K> | null>(
    defaultKey ? { key: defaultKey, dir: defaultDir } : null,
  );
  return [sort, setSort];
}

type SortKey = string | number | Date | null | undefined;

/**
 * Sort the given items by the current sort key. `getValue(row, key)` returns
 * the comparable value (string / number / Date) or null. Null values sort to
 * the bottom regardless of direction.
 *
 * Pure function (not a hook) — safe to call inside JSX, conditionals, etc.
 * Re-sorting < 1000 rows on every render is sub-millisecond.
 */
export function sortedRows<T, K extends string>(
  items: T[] | undefined,
  sort: SortState<K> | null,
  getValue: (row: T, key: K) => SortKey,
): T[] {
  if (!items) return [];
  if (!sort) return items;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = getValue(a, sort.key);
    const bv = getValue(b, sort.key);
    const aNil = av === null || av === undefined || av === '';
    const bNil = bv === null || bv === undefined || bv === '';
    if (aNil && bNil) return 0;
    if (aNil) return 1;
    if (bNil) return -1;

    if (av instanceof Date && bv instanceof Date) {
      return (av.getTime() - bv.getTime()) * sign;
    }
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * sign;
    }
    return (
      String(av).localeCompare(String(bv), 'uk', { numeric: true, sensitivity: 'base' }) * sign
    );
  });
}
