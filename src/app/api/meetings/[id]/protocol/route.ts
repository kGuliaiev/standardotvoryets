import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth';
import { db } from '@/server/db';
import { Document, Page, Text, View, StyleSheet, renderToBuffer, Font } from '@react-pdf/renderer';
import { createElement, type ReactElement, type ReactNode } from 'react';
import type { DocumentProps } from '@react-pdf/renderer';

const RANK_LABELS: Record<string, string> = {
  CIVILIAN: '',
  LIEUTENANT: 'лейтенант',
  SENIOR_LIEUTENANT: 'старший лейтенант',
  CAPTAIN: 'капітан',
  MAJOR: 'майор',
  LIEUTENANT_COLONEL: 'підполковник',
  COLONEL: 'полковник',
  BRIGADIER_GENERAL: 'бригадний генерал',
  MAJOR_GENERAL: 'генерал-майор',
  LIEUTENANT_GENERAL: 'генерал-лейтенант',
  GENERAL: 'генерал',
};

function rankPrefix(rank?: string | null) {
  if (!rank) return '';
  const r = RANK_LABELS[rank];
  return r ? `${r} ` : '';
}

function wgNumber(code: string) {
  return /(\d+)/.exec(code)?.[1] ?? code;
}

const MONTH_GEN = [
  'січня',
  'лютого',
  'березня',
  'квітня',
  'травня',
  'червня',
  'липня',
  'серпня',
  'вересня',
  'жовтня',
  'листопада',
  'грудня',
];

// Register a static, Cyrillic-capable serif. @react-pdf cannot resolve weights
// from a *variable* font (the previous NotoSans[wght] build threw "Could not
// resolve font … fontWeight 400"), so we use PT Serif's static TTFs.
let fontRegistered = false;
function ensureFont() {
  if (fontRegistered) return;
  Font.register({
    family: 'PTSerif',
    fonts: [
      { src: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ptserif/PT_Serif-Web-Regular.ttf' },
      {
        src: 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/ptserif/PT_Serif-Web-Bold.ttf',
        fontWeight: 700,
      },
    ],
  });
  fontRegistered = true;
}

const styles = StyleSheet.create({
  page: {
    paddingVertical: 56,
    paddingHorizontal: 64,
    fontFamily: 'PTSerif',
    fontSize: 11,
    color: '#1a1a1a',
    lineHeight: 1.45,
  },
  title: { fontSize: 14, fontWeight: 700, textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 11, textAlign: 'center' },
  wg: { fontSize: 11, fontWeight: 700, textAlign: 'center', marginBottom: 10 },
  dateRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  intro: { marginBottom: 3 },
  bold: { fontWeight: 700 },
  muted: { color: '#555' },
  sectionTitle: { fontWeight: 700, marginTop: 12, marginBottom: 5 },
  item: { marginBottom: 5, textAlign: 'justify' },
  meta: { color: '#444', marginBottom: 3, marginLeft: 16 },
  underline: { textDecoration: 'underline' },
  sigRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 40 },
});

interface Person {
  id: string;
  name: string;
  rank: string;
  position?: string | null;
}
interface Item {
  section: string;
  title: string;
  heardText: string | null;
  discussionText: string | null;
  decisionText: string | null;
  deadline: Date | null;
  speaker: Person | null;
  speakerName: string | null;
  responsible: Person | null;
  responsibleName: string | null;
}
interface ProtocolData {
  protoTitle: string;
  wgLine: string;
  dateLine: string;
  chairman: Person | null;
  secretary: Person | null;
  presentNames: string[];
  agenda: Item[];
  heard: Item[];
  decisions: Item[];
}

function fmtDeadline(d: Date) {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
function personLabel(p: Person | null) {
  return p ? `${rankPrefix(p.rank)}${p.name}` : '';
}
// Roster member (rank + name) wins; otherwise the free-text external name.
function speakerOf(it: Item) {
  return it.speaker ? personLabel(it.speaker) : (it.speakerName ?? '');
}
function responsibleOf(it: Item) {
  return it.responsible ? personLabel(it.responsible) : (it.responsibleName ?? '');
}

function ProtocolDoc({ d }: { d: ProtocolData }) {
  const body: ReactNode[] = [];

  body.push(
    createElement(Text, { key: 'title', style: styles.title }, d.protoTitle),
    createElement(
      Text,
      { key: 'sub', style: styles.subtitle },
      'Засідання робочої групи із стандартизації',
    ),
    createElement(Text, { key: 'wg', style: styles.wg }, d.wgLine),
    createElement(
      View,
      { key: 'date', style: styles.dateRow },
      createElement(Text, {}, d.dateLine),
      createElement(Text, {}, 'м. Київ'),
    ),
  );

  if (d.chairman) {
    body.push(
      createElement(
        Text,
        { key: 'chair', style: styles.intro },
        'Головуючий — ',
        createElement(Text, { style: styles.bold }, personLabel(d.chairman)),
        ' (керівник робочої групи)',
      ),
    );
  }
  if (d.secretary) {
    body.push(
      createElement(
        Text,
        { key: 'sec', style: styles.intro },
        'Секретар — ',
        createElement(Text, { style: styles.bold }, personLabel(d.secretary)),
      ),
    );
  }
  if (d.presentNames.length > 0) {
    body.push(
      createElement(
        Text,
        { key: 'present', style: { ...styles.intro, marginBottom: 8 } },
        'Присутні: ',
        d.presentNames.join(', '),
      ),
    );
  }

  // ПОРЯДОК ДЕННИЙ
  body.push(
    createElement(Text, { key: 'agenda-h', style: styles.sectionTitle }, 'ПОРЯДОК ДЕННИЙ:'),
  );
  d.agenda.forEach((it, idx) => {
    body.push(
      createElement(Text, { key: `a-${idx}`, style: styles.item }, `${idx + 1}. ${it.title}`),
    );
    if (it.speaker || it.speakerName) {
      const label = it.speaker
        ? `${it.speaker.position ? `${it.speaker.position} ` : ''}${personLabel(it.speaker)}`
        : it.speakerName;
      body.push(
        createElement(Text, { key: `a-sp-${idx}`, style: styles.meta }, `Доповідач: ${label}.`),
      );
    }
  });

  // СЛУХАЛИ / ВИСТУПИЛИ
  d.heard.forEach((it, idx) => {
    if (it.heardText) {
      const spk = speakerOf(it);
      body.push(
        createElement(Text, { key: `h-h-${idx}`, style: styles.sectionTitle }, 'СЛУХАЛИ:'),
        createElement(
          Text,
          { key: `h-b-${idx}`, style: styles.item },
          spk ? createElement(Text, { style: styles.underline }, `${spk} `) : null,
          it.heardText,
        ),
      );
    }
    if (it.discussionText) {
      body.push(
        createElement(Text, { key: `d-h-${idx}`, style: styles.sectionTitle }, 'ВИСТУПИЛИ:'),
        createElement(Text, { key: `d-b-${idx}`, style: styles.item }, it.discussionText),
      );
    }
  });

  // ВИРІШИЛИ
  const decisions = d.decisions.filter((i) => i.decisionText);
  if (decisions.length > 0) {
    body.push(createElement(Text, { key: 'dec-h', style: styles.sectionTitle }, 'ВИРІШИЛИ:'));
    decisions.forEach((it, idx) => {
      body.push(
        createElement(
          Text,
          { key: `dec-${idx}`, style: styles.item },
          `${idx + 1}. ${it.decisionText}`,
        ),
      );
      if (it.deadline) {
        body.push(
          createElement(
            Text,
            { key: `dec-dl-${idx}`, style: styles.meta },
            `Термін: до ${fmtDeadline(new Date(it.deadline))}.`,
          ),
        );
      }
      const resp = responsibleOf(it);
      if (resp) {
        body.push(
          createElement(
            Text,
            { key: `dec-r-${idx}`, style: styles.meta },
            `Відповідальний: ${resp}.`,
          ),
        );
      }
    });
  }

  // Signatures
  body.push(
    createElement(
      View,
      { key: 'sig', style: styles.sigRow },
      createElement(
        Text,
        {},
        'Головуючий          ',
        createElement(Text, { style: styles.bold }, personLabel(d.chairman)),
      ),
      createElement(
        Text,
        {},
        'Секретар          ',
        createElement(Text, { style: styles.bold }, personLabel(d.secretary)),
      ),
    ),
  );

  return createElement(
    Document,
    {},
    createElement(Page, { size: 'A4', style: styles.page }, ...body),
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
      workingGroup: {
        select: {
          id: true,
          code: true,
          name: true,
          members: { include: { user: { select: { id: true, name: true, rank: true } } } },
        },
      },
      chairman: { select: { id: true, name: true, rank: true, position: true } },
      agendaItems: {
        orderBy: { order: 'asc' },
        include: {
          speaker: { select: { id: true, name: true, rank: true, position: true } },
          responsible: { select: { id: true, name: true, rank: true, position: true } },
        },
      },
      attendances: { include: { user: { select: { id: true, name: true, rank: true } } } },
    },
  });

  if (!meeting) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const isAdmin = session.user.globalRole === 'ADMIN';
  const isMember = session.user.memberships?.some(
    (m) => m.workingGroupId === meeting.workingGroup.id,
  );
  const isAnySec = session.user.memberships?.some((m) => m.role === 'SECRETARY');
  if (!isAdmin && !isMember && !isAnySec) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const leaderMember = meeting.workingGroup.members.find((m) => m.role === 'LEADER');
  const secretaryMember = meeting.workingGroup.members.find((m) => m.role === 'SECRETARY');
  const chairman = meeting.chairman ?? leaderMember?.user ?? null;
  const secretary = secretaryMember?.user ?? null;

  const startDate = new Date(meeting.startAt);
  const year = startDate.getFullYear();
  const dateLine = `«${String(startDate.getDate()).padStart(2, '0')}» ${MONTH_GEN[startDate.getMonth()]} ${year} року`;

  const presentNames = meeting.attendances
    .filter(
      (a) => a.status === 'CONFIRMED' && a.user.id !== chairman?.id && a.user.id !== secretary?.id,
    )
    .map((a) => a.user.name);

  const data: ProtocolData = {
    protoTitle: `ПРОТОКОЛ № ${meeting.protocolNumber ?? '_'}/${wgNumber(meeting.workingGroup.code)}/${year}`,
    wgLine: `${meeting.workingGroup.code} «${meeting.workingGroup.name}»`,
    dateLine,
    chairman: chairman ?? null,
    secretary: secretary ?? null,
    presentNames,
    agenda: meeting.agendaItems.filter((i) => (i.section ?? 'AGENDA') === 'AGENDA'),
    heard: meeting.agendaItems.filter((i) => i.section === 'HEARD'),
    decisions: meeting.agendaItems.filter((i) => i.section === 'DECISION'),
  };

  ensureFont();

  try {
    const buffer = await renderToBuffer(
      createElement(ProtocolDoc, { d: data }) as unknown as ReactElement<DocumentProps>,
    );
    const date = startDate.toISOString().slice(0, 10);
    const wgDigits = wgNumber(meeting.workingGroup.code);
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
