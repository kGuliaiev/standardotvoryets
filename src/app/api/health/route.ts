/**
 * Lightweight liveness + DB-reachability probe.
 *
 * Unlike /api/version (which counts rows and is heavier), this just
 * runs `SELECT 1` with a short timeout so the login page can decide
 * whether to show the form or a "service unavailable" panel.
 *
 * Returns:
 *   200 { ok: true, db: 'up', … }                 when the DB answers
 *   503 { ok: false, db: 'down', error, code, … }  when it doesn't
 *
 * Diagnostics (error message, Prisma code, DB host without creds,
 * timestamp, commit) are included so we can tell at a glance WHY it's
 * down — network (P1001), auth, etc.
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
    // make the health check itself hang (and thus the login page).
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Health check timed out after 4000ms')), 4000),
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
