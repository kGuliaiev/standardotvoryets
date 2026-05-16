import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth';
import { db } from '@/server/db';
import { Document, Page, Text, View, StyleSheet, renderToBuffer, Font } from '@react-pdf/renderer';
import { createElement, type ReactElement } from 'react';
import type { DocumentProps } from '@react-pdf/renderer';

const ATTENDANCE_LABELS: Record<string, string> = {
  PENDING: 'Очікується',
  CONFIRMED: 'Підтверджено',
  DECLINED: 'Відмовлено',
};

const FORMAT_LABELS: Record<string, string> = {
  ONLINE: 'Онлайн',
  OFFLINE: 'Офлайн',
  HYBRID: 'Гібрид',
};

const STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Заплановано',
  IN_PROGRESS: 'Триває',
  COMPLETED: 'Завершено',
  CANCELLED: 'Скасовано',
};

// Register a Cyrillic-capable font (built-in Helvetica doesn't support Cyrillic).
let fontRegistered = false;
function ensureFont() {
  if (fontRegistered) return;
  try {
    Font.register({
      family: 'NotoSans',
      fonts: [
        {
          src: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf',
          fontWeight: 400,
        },
        {
          src: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf',
          fontWeight: 700,
        },
      ],
    });
    fontRegistered = true;
  } catch {
    // ignore — fall back to default
  }
}

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: 'NotoSans',
    fontSize: 11,
    color: '#1a2540',
    lineHeight: 1.5,
  },
  header: {
    borderBottomWidth: 2,
    borderBottomColor: '#1a56db',
    paddingBottom: 14,
    marginBottom: 18,
  },
  brand: {
    fontSize: 9,
    color: '#8a96b0',
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  h1: { fontSize: 18, fontWeight: 700, color: '#0f2b6b', marginBottom: 6 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, fontSize: 10, color: '#4b5880' },
  metaItem: { marginRight: 16 },
  metaLabel: { color: '#8a96b0' },
  section: { marginTop: 18 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: '#0f2b6b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  para: { marginBottom: 6, color: '#1a2540' },
  table: { marginTop: 6 },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e5eaf2',
    paddingVertical: 5,
  },
  trHead: { backgroundColor: '#fafbfd', fontWeight: 700, color: '#4b5880' },
  td: { paddingHorizontal: 6 },
  tdName: { width: '50%' },
  tdRole: { width: '30%' },
  tdStatus: { width: '20%' },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 48,
    right: 48,
    fontSize: 8,
    color: '#8a96b0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#e5eaf2',
  },
});

interface MeetingData {
  title: string;
  format: string;
  status: string;
  startAt: Date;
  durationMins: number;
  location: string | null;
  agendaText: string | null;
  minutesText: string | null;
  createdBy: { name: string };
  workingGroup: { code: string; name: string };
  attendances: { status: string; user: { name: string }; note: string | null }[];
}

function ProtocolDoc({ meeting }: { meeting: MeetingData }) {
  const date = new Date(meeting.startAt);
  return createElement(
    Document,
    {},
    createElement(
      Page,
      { size: 'A4', style: styles.page },
      createElement(
        View,
        { style: styles.header },
        createElement(Text, { style: styles.brand }, 'СТАНДАРТОТВОРЕЦЬ · Протокол засідання'),
        createElement(Text, { style: styles.h1 }, meeting.title),
        createElement(
          View,
          { style: styles.metaRow },
          createElement(
            Text,
            { style: styles.metaItem },
            createElement(Text, { style: styles.metaLabel }, 'РГ: '),
            `${meeting.workingGroup.code} — ${meeting.workingGroup.name}`,
          ),
          createElement(
            Text,
            { style: styles.metaItem },
            createElement(Text, { style: styles.metaLabel }, 'Дата: '),
            date.toLocaleString('uk-UA', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            }),
          ),
          createElement(
            Text,
            { style: styles.metaItem },
            createElement(Text, { style: styles.metaLabel }, 'Тривалість: '),
            `${meeting.durationMins} хв`,
          ),
          createElement(
            Text,
            { style: styles.metaItem },
            createElement(Text, { style: styles.metaLabel }, 'Формат: '),
            FORMAT_LABELS[meeting.format] ?? meeting.format,
          ),
          createElement(
            Text,
            { style: styles.metaItem },
            createElement(Text, { style: styles.metaLabel }, 'Статус: '),
            STATUS_LABELS[meeting.status] ?? meeting.status,
          ),
          meeting.location
            ? createElement(
                Text,
                { style: styles.metaItem },
                createElement(Text, { style: styles.metaLabel }, 'Місце: '),
                meeting.location,
              )
            : null,
          createElement(
            Text,
            { style: styles.metaItem },
            createElement(Text, { style: styles.metaLabel }, 'Організатор: '),
            meeting.createdBy.name,
          ),
        ),
      ),
      meeting.agendaText
        ? createElement(
            View,
            { style: styles.section },
            createElement(Text, { style: styles.sectionTitle }, 'Порядок денний'),
            createElement(Text, { style: styles.para }, meeting.agendaText),
          )
        : null,
      createElement(
        View,
        { style: styles.section },
        createElement(
          Text,
          { style: styles.sectionTitle },
          `Учасники (${meeting.attendances.length})`,
        ),
        createElement(
          View,
          { style: styles.table },
          createElement(
            View,
            { style: [styles.tr, styles.trHead] },
            createElement(Text, { style: [styles.td, styles.tdName] }, "Ім'я"),
            createElement(Text, { style: [styles.td, styles.tdRole] }, 'Примітка'),
            createElement(Text, { style: [styles.td, styles.tdStatus] }, 'Статус'),
          ),
          ...meeting.attendances.map((a, i) =>
            createElement(
              View,
              { style: styles.tr, key: i },
              createElement(Text, { style: [styles.td, styles.tdName] }, a.user.name),
              createElement(Text, { style: [styles.td, styles.tdRole] }, a.note ?? '—'),
              createElement(
                Text,
                { style: [styles.td, styles.tdStatus] },
                ATTENDANCE_LABELS[a.status] ?? a.status,
              ),
            ),
          ),
        ),
      ),
      meeting.minutesText
        ? createElement(
            View,
            { style: styles.section },
            createElement(Text, { style: styles.sectionTitle }, 'Протокол'),
            createElement(Text, { style: styles.para }, meeting.minutesText),
          )
        : createElement(
            View,
            { style: styles.section },
            createElement(Text, { style: styles.sectionTitle }, 'Протокол'),
            createElement(
              Text,
              { style: { ...styles.para, color: '#8a96b0', fontStyle: 'italic' } },
              'Протокол ще не додано',
            ),
          ),
      createElement(
        View,
        { style: styles.footer, fixed: true },
        createElement(Text, {}, 'Стандартотворець'),
        createElement(Text, {}, `Створено ${new Date().toLocaleString('uk-UA')}`),
      ),
    ),
  );
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const meeting = await db.meeting.findUnique({
    where: { id: params.id },
    include: {
      workingGroup: { select: { id: true, code: true, name: true } },
      createdBy: { select: { name: true } },
      attendances: {
        include: { user: { select: { name: true } } },
        orderBy: { user: { name: 'asc' } },
      },
    },
  });

  if (!meeting) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Access: ADMIN or member of WG
  const isAdmin = session.user.globalRole === 'ADMIN';
  const isMember = session.user.memberships?.some(
    (m) => m.workingGroupId === meeting.workingGroup.id,
  );
  if (!isAdmin && !isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  ensureFont();

  try {
    const buffer = await renderToBuffer(
      createElement(ProtocolDoc, { meeting }) as unknown as ReactElement<DocumentProps>,
    );
    // HTTP headers must be Latin-1. Build an ASCII-safe filename for the
    // `filename=` fallback, and a URI-encoded UTF-8 variant (RFC 5987) so
    // modern browsers show the proper Cyrillic name.
    const date = new Date(meeting.startAt).toISOString().slice(0, 10);
    const wgDigits = /(\d+)/.exec(meeting.workingGroup.code)?.[1] ?? 'x';
    const asciiName = `protocol-rg${wgDigits}-${date}.pdf`;
    const fullName = `protocol-${meeting.workingGroup.code.replace(/\s+/g, '_')}-${date}.pdf`;
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fullName)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[pdf] render failed', err);
    return NextResponse.json(
      { error: 'Failed to render PDF', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
