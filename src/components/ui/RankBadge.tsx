/**
 * Shoulder-board badge for a military rank. Renders nothing for CIVILIAN.
 *
 * Variants:
 *   - "pill" (default): small rounded chip with stars + abbreviated label
 *   - "icon": just the stars in a compact pill (when label would crowd UI)
 */
import { RANKS, rankPillClasses } from '@/lib/ranks';
import type { MilitaryRank } from '@prisma/client';
import { cn } from '@/lib/utils';

interface Props {
  rank: MilitaryRank | null | undefined;
  variant?: 'pill' | 'icon';
  className?: string;
}

export function RankBadge({ rank, variant = 'pill', className }: Props) {
  if (!rank || rank === 'CIVILIAN') return null;
  const info = RANKS[rank];
  const cls = rankPillClasses(rank);

  if (variant === 'icon') {
    return (
      <span
        title={info.label}
        className={cn(
          'inline-flex items-center justify-center rounded px-1 text-[10px] font-bold leading-tight tracking-tight',
          cls,
          className,
        )}
      >
        {info.short}
      </span>
    );
  }

  return (
    <span
      title={info.label}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-none uppercase tracking-wide',
        cls,
        className,
      )}
    >
      <span className="text-[9px]">{info.short}</span>
      <span>{info.label}</span>
    </span>
  );
}
