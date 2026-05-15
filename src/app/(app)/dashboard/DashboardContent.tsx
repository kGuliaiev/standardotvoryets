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
  const { data: wgStats } = trpc.workingGroup.stats.useQuery({});
  const { data: upcoming } = trpc.meeting.upcomingForUser.useQuery({ limit: 5 });
  const { data: myTasks } = trpc.task.list.useQuery({ assigneeId: userId }, { enabled: !!userId });
  const { data: notifications } = trpc.notification.list.useQuery({ limit: 5 });

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
          label="НА РОЗГЛЯДІ"
          value={kpis?.standardsInReview ?? '…'}
          sub="Очікують голосування"
          tone="amber"
          icon={Hourglass}
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
          icon={AlertTriangle}
        />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_316px] gap-5 items-start">
        {/* Left column */}
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

          {/* Upcoming meetings */}
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
                    <li key={m.id} className="flex items-center gap-4 px-5 py-3.5">
                      <div
                        className="w-12 h-12 rounded-[10px] flex flex-col items-center justify-center text-white shrink-0"
                        style={{ backgroundColor: m.workingGroup.color }}
                      >
                        <span className="text-[16px] font-extrabold leading-none">
                          {d.getDate()}
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">
                          {MONTHS_UA_SHORT[d.getMonth()]}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/meetings/${m.id}`}
                          className="font-semibold text-ink hover:text-brand block truncate"
                        >
                          {m.title}
                        </Link>
                        <p className="text-[11px] text-light mt-0.5">
                          {d.toLocaleTimeString('uk-UA', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {' · '}
                          {m.format === 'ONLINE'
                            ? 'Онлайн'
                            : m.format === 'OFFLINE'
                              ? 'Офлайн'
                              : 'Гібрид'}
                          {' · '}
                          {m.workingGroup.code}
                        </p>
                      </div>
                      <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-[#EEF4FF] text-[#1A3A8F] shrink-0">
                        {m.status === 'PLANNED'
                          ? 'Підготовка'
                          : m.status === 'IN_PROGRESS'
                            ? 'Триває'
                            : 'Завершено'}
                      </span>
                    </li>
                  );
                })}
              </ul>
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

          {/* Meetings by RG */}
          <div className="card overflow-hidden">
            <div className="card-head">
              <h2 className="font-bold text-ink">Засідання по РГ</h2>
              <Link href="/meetings" className="text-xs font-semibold text-brand hover:underline">
                Календар →
              </Link>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-[#FAFBFD]">
                <tr className="text-left text-[10px] text-light uppercase tracking-wide">
                  <th className="px-4 py-2.5 font-bold">Група</th>
                  <th className="px-2 py-2.5 font-bold text-center">Запл.</th>
                  <th className="px-2 py-2.5 font-bold text-center">Провед.</th>
                  <th className="px-4 py-2.5 font-bold w-24">Виконання</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {(wgStats ?? []).map((g) => {
                  const total = g.meetingsPlanned + g.meetingsDone;
                  const pct = total > 0 ? Math.round((g.meetingsDone / total) * 100) : 0;
                  return (
                    <tr key={g.id}>
                      <td className="px-4 py-2.5">
                        <div className="inline-flex items-center gap-1.5">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: g.color }}
                          />
                          <span className="font-mono text-[11px] font-bold text-ink">{g.code}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-center font-bold text-ink">
                        {g.meetingsPlanned + g.meetingsDone}
                      </td>
                      <td className="px-2 py-2.5 text-center font-bold text-ink">
                        {g.meetingsDone}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-hairline rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: g.color,
                              }}
                            />
                          </div>
                          <span className="text-[10px] font-bold text-mid w-7 text-right">
                            {pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
