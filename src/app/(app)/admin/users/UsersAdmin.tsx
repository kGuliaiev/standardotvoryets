'use client';

import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui/Avatar';
import { formatDate } from '@/lib/utils';
import { useEscape } from '@/lib/useEscape';
import { UserX, UserCheck } from 'lucide-react';

const GLOBAL_ROLE_LABELS: Record<string, { label: string; cls: string }> = {
  ADMIN: { label: 'Адмін', cls: 'bg-purple-100 text-purple-700' },
  DIRECTOR: { label: 'Керівник центру', cls: 'bg-amber-100 text-amber-700' },
  USER: { label: 'Користувач', cls: 'bg-slate-100 text-slate-600' },
};

const WG_ROLE_LABELS: Record<string, string> = {
  LEADER: 'Керівник',
  DEPUTY: 'Заст.',
  SECRETARY: 'Секр.',
  MEMBER: 'Учасник',
  GUEST: 'Гість',
};

export function UsersAdmin() {
  const { data: session } = useSession();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: '',
    workingGroupId: '',
    role: 'MEMBER' as const,
  });
  const [inviteError, setInviteError] = useState('');

  const isAdmin = session?.user.globalRole === 'ADMIN';

  const utils = trpc.useUtils();
  const { data: users, isLoading } = trpc.user.list.useQuery(undefined, { enabled: isAdmin });
  const { data: groups } = trpc.workingGroup.list.useQuery(undefined, { enabled: isAdmin });

  const changeRoleMutation = trpc.user.changeGlobalRole.useMutation({
    onSuccess: () => void utils.user.list.invalidate(),
  });

  const inviteMutation = trpc.user.invite.useMutation({
    onSuccess: () => {
      void utils.user.list.invalidate();
      setShowInvite(false);
      setInviteForm({ email: '', workingGroupId: '', role: 'MEMBER' });
      setInviteError('');
    },
    onError: (e) => setInviteError(e.message),
  });

  const setActiveMutation = trpc.user.setActive.useMutation({
    onSuccess: () => void utils.user.list.invalidate(),
  });

  useEscape(showInvite, () => {
    setShowInvite(false);
    setInviteError('');
  });

  useEffect(() => {
    if (session && !isAdmin) router.replace('/dashboard');
  }, [session, isAdmin, router]);

  if (session && !isAdmin) return null;

  const filtered = users?.filter(
    (u) =>
      !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Користувачі</h1>
        <button
          onClick={() => setShowInvite(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors"
        >
          + Запросити
        </button>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Пошук за ім'ям або email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Завантаження…</div>
        ) : filtered?.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            <p className="text-2xl mb-2">👤</p>
            Користувачів не знайдено
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-5 py-3 font-medium">Користувач</th>
                <th className="px-3 py-3 font-medium">Глобальна роль</th>
                <th className="px-3 py-3 font-medium">Робочі групи</th>
                <th className="px-3 py-3 font-medium">Зареєстрований</th>
                <th className="px-3 py-3 font-medium text-right">Дії</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered?.map((u) => {
                const roleInfo = GLOBAL_ROLE_LABELS[u.globalRole] ?? {
                  label: u.globalRole,
                  cls: '',
                };
                const isSelf = u.id === session?.user.id;
                return (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} avatarUrl={u.avatarUrl ?? undefined} size="sm" />
                        <div>
                          <p className="font-medium text-slate-800">
                            {u.name}
                            {isSelf && <span className="ml-1.5 text-xs text-slate-400">(ви)</span>}
                          </p>
                          <p className="text-xs text-slate-400">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5">
                      {isSelf ? (
                        <span
                          className={`text-xs px-2 py-1 rounded-full font-medium ${roleInfo.cls}`}
                        >
                          {roleInfo.label}
                        </span>
                      ) : (
                        <select
                          value={u.globalRole}
                          onChange={(e) =>
                            changeRoleMutation.mutate({
                              userId: u.id,
                              globalRole: e.target.value as 'ADMIN' | 'DIRECTOR' | 'USER',
                            })
                          }
                          className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="USER">Користувач</option>
                          <option value="DIRECTOR">Керівник центру</option>
                          <option value="ADMIN">Адмін</option>
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {u.memberships.length === 0 ? (
                          <span className="text-xs text-slate-300">—</span>
                        ) : (
                          u.memberships.map((m) => (
                            <span
                              key={m.workingGroup.id}
                              className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded"
                            >
                              <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ backgroundColor: m.workingGroup.color }}
                              />
                              {m.workingGroup.code}
                              <span className="text-slate-400">
                                ·{WG_ROLE_LABELS[m.role] ?? m.role}
                              </span>
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-xs text-slate-400">
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      {!isSelf && (
                        <button
                          onClick={() => {
                            const wantActive = !(u as { isActive?: boolean }).isActive
                              ? true
                              : false;
                            if (
                              confirm(
                                `${wantActive ? 'Активувати' : 'Деактивувати'} користувача "${u.name}"?`,
                              )
                            ) {
                              setActiveMutation.mutate({ userId: u.id, isActive: wantActive });
                            }
                          }}
                          disabled={setActiveMutation.isPending}
                          className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 border border-slate-200 rounded-lg px-2.5 py-1 hover:bg-slate-50 disabled:opacity-50"
                          title={
                            (u as { isActive?: boolean }).isActive === false
                              ? 'Активувати'
                              : 'Деактивувати'
                          }
                        >
                          {(u as { isActive?: boolean }).isActive === false ? (
                            <>
                              <UserCheck className="w-3.5 h-3.5" />
                              Активувати
                            </>
                          ) : (
                            <>
                              <UserX className="w-3.5 h-3.5" />
                              Деактивувати
                            </>
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Summary */}
        {users && (
          <div className="border-t border-slate-100 px-5 py-3">
            <span className="text-xs text-slate-400">
              Всього {users.length} користувач
              {users.length === 1 ? '' : users.length < 5 ? 'и' : 'ів'}
            </span>
          </div>
        )}
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Запросити користувача</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Робоча група *
                </label>
                <select
                  value={inviteForm.workingGroupId}
                  onChange={(e) => setInviteForm((f) => ({ ...f, workingGroupId: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Оберіть групу…</option>
                  {groups?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.code} — {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Роль в групі
                </label>
                <select
                  value={inviteForm.role}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, role: e.target.value as typeof inviteForm.role }))
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="LEADER">Керівник РГ</option>
                  <option value="DEPUTY">Заступник керівника</option>
                  <option value="SECRETARY">Секретар</option>
                  <option value="MEMBER">Учасник</option>
                  <option value="GUEST">Гість / Спостерігач</option>
                </select>
              </div>
              {inviteError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{inviteError}</p>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => {
                    setShowInvite(false);
                    setInviteError('');
                  }}
                  className="flex-1 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Скасувати
                </button>
                <button
                  onClick={() => {
                    if (!inviteForm.email || !inviteForm.workingGroupId) return;
                    inviteMutation.mutate({
                      email: inviteForm.email,
                      workingGroupId: inviteForm.workingGroupId,
                      role: inviteForm.role,
                    });
                  }}
                  disabled={
                    inviteMutation.isPending || !inviteForm.email || !inviteForm.workingGroupId
                  }
                  className="flex-1 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors font-medium"
                >
                  {inviteMutation.isPending ? 'Відправка…' : 'Запросити'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
