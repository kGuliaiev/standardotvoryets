'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Avatar } from '@/components/ui/Avatar';
import { formatDate } from '@/lib/utils';
import { can } from '@/lib/rbac';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';

const FORMAT_LABELS: Record<string, string> = {
  ONLINE: 'Онлайн',
  OFFLINE: 'Офлайн',
  HYBRID: 'Гібрид',
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PLANNED: { label: 'Заплановано', cls: 'bg-blue-50 text-blue-700' },
  IN_PROGRESS: { label: 'Проводиться', cls: 'bg-amber-50 text-amber-700' },
  COMPLETED: { label: 'Завершено', cls: 'bg-green-50 text-green-700' },
  CANCELLED: { label: 'Скасовано', cls: 'bg-slate-100 text-slate-500' },
};

const ATTENDANCE_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Очікується', cls: 'text-slate-400' },
  CONFIRMED: { label: 'Підтверджено', cls: 'text-green-600' },
  DECLINED: { label: 'Відмовлено', cls: 'text-red-500' },
};

interface Props { id: string }

export function MeetingDetail({ id }: Props) {
  const { data: session } = useSession();
  const [showMinutes, setShowMinutes] = useState(false);
  const [minutesText, setMinutesText] = useState('');

  const utils = trpc.useUtils();
  const { data: meeting, isLoading } = trpc.meeting.byId.useQuery({ id });

  const confirmMutation = trpc.meeting.confirmAttendance.useMutation({
    onSuccess: () => utils.meeting.byId.invalidate({ id }),
  });
  const uploadMinutesMutation = trpc.meeting.uploadMinutes.useMutation({
    onSuccess: () => {
      utils.meeting.byId.invalidate({ id });
      setShowMinutes(false);
    },
  });
  const changeStatusMutation = trpc.meeting.changeStatus.useMutation({
    onSuccess: () => utils.meeting.byId.invalidate({ id }),
  });

  if (isLoading) return <div className="py-16 text-center text-slate-400 text-sm">Завантаження…</div>;
  if (!meeting) return <div className="py-16 text-center text-slate-400 text-sm">Засідання не знайдено</div>;

  const userCtx = session ? {
    globalRole: session.user.globalRole as GlobalRole,
    memberships: (session.user.memberships ?? []) as Array<{ workingGroupId: string; role: WorkingGroupRole }>,
  } : null;
  const isAdmin = session?.user.globalRole === 'ADMIN';
  const wgId = meeting.workingGroup.id;
  const canManage = userCtx && (isAdmin || can(userCtx, 'meeting:uploadMinutes', wgId));
  const canCancel = userCtx && (isAdmin || can(userCtx, 'meeting:cancel', wgId));

  const myAttendance = meeting.attendances.find((a) => a.user.id === session?.user.id);
  const statusInfo = STATUS_LABELS[meeting.status] ?? { label: meeting.status, cls: '' };

  return (
    <div className="space-y-5">
      {/* Breadcrumb + header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Link href="/meetings" className="hover:text-slate-600 transition-colors">← Засідання</Link>
            <span>/</span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meeting.workingGroup.color }} />
              <Link href={`/working-groups/${wgId}`} className="hover:text-slate-600 transition-colors">
                {meeting.workingGroup.code}
              </Link>
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-900">{meeting.title}</h1>
        </div>
        <span className={`text-xs px-3 py-1.5 rounded-full font-medium ${statusInfo.cls}`}>
          {statusInfo.label}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: main info */}
        <div className="lg:col-span-2 space-y-5">
          {/* Info card */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-400 mb-1">Дата та час</p>
                <p className="font-medium text-slate-800">{formatDate(meeting.startAt)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Тривалість</p>
                <p className="font-medium text-slate-800">{meeting.durationMins} хв</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Формат</p>
                <p className="font-medium text-slate-800">{FORMAT_LABELS[meeting.format] ?? meeting.format}</p>
              </div>
              {meeting.location && (
                <div>
                  <p className="text-xs text-slate-400 mb-1">Місце / Посилання</p>
                  <p className="font-medium text-slate-800 break-all">{meeting.location}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-slate-400 mb-1">Організатор</p>
                <p className="font-medium text-slate-800">{meeting.createdBy.name}</p>
              </div>
            </div>
          </div>

          {/* Agenda */}
          {meeting.agendaText && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Порядок денний</h3>
              <pre className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap font-sans">
                {meeting.agendaText}
              </pre>
            </div>
          )}

          {/* Minutes */}
          {(meeting.minutesText || canManage) && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700">Протокол</h3>
                {canManage && meeting.status !== 'CANCELLED' && (
                  <button
                    onClick={() => { setMinutesText(meeting.minutesText ?? ''); setShowMinutes(true); }}
                    className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    {meeting.minutesText ? 'Редагувати' : '+ Додати протокол'}
                  </button>
                )}
              </div>
              {meeting.minutesText ? (
                <pre className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap font-sans">
                  {meeting.minutesText}
                </pre>
              ) : (
                <p className="text-sm text-slate-400">Протокол ще не додано</p>
              )}
            </div>
          )}

          {/* Status controls */}
          {canManage && meeting.status !== 'CANCELLED' && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Управління статусом</h3>
              <div className="flex gap-2 flex-wrap">
                {meeting.status === 'PLANNED' && (
                  <button
                    onClick={() => changeStatusMutation.mutate({ meetingId: id, status: 'IN_PROGRESS' })}
                    className="text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors font-medium"
                  >
                    Розпочати
                  </button>
                )}
                {(meeting.status === 'PLANNED' || meeting.status === 'IN_PROGRESS') && (
                  <button
                    onClick={() => changeStatusMutation.mutate({ meetingId: id, status: 'COMPLETED' })}
                    className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1.5 rounded-lg transition-colors font-medium"
                  >
                    Завершити
                  </button>
                )}
                {canCancel && meeting.status === 'PLANNED' && (
                  <button
                    onClick={() => { if (confirm('Скасувати засідання?')) changeStatusMutation.mutate({ meetingId: id, status: 'CANCELLED' }); }}
                    className="text-xs bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors font-medium"
                  >
                    Скасувати
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: attendances */}
        <div className="space-y-5">
          {/* My attendance */}
          {myAttendance && meeting.status === 'PLANNED' && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Ваша участь</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => confirmMutation.mutate({ meetingId: id, status: 'CONFIRMED' })}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                    myAttendance.status === 'CONFIRMED'
                      ? 'bg-green-600 text-white'
                      : 'border border-slate-200 text-slate-600 hover:bg-green-50 hover:border-green-300 hover:text-green-700'
                  }`}
                >
                  ✓ Буду
                </button>
                <button
                  onClick={() => confirmMutation.mutate({ meetingId: id, status: 'DECLINED' })}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                    myAttendance.status === 'DECLINED'
                      ? 'bg-red-500 text-white'
                      : 'border border-slate-200 text-slate-600 hover:bg-red-50 hover:border-red-300 hover:text-red-600'
                  }`}
                >
                  ✗ Не буду
                </button>
              </div>
            </div>
          )}

          {/* Attendees list */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700">
                Учасники ({meeting.attendances.length})
              </h3>
            </div>
            <div className="divide-y divide-slate-100">
              {meeting.attendances.map((a) => {
                const att = ATTENDANCE_LABELS[a.status] ?? { label: a.status, cls: '' };
                return (
                  <div key={a.user.id} className="flex items-center justify-between px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={a.user.name} size="xs" />
                      <span className="text-sm text-slate-700">{a.user.name}</span>
                    </div>
                    <span className={`text-xs ${att.cls}`}>{att.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Minutes modal */}
      {showMinutes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Протокол засідання</h2>
            <textarea
              rows={12}
              placeholder="Текст протоколу…"
              value={minutesText}
              onChange={(e) => setMinutesText(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowMinutes(false)}
                className="flex-1 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Скасувати
              </button>
              <button
                onClick={() => uploadMinutesMutation.mutate({ meetingId: id, minutesText })}
                disabled={uploadMinutesMutation.isLoading || minutesText.length < 10}
                className="flex-1 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors font-medium"
              >
                {uploadMinutesMutation.isLoading ? 'Збереження…' : 'Зберегти'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
