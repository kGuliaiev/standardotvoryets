/**
 * Visual stepper for the 5 stages of the Програма стандартизації plan.
 *
 * Variants:
 *   - "full" (default): wide horizontal stepper with stage names + due dates,
 *     suitable for the standard detail page.
 *   - "compact": a thin progress bar with 5 dots, suitable for a list row.
 *
 * State per stage:
 *   - completed: stage is finished (✓ check, green bar)
 *   - current:   stage is in progress (filled dot, brand color)
 *   - overdue:   stage is current and its due date has passed (red)
 *   - upcoming:  not yet reached (gray dot, gray bar)
 */
import type { StandardStage } from '@prisma/client';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StandardProgressProps {
  currentStage: StandardStage;
  techSpecDueDate?: Date | string | null;
  draftDueDate?: Date | string | null;
  feedbackDueDate?: Date | string | null;
  techReviewDueDate?: Date | string | null;
  finalDueDate?: Date | string | null;
  variant?: 'full' | 'compact';
  className?: string;
}

interface Stage {
  key: Exclude<StandardStage, 'COMPLETED'>;
  short: string;
  full: string;
  dueDate: Date | null;
}

const STAGE_ORDER: Exclude<StandardStage, 'COMPLETED'>[] = [
  'TECH_SPEC',
  'DRAFTING',
  'FEEDBACK',
  'TECH_REVIEW',
  'FINALIZATION',
];

const STAGE_LABELS: Record<Exclude<StandardStage, 'COMPLETED'>, { short: string; full: string }> = {
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

function stageState(
  index: number,
  currentIndex: number,
  isCompletedAll: boolean,
  dueDate: Date | null,
): 'completed' | 'current' | 'overdue' | 'upcoming' {
  if (isCompletedAll || index < currentIndex) return 'completed';
  if (index > currentIndex) return 'upcoming';
  // index === currentIndex
  if (dueDate && dueDate.getTime() < Date.now()) return 'overdue';
  return 'current';
}

export function StandardProgress({
  currentStage,
  techSpecDueDate,
  draftDueDate,
  feedbackDueDate,
  techReviewDueDate,
  finalDueDate,
  variant = 'full',
  className,
}: StandardProgressProps) {
  const stages: Stage[] = STAGE_ORDER.map((key) => ({
    key,
    short: STAGE_LABELS[key].short,
    full: STAGE_LABELS[key].full,
    dueDate: toDate(
      key === 'TECH_SPEC'
        ? techSpecDueDate
        : key === 'DRAFTING'
          ? draftDueDate
          : key === 'FEEDBACK'
            ? feedbackDueDate
            : key === 'TECH_REVIEW'
              ? techReviewDueDate
              : finalDueDate,
    ),
  }));

  const isCompletedAll = currentStage === 'COMPLETED';
  const currentIndex = isCompletedAll ? stages.length : STAGE_ORDER.indexOf(currentStage);

  if (variant === 'compact') {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        {stages.map((s, i) => {
          const state = stageState(i, currentIndex, isCompletedAll, s.dueDate);
          return (
            <div
              key={s.key}
              title={`${i + 1}. ${s.full} — ${fmt(s.dueDate)}`}
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

  // Full variant — labelled stepper
  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-start gap-0">
        {stages.map((s, i) => {
          const state = stageState(i, currentIndex, isCompletedAll, s.dueDate);
          const isLast = i === stages.length - 1;
          return (
            <div key={s.key} className="flex-1 flex items-start">
              {/* Dot + label column */}
              <div className="flex flex-col items-center min-w-0 w-full">
                <div className="relative w-full flex items-center">
                  {/* connector before this dot — hidden for first */}
                  {i > 0 && (
                    <div
                      className={cn(
                        'absolute right-1/2 left-0 top-1/2 -translate-y-1/2 h-[3px]',
                        state === 'completed' || state === 'current' || state === 'overdue'
                          ? 'bg-brand'
                          : 'bg-hairline',
                      )}
                    />
                  )}
                  {/* dot */}
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
                    {state === 'completed' ? <Check className="w-3.5 h-3.5" /> : i + 1}
                  </div>
                  {/* connector after this dot — hidden for last */}
                  {!isLast && (
                    <div
                      className={cn(
                        'absolute left-1/2 right-0 top-1/2 -translate-y-1/2 h-[3px]',
                        i < currentIndex || isCompletedAll ? 'bg-brand' : 'bg-hairline',
                      )}
                    />
                  )}
                </div>
                {/* labels */}
                <div className="mt-2 text-center px-1 min-w-0 w-full">
                  <p
                    className={cn(
                      'text-[11px] font-semibold leading-tight truncate',
                      state === 'overdue' ? 'text-red-600 dark:text-red-400' : 'text-ink',
                    )}
                    title={s.full}
                  >
                    {s.short}
                  </p>
                  <p
                    className={cn(
                      'text-[10px] mt-0.5',
                      state === 'overdue'
                        ? 'text-red-600 dark:text-red-400 font-semibold'
                        : 'text-light',
                    )}
                  >
                    до {fmt(s.dueDate)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {isCompletedAll && (
        <p className="mt-3 text-center text-xs font-semibold text-emerald-600 dark:text-emerald-400">
          ✓ Стандарт завершено
        </p>
      )}
    </div>
  );
}
