'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { formatDate } from '@/lib/utils';

const ROLE_LABELS: Record<string, string> = {
  LEADER: 'Керівник',
  DEPUTY: 'Заступник',
  SECRETARY: 'Секретар',
  MEMBER: 'Учасник',
  GUEST: 'Гість',
};

export function WorkingGroupsList() {
  const { data: session } = useSession();
  const isAdmin = session?.user.globalRole === 'ADMIN';
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', description: '', color: '#1A56DB' });
  const [error, setError] = useState('');

  const utils = trpc.useUtils();
  const { data: groups, isLoading } = trpc.workingGroup.list.useQuery();
  const createMutation = trpc.workingGroup.create.useMutation({
    onSuccess: () => {
      utils.workingGroup.list.invalidate();
      setShowCreate(false);
      setForm({ code: '', name: '', description: '', color: '#1A56DB' });
      setError('');
    },
    onError: (e) => setError(e.message),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) return;
    createMutation.mutate(form);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Робочі групи</h1>
        {isAdmin && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors"
          >
            + Нова група
          </button>
        )}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="py-16 text-center text-slate-400 text-sm">Завантаження…</div>
      ) : groups?.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm">
          <p className="text-3xl mb-3">📁</p>
          Немає доступних робочих груп
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {groups?.map((g) => {
            const myMembership = session?.user.memberships?.find((m) => m.workingGroupId === g.id);
            return (
              <Link
                key={g.id}
                href={`/working-groups/${g.id}`}
                className="bg-white rounded-xl border border-slate-200 p-5 hover:border-blue-300 hover:shadow-md transition-all group"
              >
                {/* Top row */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-9 h-9 rounded-lg flex-shrink-0"
                      style={{ backgroundColor: g.color + '22' }}
                    >
                      <span
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold"
                        style={{ color: g.color }}
                      >
                        {g.code.slice(0, 2)}
                      </span>
                    </span>
                    <div>
                      <p className="font-mono text-xs text-slate-400">{g.code}</p>
                      <p
                        className="font-semibold text-slate-800 group-hover:text-blue-700 transition-colors leading-tight"
                        style={{ borderLeft: `3px solid ${g.color}`, paddingLeft: '6px' }}
                      >
                        {g.name}
                      </p>
                    </div>
                  </div>
                  {myMembership && (
                    <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full shrink-0">
                      {ROLE_LABELS[myMembership.role] ?? myMembership.role}
                    </span>
                  )}
                </div>

                {/* Description */}
                {g.description && (
                  <p className="text-xs text-slate-500 line-clamp-2 mb-3">{g.description}</p>
                )}

                {/* Stats */}
                <div className="flex gap-4 text-xs text-slate-400 pt-3 border-t border-slate-100">
                  <span>
                    <span className="font-semibold text-slate-600">{g._count.members}</span> учасн.
                  </span>
                  <span>
                    <span className="font-semibold text-slate-600">{g._count.standards}</span> станд.
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Нова робоча група</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Код *</label>
                  <input
                    type="text"
                    maxLength={20}
                    placeholder="РГ-1"
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    required
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Колір</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.color}
                      onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                      className="w-10 h-9 rounded-lg border border-slate-200 cursor-pointer p-0.5"
                    />
                    <span className="text-xs text-slate-400 font-mono">{form.color}</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Назва *</label>
                <input
                  type="text"
                  maxLength={200}
                  placeholder="Назва робочої групи"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Опис</label>
                <textarea
                  rows={3}
                  placeholder="Короткий опис завдань групи…"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setError(''); }}
                  className="flex-1 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="flex-1 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors font-medium"
                >
                  {createMutation.isPending ? 'Створення…' : 'Створити'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
