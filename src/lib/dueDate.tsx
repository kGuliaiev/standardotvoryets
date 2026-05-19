/**
 * Shared due-date chip for task rows. Used in both the global tasks
 * list and the per-standard tasks tab so the visual rhythm matches.
 *
 * Format: "DD month · ще N днів" / "сьогодні" / "прострочено N днів"
 * with a colour cue: green (more than 3 days out), amber (≤3 days),
 * rose (overdue or today).
 */

import { AlertTriangle } from 'lucide-react';

const MONTHS_UA_SHORT = [
  'січ',
  'лют',
  'бер',
  'квіт',
  'трав',
  'черв',
  'лип',
  'серп',
  'вер',
  'жовт',
  'лист',
  'груд',
];

/** Ukrainian plural: 1 → день · 2-4 → дні · 5+ → днів. */
export function pluralizeDays(n: number): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'днів';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дні';
  return 'днів';
}

/** Short-form Ukrainian date: "13 трав". */
export function formatShortDateUa(d: Date): string {
  return `${d.getDate()} ${MONTHS_UA_SHORT[d.getMonth()]}`;
}

/** Full-month Ukrainian date used in tables: "13 травня". */
const MONTHS_UA_FULL = [
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
export function formatLongDateUa(d: Date): string {
  return `${d.getDate()} ${MONTHS_UA_FULL[d.getMonth()]}`;
}

export function DueDateChip({
  due,
  isDone,
}: {
  due: Date | null;
  isDone: boolean;
}): React.ReactElement | null {
  if (!due) return null;
  if (isDone) {
    return (
      <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-pill text-light">
        Виконано
      </span>
    );
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const dateLabel = formatShortDateUa(due);
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    const past = Math.abs(diffDays);
    return (
      <span className="text-[10px] font-bold rounded-full px-2 py-0.5 pill-rose inline-flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        {dateLabel} · прострочено {past} {pluralizeDays(past)}
      </span>
    );
  }
  if (diffDays === 0) {
    return (
      <span className="text-[10px] font-bold rounded-full px-2 py-0.5 pill-rose">
        {dateLabel} · сьогодні
      </span>
    );
  }
  const tone = diffDays <= 3 ? 'pill-amber' : 'pill-green';
  return (
    <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${tone}`}>
      {dateLabel} · ще {diffDays} {pluralizeDays(diffDays)}
    </span>
  );
}
