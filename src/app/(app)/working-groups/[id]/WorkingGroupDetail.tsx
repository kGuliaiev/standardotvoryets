'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate } from '@/lib/utils';
import { can } from '@/lib/rbac';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';

const TABS = [
  { id: 'info', label: 'Інформація' },
  { id: 'members', label: 'Учасники' },
  { id: 'standards', label: 'Стандарти' },
  { id: 'meetings', label: 'Засідання' },
] as const;

type TabId = typeof TABS[number]['id'];

const ROLE_OPTIONS: Array<{ value: WorkingGroupRole; label: string }> = [
  { value: 'LEADER', label: 'Керівник РГ' },
  { value: 'DEPUTY', label: 'Заступник керівника' },
  { value: 'SECRETARY', label: 'Секретар' },
  { value: 'MEMBER', label: 'Учасник' },
  { value: 'GUEST', label: 'Гість / Спостерігач' },
];

const FORMAT_LABELS: Record<string, string> = {
  ONLINE: 'Онлайн',
  OFFLINE: 'Офлайн',
  HYBRID: 'Гібрид',
};

const MEETING_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PLANNED: { label: 'Заплановано', cls: 'bg-blue-50 text-blue-700' },
  IN_PROGRESS: { label: 'Проводиться', cls: 'bg-amber-50 text-amber-700' },
  COMPLETED: { label: 'Завершено', cls: 'bg-green-50 text-green-700' },
  CANCELLED: { label: 'Скасовано', cls: 'bg-slate-100 text-slate-400' },
};

interface Props { id: string }

export function WorkingGroupDetail({ id }: Props) {
  const { data: session } = useSession();
  const [tab, setTab] = useState<TabId>('info');
  const [showAddMember, setShowAddMember] = useState(false);
  const [showEditName, setShowEditName] = useState(false);
  const [addForm, setAddForm] = useState({ email: '', role: 'MEMBER' as WorkingGroupRole });
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [addError, setAddError] = useState('');

  const utils = trpc.useUtils();
  const { data: group, isLoading } = trpc.workingGroup.byId.useQuery({ id });
  const { data: standards } = trpc.standard.list.useQuery(
    { workingGroupId: id, page: 1, pageSize: 50 },
    { enabled: tab === 'standards' }
  );
  const { data: meetings } = trpc.meeting.list.useQuery(
    { workingGroupId: id },
    { enabled: tab === 'meetings' }
  );

  const inviteMutation = trpc.user.invite.useMutation({
    onSuccess: () => {
      utils.workingGroup.byId.invalidate({ id });
      setShowAddMember(false);
      setAddForm({ email: '', role: 'MEMBER' });
      setAddError('');
    },
    onError: (e) => setAddError(e.message),
  });

  const removeMutation = trpc.workingGroup.removeMember.useMutation({
    onSuccess: () => utils.workingGroup.byId.invalidate({ id }),
  });

  const changeRoleMutation = trpc.workingGroup.changeMemberRole.useMutation({
    onSuccess: () => utils.workingGroup.byId.invalidate({ id }),
  });

  const updateMutation = trpc.workingGroup.update.useMutation({
    onSuccess: () => {
      utils.workingGroup.byId.invalidate({ id });
      setShowEditName(false);
    },
  });

  if (isLoading) {
    return <div className="py-16 text-center text-slate-400 text-sm">Завантаження…</div>;
  }
  if (!group) {
    return <div className="py-16 text-center text-slate-400 text-sm">Групу не знайдено</div>;
  }

  const userCtx = session ? {
    globalRole: session.user.globalRole as GlobalRole,
    memberships: (session.user.memberships ?? []) as Array<{ workingGroupId: string; role: WorkingGroupRole }>,
  } : null;
  const isAdmin = session?.user.globalRole === 'ADMIN';
  const canInvite = userCtx ? (isAdmin || can(userCtx, 'wg:invite', id)) : false;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link href="/working-groups" className="text-slate-400 hover:text-slate-600 text-sm transition-colors">
            ← Робочі групи
          </Link>
          <span className="text-slate-200">/</span>
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: group.color }}
            />
            <span className="font-mono text-sm text-slate-500">{group.code}</span>
            <h1 className="text-xl font-bold text-slate-900">{group.name}</h1>
          </div>
        </div>
        {canInvite && (
          <button
            onClick={() => {
              setEditForm({ name: group.name, description: group.description ?? '' });
              setShowEditName(true);
            }}
            className="text-xs text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
          >
            Редагувати
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex gap-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {t.label}
              {t.id === 'members' && (
                <span className="ml-1.5 text-xs bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5">
                  {group.members.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'info' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Код</p>
              <p className="font-mono font-semibold text-slate-800">{group.code}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Колір</p>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded" style={{ backgroundColor: group.color }} />
                <span className="font-mono text-sm text-slate-600">{group.color}</span>
              </div>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Назва</p>
              <p className="font-semibold text-slate-800">{group.name}</p>
            </div>
            {group.description && (
              <div className="col-span-2">
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Опис</p>
                <p className="text-sm text-slate-600 leading-relaxed">{group.description}</p>
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-100">
            <div className="text-center">
              <p className="text-2xl font-bold text-slate-800">{group.members.length}</p>
              <p className="text-xs text-slate-400 mt-0.5">Учасників</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-slate-800">{group._count.standards}</p>
              <p className="text-xs text-slate-400 mt-0.5">Стандартів</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-slate-800">{group._count.meetings}</p>
              <p className="text-xs text-slate-400 mt-0.5">Засідань</p>
            </div>
          </div>
        </div>
      )}

      {tab === 'members' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <span className="text-sm font-medium text-slate-700">
              {group.members.length} учасник{group.members.length === 1 ? '' : group.members.length < 5 ? 'и' : 'ів'}
            </span>
            {canInvite && (
              <button
                onClick={() => setShowAddMember(true)}
                className="text-xs bg-blue-700 text-white px-3 py-1.5 rounded-lg hover:bg-blue-800 transition-colors font-medium"
              >
                + Додати учасника
              </button>
            )}
          </div>

          {/* Members list */}
          {group.members.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">Учасників немає</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-5 py-3 font-medium">Учасник</th>
                  <th className="px-3 py-3 font-medium">Email</th>
                  <th className="px-3 py-3 font-medium">Роль</th>
                  <th className="px-3 py-3 font-medium">З</th>
                  {canInvite && <th className="px-3 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {group.members.map((m) => (
                  <tr key={m.userId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={m.user.name} size="sm" />
                        <span className="font-medium text-slate-800">{m.user.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-500 text-xs">{m.user.email}</td>
                    <td className="px-3 py-3">
                      {canInvite && session?.user.id !== m.userId ? (
                        <select
                          value={m.role}
                          onChange={(e) =>
                            changeRoleMutation.mutate({
                              workingGroupId: id,
                              userId: m.userId,
                              role: e.target.value as WorkingGroupRole,
                            })
                          }
                          className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                          {ROLE_OPTIONS.find((o) => o.value === m.role)?.label ?? m.role}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400">{formatDate(m.joinedAt)}</td>
                    {canInvite && (
                      <td className="px-3 py-3 text-right">
                        {session?.user.id !== m.userId && (
                          <button
                            onClick={() => {
                              if (confirm(`Видалити ${m.user.name} з групи?`)) {
                                removeMutation.mutate({ workingGroupId: id, userId: m.userId });
                              }
                            }}
                            className="text-xs text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded hover:bg-red-50"
                          >
                            Видалити
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'standards' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <span className="text-sm font-medium text-slate-700">Стандарти групи</span>
            <Link
              href={`/standards/new?wg=${id}`}
              className="text-xs bg-blue-700 text-white px-3 py-1.5 rounded-lg hover:bg-blue-800 transition-colors font-medium"
            >
              + Новий стандарт
            </Link>
          </div>
          {!standards || standards.items.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">Стандартів немає</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-5 py-3 font-medium">Код / Назва</th>
                  <th className="px-3 py-3 font-medium">Статус</th>
                  <th className="px-3 py-3 font-medium">Прогрес</th>
                  <th className="px-3 py-3 font-medium">Дедлайн</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {standards.items.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 max-w-xs">
                      <Link href={`/standards/${s.id}`} className="block group">
                        <span className="font-mono text-xs text-slate-400 group-hover:text-blue-500">{s.code}</span>
                        <p className="font-medium text-slate-800 group-hover:text-blue-700 line-clamp-1 mt-0.5">{s.title}</p>
                      </Link>
                    </td>
                    <td className="px-3 py-3.5">
                      <StatusBadge status={s.status} size="sm" />
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full" style={{ width: `${s.progress}%` }} />
                        </div>
                        <span className="text-xs text-slate-400">{s.progress}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-xs text-slate-500">
                      {s.deadline ? formatDate(s.deadline) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'meetings' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <span className="text-sm font-medium text-slate-700">Засідання групи</span>
            <Link
              href={`/meetings/new?wg=${id}`}
              className="text-xs bg-blue-700 text-white px-3 py-1.5 rounded-lg hover:bg-blue-800 transition-colors font-medium"
            >
              + Нове засідання
            </Link>
          </div>
          {!meetings || meetings.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">Засідань немає</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-5 py-3 font-medium">Тема</th>
                  <th className="px-3 py-3 font-medium">Дата</th>
                  <th className="px-3 py-3 font-medium">Формат</th>
                  <th className="px-3 py-3 font-medium">Статус</th>
                  <th className="px-3 py-3 font-medium">Учасники</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {meetings.map((m) => {
                  const s = MEETING_STATUS_LABELS[m.status] ?? { label: m.status, cls: '' };
                  return (
                    <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5 max-w-xs">
                        <Link href={`/meetings/${m.id}`} className="font-medium text-slate-800 hover:text-blue-700 line-clamp-1">
                          {m.title}
                        </Link>
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Add member modal */}
      {showAddMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Додати учасника</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Роль</label>
                <select
                  value={addForm.role}
                  onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value as WorkingGroupRole }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              {addError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{addError}</p>
              )}
              <p className="text-xs text-slate-400">
                Якщо користувач ще не зареєстрований — буде надіслано запрошення на email.
              </p>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => { setShowAddMember(false); setAddError(''); }}
                  className="flex-1 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Скасувати
                </button>
                <button
                  onClick={() => {
                    if (!addForm.email) return;
                    inviteMutation.mutate({ email: addForm.email, workingGroupId: id, role: addForm.role });
                  }}
                  disabled={inviteMutation.isLoading || !addForm.email}
                  className="flex-1 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors font-medium"
                >
                  {inviteMutation.isLoading ? 'Додавання…' : 'Додати'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit group modal */}
      {showEditName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Редагувати групу</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Назва</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Опис</label>
                <textarea
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowEditName(false)}
                  className="flex-1 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Скасувати
                </button>
                <button
                  onClick={() => updateMutation.mutate({ id, name: editForm.name, description: editForm.description })}
                  disabled={updateMutation.isLoading}
                  className="flex-1 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors font-medium"
                >
                  {updateMutation.isLoading ? 'Збереження…' : 'Зберегти'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
