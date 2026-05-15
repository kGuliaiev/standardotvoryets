'use client';

import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { formatDate } from '@/lib/utils';
import { useEscape } from '@/lib/useEscape';
import { UserX, UserCheck, Pencil, X, Plus } from 'lucide-react';

type WGRole = 'LEADER' | 'DEPUTY' | 'SECRETARY' | 'MEMBER' | 'GUEST';

const GLOBAL_ROLE_LABELS: Record<string, { label: string; cls: string }> = {
  ADMIN: { label: 'Адмін', cls: 'bg-purple-100 text-purple-700' },
  DIRECTOR: { label: 'Керівник центру', cls: 'bg-amber-100 text-amber-700' },
  USER: { label: 'Користувач', cls: 'bg-pill text-mid' },
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

  const addMemberMutation = trpc.workingGroup.addMember.useMutation({
    onSuccess: () => void utils.user.list.invalidate(),
  });
  const removeMemberMutation = trpc.workingGroup.removeMember.useMutation({
    onSuccess: () => void utils.user.list.invalidate(),
  });
  const changeMemberRoleMutation = trpc.workingGroup.changeMemberRole.useMutation({
    onSuccess: () => void utils.user.list.invalidate(),
  });

  const [editingUser, setEditingUser] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);
  const [newWgId, setNewWgId] = useState('');
  const [newWgRole, setNewWgRole] = useState<WGRole>('MEMBER');
  const editingUserData = users?.find((u) => u.id === editingUser?.id);

  useEscape(showInvite, () => {
    setShowInvite(false);
    setInviteError('');
  });
  useEscape(!!editingUser, () => setEditingUser(null));

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
        <h1 className="text-2xl font-bold text-ink">Користувачі</h1>
        <button
          onClick={() => setShowInvite(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors"
        >
          + Запросити
        </button>
      </div>

      {/* Search */}
      <div className="bg-card rounded-xl border border-hairline p-4">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-light"
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
            className="w-full pl-9 pr-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-hairline overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-light text-sm">Завантаження…</div>
        ) : filtered?.length === 0 ? (
          <div className="py-16 text-center text-light text-sm">
            <p className="text-2xl mb-2">👤</p>
            Користувачів не знайдено
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-page border-b border-hairline">
              <tr className="text-left text-xs text-mid uppercase tracking-wide">
                <th className="px-5 py-3 font-medium">Користувач</th>
                <th className="px-3 py-3 font-medium">Глобальна роль</th>
                <th className="px-3 py-3 font-medium">Робочі групи</th>
                <th className="px-3 py-3 font-medium">Зареєстрований</th>
                <th className="px-3 py-3 font-medium text-right">Дії</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {filtered?.map((u) => {
                const roleInfo = GLOBAL_ROLE_LABELS[u.globalRole] ?? {
                  label: u.globalRole,
                  cls: '',
                };
                const isSelf = u.id === session?.user.id;
                return (
                  <tr key={u.id} className="hover:bg-page transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.name} avatarUrl={u.avatarUrl ?? undefined} size="sm" />
                        <div>
                          <p className="font-medium text-ink">
                            {u.name}
                            {isSelf && <span className="ml-1.5 text-xs text-light">(ви)</span>}
                          </p>
                          <p className="text-xs text-light">{u.email}</p>
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
                          className="text-xs border border-hairline rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                          <span className="text-xs text-light">—</span>
                        ) : (
                          u.memberships.map((m) => (
                            <span
                              key={m.workingGroup.id}
                              className="inline-flex items-center gap-1 text-xs bg-pill text-mid px-1.5 py-0.5 rounded"
                            >
                              <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ backgroundColor: m.workingGroup.color }}
                              />
                              {m.workingGroup.code}
                              <span className="text-light">
                                ·{WG_ROLE_LABELS[m.role] ?? m.role}
                              </span>
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-xs text-light">{formatDate(u.createdAt)}</td>
                    <td className="px-3 py-3.5 text-right">
                      <div className="inline-flex gap-1.5">
                        <button
                          onClick={() => setEditingUser({ id: u.id, name: u.name, email: u.email })}
                          className="text-xs text-mid hover:text-brand inline-flex items-center gap-1 border border-hairline rounded-lg px-2.5 py-1 hover:bg-page"
                          title="Редагувати"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Редагувати
                        </button>
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
                            className="text-xs text-mid hover:text-ink inline-flex items-center gap-1 border border-hairline rounded-lg px-2.5 py-1 hover:bg-page disabled:opacity-50"
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
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Summary */}
        {users && (
          <div className="border-t border-hairline px-5 py-3">
            <span className="text-xs text-light">
              Всього {users.length} користувач
              {users.length === 1 ? '' : users.length < 5 ? 'и' : 'ів'}
            </span>
          </div>
        )}
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-ink mb-4">Запросити користувача</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-mid mb-1">Email *</label>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-mid mb-1">Робоча група *</label>
                <select
                  value={inviteForm.workingGroupId}
                  onChange={(e) => setInviteForm((f) => ({ ...f, workingGroupId: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <label className="block text-xs font-medium text-mid mb-1">Роль в групі</label>
                <select
                  value={inviteForm.role}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, role: e.target.value as typeof inviteForm.role }))
                  }
                  className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="flex-1 py-2 text-sm border border-hairline rounded-lg hover:bg-page transition-colors"
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

      {/* Edit user modal */}
      <Modal
        open={!!editingUser}
        onClose={() => setEditingUser(null)}
        title={editingUser ? `Редагувати: ${editingUser.name}` : ''}
        subtitle={editingUser?.email}
        size="md"
      >
        {editingUserData && (
          <div className="space-y-4">
            <div>
              <label className="field-label">Глобальна роль</label>
              <select
                className="select"
                value={editingUserData.globalRole}
                onChange={(e) =>
                  changeRoleMutation.mutate({
                    userId: editingUserData.id,
                    globalRole: e.target.value as 'ADMIN' | 'DIRECTOR' | 'USER',
                  })
                }
                disabled={editingUserData.id === session?.user.id}
              >
                <option value="USER">Користувач</option>
                <option value="DIRECTOR">Керівник центру</option>
                <option value="ADMIN">Адмін</option>
              </select>
              {editingUserData.id === session?.user.id && (
                <p className="text-[11px] text-light mt-1">Власну роль змінити не можна</p>
              )}
            </div>

            <div>
              <label className="field-label">Робочі групи</label>
              <p className="text-[11px] text-light mb-2">
                Користувач може бути учасником декількох груп з різними ролями
              </p>
              {editingUserData.memberships.length === 0 ? (
                <p className="text-sm text-light italic">Поки не є учасником жодної групи</p>
              ) : (
                <div className="space-y-1.5">
                  {editingUserData.memberships.map((m) => (
                    <div
                      key={m.workingGroup.id}
                      className="flex items-center gap-2 bg-page border border-hairline rounded-[10px] px-3 py-2"
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: m.workingGroup.color }}
                      />
                      <span className="font-mono text-xs font-bold text-ink flex-1">
                        {m.workingGroup.code}
                      </span>
                      <select
                        value={m.role}
                        onChange={(e) =>
                          changeMemberRoleMutation.mutate({
                            workingGroupId: m.workingGroup.id,
                            userId: editingUserData.id,
                            role: e.target.value as WGRole,
                          })
                        }
                        className="text-xs border border-hairline rounded-md px-2 py-1 bg-card text-ink focus:outline-none focus:border-brand"
                      >
                        {Object.entries(WG_ROLE_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => {
                          if (confirm(`Видалити з групи ${m.workingGroup.code}?`)) {
                            removeMemberMutation.mutate({
                              workingGroupId: m.workingGroup.id,
                              userId: editingUserData.id,
                            });
                          }
                        }}
                        className="p-1 text-mid hover:text-red-600 rounded hover:bg-red-50"
                        title="Видалити з групи"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add WG */}
            <div className="border-t border-hairline pt-4">
              <label className="field-label">Додати до групи</label>
              <div className="flex gap-2">
                <select
                  className="select flex-1"
                  value={newWgId}
                  onChange={(e) => setNewWgId(e.target.value)}
                >
                  <option value="">— оберіть групу —</option>
                  {groups
                    ?.filter(
                      (g) => !editingUserData.memberships.some((m) => m.workingGroup.id === g.id),
                    )
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.code} — {g.name}
                      </option>
                    ))}
                </select>
                <select
                  className="select w-40"
                  value={newWgRole}
                  onChange={(e) => setNewWgRole(e.target.value as WGRole)}
                >
                  {Object.entries(WG_ROLE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    if (!newWgId) return;
                    addMemberMutation.mutate({
                      workingGroupId: newWgId,
                      userId: editingUserData.id,
                      role: newWgRole,
                    });
                    setNewWgId('');
                    setNewWgRole('MEMBER');
                  }}
                  disabled={!newWgId || addMemberMutation.isPending}
                  className="btn-primary shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-2 border-t border-hairline">
              <button onClick={() => setEditingUser(null)} className="btn-secondary">
                Закрити
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
