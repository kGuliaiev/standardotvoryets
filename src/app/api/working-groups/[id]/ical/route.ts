/**
 * Subscribable calendar URL for one working group.
 *
 * Used by Outlook / Google Calendar / Apple Calendar "Subscribe to URL"
 * feature — they refresh the feed periodically and auto-sync new
 * meetings. Subscribe URLs can't carry browser session cookies, so we
 * authenticate with an HMAC-signed token bound to (userId, wgId) using
 * NEXTAUTH_SECRET.
 *
 *   GET /api/working-groups/[id]/ical?user=<userId>&token=<HMAC>
 *
 * The frontend exposes a "Copy subscribe link" button which encodes
 * the current user's token (see WorkingGroupDetail.tsx).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { env } from '@/lib/env';
import { meetingToVEvent, wrapCalendar } from '@/lib/ical';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Derived from NEXTAUTH_SECRET — stable across deploys, unguessable. */
function icalToken(userId: string, wgId: string): string {
  return createHmac('sha256', env.NEXTAUTH_SECRET)
    .update(`ical:${userId}:${wgId}`)
    .digest('hex')
    .slice(0, 32);
}

export function buildSubscribeUrl(userId: string, wgId: string): string {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const token = icalToken(userId, wgId);
  return `${base}/api/working-groups/${wgId}/ical?user=${userId}&token=${token}`;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const userId = url.searchParams.get('user');
  const token = url.searchParams.get('token');
  if (!userId || !token) {
    return NextResponse.json({ error: 'Missing user or token' }, { status: 401 });
  }

  const expected = icalToken(userId, params.id);
  // Constant-time compare to avoid timing attacks
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isActive: true,
      globalRole: true,
      memberships: { where: { workingGroupId: params.id }, select: { workingGroupId: true } },
    },
  });
  if (!user?.isActive) return NextResponse.json({ error: 'User inactive' }, { status: 403 });

  const isPrivileged = user.globalRole === 'ADMIN' || user.globalRole === 'DIRECTOR';
  const isMember = user.memberships.length > 0;
  if (!isPrivileged && !isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const wg = await db.workingGroup.findUnique({
    where: { id: params.id },
    select: { id: true, code: true, name: true },
  });
  if (!wg) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // All non-cancelled meetings of this WG, past 30 days + all future
  const lookback = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const meetings = await db.meeting.findMany({
    where: {
      workingGroupId: params.id,
      status: { not: 'CANCELLED' },
      startAt: { gte: lookback },
    },
    include: {
      workingGroup: { select: { id: true, code: true, name: true } },
      chairman: { select: { name: true, email: true } },
      attendances: { include: { user: { select: { name: true, email: true } } } },
    },
    orderBy: { startAt: 'asc' },
  });

  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const events = meetings.map((m) =>
    meetingToVEvent(
      {
        id: m.id,
        title: m.title,
        startAt: m.startAt,
        durationMins: m.durationMins,
        format: m.format,
        location: m.location,
        agendaText: m.agendaText,
        status: m.status,
        updatedAt: m.updatedAt,
        workingGroup: m.workingGroup,
        chairman: m.chairman,
        attendances: m.attendances,
      },
      appUrl,
    ),
  );
  const ics = wrapCalendar(events, `${wg.code} «${wg.name}»`);

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=3600', // refresh hourly
    },
  });
}
