'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { can } from '@/lib/rbac';
import { formatDate } from '@/lib/utils';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';

const MONTHS_UA = [
  'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
  'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень',
];

const FORMAT_LABELS: Record<string, string> = {
  ONLINE: 'Онлайн',
  OFFLINE: 'Офлайн',
  HYBRID: 'Гібрид',
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PLANNED: { label: 'Заплановано', cls: 'bg-blue-50 text-blue-700' },
  IN_PROGRESS: { label: 'Проводиться', cls: 'bg-amber-50 text-amber-700' },
  COMPLETED: { label: 'Завершено', cls: 'bg-green-50 text-green-700' },
  CANCELLED: { label: 'Скасовано', cls: 'bg-slate-100 text-slate-400 line-through' },
};

export function MeetingsList() {
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [wgFilter, setWgFilter] = useState(searchParams.get('wg') ?? '');
  const [showCreate, setShowCreate] = useState(false);

  const [form, setForm] = useState({
    workingGroupId: searchParams.get('wg') ?? '',
    title: '',
    format: 'ONLINE' as const,
    location: '',
    startAt: '',
    durationMins: 60,
    agendaText: '',
  });
  const [createError, setCreateError] = useState('');

  const utils = trpc.useUtils();
  const { data: groups } = trpc.workingGroup.list.useQuery();
  const { data: meetings, isLoading } = trpc.meeting.list.useQuery({
    workingGroupId: wgFilter || undefined,
    month,
    year,
  });

  const createMutation = trpc.meeting.create.useMutation({
    onSuccess: () => {
      utils.meeting.list.invalidate();
      setShowCreate(false);
      setForm({ workingGroupId: '', title: '', format: 'ONLINE', location: '', startAt: '', durationMins: 60, agendaText: '' });
      setCreateError('');
    },
    onError: (e) => setCreateError(e.message),
  });

  const cancelMutation = trpc.meeting.cancel.useMutation({
    onSuccess: () => utils.meeting.list.invalidate(),
  });

  const userCtx = session ? {
    globalRole: session.user.globalRole as GlobalRole,
    memberships: (session.user.memberships ?? []) as Array<{ workingGroupId: string; role: WorkingGroupRole }>,
  } : null;

  function canCreateInGroup(wgId: string) {
    if (!userCtx) return false;
    return userCtx.globalRole === 'ADMIN' || can(userCtx, 'meeting:create', wgId);
  }

  function canCreateAny() {
    return groups?.some((g) => canCreateInGroup(g.id)) ?? false;
  }

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Засідання</h1>
        {canCreateAny() && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors"
          >
            + Нове засідання
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex gap-3 flex-wrap items-center">
          {/* Month navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                if (month === 1) { setMonth(12); setYear(y => y - 1); }
                else setMonth(m => m - 1);
              }}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
            >
              ←
            </button>
            <span className="text-sm font-medium text-slate-700 min-w-[120px] text-center">
              {MONTHS_UA[month - 1]} {year}
            </span>
            <button
              onClick={() => {
                if (month === 12) { setMonth(1); setYear(y => y + 1); }
                else setMonth(m => m + 1);
              }}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
            >
              →
            </button>
          </div>

          {/* WG filter */}
          <select
            value={wgFilter}
            onChange={(e) => setWgFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Всі РГ</option>
            {groups?.map((g) => (
              <option key={g.id} value={g.id}>{g.code} — {g.name}</option>
            ))}
          </select>

          <button
            onClick={() => { setMonth(now.getMonth() + 1); setYear(now.getFullYear()); setWgFilter(''); }}
            className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2"
          >
            Поточний місяць
          </button>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Завантаження…</div>
        ) : meetings?.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            <p className="text-2xl mb-2">📅</p>
            Засідань у цьому місяці немає
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-5 py-3 font-medium">Тема</th>
                <th className="px-3 py-3 font-medium">РГ</th>
                <th className="px-3 py-3 font-medium">Дата / Час</th>
                <th className="px-3 py-3 font-medium">Формат</th>
                <th className="px-3 py-3 font-medium">Статус</th>
                <th className="px-3 py-3 font-medium">Учасн.</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {meetings?.map((m) => {
                const s = STATUS_LABELS[m.status] ?? { label: m.status, cls: '' };
                const canCancel = userCtx && (userCtx.globalRole === 'ADMIN' || can(userCtx, 'meeting:cancel', m.workingGroup.id));
                return (
                  <tr key={m.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-5 py-3.5 max-w-xs">
                      <Link href={`/meetings/${m.id}`} className="font-medium text-slate-800 hover:text-blue-700 line-clamp-1">
                        {m.title}
                      </Link>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.workingGroup.color }} />
                        <span className="text-xs text-slate-600 font-medium">{m.workingGroup.code}</span>
                      </span>
                    </td>
                    <td className="px-3 py-3.5 text-xs text-slate-500">
                      {formatDate(m.startAt)}
                    </td>
                    <td className="px-3 py-3.5 text-xs text-slate-500">
                      {FORMAT_LABELS[m.format] ?? m.format}
                    </td>
                    <td className="px-3 py-3.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>
                    </td>
                    <td className="px-3 py-3.5 text-xs text-slate-400">
                      {m._count.attendances}
                    </td>
                    <td className="px-3 py-3.5 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                      {canCancel && m.status === 'PLANNED' && (
                        <button
                          onClick={() => {
                            if (confirm('Скасувати засідання?')) cancelMutation.mutate({ id: m.id });
                          }}
                          className="text-xs text-red-500 hover:text-red-700 transition-colors"
                        >
                          Скасувати
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Нове засідання</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Робоча група *</label>
                <select
                  value={form.workingGroupId}
                  onChange={(e) => setForm((f) => ({ ...f, workingGroupId: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Оберіть групу…</option>
                  {groups?.filter((g) => canCreateInGroup(g.id)).map((g) => (
                    <option key={g.id} value={g.id}>{g.code} — {g.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Тема засідання *</label>
                <input
                  type="text"
                  maxLength={300}
                  placeholder="Засідання з розгляду стандартів…"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Дата та час *</label>
                  <input
                    type="datetime-local"
                    value={form.startAt}
                    onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Тривалість (хв)</label>
                  <input
                    type="number"
                    min={15}
                    max={480}
                    value={form.durationMins}
                    onChange={(e) => setForm((f) => ({ ...f, durationMins: Number(e.target.value) }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Формат</label>
                  <select
                    value={form.format}
                    onChange={(e) => setForm((f) => ({ ...f, format: e.target.value as typeof form.format }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="ONLINE">Онлайн</option>
                    <option value="OFFLINE">Офлайн</option>
                    <option value="HYBRID">Гібрид</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Місце / Посилання</label>
                  <input
                    type="text"
                    placeholder="https://meet.google.com/…"
                    value={form.location}
                    onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Порядок денний</label>
                <textarea
                  rows={4}
                  placeholder="1. Розгляд стандарту ДСТУ-ХХ&#10;2. Обговорення коментарів&#10;3. Різне"
                  value={form.agendaText}
                  onChange={(e) => setForm((f) => ({ ...f, agendaText: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {createError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{createError}</p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => { setShowCreate(false); setCreateError(''); }}
                  className="flex-1 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Скасувати
                </button>
                <button
                  onClick={() => {
                    if (!form.workingGroupId || !form.title || !form.startAt) return;
                    createMutation.mutate({
                      ...form,
                      startAt: new Date(form.startAt),
                    });
                  }}
                  disabled={createMutation.isLoading || !form.workingGroupId || !form.title || !form.startAt}
                  className="flex-1 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors font-medium"
                >
                  {createMutation.isLoading ? 'Створення…' : 'Створити'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
