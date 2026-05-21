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
  // External presenters (free-text speakers not in the WG roster) were present
  // too — add their names so a доповідач isn't missing from «Присутні».
  const extraPresent = Array.from(
    new Set(
      meeting.agendaItems
        .filter((i) => (i.section ?? 'AGENDA') === 'AGENDA' || i.section === 'HEARD')
        .map((i) => (i.speakerName ?? '').trim())
        .filter((n) => n.length > 0),
    ),
  ).filter((n) => !presentNames.includes(n));
  const presentAll = [...presentNames, ...extraPresent];

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
          new TextRun({ text: chairman.name, bold: true, size: 22 }),
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
          new TextRun({ text: secretary.name, bold: true, size: 22 }),
        ],
      }),
    );
  }
  if (presentAll.length > 0) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        children: [
          new TextRun({ text: 'Присутні: ', size: 22 }),
          new TextRun({ text: presentAll.join(', '), size: 22 }),
        ],
      }),
    );
  }

  // Split items by protocol section — each section is its own list. (Without
  // this filter every section's items leaked into ПОРЯДОК ДЕННИЙ.)
  const agendaItems = meeting.agendaItems.filter((i) => (i.section ?? 'AGENDA') === 'AGENDA');
  const heardItems = meeting.agendaItems.filter((i) => i.section === 'HEARD');
  const decisionItems = meeting.agendaItems.filter((i) => i.section === 'DECISION');

  // Speaker/responsible display: roster member name wins; otherwise the
  // free-text name. No military rank — only «Ім'я ПРІЗВИЩЕ».
  const speakerOf = (it: { speaker: { name: string } | null; speakerName: string | null }) =>
    it.speaker ? it.speaker.name : (it.speakerName ?? '');
  const responsibleOf = (it: {
    responsible: { name: string } | null;
    responsibleName: string | null;
  }) => (it.responsible ? it.responsible.name : (it.responsibleName ?? ''));

  // ПОРЯДОК ДЕННИЙ
  children.push(
    new Paragraph({
      spacing: { before: 120, after: 120 },
      children: [new TextRun({ text: 'ПОРЯДОК ДЕННИЙ:', bold: true, size: 24 })],
    }),
  );
  agendaItems.forEach((item, idx) => {
    children.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: `${idx + 1}. `, bold: true, size: 22 }),
          new TextRun({ text: item.title, size: 22 }),
        ],
      }),
    );
    const speaker = speakerOf(item);
    if (speaker) {
      children.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: `Доповідач: ${speaker}.`, italics: true, size: 22 })],
        }),
      );
    }
  });

  // СЛУХАЛИ / ВИСТУПИЛИ — underlined speaker name leads the narrative
  heardItems.forEach((item) => {
    if (item.heardText) {
      const runs: TextRun[] = [];
      const spk = speakerOf(item);
      if (spk) {
        runs.push(new TextRun({ text: `${spk} `, underline: {}, size: 22 }));
      }
      runs.push(new TextRun({ text: item.heardText, size: 22 }));
      children.push(
        new Paragraph({
          spacing: { before: 200, after: 80 },
          children: [new TextRun({ text: 'СЛУХАЛИ:', bold: true, size: 24 })],
        }),
        new Paragraph({ spacing: { after: 120 }, children: runs }),
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
  });

  // ВИРІШИЛИ — single header, decisions numbered within the section
  const decisionsWithText = decisionItems.filter((i) => i.decisionText);
  if (decisionsWithText.length > 0) {
    children.push(
      new Paragraph({
        spacing: { before: 200, after: 80 },
        children: [new TextRun({ text: 'ВИРІШИЛИ:', bold: true, size: 24 })],
      }),
    );
    decisionsWithText.forEach((item, idx) => {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: `${idx + 1}. `, bold: true, size: 22 }),
            new TextRun({ text: item.decisionText ?? '', size: 22 }),
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
      const resp = responsibleOf(item);
      if (resp) {
        children.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({ text: `Відповідальний: ${resp}.`, italics: true, size: 22 })],
          }),
        );
      }
    });
  }

  // Signatures
  children.push(new Paragraph({ spacing: { before: 480 }, children: [new TextRun({ text: '' })] }));
  if (chairman) {
    children.push(
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        spacing: { after: 240 },
        children: [
          new TextRun({ text: 'Головуючий', size: 22 }),
          new TextRun({ text: `\t${chairman.name}`, size: 22 }),
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
          new TextRun({ text: `\t${secretary.name}`, size: 22 }),
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
