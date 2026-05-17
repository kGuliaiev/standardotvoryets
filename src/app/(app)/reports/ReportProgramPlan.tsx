'use client';

import { trpc } from '@/lib/trpc/client';
import { useSort, sortedRows } from '@/lib/useSort';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { Check, FileText, FileDown } from 'lucide-react';

interface CellProps {
  due?: Date | string | null;
  completedAt?: Date | string | null;
}

function fmtShort(d: Date | string) {
  const dt = d instanceof Date ? d : new Date(d);
  const day = String(dt.getDate()).padStart(2, '0');
  const months = [
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
  return `${day} ${months[dt.getMonth()]}`;
}

function fmtDot(d: Date | string) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
}

function StageCell({ due, completedAt }: CellProps) {
  if (!due) return <span className="text-light">—</span>;
  const isDone = !!completedAt;
  const dueDate = due instanceof Date ? due : new Date(due);
  const isOverdue = !isDone && dueDate.getTime() < Date.now();
  return (
    <div className="flex flex-col items-center gap-0.5 text-center">
      <span
        className={
          isDone
            ? 'text-mid line-through'
            : isOverdue
              ? 'text-red-600 dark:text-red-400 font-semibold'
              : 'text-ink'
        }
      >
        до {fmtShort(due)}
      </span>
      {isDone && completedAt && (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold whitespace-nowrap">
          <Check className="w-3 h-3" strokeWidth={3} /> {fmtDot(completedAt)}
        </span>
      )}
    </div>
  );
}

export function ReportProgramPlan() {
  const { data, error } = trpc.standard.list.useQuery(
    { page: 1, pageSize: 100 },
    { refetchOnMount: 'always', staleTime: 0 },
  );
  const [sort, setSort] = useSort<
    'num' | 'part' | 'indeks' | 'title' | 'wg' | 'techSpec' | 'final'
  >('num', 'asc');

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 rounded-xl p-6 text-sm">
        <p className="font-semibold mb-1">Не вдалось завантажити дані</p>
        <p className="opacity-80">{error.message}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="bg-card rounded-xl border border-hairline p-12 text-center text-light text-sm">
        Завантаження…
      </div>
    );
  }

  // Only standards belonging to the program plan (those that have an indeks)
  const planItems = data.items.filter((s) => s.indeks);

  const ordered = sortedRows(planItems, sort, (s, key) => {
    switch (key) {
      case 'num':
        return s.programNumber ?? Number.MAX_SAFE_INTEGER;
      case 'part':
        return s.partProgram ?? '';
      case 'indeks':
        return s.indeks ?? '';
      case 'title':
        return s.title;
      case 'wg':
        return s.workingGroup.code;
      case 'techSpec':
        return s.techSpecDueDate ? new Date(s.techSpecDueDate) : null;
      case 'final':
        return s.finalDueDate ? new Date(s.finalDueDate) : null;
      default:
        return null;
    }
  });

  const totalDone = planItems.filter((s) => s.techSpecCompletedAt).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Звіт</h1>
          <p className="text-sm text-mid mt-1">
            Поетапний план виконання програми стандартизації на 2026 рік
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-xs text-mid">
            ТЗ виконано: <span className="font-bold text-ink">{totalDone}</span> /{' '}
            {planItems.length}
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/api/reports/plan.docx"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-hairline text-ink hover:bg-pill transition-colors"
              title="Завантажити як Word"
            >
              <FileText className="w-3.5 h-3.5" />
              Word
            </a>
            <a
              href="/api/reports/plan.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-hairline text-ink hover:bg-pill transition-colors"
              title="Відкрити PDF"
            >
              <FileDown className="w-3.5 h-3.5" />
              PDF
            </a>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-hairline overflow-x-auto scrollbar-thin">
        <table className="w-full text-xs min-w-[1200px]">
          <thead className="bg-page border-b border-hairline text-mid uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2.5 font-medium text-center w-10">
                <SortableHeader columnKey="num" sort={sort} onSort={setSort}>
                  №
                </SortableHeader>
              </th>
              <th className="px-3 py-2.5 font-medium text-center w-24">
                <SortableHeader columnKey="part" sort={sort} onSort={setSort}>
                  Частина / №
                </SortableHeader>
              </th>
              <th className="px-3 py-2.5 font-medium text-center w-40">
                <SortableHeader columnKey="indeks" sort={sort} onSort={setSort}>
                  Індекс (гриф)
                </SortableHeader>
              </th>
              <th className="px-3 py-2.5 font-medium">
                <SortableHeader columnKey="title" sort={sort} onSort={setSort}>
                  Назва стандарту
                </SortableHeader>
              </th>
              <th className="px-3 py-2.5 font-medium w-20 text-center">
                <SortableHeader columnKey="wg" sort={sort} onSort={setSort}>
                  Робоча група
                </SortableHeader>
              </th>
              <th className="px-2 py-2.5 font-medium text-center">
                <SortableHeader columnKey="techSpec" sort={sort} onSort={setSort}>
                  ТЗ
                </SortableHeader>
              </th>
              <th className="px-2 py-2.5 font-medium text-center">Проєкт</th>
              <th className="px-2 py-2.5 font-medium text-center">Відгуки</th>
              <th className="px-2 py-2.5 font-medium text-center">Перевірка</th>
              <th className="px-2 py-2.5 font-medium text-center">
                <SortableHeader columnKey="final" sort={sort} onSort={setSort}>
                  Остаточно
                </SortableHeader>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {ordered.map((s) => (
              <tr key={s.id} className="hover:bg-page transition-colors align-top">
                <td className="px-3 py-3 text-center font-bold text-ink">
                  {s.programNumber ?? '—'}
                </td>
                <td className="px-3 py-3 text-center text-mid">
                  <p>{s.partProgram ?? '—'}</p>
                  {s.programNumber !== null && (
                    <p className="text-light mt-0.5">№ {s.programNumber}</p>
                  )}
                </td>
                <td className="px-3 py-3 text-center font-mono text-[11px] text-mid">
                  {s.indeks ?? '—'}
                </td>
                <td className="px-3 py-3 max-w-[400px]">
                  <a
                    href={`/standards/${s.id}`}
                    className="text-ink hover:text-brand font-medium block leading-snug"
                  >
                    {s.title}
                  </a>
                  {s.description && (
                    <p className="text-[10px] text-light italic mt-1">{s.description}</p>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: s.workingGroup.color }}
                    />
                    <span className="font-mono text-[11px] text-mid font-semibold">
                      {s.workingGroup.code}
                    </span>
                  </span>
                </td>
                <td className="px-2 py-3">
                  <StageCell due={s.techSpecDueDate} completedAt={s.techSpecCompletedAt} />
                </td>
                <td className="px-2 py-3">
                  <StageCell due={s.draftDueDate} completedAt={s.draftCompletedAt} />
                </td>
                <td className="px-2 py-3">
                  <StageCell due={s.feedbackDueDate} completedAt={s.feedbackCompletedAt} />
                </td>
                <td className="px-2 py-3">
                  <StageCell due={s.techReviewDueDate} completedAt={s.techReviewCompletedAt} />
                </td>
                <td className="px-2 py-3">
                  <StageCell due={s.finalDueDate} completedAt={s.finalCompletedAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-light italic">
        Дати виконання етапів підтверджують секретарі / керівники робочих груп на сторінці стандарту
        у блоці «Поетапний план виконання».
      </p>
    </div>
  );
}
