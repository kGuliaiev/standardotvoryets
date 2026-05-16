/**
 * Visual stepper for the 5 stages of the Програма стандартизації plan.
 *
 * Drives entirely off per-stage completion timestamps + due dates (NOT the
 * legacy `currentStage` enum). Per-stage state:
 *   - completed: <stage>CompletedAt is set      → green ✓
 *   - overdue:   not completed AND now > dueDate → red ! (also bubbles up as
 *                a banner / list flag elsewhere)
 *   - current:   first non-completed stage       → brand blue
 *   - upcoming:  later than current              → gray
 *
 * Variants:
 *   - "full" (default): wide labeled stepper for the standard detail page;
 *     when an onConfirm callback is passed, each stage gets a date-picker
 *     popover so the secretary can record the REAL completion date (not
 *     just "now"). Confirmed stages display "✏ <date>" — clicking opens
 *     the editor pre-filled.
 *   - "compact": thin 5-segment bar for table rows.
 */
'use client';

import { useState } from 'react';
import { Check, AlertCircle, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StageKey = 'TECH_SPEC' | 'DRAFTING' | 'FEEDBACK' | 'TECH_REVIEW' | 'FINALIZATION';

export interface StandardProgressProps {
  techSpecDueDate?: Date | string | null;
  draftDueDate?: Date | string | null;
  feedbackDueDate?: Date | string | null;
  techReviewDueDate?: Date | string | null;
  finalDueDate?: Date | string | null;
  techSpecCompletedAt?: Date | string | null;
  draftCompletedAt?: Date | string | null;
  feedbackCompletedAt?: Date | string | null;
  techReviewCompletedAt?: Date | string | null;
  finalCompletedAt?: Date | string | null;
  variant?: 'full' | 'compact';
  /** compact variant only: render the current/overdue stage name under the bar */
  showLabel?: boolean;
  /** Confirm / re-confirm / un-confirm a stage. completedAt is the actual
   *  completion date the user picked (may be earlier than today). Omitted on
   *  un-confirm. If omitted on confirm, server falls back to now(). */
  onConfirm?: (stage: StageKey, confirmed: boolean, completedAt?: Date) => void;
  isPending?: boolean;
  className?: string;
}

interface Stage {
  key: StageKey;
  short: string;
  full: string;
  dueDate: Date | null;
  completedAt: Date | null;
}

const STAGE_ORDER: StageKey[] = [
  'TECH_SPEC',
  'DRAFTING',
  'FEEDBACK',
  'TECH_REVIEW',
  'FINALIZATION',
];

const STAGE_LABELS: Record<StageKey, { short: string; full: string }> = {
  TECH_SPEC: { short: 'ТЗ', full: 'Розроблення та погодження ТЗ' },
  DRAFTING: { short: 'Проєкт', full: 'Розроблення проєкту стандарту' },
  FEEDBACK: { short: 'Відгуки', full: 'Отримання та опрацювання відгуків' },
  TECH_REVIEW: { short: 'Перевірка', full: 'Технічна перевірка проєкту стандарту' },
  FINALIZATION: { short: 'Фіналізація', full: 'Остаточний термін виконання' },
};

function toDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  return d instanceof Date ? d : new Date(d);
}

function fmt(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: 'short' });
}

function pluralDays(n: number): string {
  // 1 день, 2-4 дні, 5+ днів (стандартні українські правила, абс. значення)
  const a = Math.abs(n);
  const last = a % 10;
  const last2 = a % 100;
  if (last2 >= 11 && last2 <= 19) return 'днів';
  if (last === 1) return 'день';
  if (last >= 2 && last <= 4) return 'дні';
  return 'днів';
}

type State = 'completed' | 'current' | 'overdue' | 'upcoming';

function stageState(s: Stage, currentIndex: number, index: number): State {
  if (s.completedAt) return 'completed';
  if (index === currentIndex && s.dueDate && s.dueDate.getTime() < Date.now()) return 'overdue';
  if (index === currentIndex) return 'current';
  // not completed and not current — could be either overdue (past due) or upcoming
  if (s.dueDate && s.dueDate.getTime() < Date.now()) return 'overdue';
  return 'upcoming';
}

/** Public helper for list rows / dashboard cards. */
export function hasOverdueStage(p: {
  techSpecDueDate?: Date | string | null;
  draftDueDate?: Date | string | null;
  feedbackDueDate?: Date | string | null;
  techReviewDueDate?: Date | string | null;
  finalDueDate?: Date | string | null;
  techSpecCompletedAt?: Date | string | null;
  draftCompletedAt?: Date | string | null;
  feedbackCompletedAt?: Date | string | null;
  techReviewCompletedAt?: Date | string | null;
  finalCompletedAt?: Date | string | null;
}): boolean {
  const now = Date.now();
  const pairs: [Date | null, Date | null][] = [
    [toDate(p.techSpecDueDate), toDate(p.techSpecCompletedAt)],
    [toDate(p.draftDueDate), toDate(p.draftCompletedAt)],
    [toDate(p.feedbackDueDate), toDate(p.feedbackCompletedAt)],
    [toDate(p.techReviewDueDate), toDate(p.techReviewCompletedAt)],
    [toDate(p.finalDueDate), toDate(p.finalCompletedAt)],
  ];
  return pairs.some(([due, done]) => !done && due !== null && due.getTime() < now);
}

function toInputDate(d: Date | null): string {
  if (!d) return '';
  // YYYY-MM-DD in local time (the <input type="date"> expects this format)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function StandardProgress(props: StandardProgressProps) {
  const [editing, setEditing] = useState<StageKey | null>(null);
  const [pickedDate, setPickedDate] = useState<string>('');

  function openEditor(stage: StageKey, currentCompletedAt: Date | null) {
    setPickedDate(toInputDate(currentCompletedAt ?? new Date()));
    setEditing(stage);
  }
  function saveEditor(stage: StageKey) {
    if (!props.onConfirm) return;
    const parts = pickedDate.split('-').map((x) => Number(x));
    const yy = parts[0] ?? new Date().getFullYear();
    const mm = parts[1] ?? 1;
    const dd = parts[2] ?? 1;
    const date = pickedDate ? new Date(yy, mm - 1, dd, 12, 0, 0) : new Date();
    props.onConfirm(stage, true, date);
    setEditing(null);
  }
  function clearEditor(stage: StageKey) {
    if (!props.onConfirm) return;
    props.onConfirm(stage, false);
    setEditing(null);
  }

  const stages: Stage[] = STAGE_ORDER.map((key) => ({
    key,
    short: STAGE_LABELS[key].short,
    full: STAGE_LABELS[key].full,
    dueDate: toDate(
      key === 'TECH_SPEC'
        ? props.techSpecDueDate
        : key === 'DRAFTING'
          ? props.draftDueDate
          : key === 'FEEDBACK'
            ? props.feedbackDueDate
            : key === 'TECH_REVIEW'
              ? props.techReviewDueDate
              : props.finalDueDate,
    ),
    completedAt: toDate(
      key === 'TECH_SPEC'
        ? props.techSpecCompletedAt
        : key === 'DRAFTING'
          ? props.draftCompletedAt
          : key === 'FEEDBACK'
            ? props.feedbackCompletedAt
            : key === 'TECH_REVIEW'
              ? props.techReviewCompletedAt
              : props.finalCompletedAt,
    ),
  }));

  // Current = first stage without completedAt
  let currentIndex = stages.findIndex((s) => !s.completedAt);
  if (currentIndex === -1) currentIndex = stages.length; // all done
  const allDone = currentIndex === stages.length;

  if (props.variant === 'compact') {
    // Find the "headline" stage to show under the bar:
    // 1) first OVERDUE stage (most important — show in red)
    // 2) otherwise the current stage
    // 3) if all done — "Усі етапи підтверджено"
    let headlineStage: Stage | null = null;
    let headlineState: State = 'current';
    if (allDone) {
      headlineStage = stages[stages.length - 1] ?? null;
      headlineState = 'completed';
    } else {
      const overdueStage = stages.find((s, i) => stageState(s, currentIndex, i) === 'overdue');
      if (overdueStage) {
        headlineStage = overdueStage;
        headlineState = 'overdue';
      } else {
        headlineStage = stages[currentIndex] ?? null;
        headlineState = 'current';
      }
    }

    return (
      <div className={cn('flex flex-col gap-1', props.className)}>
        <div className="flex items-center gap-1">
          {stages.map((s, i) => {
            const state = stageState(s, currentIndex, i);
            return (
              <div
                key={s.key}
                title={`${i + 1}. ${s.full} — до ${fmt(s.dueDate)}${s.completedAt ? ` ✓ ${fmt(s.completedAt)}` : ''}`}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors',
                  state === 'completed' && 'bg-emerald-500',
                  state === 'current' && 'bg-brand',
                  state === 'overdue' && 'bg-red-500',
                  state === 'upcoming' && 'bg-hairline',
                )}
              />
            );
          })}
        </div>
        {props.showLabel !== false && headlineStage && (
          <p
            className={cn(
              'text-[11px] leading-tight truncate font-medium',
              headlineState === 'overdue'
                ? 'text-red-600 dark:text-red-400 font-semibold'
                : headlineState === 'completed'
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-mid',
            )}
            title={headlineStage.full}
          >
            {allDone ? (
              '✓ Усі етапи підтверджено'
            ) : (
              <>
                {headlineStage.full}
                {headlineStage.dueDate && (
                  <span className="text-light font-normal"> · до {fmt(headlineStage.dueDate)}</span>
                )}
              </>
            )}
          </p>
        )}
      </div>
    );
  }

  // ── Active-segment progress (elapsed days / total days between previous
  //    anchor and the current stage's due date). Used to render a partial
  //    brand-color fill on the connector between dot[currentIndex-1] and
  //    dot[currentIndex], plus a "залишилось N днів" label above it.
  const activeConnectorIdx = currentIndex - 1; // physical connector index that's "active"
  let activePct = 0; // 0..1
  let activeOverdue = false;
  let activeDaysLabel: string | null = null;
  if (!allDone && currentIndex > 0) {
    const prev = stages[currentIndex - 1];
    const curr = stages[currentIndex];
    const prevAnchor = prev?.completedAt ?? prev?.dueDate ?? null;
    const due = curr?.dueDate ?? null;
    if (due) {
      const nowMs = Date.now();
      if (prevAnchor) {
        const total = due.getTime() - prevAnchor.getTime();
        const elapsed = nowMs - prevAnchor.getTime();
        activePct = total > 0 ? Math.max(0, Math.min(1, elapsed / total)) : 1;
      } else {
        activePct = nowMs >= due.getTime() ? 1 : 0;
      }
      const dayMs = 24 * 3600 * 1000;
      const daysRemaining = Math.ceil((due.getTime() - nowMs) / dayMs);
      activeOverdue = daysRemaining < 0;
      activeDaysLabel =
        daysRemaining > 0
          ? `залишилось ${daysRemaining} ${pluralDays(daysRemaining)}`
          : daysRemaining === 0
            ? 'сьогодні термін'
            : `прострочено на ${Math.abs(daysRemaining)} ${pluralDays(Math.abs(daysRemaining))}`;
    }
  }

  function connectorFillPct(half: 'left' | 'right', cellIdx: number): number {
    if (allDone) return 100;
    const physical = half === 'left' ? cellIdx - 1 : cellIdx;
    if (physical < activeConnectorIdx) return 100;
    if (physical === activeConnectorIdx) {
      return half === 'right' ? Math.min(100, activePct * 200) : Math.max(0, activePct * 200 - 100);
    }
    return 0;
  }

  const activeFillCls = activeOverdue ? 'bg-red-500' : 'bg-brand';

  return (
    <div className={cn('w-full pt-5', props.className)}>
      <div className="flex items-start gap-0">
        {stages.map((s, i) => {
          const state = stageState(s, currentIndex, i);
          const isLast = i === stages.length - 1;
          const showOverdue = state === 'overdue';
          // Should THIS cell show the days-left label above its left-half?
          // → only on cell[currentIndex] (the active segment's right end).
          const showActiveLabel = i === currentIndex && currentIndex > 0 && !allDone;
          const leftFillCls =
            i - 1 < activeConnectorIdx || allDone
              ? 'bg-brand'
              : i - 1 === activeConnectorIdx
                ? activeFillCls
                : 'bg-transparent';
          const rightFillCls =
            i < activeConnectorIdx || allDone
              ? 'bg-brand'
              : i === activeConnectorIdx
                ? activeFillCls
                : 'bg-transparent';
          return (
            <div key={s.key} className="flex-1 flex items-start">
              <div className="flex flex-col items-center min-w-0 w-full">
                <div className="relative w-full flex items-center">
                  {/* Days-left label above the active connector — anchored on
                      cell[currentIndex] left side, stretched into prev cell's
                      right half via -left-1/2 so it sits centered between dots. */}
                  {showActiveLabel && activeDaysLabel && (
                    <span
                      className={cn(
                        'absolute -left-1/2 right-1/2 -top-5 text-center text-[10px] font-semibold leading-tight pointer-events-none',
                        activeOverdue ? 'text-red-600 dark:text-red-400' : 'text-brand',
                      )}
                    >
                      {activeDaysLabel}
                    </span>
                  )}
                  {/* Left-half connector (incoming from i-1) */}
                  {i > 0 && (
                    <div className="absolute right-1/2 left-0 top-1/2 -translate-y-1/2 h-[3px] bg-hairline rounded-l-full overflow-hidden">
                      <div
                        className={cn('absolute left-0 top-0 bottom-0 transition-all', leftFillCls)}
                        style={{ width: `${connectorFillPct('left', i)}%` }}
                      />
                    </div>
                  )}
                  <div
                    className={cn(
                      'relative mx-auto flex items-center justify-center rounded-full border-2 z-10',
                      'w-7 h-7 text-[11px] font-bold transition-colors',
                      state === 'completed' && 'bg-emerald-500 border-emerald-500 text-white',
                      state === 'current' && 'bg-brand border-brand text-white',
                      state === 'overdue' && 'bg-red-500 border-red-500 text-white',
                      state === 'upcoming' && 'bg-card border-hairline text-mid',
                    )}
                  >
                    {state === 'completed' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : showOverdue ? (
                      <AlertCircle className="w-3.5 h-3.5" />
                    ) : (
                      i + 1
                    )}
                  </div>
                  {/* Right-half connector (outgoing to i+1) */}
                  {!isLast && (
                    <div className="absolute left-1/2 right-0 top-1/2 -translate-y-1/2 h-[3px] bg-hairline rounded-r-full overflow-hidden">
                      <div
                        className={cn(
                          'absolute left-0 top-0 bottom-0 transition-all',
                          rightFillCls,
                        )}
                        style={{ width: `${connectorFillPct('right', i)}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="mt-2 text-center px-1 min-w-0 w-full">
                  <p
                    className={cn(
                      'text-[11px] font-semibold leading-tight truncate',
                      showOverdue ? 'text-red-600 dark:text-red-400' : 'text-ink',
                    )}
                    title={s.full}
                  >
                    {s.short}
                  </p>
                  <p
                    className={cn(
                      'text-[10px] mt-0.5',
                      showOverdue ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-light',
                    )}
                  >
                    до {fmt(s.dueDate)}
                  </p>
                  {s.completedAt && editing !== s.key && (
                    <p className="text-[10px] mt-0.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                      ✓ {fmt(s.completedAt)}
                    </p>
                  )}
                  {props.onConfirm &&
                    (editing === s.key ? (
                      <div className="mt-1.5 flex flex-col gap-1 items-stretch bg-card border border-hairline rounded-md p-1.5 shadow-md">
                        <input
                          type="date"
                          value={pickedDate}
                          onChange={(e) => setPickedDate(e.target.value)}
                          className="text-[10px] border border-hairline rounded px-1.5 py-0.5 bg-card text-ink w-full"
                          autoFocus
                        />
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => saveEditor(s.key)}
                            disabled={props.isPending}
                            className="flex-1 text-[10px] font-semibold rounded px-1.5 py-0.5 bg-brand text-white hover:opacity-90 disabled:opacity-50"
                          >
                            ✓ ОК
                          </button>
                          {s.completedAt && (
                            <button
                              type="button"
                              onClick={() => clearEditor(s.key)}
                              disabled={props.isPending}
                              title="Зняти підтвердження"
                              className="text-[10px] rounded px-1.5 py-0.5 border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/30 disabled:opacity-50"
                            >
                              ✕
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className="text-[10px] rounded px-1.5 py-0.5 border border-hairline text-mid hover:bg-pill"
                          >
                            ↺
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={props.isPending}
                        onClick={() => openEditor(s.key, s.completedAt)}
                        title={
                          s.completedAt
                            ? 'Змінити дату виконання / зняти підтвердження'
                            : 'Підтвердити виконання — оберіть дату'
                        }
                        className={cn(
                          'mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold rounded px-2 py-0.5 transition-colors border',
                          s.completedAt
                            ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/30'
                            : showOverdue
                              ? 'border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/30'
                              : 'border-hairline text-mid hover:bg-pill',
                          props.isPending && 'opacity-50 cursor-wait',
                        )}
                      >
                        {s.completedAt ? (
                          <>
                            <Pencil className="w-2.5 h-2.5" />
                            Редагувати
                          </>
                        ) : (
                          'Підтвердити'
                        )}
                      </button>
                    ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {allDone && (
        <p className="mt-3 text-center text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          ✓ Усі етапи підтверджено
        </p>
      )}
    </div>
  );
}
