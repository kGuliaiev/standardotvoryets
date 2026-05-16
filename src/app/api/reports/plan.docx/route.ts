import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth';
import { db } from '@/server/db';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  PageOrientation,
  WidthType,
  ShadingType,
  BorderStyle,
  VerticalAlign,
} from 'docx';

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

function fmtShort(d: Date | null) {
  if (!d) return '';
  return `до ${String(d.getDate()).padStart(2, '0')} ${MONTH_GEN[d.getMonth()]}`;
}
function fmtDot(d: Date | null) {
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
const borders = { top: border, bottom: border, left: border, right: border };

function headCell(text: string, widthDxa: number) {
  return new TableCell({
    borders,
    width: { size: widthDxa, type: WidthType.DXA },
    shading: { fill: 'E8EEF7', type: ShadingType.CLEAR, color: 'auto' },
    margins: { top: 80, bottom: 80, left: 80, right: 80 },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text, bold: true, size: 18 })],
      }),
    ],
  });
}

function cell(widthDxa: number, children: Paragraph[], opts: { center?: boolean } = {}) {
  return new TableCell({
    borders,
    width: { size: widthDxa, type: WidthType.DXA },
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    verticalAlign: VerticalAlign.CENTER,
    children:
      children.length > 0
        ? children
        : [
            new Paragraph({
              alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
              children: [new TextRun({ text: '', size: 18 })],
            }),
          ],
  });
}

function stageParas(due: Date | null, completedAt: Date | null) {
  const out: Paragraph[] = [];
  if (!due && !completedAt) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: '—', size: 18, color: '8a96b0' })],
      }),
    );
    return out;
  }
  const isOverdue = !completedAt && !!due && due.getTime() < Date.now();
  if (due) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: fmtShort(due),
            size: 18,
            strike: !!completedAt,
            color: isOverdue ? 'C82333' : '1a2540',
            bold: isOverdue,
          }),
        ],
      }),
    );
  }
  if (completedAt) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: `✓ ${fmtDot(completedAt)}`, size: 18, color: '0F7B3B', bold: true }),
        ],
      }),
    );
  }
  return out;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const items = await db.standard.findMany({
    where: { indeks: { not: null } },
    include: { workingGroup: { select: { code: true, name: true, color: true } } },
    orderBy: [{ programNumber: 'asc' }],
  });

  // Column widths (DXA, landscape A4 content = 15860 - 1800 - 1080 ≈ 12980)
  const cols = {
    num: 480,
    part: 1200,
    indeks: 1600,
    title: 4200,
    wg: 900,
    techSpec: 1100,
    draft: 1100,
    feedback: 1100,
    review: 1100,
    final: 1200,
  };
  const totalWidth = Object.values(cols).reduce((a, b) => a + b, 0);

  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headCell('№', cols.num),
      headCell('Частина', cols.part),
      headCell('Індекс (гриф)', cols.indeks),
      headCell('Назва стандарту', cols.title),
      headCell('РГ', cols.wg),
      headCell('ТЗ', cols.techSpec),
      headCell('Проєкт', cols.draft),
      headCell('Відгуки', cols.feedback),
      headCell('Перевірка', cols.review),
      headCell('Остаточно', cols.final),
    ],
  });

  const bodyRows = items.map((s) => {
    const titlePara = new Paragraph({
      children: [new TextRun({ text: s.title, size: 18, bold: true })],
    });
    const descPara = s.description
      ? new Paragraph({
          children: [
            new TextRun({ text: s.description, size: 16, italics: true, color: '8a96b0' }),
          ],
        })
      : null;
    return new TableRow({
      children: [
        cell(cols.num, [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: String(s.programNumber ?? '—'), size: 18, bold: true })],
          }),
        ]),
        cell(cols.part, [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: s.partProgram ?? '—', size: 18 })],
          }),
        ]),
        cell(cols.indeks, [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: s.indeks ?? '—', size: 16 })],
          }),
        ]),
        cell(cols.title, descPara ? [titlePara, descPara] : [titlePara]),
        cell(cols.wg, [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: s.workingGroup.code, size: 18, bold: true })],
          }),
        ]),
        cell(cols.techSpec, stageParas(s.techSpecDueDate, s.techSpecCompletedAt)),
        cell(cols.draft, stageParas(s.draftDueDate, s.draftCompletedAt)),
        cell(cols.feedback, stageParas(s.feedbackDueDate, s.feedbackCompletedAt)),
        cell(cols.review, stageParas(s.techReviewDueDate, s.techReviewCompletedAt)),
        cell(cols.final, stageParas(s.finalDueDate, s.finalCompletedAt)),
      ],
    });
  });

  const table = new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: Object.values(cols),
    rows: [headerRow, ...bodyRows],
  });

  const titlePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [
      new TextRun({
        text: 'Поетапний план виконання програми стандартизації на 2026 рік',
        bold: true,
        size: 28,
      }),
    ],
  });
  const generated = new Date();
  const subTitle = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [
      new TextRun({
        text: `Звіт станом на ${String(generated.getDate()).padStart(2, '0')}.${String(generated.getMonth() + 1).padStart(2, '0')}.${generated.getFullYear()} · Усього позицій: ${items.length}`,
        size: 20,
        color: '4b5880',
      }),
    ],
  });

  const doc = new Document({
    creator: 'Стандартотворець',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 20 } } } },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838,
              orientation: PageOrientation.LANDSCAPE,
            },
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children: [titlePara, subTitle, table],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const date = generated.toISOString().slice(0, 10);
  const asciiName = `program-plan-${date}.docx`;
  const fullName = `plan-stadartyzacii-${date}.docx`;
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fullName)}`,
      'Cache-Control': 'no-store',
    },
  });
}
