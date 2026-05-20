/**
 * Liveness probe — used by Railway's deploy healthcheck.
 *
 * MUST NOT touch the database. This endpoint answers "is the web
 * process up and serving HTTP?" If it depended on the DB, a Postgres
 * outage would make every deploy fail its healthcheck and the
 * resilient login page (which is the whole point) would never ship.
 *
 * DB reachability lives in /api/db-status instead, which the login
 * page polls to decide whether to show the form or an outage panel.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json({
    ok: true,
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
}
