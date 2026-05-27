'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { can } from '@/lib/rbac';
import { useLocalStorageState } from '@/lib/useLocalStorageState';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';

const MONTHS_UA_NOM = [
  'Січень',
  'Лютий',
  'Березень',
  'Квітень',
  'Травень',
  'Червень',
  'Липень',
  'Серпень',
  'Вересень',
  'Жовтень',
  'Листопад',
  'Грудень',
];

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

const DOW_UA = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'НД'];

const FORMAT_LABELS: Record<string, string> = {
  ONLINE: 'Онлайн',
  OFFLINE: 'Офлайн',
  HYBRID: 'Гібрид',
};

const STATUS_TONE: Record<string, { label: string; cls: string }> = {
  PLANNED: { label: 'Підготовка', cls: 'bg-[#EEF4FF] text-[#1A3A8F]' },
  IN_PROGRESS: {
    label: 'Триває',
    cls: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  },
  COMPLETED: { label: 'Завершено', cls: 'bg-[#ECFDF5] text-[#065F46]' },
  CANCELLED: { label: 'Скасовано', cls: 'bg-pill text-light' },
};

type AttStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED';

interface MeetingItem {
  id: string;
  title: string;
  startAt: string | Date;
  durationMins: number;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  format: 'ONLINE' | 'OFFLINE' | 'HYBRID';
  location: string | null;
  workingGroup: { id: string; code: string; name?: string; color: string };
  attendances?: { status: AttStatus }[];
  _count?: { attendances: number };
}

function attCounts(m: MeetingItem) {
  const list = m.attendances ?? [];
  const total = m._count?.attendances ?? list.length;
  let confirmed = 0;
  let declined = 0;
  let pending = 0;
  for (const a of list) {
    if (a.status === 'CONFIRMED') confirmed += 1;
    else if (a.status === 'DECLINED') declined += 1;
    else pending += 1;
  }
  return { total, confirmed, declined, pending };
}

function buildMonthGrid(year: number, month: number) {
  // month is 0-based. Build a 6×7 grid that starts on Monday.
  const first = new Date(year, month, 1);
  // 0=Sun..6=Sat → convert to Mon-based: 0=Mon..6=Sun
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  const grid: Date[] = [];
  for (let i = 0; i < 42; i++) {
    grid.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }
  return grid;
}

function keyForDate(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Local "YYYY-MM-DDTHH:mm" value for a datetime-local input / ?start= param. */
function toLocalDTValue(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Week-grid bounds: 08:00–18:00 in 30-minute slots.
const WV_START_HOUR = 8;
const WV_END_HOUR = 18;
const WV_SLOT_MIN = 30;
const WV_SLOT_PX = 28;
const WV_TOTAL_SLOTS = ((WV_END_HOUR - WV_START_HOUR) * 60) / WV_SLOT_MIN;
const WV_GRID_HEIGHT = WV_TOTAL_SLOTS * WV_SLOT_PX;

/** Monday (00:00) of the week containing `d`. */
function startOfWeekMonday(d: Date): Date {
  const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
}

/** Human label for the Mon–Sun week containing `d`, e.g. "25–31 трав. 2026",
 *  "28 квіт. – 4 трав. 2026", or "29 груд. 2025 – 4 січ. 2026". */
function formatWeekRange(d: Date): string {
  const mon = startOfWeekMonday(d);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  const dm = (x: Date) => x.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
  const dmy = (x: Date) =>
    x.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });
  if (mon.getMonth() === sun.getMonth() && mon.getFullYear() === sun.getFullYear()) {
    return `${mon.getDate()}–${sun.getDate()} ${sun.toLocaleDateString('uk-UA', { month: 'short' })} ${sun.getFullYear()}`;
  }
  if (mon.getFullYear() === sun.getFullYear()) {
    return `${dm(mon)} – ${dm(sun)} ${sun.getFullYear()}`;
  }
  return `${dmy(mon)} – ${dmy(sun)}`;
}

export function MeetingsList() {
  const { data: session } = useSession();
  const router = useRouter();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  // Remember the chosen view per user (persists across navigation + reopen).
  const [view, setView] = useLocalStorageState<'month' | 'week' | 'list'>(
    'meetings.view.v1',
    'month',
  );
  const [wgFilter, setWgFilter] = useState('');
  const [selectedDayKey, setSelectedDayKey] = useState<string>(keyForDate(now));

  const { data: groups } = trpc.workingGroup.list.useQuery();
  const { data: meetings, isLoading } = trpc.meeting.list.useQuery({
    workingGroupId: wgFilter || undefined,
    month: month + 1,
    year,
  });

  const userCtx = useMemo(
    () =>
      session
        ? {
            globalRole: session.user.globalRole as GlobalRole,
            memberships: (session.user.memberships ?? []) as {
              workingGroupId: string;
              role: WorkingGroupRole;
            }[],
          }
        : null,
    [session],
  );

  const canCreateAny =
    !!userCtx &&
    (userCtx.globalRole === 'ADMIN' ||
      (groups ?? []).some((g) => can(userCtx, 'meeting:create', g.id)));

  // Open the create form prefilled with a date/time (calendar click → create).
  const goCreate = (date: Date) =>
    router.push(`/meetings/new?start=${toLocalDTValue(date)}&duration=60`);

  // Group meetings by date key
  const byDay = useMemo(() => {
    const map = new Map<string, MeetingItem[]>();
    (meetings ?? []).forEach((m) => {
      const d = new Date(m.startAt);
      const k = keyForDate(d);
      const arr = map.get(k) ?? [];
      arr.push(m);
      map.set(k, arr);
    });
    return map;
  }, [meetings]);

  // Per-RG summary for current month
  const rgSummary = useMemo(() => {
    const summary: Record<
      string,
      { id: string; code: string; color: string; planned: number; done: number }
    > = {};
    (meetings ?? []).forEach((m) => {
      const k = m.workingGroup.id;
      summary[k] ??= {
        id: m.workingGroup.id,
        code: m.workingGroup.code,
        color: m.workingGroup.color,
        planned: 0,
        done: 0,
      };
      if (m.status === 'COMPLETED') summary[k].done += 1;
      else if (m.status !== 'CANCELLED') summary[k].planned += 1;
    });
    return Object.values(summary).sort((a, b) => a.code.localeCompare(b.code));
  }, [meetings]);

  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const todayKey = keyForDate(now);
  const selectedDayMeetings = byDay.get(selectedDayKey) ?? [];
  const selectedDate = useMemo(() => {
    const [y, m, d] = selectedDayKey.split('-').map(Number);
    return new Date(y ?? year, m ?? month, d ?? 1);
  }, [selectedDayKey, year, month]);

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  }
  // Week navigation: shift the visible week by ±7 days. Keep month/year (used by
  // the meeting.list query + RG summary) synced to the new week's Thursday — the
  // month an ISO week mostly belongs to — so the data follows the week.
  function shiftWeek(dir: number) {
    const base = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate() + dir * 7,
    );
    setSelectedDayKey(keyForDate(base));
    const mon = startOfWeekMonday(base);
    const thursday = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 3);
    setMonth(thursday.getMonth());
    setYear(thursday.getFullYear());
  }
  function goPrev() {
    if (view === 'week') shiftWeek(-1);
    else prevMonth();
  }
  function goNext() {
    if (view === 'week') shiftWeek(1);
    else nextMonth();
  }
  const periodLabel =
    view === 'week' ? formatWeekRange(selectedDate) : `${MONTHS_UA_NOM[month]} ${year}`;

  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  }

  return (
    <div className="space-y-5 pg-enter">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-[19px] font-extrabold text-navy">Календар засідань</h1>
        <div className="flex items-center gap-4 flex-wrap">
          {/* RG legend */}
          {groups && groups.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap text-[11px]">
              {groups.slice(0, 6).map((g) => (
                <button
                  key={g.id}
                  onClick={() => setWgFilter((prev) => (prev === g.id ? '' : g.id))}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full transition ${
                    wgFilter === g.id
                      ? 'bg-pill text-ink ring-1 ring-mid'
                      : 'text-mid hover:bg-pill'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: g.color }} />
                  {g.code}
                </button>
              ))}
            </div>
          )}
          {canCreateAny && (
            <Link href="/meetings/new" className="btn-add inline-flex">
              <Plus className="w-3.5 h-3.5" />
              Засідання
            </Link>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="card p-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={goPrev}
            className="w-8 h-8 rounded-[10px] inline-flex items-center justify-center text-mid hover:bg-pill"
            aria-label={view === 'week' ? 'Попередній тиждень' : 'Попередній місяць'}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[15px] font-bold text-navy min-w-[190px] text-center">
            {periodLabel}
          </span>
          <button
            onClick={goNext}
            className="w-8 h-8 rounded-[10px] inline-flex items-center justify-center text-mid hover:bg-pill"
            aria-label={view === 'week' ? 'Наступний тиждень' : 'Наступний місяць'}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setMonth(now.getMonth());
              setYear(now.getFullYear());
              setSelectedDayKey(todayKey);
            }}
            className="ml-2 text-xs text-mid hover:text-ink underline underline-offset-2"
          >
            Сьогодні
          </button>
        </div>

        {/* View toggle */}
        <div className="inline-flex rounded-[10px] border border-hairline p-0.5 bg-page">
          {(
            [
              ['month', 'Місяць'],
              ['week', 'Тиждень'],
              ['list', 'Список'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => {
                // When entering week view, make sure the visible week sits in the
                // month being browsed (otherwise today's week could show while the
                // toolbar/data point at a different month).
                if (
                  v === 'week' &&
                  (selectedDate.getMonth() !== month || selectedDate.getFullYear() !== year)
                ) {
                  setSelectedDayKey(keyForDate(new Date(year, month, 15)));
                }
                setView(v);
              }}
              className={`px-3 py-1 text-xs font-semibold rounded-[8px] transition-colors ${
                view === v ? 'bg-card text-ink shadow-sm' : 'text-mid hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_316px] gap-5 items-start">
        {/* Main view */}
        <div className="card overflow-hidden">
          {view === 'month' && (
            <>
              <div className="grid grid-cols-7 bg-page border-b border-hairline">
                {DOW_UA.map((d, i) => (
                  <div
                    key={d}
                    className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider ${
                      i >= 5 ? 'text-red-500/70' : 'text-light'
                    }`}
                  >
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {grid.map((d) => {
                  const k = keyForDate(d);
                  const isCurrentMonth = d.getMonth() === month;
                  const isToday = k === todayKey;
                  const isSelected = k === selectedDayKey;
                  const dayMeetings = byDay.get(k) ?? [];
                  return (
                    <button
                      key={k}
                      onClick={() => {
                        setSelectedDayKey(k);
                        // Click an empty day → create a meeting on it (10:00 default).
                        if (canCreateAny) {
                          goCreate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0));
                        }
                      }}
                      title={canCreateAny ? 'Створити засідання на цей день' : undefined}
                      className={`min-h-[88px] border-t border-l border-hairline -ml-px -mt-px text-left p-1.5 align-top flex flex-col gap-1 transition-colors ${
                        isCurrentMonth ? 'bg-card' : 'bg-page'
                      } ${isSelected ? 'ring-2 ring-brand-soft ring-inset' : ''} hover:bg-brand-soft/30`}
                    >
                      <span
                        className={`text-[12px] font-bold ${
                          isToday
                            ? 'bg-brand text-white rounded-full w-6 h-6 inline-flex items-center justify-center self-start'
                            : isCurrentMonth
                              ? 'text-ink'
                              : 'text-light'
                        }`}
                      >
                        {d.getDate()}
                      </span>
                      <div className="space-y-0.5">
                        {dayMeetings.slice(0, 3).map((m) => {
                          const start = new Date(m.startAt);
                          return (
                            <Link
                              key={m.id}
                              href={`/meetings/${m.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="block text-[10px] leading-tight rounded px-1.5 py-0.5 truncate"
                              style={{
                                backgroundColor: m.workingGroup.color + '22',
                                color: m.workingGroup.color,
                                fontWeight: 600,
                              }}
                            >
                              {String(start.getHours()).padStart(2, '0')}:
                              {String(start.getMinutes()).padStart(2, '0')} {m.workingGroup.code}
                            </Link>
                          );
                        })}
                        {dayMeetings.length > 3 && (
                          <div className="text-[9px] text-light px-1.5">
                            +{dayMeetings.length - 3} ще
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {view === 'week' && (
            <WeekView
              currentDate={selectedDate}
              meetings={meetings ?? []}
              onSelectDay={(k) => setSelectedDayKey(k)}
              selectedKey={selectedDayKey}
              todayKey={todayKey}
              canCreate={canCreateAny}
              onCreateAt={goCreate}
            />
          )}

          {view === 'list' && (
            <>
              {isLoading ? (
                <div className="py-12 text-center text-light text-sm">Завантаження…</div>
              ) : !meetings || meetings.length === 0 ? (
                <div className="py-12 text-center text-light text-sm">
                  Засідань у цьому місяці немає
                </div>
              ) : (
                <ul className="divide-y divide-hairline">
                  {meetings.map((m) => {
                    const d = new Date(m.startAt);
                    const s = STATUS_TONE[m.status] ?? { label: m.status, cls: '' };
                    const att = attCounts(m);
                    return (
                      <li
                        key={m.id}
                        className="flex items-center gap-4 px-5 py-3.5 hover:bg-pill/40 transition-colors"
                      >
                        <div
                          className="w-12 h-12 rounded-[10px] flex flex-col items-center justify-center text-white shrink-0"
                          style={{ backgroundColor: m.workingGroup.color }}
                        >
                          <span className="text-[15px] font-extrabold leading-none">
                            {d.getDate()}
                          </span>
                          <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">
                            {(MONTHS_UA_NOM[d.getMonth()] ?? '').slice(0, 3).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5 shrink-0"
                              style={{
                                backgroundColor: m.workingGroup.color + '22',
                                color: m.workingGroup.color,
                              }}
                              title={m.workingGroup.name ?? m.workingGroup.code}
                            >
                              <span
                                className="w-1 h-1 rounded-full"
                                style={{ backgroundColor: m.workingGroup.color }}
                              />
                              {m.workingGroup.code}
                            </span>
                            <Link
                              href={`/meetings/${m.id}`}
                              className="font-semibold text-ink hover:text-brand truncate min-w-0"
                            >
                              {m.title}
                            </Link>
                          </div>
                          <p className="text-[11px] text-light">
                            {d.toLocaleTimeString('uk-UA', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            {' · '}
                            {FORMAT_LABELS[m.format] ?? m.format}
                            {m.location ? ` · ${m.location}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <AttendanceChips att={att} />
                          <span
                            className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${s.cls}`}
                          >
                            {s.label}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          {/* Monthly summary per RG */}
          <div className="card overflow-hidden">
            <div className="card-head">
              <h2 className="font-bold text-ink">
                {MONTHS_UA_NOM[month]} {year} — підсумок
              </h2>
            </div>
            {rgSummary.length === 0 ? (
              <div className="py-8 text-center text-light text-sm">Засідань немає</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-page">
                  <tr className="text-left text-[10px] text-light uppercase tracking-wide">
                    <th className="px-4 py-2.5 font-bold">Група</th>
                    <th className="px-2 py-2.5 font-bold text-center">Заплан.</th>
                    <th className="px-4 py-2.5 font-bold text-center">Проведено</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {rgSummary.map((r) => {
                    const total = r.planned + r.done;
                    // Green when every meeting is conducted, red while some
                    // remain; neutral if there are no active meetings.
                    const doneCls =
                      total === 0
                        ? 'text-light'
                        : r.done === total
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400';
                    return (
                      <tr key={r.id}>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: r.color }}
                            />
                            <span className="font-mono text-[11px] font-bold text-ink">
                              {r.code}
                            </span>
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-center font-bold text-ink">{total}</td>
                        <td className={`px-4 py-2.5 text-center font-bold ${doneCls}`}>
                          {r.done} / {total}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Day detail */}
          <div className="card overflow-hidden">
            <div className="card-head">
              <h2 className="font-bold text-ink">
                {selectedDate.getDate()} {MONTHS_UA_ACC[selectedDate.getMonth()]} — засідання
              </h2>
            </div>
            {selectedDayMeetings.length === 0 ? (
              <div className="py-8 text-center text-light text-sm">Засідань цього дня немає</div>
            ) : (
              <ul className="divide-y divide-hairline">
                {selectedDayMeetings.map((m) => {
                  const d = new Date(m.startAt);
                  const att = attCounts(m);
                  return (
                    <li key={m.id} className="px-5 py-3">
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <span className="font-mono text-[13px] font-bold text-brand">
                          {String(d.getHours()).padStart(2, '0')}:
                          {String(d.getMinutes()).padStart(2, '0')}
                        </span>
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5"
                          style={{
                            backgroundColor: m.workingGroup.color + '22',
                            color: m.workingGroup.color,
                          }}
                        >
                          <span
                            className="w-1 h-1 rounded-full"
                            style={{ backgroundColor: m.workingGroup.color }}
                          />
                          {m.workingGroup.code}
                        </span>
                      </div>
                      <Link
                        href={`/meetings/${m.id}`}
                        className="block text-[13px] font-semibold text-ink hover:text-brand leading-snug"
                      >
                        {m.title}
                      </Link>
                      <div className="flex items-center justify-between gap-3 mt-1">
                        <p className="text-[11px] text-light truncate min-w-0">
                          {m.location ?? FORMAT_LABELS[m.format] ?? m.format}
                        </p>
                        <AttendanceChips att={att} />
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

function AttendanceChips({
  att,
}: {
  att: { total: number; confirmed: number; declined: number; pending: number };
}) {
  if (att.total === 0) {
    return <span className="text-[10px] text-light">—</span>;
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold tabular-nums"
      title={`Підтвердили: ${att.confirmed} · Відмовили: ${att.declined} · Очікують: ${att.pending}`}
    >
      <span className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        {att.confirmed}
      </span>
      <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        {att.declined}
      </span>
      <span className="inline-flex items-center gap-0.5 text-light">
        <span className="w-1.5 h-1.5 rounded-full bg-light" />
        {att.pending}
      </span>
      <span className="text-light ml-0.5">/{att.total}</span>
    </span>
  );
}

function WeekView({
  currentDate,
  meetings,
  onSelectDay,
  selectedKey,
  todayKey,
  canCreate,
  onCreateAt,
}: {
  currentDate: Date;
  meetings: MeetingItem[];
  onSelectDay: (k: string) => void;
  selectedKey: string;
  todayKey: string;
  canCreate: boolean;
  onCreateAt: (date: Date) => void;
}) {
  // 7 days starting Mon of the current week.
  const dow = (currentDate.getDay() + 6) % 7;
  const monday = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate() - dow,
  );
  const days = Array.from(
    { length: 7 },
    (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i),
  );
  const byDay = new Map<string, MeetingItem[]>();
  meetings.forEach((m) => {
    const k = keyForDate(new Date(m.startAt));
    const arr = byDay.get(k) ?? [];
    arr.push(m);
    byDay.set(k, arr);
  });

  const hourLabels = Array.from(
    { length: WV_END_HOUR - WV_START_HOUR + 1 },
    (_, i) => WV_START_HOUR + i,
  );
  const gridCols = { gridTemplateColumns: `52px repeat(7, minmax(0, 1fr))` };
  const pxPerHour = WV_SLOT_PX * (60 / WV_SLOT_MIN);

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <div className="min-w-[760px]">
        {/* Day headers */}
        <div className="grid border-b border-hairline" style={gridCols}>
          <div />
          {days.map((d, i) => {
            const k = keyForDate(d);
            const isToday = k === todayKey;
            const isSelected = k === selectedKey;
            return (
              <button
                key={k}
                onClick={() => onSelectDay(k)}
                className={`border-l border-hairline px-2 py-2 text-center transition-colors ${
                  isSelected ? 'bg-brand-soft/40' : 'hover:bg-pill/40'
                }`}
              >
                <div
                  className={`text-[10px] font-bold uppercase tracking-wider ${
                    i >= 5 ? 'text-red-500/70' : 'text-light'
                  }`}
                >
                  {DOW_UA[i]}
                </div>
                <div
                  className={`text-[14px] font-bold mt-0.5 inline-flex items-center justify-center ${
                    isToday ? 'bg-brand text-white rounded-full w-6 h-6' : 'text-ink'
                  }`}
                >
                  {d.getDate()}
                </div>
              </button>
            );
          })}
        </div>

        {/* Time grid: 08:00–18:00 in 30-min slots */}
        <div className="grid" style={gridCols}>
          {/* Hour gutter */}
          <div className="relative" style={{ height: WV_GRID_HEIGHT }}>
            {hourLabels.map((h, idx) => (
              <div
                key={h}
                className="absolute right-1.5 text-[10px] text-light -translate-y-1/2"
                style={{ top: idx * pxPerHour }}
              >
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d) => {
            const list = byDay.get(keyForDate(d)) ?? [];
            return (
              <div
                key={keyForDate(d)}
                className="relative border-l border-hairline"
                style={{ height: WV_GRID_HEIGHT }}
              >
                {/* 30-min slots — click an empty one to create a meeting there */}
                {Array.from({ length: WV_TOTAL_SLOTS }).map((_, s) => {
                  const minutes = s * WV_SLOT_MIN;
                  const h = WV_START_HOUR + Math.floor(minutes / 60);
                  const m = minutes % 60;
                  return (
                    <button
                      key={s}
                      disabled={!canCreate}
                      onClick={() =>
                        onCreateAt(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m))
                      }
                      title={
                        canCreate
                          ? `Створити засідання · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
                          : undefined
                      }
                      className={`absolute left-0 right-0 border-b border-hairline ${
                        // The slot's bottom edge lands on the hour when m === 30
                        // (e.g. 08:30 slot ends at 09:00) → solid; the 08:00 slot
                        // ends at 08:30 → dashed. Same grey for both.
                        m === 30 ? '' : 'border-dashed'
                      } ${canCreate ? 'hover:bg-brand-soft/40' : 'cursor-default'}`}
                      style={{ top: s * WV_SLOT_PX, height: WV_SLOT_PX }}
                    />
                  );
                })}

                {/* Meeting blocks, positioned by time */}
                {list.map((m) => {
                  const start = new Date(m.startAt);
                  const startMin = (start.getHours() - WV_START_HOUR) * 60 + start.getMinutes();
                  const rawTop = (startMin / WV_SLOT_MIN) * WV_SLOT_PX;
                  const top = Math.min(Math.max(0, rawTop), WV_GRID_HEIGHT - WV_SLOT_PX);
                  const rawH = (m.durationMins / WV_SLOT_MIN) * WV_SLOT_PX - 2;
                  const height = Math.max(WV_SLOT_PX - 4, Math.min(rawH, WV_GRID_HEIGHT - top - 2));
                  const completed = m.status === 'COMPLETED';
                  return (
                    <Link
                      key={m.id}
                      href={`/meetings/${m.id}`}
                      onClick={(e) => e.stopPropagation()}
                      title={`${m.title} · ${FORMAT_LABELS[m.format] ?? m.format}`}
                      className="absolute left-0.5 right-0.5 z-10 rounded-md px-1.5 py-0.5 overflow-hidden"
                      style={{
                        top,
                        height,
                        backgroundColor: m.workingGroup.color + (completed ? '33' : '22'),
                        color: m.workingGroup.color,
                        borderLeft: `3px solid ${m.workingGroup.color}`,
                      }}
                    >
                      <div className="font-mono text-[9px] leading-none">
                        {String(start.getHours()).padStart(2, '0')}:
                        {String(start.getMinutes()).padStart(2, '0')}
                      </div>
                      <div className="truncate text-[10px] font-semibold leading-tight mt-0.5">
                        {m.workingGroup.code} · {m.title}
                      </div>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
