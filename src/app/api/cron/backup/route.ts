/**
 * Manual trigger for the database backup. Scheduling is handled
 * in-process by src/instrumentation.ts.
 *
 * Auth: same as other /api/cron/* endpoints.
 *
 * Query params:
 *   ?retentionDays=N  override default 30
 */

import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { runDatabaseBackup } from '@/lib/cron-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Backup needs more than the default 10-second budget.
export const maxDuration = 300;

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
  const url = new URL(req.url);
  const retentionParam = url.searchParams.get('retentionDays');
  const retentionDays = retentionParam ? Number(retentionParam) : undefined;
  try {
    const result = await runDatabaseBackup({ retentionDays });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
