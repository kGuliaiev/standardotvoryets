/**
 * Minimal iCalendar (RFC 5545) generator for meeting export.
 *
 * Pulls in zero deps — the spec for what we need (single VEVENT in a
 * VCALENDAR wrapper) is straightforward. Keep this in pure-function
 * land so both the per-meeting route and the per-WG subscribe route
 * can reuse it.
 */

const PROD_ID = '-//Standardotvorets//Meetings//UK';

interface MeetingForIcs {
  id: string;
  title: string;
  startAt: Date;
  durationMins: number;
  format: 'ONLINE' | 'OFFLINE' | 'HYBRID';
  location: string | null;
  agendaText?: string | null;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  updatedAt: Date;
  workingGroup: { code: string; name: string };
  chairman: { name: string; email?: string | null } | null;
  attendances?: { user: { name: string; email: string } }[];
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** UTC timestamp formatted YYYYMMDDTHHMMSSZ. */
function dt(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

/** Escape per RFC 5545 §3.3.11 — backslash, comma, semicolon, newline. */
function esc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold long lines at 75 octets per RFC 5545 §3.1. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let rest = line;
  out.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    out.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return out.join('\r\n');
}

export function meetingToVEvent(m: MeetingForIcs, appUrl: string): string {
  const start = new Date(m.startAt);
  const end = new Date(start.getTime() + m.durationMins * 60_000);
  const description: string[] = [`Робоча група: ${m.workingGroup.code} «${m.workingGroup.name}»`];
  if (m.chairman) description.push(`Головуючий: ${m.chairman.name}`);
  if (m.agendaText) description.push('', 'Порядок денний:', m.agendaText);
  description.push('', `${appUrl}/meetings/${m.id}`);

  const lines: string[] = [
    'BEGIN:VEVENT',
    `UID:${m.id}@standardotvorets`,
    `DTSTAMP:${dt(new Date(m.updatedAt))}`,
    `DTSTART:${dt(start)}`,
    `DTEND:${dt(end)}`,
    `SUMMARY:${esc(m.title)}`,
    `DESCRIPTION:${esc(description.join('\n'))}`,
    `URL:${appUrl}/meetings/${m.id}`,
    `STATUS:${m.status === 'CANCELLED' ? 'CANCELLED' : m.status === 'COMPLETED' ? 'CONFIRMED' : 'TENTATIVE'}`,
    `CATEGORIES:${esc(m.workingGroup.code)}`,
  ];
  if (m.location) lines.push(`LOCATION:${esc(m.location)}`);
  else
    lines.push(
      `LOCATION:${esc(m.format === 'ONLINE' ? 'Онлайн' : m.format === 'HYBRID' ? 'Гібрид' : 'Офлайн')}`,
    );

  if (m.chairman?.email) {
    lines.push(`ORGANIZER;CN=${esc(m.chairman.name)}:mailto:${m.chairman.email}`);
  }
  if (m.attendances) {
    for (const a of m.attendances) {
      if (!a.user.email) continue;
      lines.push(`ATTENDEE;CN=${esc(a.user.name)};RSVP=TRUE:mailto:${a.user.email}`);
    }
  }
  lines.push('END:VEVENT');
  return lines.map(fold).join('\r\n');
}

export function wrapCalendar(events: string[], calName: string): string {
  const head = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PROD_ID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(calName)}`,
    `X-WR-TIMEZONE:Europe/Kyiv`,
  ];
  const tail = ['END:VCALENDAR'];
  return [...head.map(fold), ...events, ...tail].join('\r\n') + '\r\n';
}
