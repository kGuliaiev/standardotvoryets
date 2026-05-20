'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Pencil } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { ActivityFeed } from '@/components/ActivityFeed';
import { can } from '@/lib/rbac';
import { useEscape } from '@/lib/useEscape';
import { rankWeight, extractSurname } from '@/lib/ranks';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';

// Short UA weekday, indexed by Date.getDay() (0 = Sunday).
const DOW_SHORT_UA = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/** "13:00, Чт, 21.05.2026" — time, short weekday, date. */
function formatMeetingWhen(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}, ${DOW_SHORT_UA[d.getDay()]}, ${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// Sort priority within the WG roster: lower number = higher up
const WG_ROLE_ORDER: Record<string, number> = {
  LEADER: 0,
  DEPUTY: 1,
  SECRETARY: 2,
  MEMBER: 3,
  GUEST: 4,
};

// Roles that don't count toward quorum (secretaries are administrative,
// not voting members of the working group).
const NON_QUORUM_ROLES = new Set(['SECRETARY', 'GUEST']);

const FORMAT_LABELS: Record<string, string> = {
  ONLINE: 'Онлайн',
  OFFLINE: 'Офлайн',
  HYBRID: 'Гібрид',
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PLANNED: { label: 'Заплановано', cls: 'bg-blue-50 text-blue-700' },
  IN_PROGRESS: { label: 'Проводиться', cls: 'bg-amber-50 text-amber-700' },
  COMPLETED: { label: 'Завершено', cls: 'bg-green-50 text-green-700' },
  CANCELLED: { label: 'Скасовано', cls: 'bg-pill text-mid' },
};

const ATTENDANCE_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Очікується', cls: 'text-light' },
  CONFIRMED: { label: 'Підтверджено', cls: 'text-green-600' },
  DECLINED: { label: 'Відмовлено', cls: 'text-red-500' },
};

const WG_ROLE_LABELS_UA: Record<string, string> = {
  LEADER: 'Керівник РГ',
  DEPUTY: 'Заступник керівника',
  SECRETARY: 'Секретар',
  MEMBER: 'Член РГ',
  GUEST: 'Гість',
};

interface Props {
  id: string;
}

export function MeetingDetail({ id }: Props) {
  const { data: session } = useSession();
  const [showMinutes, setShowMinutes] = useState(false);
  const [minutesText, setMinutesText] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    title: '',
    format: 'OFFLINE' as 'ONLINE' | 'OFFLINE' | 'HYBRID',
    location: '',
    startAt: '',
    durationMins: 60,
    agendaText: '',
    chairmanId: '',
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const utils = trpc.useUtils();
  const { data: meeting, isLoading } = trpc.meeting.byId.useQuery({ id });

  const invalidateMeetings = () => {
    void utils.meeting.byId.invalidate({ id });
    void utils.meeting.list.invalidate();
    void utils.meeting.upcomingForUser.invalidate();
    void utils.dashboard.kpis.invalidate();
    void utils.dashboard.navCounts.invalidate();
    void utils.activityLog.list.invalidate({ entity: 'Meeting', entityId: id });
  };

  const confirmMutation = trpc.meeting.confirmAttendance.useMutation({
    onSuccess: invalidateMeetings,
  });
  const setAttendanceMutation = trpc.meeting.setAttendance.useMutation({
    onSuccess: invalidateMeetings,
  });
  const uploadMinutesMutation = trpc.meeting.uploadMinutes.useMutation({
    onSuccess: () => {
      invalidateMeetings();
      setShowMinutes(false);
    },
  });
  const changeStatusMutation = trpc.meeting.changeStatus.useMutation({
    onSuccess: invalidateMeetings,
  });

  const updateMutation = trpc.meeting.update.useMutation({
    onSuccess: () => {
      invalidateMeetings();
      setEditOpen(false);
    },
    onError: (e) => setEditError(e.message),
  });

  useEscape(showMinutes, () => setShowMinutes(false));

  if (isLoading) return <div className="py-16 text-center text-light text-sm">Завантаження…</div>;
  if (!meeting)
    return <div className="py-16 text-center text-light text-sm">Засідання не знайдено</div>;

  const userCtx = session
    ? {
        globalRole: session.user.globalRole as GlobalRole,
        memberships: (session.user.memberships ?? []) as {
          workingGroupId: string;
          role: WorkingGroupRole;
        }[],
      }
    : null;
  const isAdmin = session?.user.globalRole === 'ADMIN';
  const isDirector = session?.user.globalRole === 'DIRECTOR';
  const wgId = meeting.workingGroup.id;
  const canManage = userCtx && (isAdmin || can(userCtx, 'meeting:uploadMinutes', wgId));
  const canCancel = userCtx && (isAdmin || can(userCtx, 'meeting:cancel', wgId));
  const myRoleHere = userCtx?.memberships.find((m) => m.workingGroupId === wgId)?.role;
  const canManageAttendance =
    isAdmin ||
    isDirector ||
    myRoleHere === 'LEADER' ||
    myRoleHere === 'DEPUTY' ||
    myRoleHere === 'SECRETARY';

  const myAttendance = meeting.attendances.find((a) => a.user.id === session?.user.id);
  const statusInfo = STATUS_LABELS[meeting.status] ?? { label: meeting.status, cls: '' };

  return (
    <div className="space-y-5">
      {/* Breadcrumb + header — title on the left, status + action buttons on the right */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 text-sm text-light">
            <Link href="/meetings" className="hover:text-mid transition-colors">
              ← Засідання
            </Link>
            <span>/</span>
            <span className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: meeting.workingGroup.color }}
              />
              <Link href={`/working-groups/${wgId}`} className="hover:text-mid transition-colors">
                {meeting.workingGroup.code}
              </Link>
            </span>
          </div>
          <h1 className="text-xl font-bold text-ink">{meeting.title}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <span className={`text-xs px-3 py-1.5 rounded-full font-medium ${statusInfo.cls}`}>
            {statusInfo.label}
          </span>
          {canManage && meeting.status !== 'CANCELLED' && (
            <>
              <button
                onClick={() => {
                  setEditForm({
                    title: meeting.title,
                    format: meeting.format,
                    location: meeting.location ?? '',
                    startAt: new Date(meeting.startAt).toISOString().slice(0, 16),
                    durationMins: meeting.durationMins,
                    agendaText: meeting.agendaText ?? '',
                    chairmanId: meeting.chairmanId ?? '',
                  });
                  setEditError(null);
                  setEditOpen(true);
                }}
                className="text-xs px-3 py-1.5 rounded-lg border-[1.5px] border-hairline hover:border-brand hover:text-brand text-mid transition-colors font-semibold inline-flex items-center gap-1.5"
              >
                <Pencil className="w-3.5 h-3.5" />
                Редагувати
              </button>
              {meeting.status === 'PLANNED' && (
                <button
                  onClick={() =>
                    changeStatusMutation.mutate({ meetingId: id, status: 'IN_PROGRESS' })
                  }
                  className="text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50 px-3 py-1.5 rounded-lg transition-colors font-medium"
                >
                  Розпочати
                </button>
              )}
              {(meeting.status === 'PLANNED' || meeting.status === 'IN_PROGRESS') && (
                <button
                  onClick={() =>
                    changeStatusMutation.mutate({ meetingId: id, status: 'COMPLETED' })
                  }
                  className="text-xs bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50 px-3 py-1.5 rounded-lg transition-colors font-medium"
                >
                  Завершити
                </button>
              )}
              {canCancel && meeting.status === 'PLANNED' && (
                <button
                  onClick={() => setCancelConfirmOpen(true)}
                  className="text-xs bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 px-3 py-1.5 rounded-lg transition-colors font-medium"
                >
                  Скасувати
                </button>
              )}
            </>
          )}
          {/* Calendar download — visible for any meeting */}
          <a
            href={`/api/meetings/${id}/ical`}
            className="text-xs px-3 py-1.5 rounded-lg border-[1.5px] border-hairline hover:border-brand hover:text-brand text-mid transition-colors font-semibold inline-flex items-center gap-1.5"
            title="Завантажити .ics для Outlook / Google Calendar"
          >
            📅 Календар
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: main info */}
        <div className="lg:col-span-2 space-y-5">
          {/* Info card */}
          {(() => {
            const wgLeader = meeting.workingGroup.members.find((m) => m.role === 'LEADER')?.user;
            const chairman = meeting.chairman ?? wgLeader ?? null;
            // Quorum is calculated on current WG roster (not stale attendances)
            // and excludes administrative roles (SECRETARY/GUEST). >50% rule.
            const attByUser = new Map(meeting.attendances.map((a) => [a.user.id, a.status]));
            const votingMembers = meeting.workingGroup.members.filter(
              (m) => !NON_QUORUM_ROLES.has(m.role),
            );
            const total = votingMembers.length;
            const confirmed = votingMembers.filter(
              (m) => attByUser.get(m.user.id) === 'CONFIRMED',
            ).length;
            const hasQuorum = total > 0 && confirmed * 2 > total;
            return (
              <div className="bg-card rounded-xl border border-hairline p-5">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-4 text-sm">
                  <div>
                    <p className="text-xs text-light mb-1">Головуючий</p>
                    <p className="font-medium text-ink">
                      {chairman ? (
                        <>
                          {chairman.name}
                          {!meeting.chairman && (
                            <span className="text-[10px] text-light italic ml-1">
                              · керівник РГ
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-light italic">не вказано</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-light mb-1">Дата та час</p>
                    <p className="font-medium text-ink">{formatMeetingWhen(meeting.startAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-light mb-1">Тривалість</p>
                    <p className="font-medium text-ink">{meeting.durationMins} хв</p>
                  </div>
                  <div>
                    <p className="text-xs text-light mb-1">Кворум</p>
                    {total === 0 ? (
                      <p className="font-medium text-light italic">учасників немає</p>
                    ) : (
                      <p className="font-medium inline-flex items-center gap-1.5">
                        <span className="text-ink tabular-nums">
                          {confirmed} / {total}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            hasQuorum
                              ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                              : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                          }`}
                        >
                          {hasQuorum ? '✓ є кворум' : '✗ немає кворуму'}
                        </span>
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-light mb-1">Формат</p>
                    <p className="font-medium text-ink">
                      {FORMAT_LABELS[meeting.format] ?? meeting.format}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-light mb-1">Організатор</p>
                    <p className="font-medium text-ink">{meeting.createdBy.name}</p>
                  </div>
                  {meeting.location && (
                    <div className="col-span-full">
                      <p className="text-xs text-light mb-1">Місце / Посилання</p>
                      <p className="font-medium text-ink break-all">{meeting.location}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Agenda */}
          {meeting.agendaText && (
            <div className="bg-card rounded-xl border border-hairline p-5">
              <h3 className="text-sm font-semibold text-ink mb-3">Порядок денний</h3>
              <pre className="text-sm text-mid leading-relaxed whitespace-pre-wrap font-sans">
                {meeting.agendaText}
              </pre>
            </div>
          )}

          {/* Minutes — "started" = at least one agenda item OR legacy minutesText filled */}
          {(() => {
            const hasItems = meeting.agendaItems.length > 0;
            const hasMinutes = !!meeting.minutesText && meeting.minutesText.trim().length > 0;
            const started = hasItems || hasMinutes;
            if (!started && !canManage) return null;
            return (
              <div className="bg-card rounded-xl border border-hairline p-5">
                <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-ink">Протокол</h3>
                  {started && (
                    <div className="inline-flex items-center gap-3">
                      <Link
                        href={`/meetings/${id}/protocol`}
                        className="text-xs font-bold text-brand hover:underline inline-flex items-center gap-1"
                      >
                        📝 Редактор протоколу
                      </Link>
                      <a
                        href={`/api/meetings/${id}/protocol.docx`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-mid hover:text-brand inline-flex items-center gap-1"
                        title="Завантажити Word"
                      >
                        📄 Word
                      </a>
                      <a
                        href={`/api/meetings/${id}/protocol`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-mid hover:text-brand inline-flex items-center gap-1"
                        title="Завантажити PDF"
                      >
                        📄 PDF
                      </a>
                    </div>
                  )}
                </div>

                {!started && canManage && (
                  <Link
                    href={`/meetings/${id}/protocol`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors"
                  >
                    📝 Розпочати заповнення протоколу
                  </Link>
                )}

                {started && hasItems && (
                  <div className="space-y-4 text-sm">
                    {(() => {
                      const sections = [
                        { key: 'AGENDA', label: 'ПОРЯДОК ДЕННИЙ' },
                        { key: 'HEARD', label: 'СЛУХАЛИ / ВИСТУПИЛИ' },
                        { key: 'DECISION', label: 'ВИРІШИЛИ' },
                      ] as const;
                      return sections.map((sec) => {
                        const items = meeting.agendaItems.filter(
                          (it) => (it.section ?? 'AGENDA') === sec.key,
                        );
                        if (items.length === 0) return null;
                        return (
                          <div key={sec.key}>
                            <p className="text-[11px] font-bold uppercase tracking-wide text-light mb-1.5">
                              {sec.label}
                            </p>
                            <ol className="space-y-1.5">
                              {items.map((it, idx) => (
                                <li key={it.id} className="text-mid leading-snug">
                                  <span className="font-bold text-ink">{idx + 1}. </span>
                                  {it.title || (
                                    <span className="text-light italic">(без назви)</span>
                                  )}
                                  {sec.key === 'AGENDA' && it.speaker && (
                                    <span className="text-light italic ml-1">
                                      · доповідач {it.speaker.name}
                                    </span>
                                  )}
                                  {sec.key === 'HEARD' && it.heardText && (
                                    <p className="text-xs text-light italic mt-0.5 pl-4 line-clamp-2">
                                      {it.heardText}
                                    </p>
                                  )}
                                  {sec.key === 'DECISION' && it.deadline && (
                                    <p className="text-xs text-light italic mt-0.5 pl-4">
                                      Термін: до {new Date(it.deadline).toLocaleDateString('uk-UA')}
                                      {it.responsible && ` · ${it.responsible.name}`}
                                    </p>
                                  )}
                                </li>
                              ))}
                            </ol>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}

                {started && !hasItems && hasMinutes && (
                  <pre className="text-sm text-mid leading-relaxed whitespace-pre-wrap font-sans">
                    {meeting.minutesText}
                  </pre>
                )}
              </div>
            );
          })()}

          {/* Activity feed — same column width as Інформація / Протокол.
              Collapsed by default so it doesn't dominate the layout. */}
          <ActivityFeed entity="Meeting" entityId={id} collapsible defaultOpen={false} />
        </div>

        {/* Right: attendances */}
        <div className="space-y-5">
          {/* My attendance */}
          {myAttendance && meeting.status === 'PLANNED' && (
            <div className="bg-card rounded-xl border border-hairline p-5">
              <h3 className="text-sm font-semibold text-ink mb-3">Ваша участь</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => confirmMutation.mutate({ meetingId: id, status: 'CONFIRMED' })}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                    myAttendance.status === 'CONFIRMED'
                      ? 'bg-green-600 text-white'
                      : 'border border-hairline text-mid hover:bg-green-50 hover:border-green-300 hover:text-green-700'
                  }`}
                >
                  ✓ Буду
                </button>
                <button
                  onClick={() => confirmMutation.mutate({ meetingId: id, status: 'DECLINED' })}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                    myAttendance.status === 'DECLINED'
                      ? 'bg-red-500 text-white'
                      : 'border border-hairline text-mid hover:bg-red-50 hover:border-red-300 hover:text-red-600'
                  }`}
                >
                  ✗ Не буду
                </button>
              </div>
            </div>
          )}

          {/* Attendees list */}
          {(() => {
            // Build the full roster = all WG members, with attendance status if
            // a row exists. Privileged users (LEADER/DEPUTY/SECRETARY of this
            // WG + DIRECTOR + ADMIN) can edit each member's status — even for
            // members who don't have an attendance row yet (upsert on the server).
            const attByUser = new Map(meeting.attendances.map((a) => [a.user.id, a]));
            const roster = meeting.workingGroup.members
              .map((m) => ({
                user: m.user,
                role: m.role,
                status: attByUser.get(m.user.id)?.status ?? null,
              }))
              .sort((a, b) => {
                const r = (WG_ROLE_ORDER[a.role] ?? 99) - (WG_ROLE_ORDER[b.role] ?? 99);
                if (r !== 0) return r;
                const w = rankWeight(b.user.rank) - rankWeight(a.user.rank);
                if (w !== 0) return w;
                return extractSurname(a.user.name).localeCompare(extractSurname(b.user.name), 'uk');
              });
            const confirmedCount = roster.filter((r) => r.status === 'CONFIRMED').length;
            return (
              <div className="bg-card rounded-xl border border-hairline overflow-hidden">
                <div className="px-5 py-3.5 border-b border-hairline flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ink">Учасники ({roster.length})</h3>
                  <span className="text-[11px] text-light">
                    Підтверджено:{' '}
                    <span className="font-bold text-emerald-600">{confirmedCount}</span>
                  </span>
                </div>
                <div className="divide-y divide-hairline">
                  {roster.map((r) => {
                    const att = r.status
                      ? (ATTENDANCE_LABELS[r.status] ?? { label: r.status, cls: '' })
                      : null;
                    return (
                      <div key={r.user.id} className="px-5 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <Avatar name={r.user.name} size="xs" />
                            <div className="min-w-0">
                              <p className="text-sm text-ink truncate">{r.user.name}</p>
                              <p className="text-[10px] text-light">
                                {WG_ROLE_LABELS_UA[r.role] ?? r.role}
                              </p>
                            </div>
                          </div>
                          {!canManageAttendance && (
                            <span
                              className={`text-xs whitespace-nowrap ${att?.cls ?? 'text-light'}`}
                            >
                              {att?.label ?? '—'}
                            </span>
                          )}
                        </div>
                        {canManageAttendance && (
                          <div className="flex gap-1 mt-2">
                            {(['CONFIRMED', 'DECLINED', 'PENDING'] as const).map((s) => {
                              const active = r.status === s;
                              const cls =
                                s === 'CONFIRMED'
                                  ? active
                                    ? 'bg-emerald-500 border-emerald-500 text-white'
                                    : 'border-hairline text-mid hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 dark:hover:bg-emerald-900/30'
                                  : s === 'DECLINED'
                                    ? active
                                      ? 'bg-red-500 border-red-500 text-white'
                                      : 'border-hairline text-mid hover:bg-red-50 hover:text-red-600 hover:border-red-300 dark:hover:bg-red-900/30'
                                    : active
                                      ? 'bg-mid border-mid text-white'
                                      : 'border-hairline text-mid hover:bg-pill';
                              return (
                                <button
                                  key={s}
                                  type="button"
                                  disabled={setAttendanceMutation.isPending}
                                  onClick={() =>
                                    setAttendanceMutation.mutate({
                                      meetingId: id,
                                      userId: r.user.id,
                                      status: s,
                                    })
                                  }
                                  className={`flex-1 text-[10px] font-semibold border rounded px-2 py-1 transition-colors disabled:opacity-50 ${cls}`}
                                >
                                  {s === 'CONFIRMED'
                                    ? '✓ Присутній'
                                    : s === 'DECLINED'
                                      ? '✗ Відсутній'
                                      : '— Очікується'}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Minutes modal */}
      {showMinutes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6">
            <h2 className="text-lg font-semibold text-ink mb-4">Протокол засідання</h2>
            <textarea
              rows={12}
              placeholder="Текст протоколу…"
              value={minutesText}
              onChange={(e) => setMinutesText(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowMinutes(false)}
                className="flex-1 py-2 text-sm border border-hairline rounded-lg hover:bg-page transition-colors"
              >
                Скасувати
              </button>
              <button
                onClick={() => uploadMinutesMutation.mutate({ meetingId: id, minutesText })}
                disabled={uploadMinutesMutation.isPending || minutesText.length < 10}
                className="flex-1 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors font-medium"
              >
                {uploadMinutesMutation.isPending ? 'Збереження…' : 'Зберегти'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Редагувати засідання"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="field-label">Тема *</label>
            <input
              className="input"
              value={editForm.title}
              onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field-label">Дата та час *</label>
              <input
                type="datetime-local"
                className="input"
                value={editForm.startAt}
                onChange={(e) => setEditForm((f) => ({ ...f, startAt: e.target.value }))}
              />
            </div>
            <div>
              <label className="field-label">Тривалість (хв)</label>
              <input
                type="number"
                min={15}
                max={480}
                className="input"
                value={editForm.durationMins}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, durationMins: Number(e.target.value) }))
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field-label">Головуючий</label>
              <select
                className="select"
                value={editForm.chairmanId}
                onChange={(e) => setEditForm((f) => ({ ...f, chairmanId: e.target.value }))}
              >
                <option value="">— керівник РГ за замовчуванням —</option>
                {meeting.workingGroup.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.user.name}
                    {m.role === 'LEADER' ? ' · Керівник' : ''}
                    {m.role === 'DEPUTY' ? ' · Заступник' : ''}
                    {m.role === 'SECRETARY' ? ' · Секретар' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Локація / Посилання</label>
              <input
                className="input"
                value={editForm.location}
                onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="field-label">Формат</label>
            <select
              className="select"
              value={editForm.format}
              onChange={(e) =>
                setEditForm((f) => ({
                  ...f,
                  format: e.target.value as 'ONLINE' | 'OFFLINE' | 'HYBRID',
                }))
              }
            >
              <option value="ONLINE">Онлайн</option>
              <option value="OFFLINE">Офлайн</option>
              <option value="HYBRID">Гібрид</option>
            </select>
          </div>
          <div>
            <label className="field-label">Порядок денний</label>
            <textarea
              rows={5}
              className="textarea resize-none"
              value={editForm.agendaText}
              onChange={(e) => setEditForm((f) => ({ ...f, agendaText: e.target.value }))}
            />
          </div>
          {editError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-[10px] px-3 py-2">{editError}</p>
          )}
          <div className="flex gap-3 pt-2 border-t border-hairline">
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="flex-1 btn-secondary"
            >
              Скасувати
            </button>
            <button
              type="button"
              onClick={() => {
                if (!editForm.title.trim()) {
                  setEditError('Введіть тему');
                  return;
                }
                if (!editForm.startAt) {
                  setEditError('Оберіть дату та час');
                  return;
                }
                const trim = (v: string): string | undefined => {
                  const t = v.trim();
                  return t === '' ? undefined : t;
                };
                updateMutation.mutate({
                  id,
                  title: editForm.title.trim(),
                  format: editForm.format,
                  location: trim(editForm.location),
                  startAt: new Date(editForm.startAt),
                  durationMins: editForm.durationMins,
                  agendaText: trim(editForm.agendaText),
                  chairmanId: editForm.chairmanId ? editForm.chairmanId : null,
                });
              }}
              disabled={updateMutation.isPending}
              className="flex-1 btn-primary"
            >
              {updateMutation.isPending ? 'Збереження…' : 'Зберегти'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={cancelConfirmOpen}
        title="Скасувати засідання?"
        message="Засідання отримає статус «Скасоване». Учасники отримають сповіщення. Цю дію можна повернути зі сторінки протоколу."
        confirmLabel="Скасувати засідання"
        destructive
        isPending={changeStatusMutation.isPending}
        onClose={() => setCancelConfirmOpen(false)}
        onConfirm={() =>
          changeStatusMutation.mutate(
            { meetingId: id, status: 'CANCELLED' },
            { onSuccess: () => setCancelConfirmOpen(false) },
          )
        }
      />
    </div>
  );
}
