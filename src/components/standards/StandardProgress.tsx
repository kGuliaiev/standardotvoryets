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
 *     when an onConfirm callback is passed, each stage gets a tiny toggle
 *     button (Підтвердити / Скасувати) for secretary / leader / admin.
 *   - "compact": thin 5-segment bar for table rows.
 */
import { Check, AlertCircle } from 'lucide-react';
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
  onConfirm?: (stage: StageKey, confirmed: boolean) => void;
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

export function StandardProgress(props: StandardProgressProps) {
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
    return (
      <div className={cn('flex items-center gap-1', props.className)}>
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
    );
  }

  return (
    <div className={cn('w-full', props.className)}>
      <div className="flex items-start gap-0">
        {stages.map((s, i) => {
          const state = stageState(s, currentIndex, i);
          const isLast = i === stages.length - 1;
          const showOverdue = state === 'overdue';
          return (
            <div key={s.key} className="flex-1 flex items-start">
              <div className="flex flex-col items-center min-w-0 w-full">
                <div className="relative w-full flex items-center">
                  {i > 0 && (
                    <div
                      className={cn(
                        'absolute right-1/2 left-0 top-1/2 -translate-y-1/2 h-[3px]',
                        i <= currentIndex || allDone ? 'bg-brand' : 'bg-hairline',
                      )}
                    />
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
                  {!isLast && (
                    <div
                      className={cn(
                        'absolute left-1/2 right-0 top-1/2 -translate-y-1/2 h-[3px]',
                        i < currentIndex || allDone ? 'bg-brand' : 'bg-hairline',
                      )}
                    />
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
                  {s.completedAt && (
                    <p className="text-[10px] mt-0.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                      ✓ {fmt(s.completedAt)}
                    </p>
                  )}
                  {props.onConfirm && (
                    <button
                      type="button"
                      disabled={props.isPending}
                      onClick={() => props.onConfirm?.(s.key, !s.completedAt)}
                      className={cn(
                        'mt-1.5 text-[10px] font-semibold rounded px-2 py-0.5 transition-colors border',
                        s.completedAt
                          ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/30'
                          : showOverdue
                            ? 'border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/30'
                            : 'border-hairline text-mid hover:bg-pill',
                        props.isPending && 'opacity-50 cursor-wait',
                      )}
                    >
                      {s.completedAt ? 'Скасувати' : 'Підтвердити'}
                    </button>
                  )}
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
