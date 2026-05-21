import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth';
import { db } from '@/server/db';
import { Document, Page, Text, View, StyleSheet, renderToBuffer, Font } from '@react-pdf/renderer';
import { createElement, type ReactElement } from 'react';
import type { DocumentProps } from '@react-pdf/renderer';

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

// Tinos = Google's metric-compatible Times New Roman (static TTFs, Cyrillic),
// so the PDF report matches the Word export's Times New Roman. The old
// NotoSans[wght] *variable* font couldn't be resolved by @react-pdf.
const TINOS = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos';
let fontRegistered = false;
function ensureFont() {
  if (fontRegistered) return;
  Font.register({
    family: 'Tinos',
    fonts: [
      { src: `${TINOS}/Tinos-Regular.ttf` },
      { src: `${TINOS}/Tinos-Bold.ttf`, fontWeight: 700 },
      { src: `${TINOS}/Tinos-Italic.ttf`, fontStyle: 'italic' },
    ],
  });
  fontRegistered = true;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 24,
    fontFamily: 'Tinos',
    fontSize: 8,
    color: '#1a2540',
    lineHeight: 1.3,
  },
  header: {
    marginBottom: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: '#1a56db',
    paddingBottom: 8,
  },
  brand: {
    fontSize: 8,
    color: '#8a96b0',
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  h1: { fontSize: 13, fontWeight: 700, color: '#0f2b6b' },
  sub: { fontSize: 9, color: '#4b5880', marginTop: 2 },
  table: { width: '100%' },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#e5eaf2',
    minHeight: 22,
  },
  headRow: {
    backgroundColor: '#e8eef7',
    fontWeight: 700,
    color: '#0f2b6b',
    borderBottomWidth: 1,
    borderBottomColor: '#9aabd0',
  },
  cell: { paddingHorizontal: 3, paddingVertical: 3, justifyContent: 'center' },
  cellCenter: { alignItems: 'center', textAlign: 'center' },
  num: { width: '3.5%' },
  part: { width: '8%' },
  indeks: { width: '11%' },
  title: { width: '32%' },
  wg: { width: '6%' },
  stage: { width: '7.9%' },
  due: { fontSize: 8 },
  done: { fontSize: 7.5, fontWeight: 700, color: '#0F7B3B' },
  overdue: { color: '#C82333', fontWeight: 700 },
  doneStrike: { textDecoration: 'line-through', color: '#8a96b0' },
  titleText: { fontSize: 8.5, fontWeight: 700 },
  desc: { fontSize: 7, color: '#8a96b0', fontStyle: 'italic', marginTop: 1 },
  dash: { color: '#8a96b0' },
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 24,
    right: 24,
    fontSize: 7,
    color: '#8a96b0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 4,
    borderTopWidth: 0.5,
    borderTopColor: '#e5eaf2',
  },
});

interface PlanItem {
  id: string;
  title: string;
  description: string | null;
  partProgram: string | null;
  programNumber: number | null;
  indeks: string | null;
  workingGroup: { code: string };
  techSpecDueDate: Date | null;
  techSpecCompletedAt: Date | null;
  draftDueDate: Date | null;
  draftCompletedAt: Date | null;
  feedbackDueDate: Date | null;
  feedbackCompletedAt: Date | null;
  techReviewDueDate: Date | null;
  techReviewCompletedAt: Date | null;
  finalDueDate: Date | null;
  finalCompletedAt: Date | null;
}

function StageCell({ due, completedAt }: { due: Date | null; completedAt: Date | null }) {
  if (!due && !completedAt) {
    return createElement(
      View,
      { style: [styles.cell, styles.cellCenter, styles.stage] },
      createElement(Text, { style: styles.dash }, '—'),
    );
  }
  const isOverdue = !completedAt && !!due && due.getTime() < Date.now();
  const dueStyle = {
    ...styles.due,
    ...(completedAt ? styles.doneStrike : {}),
    ...(isOverdue ? styles.overdue : {}),
  };
  return createElement(
    View,
    { style: [styles.cell, styles.cellCenter, styles.stage] },
    due ? createElement(Text, { style: dueStyle }, fmtShort(due)) : null,
    completedAt ? createElement(Text, { style: styles.done }, `✓ ${fmtDot(completedAt)}`) : null,
  );
}

function PlanDoc({ items }: { items: PlanItem[] }) {
  const generated = new Date();
  const genStr = `${String(generated.getDate()).padStart(2, '0')}.${String(generated.getMonth() + 1).padStart(2, '0')}.${generated.getFullYear()}`;

  const headerRow = createElement(
    View,
    { style: [styles.row, styles.headRow] },
    createElement(
      View,
      { style: [styles.cell, styles.cellCenter, styles.num] },
      createElement(Text, {}, '№'),
    ),
    createElement(
      View,
      { style: [styles.cell, styles.cellCenter, styles.part] },
      createElement(Text, {}, 'Частина'),
    ),
    createElement(
      View,
      { style: [styles.cell, styles.cellCenter, styles.indeks] },
      createElement(Text, {}, 'Індекс (гриф)'),
    ),
    createElement(
      View,
      { style: [styles.cell, styles.title] },
      createElement(Text, {}, 'Назва стандарту'),
    ),
    createElement(
      View,
      { style: [styles.cell, styles.cellCenter, styles.wg] },
      createElement(Text, {}, 'РГ'),
    ),
    createElement(
      View,
      { style: [styles.cell, styles.cellCenter, styles.stage] },
      createElement(Text, {}, 'ТЗ'),
    ),
    createElement(
      View,
      { style: [styles.cell, styles.cellCenter, styles.stage] },
      createElement(Text, {}, 'Проєкт'),
    ),
    createElement(
      View,
      { style: [styles.cell, styles.cellCenter, styles.stage] },
      createElement(Text, {}, 'Відгуки'),
    ),
    createElement(
      View,
      { style: [styles.cell, styles.cellCenter, styles.stage] },
      createElement(Text, {}, 'Перевірка'),
    ),
    createElement(
      View,
      { style: [styles.cell, styles.cellCenter, styles.stage] },
      createElement(Text, {}, 'Остаточно'),
    ),
  );

  return createElement(
    Document,
    {},
    createElement(
      Page,
      { size: 'A4', orientation: 'landscape', style: styles.page },
      createElement(
        View,
        { style: styles.header },
        createElement(Text, { style: styles.brand }, 'СТАНДАРТОТВОРЕЦЬ · Звіт'),
        createElement(
          Text,
          { style: styles.h1 },
          'Поетапний план виконання програми стандартизації на 2026 рік',
        ),
        createElement(
          Text,
          { style: styles.sub },
          `Станом на ${genStr} · Усього позицій: ${items.length}`,
        ),
      ),
      createElement(
        View,
        { style: styles.table },
        headerRow,
        ...items.map((s) =>
          createElement(
            View,
            { style: styles.row, key: s.id, wrap: false },
            createElement(
              View,
              { style: [styles.cell, styles.cellCenter, styles.num] },
              createElement(Text, { style: { fontWeight: 700 } }, String(s.programNumber ?? '—')),
            ),
            createElement(
              View,
              { style: [styles.cell, styles.cellCenter, styles.part] },
              createElement(Text, {}, s.partProgram ?? '—'),
            ),
            createElement(
              View,
              { style: [styles.cell, styles.cellCenter, styles.indeks] },
              createElement(Text, { style: { fontSize: 7.5 } }, s.indeks ?? '—'),
            ),
            createElement(
              View,
              { style: [styles.cell, styles.title] },
              createElement(Text, { style: styles.titleText }, s.title),
              s.description ? createElement(Text, { style: styles.desc }, s.description) : null,
            ),
            createElement(
              View,
              { style: [styles.cell, styles.cellCenter, styles.wg] },
              createElement(Text, { style: { fontWeight: 700 } }, s.workingGroup.code),
            ),
            createElement(StageCell, {
              due: s.techSpecDueDate,
              completedAt: s.techSpecCompletedAt,
            }),
            createElement(StageCell, { due: s.draftDueDate, completedAt: s.draftCompletedAt }),
            createElement(StageCell, {
              due: s.feedbackDueDate,
              completedAt: s.feedbackCompletedAt,
            }),
            createElement(StageCell, {
              due: s.techReviewDueDate,
              completedAt: s.techReviewCompletedAt,
            }),
            createElement(StageCell, { due: s.finalDueDate, completedAt: s.finalCompletedAt }),
          ),
        ),
      ),
      createElement(
        View,
        { style: styles.footer, fixed: true },
        createElement(Text, {}, 'Стандартотворець'),
        createElement(Text, {
          render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`,
        }),
        createElement(Text, {}, `Згенеровано ${new Date().toLocaleString('uk-UA')}`),
      ),
    ),
  );
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const items = await db.standard.findMany({
    where: { indeks: { not: null } },
    include: { workingGroup: { select: { code: true } } },
    orderBy: [{ programNumber: 'asc' }],
  });

  ensureFont();

  try {
    const buffer = await renderToBuffer(
      createElement(PlanDoc, { items }) as unknown as ReactElement<DocumentProps>,
    );
    const date = new Date().toISOString().slice(0, 10);
    const asciiName = `program-plan-${date}.pdf`;
    const fullName = `plan-stadartyzacii-${date}.pdf`;
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fullName)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[plan pdf] render failed', err);
    return NextResponse.json(
      { error: 'Failed to render PDF', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }
}
