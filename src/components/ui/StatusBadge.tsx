'use client';

import { cn } from '@/lib/utils';

export type StandardStatus =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'VOTING'
  | 'ADOPTED'
  | 'REJECTED'
  | 'ARCHIVED';

const STATUS_CONFIG: Record<
  StandardStatus,
  { label: string; className: string }
> = {
  DRAFT: {
    label: 'Чернетка',
    className: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  IN_REVIEW: {
    label: 'На розгляді',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  VOTING: {
    label: 'Голосування',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  ADOPTED: {
    label: 'Прийнятий',
    className: 'bg-green-50 text-green-700 border-green-200',
  },
  REJECTED: {
    label: 'Відхилений',
    className: 'bg-red-50 text-red-700 border-red-200',
  },
  ARCHIVED: {
    label: 'Архів',
    className: 'bg-slate-50 text-slate-500 border-slate-200',
  },
};

interface StatusBadgeProps {
  status: StandardStatus;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusBadge({ status, size = 'md', className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        config.className,
        className,
      )}
    >
      {config.label}
    </span>
  );
}

export const STATUS_LABELS: Record<StandardStatus, string> = Object.fromEntries(
  Object.entries(STATUS_CONFIG).map(([k, v]) => [k, v.label]),
) as Record<StandardStatus, string>;
