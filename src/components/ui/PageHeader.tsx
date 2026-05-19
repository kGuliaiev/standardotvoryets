'use client';

import type { ReactNode } from 'react';

/**
 * Standard page header — title + subtitle on the left, optional
 * action cluster on the right. Sticks to the top of the main scroll
 * area so primary actions (Save, Create, etc.) stay reachable when
 * the form / list grows long.
 *
 * Visual contract:
 *   - Negative margins extend the bg across the surrounding main
 *     padding so scrolling content doesn't peek through on the sides.
 *   - bg-page/95 + backdrop-blur-md gives a soft glass effect over
 *     the content scrolling underneath.
 *   - top-[-1rem] md:top-[-1.5rem] perfectly nestles against the
 *     <main> element's `p-4 md:p-6` padding (so the title sits
 *     near-flush to the topbar).
 *   - bottom border separates the header from the page body.
 *
 * Use anywhere you'd previously hand-rolled an "h1 + Save button"
 * row at the top of a page.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="sticky top-[-1rem] md:top-[-1.5rem] z-20 -mx-4 md:-mx-6 px-4 md:px-6 pt-3 md:pt-4 pb-3 bg-page/95 backdrop-blur-md border-b border-hairline">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink truncate">{title}</h1>
          {subtitle && <p className="text-sm text-mid mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
      </div>
    </div>
  );
}
