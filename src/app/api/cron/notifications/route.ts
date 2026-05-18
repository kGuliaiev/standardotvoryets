/**
 * Manual trigger for the notifications scan.
 *
 * Scheduling is handled in-process by src/instrumentation.ts. This
 * endpoint exists only for manual debugging or as a fallback when the
 * in-process scheduler is disabled (CRON_DISABLED=1).
 *
 * Auth: if CRON_SECRET is set, requires it via `?secret=` or
 * `Authorization: Bearer …`. If unset, endpoint is open in dev mode
 * and blocked (503) in production.
 */

import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { runNotificationsScan } from '@/lib/cron-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(req: Request): boolean {
  if (!env.CRON_SECRET) return process.env.NODE_ENV !== 'production';
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get('secret');
  const fromHeader = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return fromQuery === env.CRON_SECRET || fromHeader === env.CRON_SECRET;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: env.CRON_SECRET ? 'Unauthorized' : 'CRON_SECRET not set (required in production)' },
      { status: env.CRON_SECRET ? 401 : 503 },
    );
  }
  const stats = await runNotificationsScan();
  return NextResponse.json({ ok: true, ...stats });
}
