/**
 * Database-reachability probe — used by the login page (LoginGate) to
 * decide whether to show the form or a "service unavailable" panel.
 *
 * Deliberately separate from /api/health: Railway's deploy healthcheck
 * hits /api/health (liveness, must stay 200 during a DB outage so the
 * resilient login page can ship). This endpoint is allowed to return
 * 503 when the DB is down because nothing gates deploys on it.
 *
 * Returns:
 *   200 { ok: true, db: 'up', … }                 when the DB answers
 *   503 { ok: false, db: 'down', error, code, … }  when it doesn't
 */
import { db } from '@/server/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Pull just the host:port out of DATABASE_URL — never the credentials. */
function dbHost(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return null;
  }
}

function commit(): string {
  return (
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT ??
    'unknown'
  );
}

export async function GET() {
  const startedAt = Date.now();
  try {
    // Race the query against a 4s timeout so a hung connection doesn't
    // make the probe itself hang (and thus the login page).
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Перевірка з’єднання перевищила 4000 мс')), 4000),
      ),
    ]);
    return NextResponse.json({
      ok: true,
      db: 'up',
      latencyMs: Date.now() - startedAt,
      commit: commit(),
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    // Prisma errors carry a `.code` like P1001 (can't reach server).
    const err = e as { message?: string; code?: string };
    return NextResponse.json(
      {
        ok: false,
        db: 'down',
        error: err.message ?? String(e),
        code: err.code ?? null,
        dbHost: dbHost(),
        latencyMs: Date.now() - startedAt,
        commit: commit(),
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
