/**
 * Deploy/data diagnostic endpoint.
 *
 * Returns build commit (from Railway env or fallback) plus DB summary so we
 * can see at a glance whether the latest deploy is live AND whether the seed
 * has populated the expected data.
 */
import { db } from '@/server/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  let dbSummary: Record<string, unknown> = {};
  try {
    const [users, wgs, members, settings] = await Promise.all([
      db.user.count(),
      db.workingGroup.findMany({ select: { code: true, _count: { select: { members: true } } } }),
      db.workingGroupMember.count(),
      db.systemSettings.findUnique({ where: { id: 1 } }),
    ]);
    dbSummary = {
      users,
      workingGroups: wgs.map((w) => ({ code: w.code, members: w._count.members })),
      memberships: members,
      systemSettingsConfigured: !!settings,
    };
  } catch (e) {
    dbSummary = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({
    commit:
      process.env.RAILWAY_GIT_COMMIT_SHA ??
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GIT_COMMIT ??
      'unknown',
    branch: process.env.RAILWAY_GIT_BRANCH ?? 'unknown',
    deployedAt: process.env.RAILWAY_DEPLOYMENT_CREATED_AT ?? process.env.BUILD_TIME ?? 'unknown',
    builtAt: process.env.NEXT_PUBLIC_BUILD_TIME ?? null,
    nodeEnv: process.env.NODE_ENV,
    db: dbSummary,
    timestamp: new Date().toISOString(),
  });
}
