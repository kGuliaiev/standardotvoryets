/**
 * Download a single meeting as an .ics file.
 *
 * Auth: any logged-in user who can read the meeting.
 *
 * Response: `text/calendar; charset=utf-8` so Outlook / Google Calendar
 * / Apple Calendar import it natively when the user clicks the link.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth';
import { db } from '@/server/db';
import { env } from '@/lib/env';
import { meetingToVEvent, wrapCalendar } from '@/lib/ical';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const m = await db.meeting.findUnique({
    where: { id: params.id },
    include: {
      workingGroup: { select: { id: true, code: true, name: true } },
      chairman: { select: { name: true, email: true } },
      attendances: { include: { user: { select: { name: true, email: true } } } },
    },
  });
  if (!m) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isAdmin = session.user.globalRole === 'ADMIN';
  const isDirector = session.user.globalRole === 'DIRECTOR';
  const isMember = session.user.memberships?.some(
    (mem) => mem.workingGroupId === m.workingGroup.id,
  );
  if (!isAdmin && !isDirector && !isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const event = meetingToVEvent(
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
    env.NEXT_PUBLIC_APP_URL.replace(/\/$/, ''),
  );
  const ics = wrapCalendar([event], `${m.workingGroup.code} · ${m.title}`);

  const safeName = `meeting-${m.workingGroup.code.replace(/[^\w-]+/g, '_')}-${m.startAt.toISOString().slice(0, 10)}.ics`;
  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
