/**
 * Weekly digest cron.
 *
 * Schedule: Mondays 09:00 Europe/Kyiv. Recommended to call hourly with
 * the same secret as /api/cron/notifications — the route itself enforces
 * the day-of-week + hour gate so duplicate invocations are safe.
 *
 * GET /api/cron/digest?secret=$CRON_SECRET
 *   ?force=1  → bypass the day/hour gate (useful for manual testing)
 */

import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { env } from '@/lib/env';
import { sendWeeklyDigest } from '@/server/notify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(req: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get('secret');
  const fromHeader = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return fromQuery === env.CRON_SECRET || fromHeader === env.CRON_SECRET;
}

export async function GET(req: Request) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';
  const now = new Date();

  // Kyiv local day-of-week + hour
  const kyivParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});

  const isMonday = kyivParts.weekday === 'Mon';
  const isNineAM = Number(kyivParts.hour) === 9;

  if (!force && !(isMonday && isNineAM)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `Not Monday 09:00 Kyiv (current ${kyivParts.weekday} ${kyivParts.hour}:00)`,
    });
  }

  const result = await sendWeeklyDigest(db);
  return NextResponse.json({ ok: true, ...result, ranAt: now.toISOString() });
}
