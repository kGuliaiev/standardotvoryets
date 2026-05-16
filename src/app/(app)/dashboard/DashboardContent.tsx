'use client';

import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  BookOpen,
  Hourglass,
  Calendar as CalendarIcon,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { StandardProgress, hasOverdueStage } from '@/components/standards/StandardProgress';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AlertCircle } from 'lucide-react';

const MONTHS_UA_ACC = [
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
const MONTHS_UA_SHORT = [
  'СІЧ',
  'ЛЮТ',
  'БЕР',
  'КВІ',
  'ТРА',
  'ЧЕР',
  'ЛИП',
  'СЕР',
  'ВЕР',
  'ЖОВ',
  'ЛИС',
  'ГРУ',
];

const NOTIF_DOT: Record<string, string> = {
  WG_LEADER: '#1A56DB',
  DOC_UPLOADED: '#D97706',
  VOTE_RESULT: '#059669',
  COMMENT: '#3B82F6',
};

type KpiTone = 'blue' | 'amber' | 'purple' | 'rose';
const KPI_STRIPE: Record<KpiTone, string> = {
  blue: 'bg-brand',
  amber: 'bg-amber-500',
  purple: 'bg-violet-500',
  rose: 'bg-red-500',
};

function KpiCard({
  label,
  value,
  sub,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone: KpiTone;
  icon: LucideIcon;
}) {
  return (
    <div className="relative card p-5 overflow-hidden">
      <span className={`absolute top-0 left-0 right-0 h-[3px] ${KPI_STRIPE[tone]}`} />
      <Icon className="absolute right-3 top-3 w-12 h-12 text-slate-100" />
      <p className="text-[10px] font-bold uppercase tracking-[0.6px] text-light relative">
        {label}
      </p>
      <p className="text-[30px] font-extrabold text-navy mt-1 leading-none relative">{value}</p>
      {sub && <p className="text-[11px] text-light mt-1.5 relative">{sub}</p>}
    </div>
  );
}

export function DashboardContent() {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  const { data: kpis } = trpc.dashboard.kpis.useQuery();
  const { data: upcoming } = trpc.meeting.upcomingForUser.useQuery({ limit: 5 });
  const { data: myTasks } = trpc.task.list.useQuery({ assigneeId: userId }, { enabled: !!userId });
  const { data: notifications } = trpc.notification.list.useQuery({ limit: 5 });
  const { data: standardsData } = trpc.standard.list.useQuery({ page: 1, pageSize: 50 });

  const utils = trpc.useUtils();
  const toggleTask = trpc.task.changeStatus.useMutation({
    onSuccess: () => void utils.task.list.invalidate(),
  });

  const myTasksTop = myTasks?.slice(0, 6) ?? [];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const formatNextMeeting = (date: Date | null) => {
    if (!date) return '—';
    const d = new Date(date);
    return `${d.getDate()} ${MONTHS_UA_ACC[d.getMonth()]}`;
  };

  return (
    <div className="space-y-5 pg-enter">
      {/* Overdue stages banner */}
      {kpis && kpis.standardsOverdueStages > 0 && (
        <Link
          href="/standards"
          className="flex items-center gap-3 rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 px-4 py-3 text-sm text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">
              {kpis.standardsOverdueStages}{' '}
              {kpis.standardsOverdueStages === 1
                ? 'стандарт має прострочений етап'
                : kpis.standardsOverdueStages < 5
                  ? 'стандарти мають прострочений етап'
                  : 'стандартів мають прострочений етап'}
            </p>
            <p className="text-xs opacity-80">
              Секретар або керівник РГ має підтвердити виконання етапу
            </p>
          </div>
          <span className="text-xs font-semibold underline">Перейти →</span>
        </Link>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="АКТИВНИХ СТАНДАРТІВ"
          value={kpis?.standardsActive ?? '…'}
          sub={
            kpis && kpis.standardsNewThisMonth > 0
              ? `+${kpis.standardsNewThisMonth} цього місяця`
              : 'у ваших РГ'
          }
          tone="blue"
          icon={BookOpen}
        />
        <KpiCard
          label="ПРОСТРОЧЕНІ ЕТАПИ"
          value={kpis?.standardsOverdueStages ?? '…'}
          sub={
            (kpis?.standardsOverdueStages ?? 0) > 0
              ? 'Потребують підтвердження'
              : 'Усі етапи у графіку'
          }
          tone="rose"
          icon={AlertTriangle}
        />
        <KpiCard
          label={`ЗАСІДАНЬ У ${MONTHS_UA_SHORT[now.getMonth()]}`}
          value={kpis?.meetingsThisMonth ?? '…'}
          sub={
            kpis?.nextMeetingDate
              ? `Наступне: ${formatNextMeeting(kpis.nextMeetingDate)}`
              : 'Нарад не заплановано'
          }
          tone="purple"
          icon={CalendarIcon}
        />
        <KpiCard
          label="ПРОСТРОЧЕНІ ЗАВДАННЯ"
          value={kpis?.tasksOverdue ?? '…'}
          sub={(kpis?.tasksOverdue ?? 0) > 0 ? 'Потребують уваги' : 'Все під контролем'}
          tone="rose"
          icon={Hourglass}
        />
      </div>

      {/* Two columns — LEFT is wide (tasks + standards statuses), RIGHT is narrow rail (notifications + upcoming meetings) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_316px] gap-5 items-start">
        {/* Left column (wide) */}
        <div className="space-y-5">
          {/* My tasks */}
          <div className="card overflow-hidden">
            <div className="card-head">
              <h2 className="font-bold text-ink">Мої завдання</h2>
              <Link href="/tasks" className="text-xs font-semibold text-brand hover:underline">
                Усі →
              </Link>
            </div>
            {myTasksTop.length === 0 ? (
              <div className="py-10 text-center text-light text-sm">Завдань немає</div>
            ) : (
              <ul className="divide-y divide-hairline">
                {myTasksTop.map((t) => {
                  const isDone = t.status === 'DONE';
                  const due = t.dueDate ? new Date(t.dueDate) : null;
                  const dueStart = due
                    ? new Date(due.getFullYear(), due.getMonth(), due.getDate())
                    : null;
                  const isOverdue = !isDone && !!dueStart && dueStart < todayStart;
                  const isToday = !isDone && dueStart?.getTime() === todayStart.getTime();
                  return (
                    <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                      <button
                        onClick={() =>
                          toggleTask.mutate({ id: t.id, status: isDone ? 'OPEN' : 'DONE' })
                        }
                        className={`w-[18px] h-[18px] rounded-md border-[1.5px] inline-flex items-center justify-center transition shrink-0 ${
                          isDone
                            ? 'bg-emerald-500 border-emerald-500'
                            : 'border-hairline hover:border-brand'
                        }`}
                        aria-label={isDone ? 'Відновити' : 'Виконати'}
                      >
                        {isDone && (
                          <svg
                            viewBox="0 0 12 12"
                            className="w-3 h-3 fill-none stroke-white stroke-[2.5]"
                          >
                            <path
                              d="M2.5 6.5 5 9l4.5-5.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </button>
                      <span
                        className={`flex-1 text-sm truncate ${
                          isDone ? 'text-light line-through' : 'text-ink'
                        }`}
                      >
                        {t.title}
                      </span>
                      {isOverdue ? (
                        <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-[#FEF2F2] text-[#991B1B]">
                          Прострочено
                        </span>
                      ) : isToday ? (
                        <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-[#FEF2F2] text-[#DC2626]">
                          Сьогодні
                        </span>
                      ) : due ? (
                        <span className="text-[11px] text-light font-mono">
                          {due.getDate()} {(MONTHS_UA_SHORT[due.getMonth()] ?? '').toLowerCase()}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Standards statuses — wide table identical to /standards */}
          <div className="card overflow-hidden">
            <div className="card-head">
              <h2 className="font-bold text-ink">Статуси стандартів</h2>
              <Link href="/standards" className="text-xs font-semibold text-brand hover:underline">
                Усі →
              </Link>
            </div>
            {!standardsData || standardsData.items.length === 0 ? (
              <div className="py-10 text-center text-light text-sm">Стандартів немає</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-page border-b border-hairline">
                  <tr className="text-left text-xs text-mid uppercase tracking-wide">
                    <th className="px-5 py-3 font-medium">Код / Назва</th>
                    <th className="px-3 py-3 font-medium">РГ</th>
                    <th className="px-3 py-3 font-medium">Статус</th>
                    <th className="px-3 py-3 font-medium">Етапи</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {standardsData.items.map((s) => {
                    const overdue = hasOverdueStage(s);
                    return (
                      <tr key={s.id} className="hover:bg-page transition-colors group">
                        <td className="px-5 py-3 max-w-xs">
                          <Link href={`/standards/${s.id}`} className="block">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs text-light group-hover:text-brand transition-colors">
                                {s.code}
                              </span>
                              {overdue && (
                                <span
                                  title="Є прострочений етап без підтвердження"
                                  className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400 text-[10px] font-bold bg-red-50 dark:bg-red-900/30 rounded px-1 py-0.5"
                                >
                                  <AlertCircle className="w-3 h-3" /> прострочка
                                </span>
                              )}
                            </div>
                            <p className="font-medium text-ink text-sm mt-0.5 line-clamp-1">
                              {s.title}
                            </p>
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <span className="flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: s.workingGroup.color }}
                            />
                            <span className="text-xs text-mid font-medium">
                              {s.workingGroup.code}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={s.status} size="sm" />
                        </td>
                        <td className="px-3 py-3 w-[200px]">
                          <StandardProgress
                            variant="compact"
                            techSpecDueDate={s.techSpecDueDate}
                            draftDueDate={s.draftDueDate}
                            feedbackDueDate={s.feedbackDueDate}
                            techReviewDueDate={s.techReviewDueDate}
                            finalDueDate={s.finalDueDate}
                            techSpecCompletedAt={s.techSpecCompletedAt}
                            draftCompletedAt={s.draftCompletedAt}
                            feedbackCompletedAt={s.feedbackCompletedAt}
                            techReviewCompletedAt={s.techReviewCompletedAt}
                            finalCompletedAt={s.finalCompletedAt}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Notifications */}
          <div className="card overflow-hidden">
            <div className="card-head">
              <h2 className="font-bold text-ink">Сповіщення</h2>
              <Link
                href="/notifications"
                className="text-xs font-semibold text-brand hover:underline"
              >
                Усі →
              </Link>
            </div>
            {!notifications || notifications.length === 0 ? (
              <div className="py-10 text-center text-light text-sm">Сповіщень немає</div>
            ) : (
              <ul className="divide-y divide-hairline">
                {notifications.map((n) => (
                  <li key={n.id} className="flex items-start gap-3 px-5 py-3">
                    <span
                      className="w-1.5 h-1.5 rounded-full mt-2 shrink-0"
                      style={{ backgroundColor: NOTIF_DOT[n.type] ?? '#94A3B8' }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-ink leading-snug">{n.title}</p>
                      <p className="text-[10px] text-light mt-1">{formatDate(n.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Upcoming meetings (was on the left, now in the right rail) */}
          <div className="card overflow-hidden">
            <div className="card-head">
              <h2 className="font-bold text-ink">Найближчі засідання</h2>
              <Link
                href="/meetings/new"
                className="text-xs font-semibold text-brand hover:underline"
              >
                + Додати
              </Link>
            </div>
            {!upcoming || upcoming.length === 0 ? (
              <div className="py-10 text-center text-light text-sm">Засідань не заплановано</div>
            ) : (
              <ul className="divide-y divide-hairline">
                {upcoming.map((m) => {
                  const d = new Date(m.startAt);
                  return (
                    <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                      <div
                        className="w-11 h-11 rounded-[10px] flex flex-col items-center justify-center text-white shrink-0"
                        style={{ backgroundColor: m.workingGroup.color }}
                      >
                        <span className="text-[15px] font-extrabold leading-none">
                          {d.getDate()}
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">
                          {MONTHS_UA_SHORT[d.getMonth()]}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/meetings/${m.id}`}
                          className="text-[13px] font-semibold text-ink hover:text-brand block truncate"
                        >
                          {m.title}
                        </Link>
                        <p className="text-[10px] text-light mt-0.5">
                          {d.toLocaleTimeString('uk-UA', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {' · '}
                          {m.workingGroup.code}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
