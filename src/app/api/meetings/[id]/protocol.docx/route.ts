import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth';
import { db } from '@/server/db';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  TabStopType,
  TabStopPosition,
  PageOrientation,
} from 'docx';

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

function rankPrefix(rank: string) {
  const r = RANK_LABELS[rank];
  return r ? `${r} ` : '';
}

function wgNumber(code: string) {
  const m = /(\d+)/.exec(code);
  return m ? m[1] : code;
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
          members: {
            include: {
              user: { select: { id: true, name: true, rank: true } },
            },
          },
        },
      },
      createdBy: { select: { id: true, name: true, rank: true } },
      chairman: { select: { id: true, name: true, rank: true } },
      agendaItems: {
        orderBy: { order: 'asc' },
        include: {
          speaker: { select: { id: true, name: true, rank: true, position: true } },
          responsible: { select: { id: true, name: true, rank: true } },
        },
      },
      attendances: {
        include: {
          user: { select: { id: true, name: true, rank: true } },
        },
      },
    },
  });
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isAdmin = session.user.globalRole === 'ADMIN';
  const isMember = session.user.memberships?.some(
    (m) => m.workingGroupId === meeting.workingGroup.id,
  );
  const isAnySec = session.user.memberships?.some((m) => m.role === 'SECRETARY');
  if (!isAdmin && !isMember && !isAnySec) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Find leader + secretary from members
  const leaderMember = meeting.workingGroup.members.find((m) => m.role === 'LEADER');
  const secretaryMember = meeting.workingGroup.members.find((m) => m.role === 'SECRETARY');
  const chairman = meeting.chairman ?? leaderMember?.user;
  const secretary = secretaryMember?.user;

  const startDate = new Date(meeting.startAt);
  const day = String(startDate.getDate()).padStart(2, '0');
  const monthGen = MONTH_GEN[startDate.getMonth()];
  const year = startDate.getFullYear();

  const presentNames = meeting.attendances
    .filter(
      (a) => a.status === 'CONFIRMED' && a.user.id !== chairman?.id && a.user.id !== secretary?.id,
    )
    .map((a) => a.user.name);

  const protoNum = meeting.protocolNumber ?? '_';
  const protoTitle = `ПРОТОКОЛ № ${protoNum}/${wgNumber(meeting.workingGroup.code)}/${year}`;

  const children: Paragraph[] = [];

  // Header
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 240 },
      children: [new TextRun({ text: protoTitle, bold: true, size: 32 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Засідання робочої групи із стандартизації', size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `${meeting.workingGroup.code} «${meeting.workingGroup.name}»`,
          bold: true,
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      spacing: { after: 360 },
      children: [
        new TextRun({ text: `«${day}» ${monthGen} ${year} року`, size: 22 }),
        new TextRun({ text: `\tм. Київ`, size: 22 }),
      ],
    }),
  );

  // Chairman + Secretary
  if (chairman) {
    children.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: 'Головуючий — ', size: 22 }),
          new TextRun({
            text: `${rankPrefix(chairman.rank)}${chairman.name}`,
            bold: true,
            size: 22,
          }),
          new TextRun({ text: ' (керівник робочої групи)', size: 22 }),
        ],
      }),
    );
  }
  if (secretary) {
    children.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: 'Секретар — ', size: 22 }),
          new TextRun({
            text: `${rankPrefix(secretary.rank)}${secretary.name}`,
            bold: true,
            size: 22,
          }),
        ],
      }),
    );
  }
  if (presentNames.length > 0) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        children: [
          new TextRun({ text: 'Присутні: ', size: 22 }),
          new TextRun({ text: presentNames.join(', '), size: 22 }),
        ],
      }),
    );
  }

  // Agenda
  children.push(
    new Paragraph({
      spacing: { before: 120, after: 120 },
      children: [new TextRun({ text: 'ПОРЯДОК ДЕННИЙ:', bold: true, size: 24 })],
    }),
  );

  meeting.agendaItems.forEach((item, idx) => {
    children.push(
      new Paragraph({
        numbering: undefined,
        spacing: { after: 80 },
        children: [
          new TextRun({ text: `${idx + 1}. `, bold: true, size: 22 }),
          new TextRun({ text: item.title, size: 22 }),
        ],
      }),
    );
    if (item.speaker) {
      children.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({
              text: `Доповідач: ${item.speaker.position ? item.speaker.position + ' ' : ''}${rankPrefix(item.speaker.rank)}${item.speaker.name}.`,
              italics: true,
              size: 22,
            }),
          ],
        }),
      );
    }
  });

  // СЛУХАЛИ / ВИСТУПИЛИ / ВИРІШИЛИ per agenda item
  meeting.agendaItems.forEach((item, idx) => {
    if (item.heardText) {
      children.push(
        new Paragraph({
          spacing: { before: 200, after: 80 },
          children: [new TextRun({ text: 'СЛУХАЛИ:', bold: true, size: 24 })],
        }),
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: item.heardText, size: 22 })],
        }),
      );
    }
    if (item.discussionText) {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 80 },
          children: [new TextRun({ text: 'ВИСТУПИЛИ:', bold: true, size: 24 })],
        }),
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: item.discussionText, size: 22 })],
        }),
      );
    }
    if (item.decisionText) {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 80 },
          children: [new TextRun({ text: 'ВИРІШИЛИ:', bold: true, size: 24 })],
        }),
        new Paragraph({
          spacing: { after: 60 },
          children: [
            new TextRun({ text: `${idx + 1}. `, bold: true, size: 22 }),
            new TextRun({ text: item.decisionText, size: 22 }),
          ],
        }),
      );
      if (item.deadline) {
        const d = new Date(item.deadline);
        children.push(
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({
                text: `Термін: до ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}.`,
                italics: true,
                size: 22,
              }),
            ],
          }),
        );
      }
      if (item.responsible) {
        children.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: `Відповідальний: ${rankPrefix(item.responsible.rank)}${item.responsible.name}.`,
                italics: true,
                size: 22,
              }),
            ],
          }),
        );
      }
    }
  });

  // Signatures
  children.push(new Paragraph({ spacing: { before: 480 }, children: [new TextRun({ text: '' })] }));
  if (chairman) {
    children.push(
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        spacing: { after: 240 },
        children: [
          new TextRun({ text: 'Головуючий', size: 22 }),
          new TextRun({
            text: `\t${rankPrefix(chairman.rank)}${chairman.name}`,
            size: 22,
          }),
        ],
      }),
    );
  }
  if (secretary) {
    children.push(
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        children: [
          new TextRun({ text: 'Секретар', size: 22 }),
          new TextRun({
            text: `\t${rankPrefix(secretary.rank)}${secretary.name}`,
            size: 22,
          }),
        ],
      }),
    );
  }

  const doc = new Document({
    creator: 'Стандартотворець',
    styles: {
      default: { document: { run: { font: 'Times New Roman', size: 24 } } },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838, orientation: PageOrientation.PORTRAIT },
            margin: { top: 1440, right: 1080, bottom: 1440, left: 1800 },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = `protocol-${wgNumber(meeting.workingGroup.code)}-${meeting.protocolNumber ?? 'draft'}-${year}.docx`;

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
