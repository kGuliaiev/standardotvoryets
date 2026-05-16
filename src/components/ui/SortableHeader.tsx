/**
 * Clickable table header with sort-direction indicator.
 *
 * Usage:
 *   const [sort, setSort] = useSort<Row>('name', 'asc');
 *   <SortableHeader columnKey="name" sort={sort} onSort={setSort}>Name</SortableHeader>
 *   {sortedRows(items, sort, getValue).map(...)}
 */
'use client';

import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SortDir = 'asc' | 'desc';

export interface SortState<K extends string = string> {
  key: K;
  dir: SortDir;
}

interface Props<K extends string> {
  columnKey: K;
  sort: SortState<K> | null;
  onSort: (next: SortState<K>) => void;
  children: React.ReactNode;
  className?: string;
  /** if true, content right-aligned (e.g. numeric columns) */
  numeric?: boolean;
}

export function SortableHeader<K extends string>({
  columnKey,
  sort,
  onSort,
  children,
  className,
  numeric,
}: Props<K>) {
  const active = sort?.key === columnKey;
  const dir = active ? sort.dir : null;

  return (
    <button
      type="button"
      onClick={() =>
        onSort({
          key: columnKey,
          dir: active && dir === 'asc' ? 'desc' : 'asc',
        })
      }
      className={cn(
        'inline-flex items-center gap-1 select-none hover:text-ink transition-colors',
        active && 'text-ink',
        numeric && 'justify-end w-full',
        className,
      )}
    >
      <span>{children}</span>
      {dir === 'asc' ? (
        <ChevronUp className="w-3 h-3 shrink-0" />
      ) : dir === 'desc' ? (
        <ChevronDown className="w-3 h-3 shrink-0" />
      ) : (
        <ChevronsUpDown className="w-3 h-3 shrink-0 opacity-40" />
      )}
    </button>
  );
}
