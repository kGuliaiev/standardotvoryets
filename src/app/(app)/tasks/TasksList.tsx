'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { formatDate } from '@/lib/utils';
import { useEscape } from '@/lib/useEscape';

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  OPEN: { label: 'Відкрите', cls: 'bg-[#EEF4FF] text-[#1A3A8F]' },
  IN_PROGRESS: { label: 'В роботі', cls: 'bg-[#FFF7E6] text-[#92400E]' },
  DONE: { label: 'Виконано', cls: 'bg-[#ECFDF5] text-[#065F46]' },
  CANCELLED: { label: 'Скасовано', cls: 'bg-pill text-mid' },
};

const PRIORITY_DOT: Record<string, string> = {
  HIGH: 'bg-red-500',
  MEDIUM: 'bg-amber-400',
  LOW: 'bg-emerald-400',
};

const PRIORITY_LABELS: Record<string, string> = {
  HIGH: 'Високий',
  MEDIUM: 'Середній',
  LOW: 'Низький',
};

export function TasksList() {
  const { data: session } = useSession();
  const [wgFilter, setWgFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'IN_PROGRESS' | 'DONE'>('ALL');
  const [editing, setEditing] = useState<{
    id: string;
    title: string;
    description: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    dueDate: string;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data: groups } = trpc.workingGroup.list.useQuery();
  const { data: tasks, isLoading } = trpc.task.list.useQuery({
    workingGroupId: wgFilter || undefined,
    status: statusFilter === 'ALL' ? undefined : statusFilter,
  });

  const changeStatusMutation = trpc.task.changeStatus.useMutation({
    onSuccess: () => void utils.task.list.invalidate(),
  });
  const updateMutation = trpc.task.update.useMutation({
    onSuccess: () => {
      void utils.task.list.invalidate();
      setEditing(null);
    },
    onError: (e) => setEditError(e.message),
  });
  const deleteMutation = trpc.task.delete.useMutation({
    onSuccess: () => void utils.task.list.invalidate(),
  });

  useEscape(!!editing, () => setEditing(null));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-[19px] font-extrabold text-navy">Завдання</h1>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex gap-3 flex-wrap items-center">
          <select
            value={wgFilter}
            onChange={(e) => setWgFilter(e.target.value)}
            className="select max-w-[260px]"
          >
            <option value="">Всі РГ</option>
            {groups?.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code} — {g.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            {(['ALL', 'OPEN', 'IN_PROGRESS', 'DONE'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs px-3 py-1.5 rounded-full border-[1.5px] font-semibold transition-colors ${
                  statusFilter === s
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-hairline text-mid hover:border-mid'
                }`}
              >
                {s === 'ALL'
                  ? 'Всі'
                  : s === 'OPEN'
                    ? 'Відкриті'
                    : s === 'IN_PROGRESS'
                      ? 'В роботі'
                      : 'Виконані'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-light text-sm">Завантаження…</div>
        ) : !tasks || tasks.length === 0 ? (
          <div className="py-12 text-center text-light text-sm">Завдань немає</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#FAFBFD] border-b border-hairline">
              <tr className="text-left text-[11px] text-light uppercase tracking-wide">
                <th className="px-5 py-3 font-bold">Завдання</th>
                <th className="px-3 py-3 font-bold">Стандарт</th>
                <th className="px-3 py-3 font-bold">Пріоритет</th>
                <th className="px-3 py-3 font-bold">Виконавець</th>
                <th className="px-3 py-3 font-bold">Дедлайн</th>
                <th className="px-3 py-3 font-bold">Статус</th>
                <th className="px-3 py-3 font-bold text-right">Дії</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {tasks.map((t) => {
                const status = STATUS_LABELS[t.status] ?? { label: t.status, cls: '' };
                const isDone = t.status === 'DONE';
                const isOverdue = t.dueDate && !isDone && new Date(t.dueDate) < new Date();
                return (
                  <tr key={t.id} className="hover:bg-[#FAFBFD] transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() =>
                            changeStatusMutation.mutate({
                              id: t.id,
                              status: isDone ? 'OPEN' : 'DONE',
                            })
                          }
                          className={`w-[18px] h-[18px] rounded-md border-[1.5px] inline-flex items-center justify-center transition ${
                            isDone
                              ? 'bg-emerald-500 border-emerald-500'
                              : 'border-hairline hover:border-brand'
                          }`}
                          aria-label={isDone ? 'Відновити' : 'Виконати'}
                        >
                          {isDone && <Check className="w-3 h-3 text-white" />}
                        </button>
                        <span
                          className={`font-medium ${isDone ? 'text-light line-through' : 'text-ink'}`}
                        >
                          {t.title}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/standards/${t.standardId}`}
                        className="font-mono text-xs text-mid hover:text-brand"
                      >
                        {t.standard.code}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[t.priority] ?? 'bg-slate-300'}`}
                        />
                        {PRIORITY_LABELS[t.priority] ?? t.priority}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {t.assignee ? (
                        <div className="flex items-center gap-2">
                          <Avatar
                            name={t.assignee.name}
                            avatarUrl={t.assignee.avatarUrl ?? undefined}
                            size="xs"
                          />
                          <span className="text-xs text-mid">{t.assignee.name}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-light">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {t.dueDate ? (
                        <span className={isOverdue ? 'text-red-600 font-semibold' : 'text-mid'}>
                          {formatDate(t.dueDate)}
                        </span>
                      ) : (
                        <span className="text-light">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${status.cls}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          onClick={() => {
                            setEditing({
                              id: t.id,
                              title: t.title,
                              description: t.description ?? '',
                              priority: t.priority,
                              dueDate: t.dueDate
                                ? new Date(t.dueDate).toISOString().slice(0, 10)
                                : '',
                            });
                            setEditError(null);
                          }}
                          className="p-1.5 rounded hover:bg-pill text-mid hover:text-brand transition-colors"
                          title="Редагувати"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {(session?.user.globalRole === 'ADMIN' ||
                          t.createdById === session?.user.id) && (
                          <button
                            onClick={() => {
                              if (confirm(`Видалити завдання "${t.title}"?`))
                                deleteMutation.mutate({ id: t.id });
                            }}
                            className="p-1.5 rounded hover:bg-red-50 text-mid hover:text-red-600 transition-colors"
                            title="Видалити"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
      </div>

      {/* Edit modal */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Редагувати завдання"
        size="md"
      >
        {editing && (
          <div className="space-y-4">
            <div>
              <label className="field-label">Назва *</label>
              <input
                className="input"
                value={editing.title}
                onChange={(e) => setEditing((s) => (s ? { ...s, title: e.target.value } : s))}
              />
            </div>
            <div>
              <label className="field-label">Опис</label>
              <textarea
                rows={3}
                className="textarea resize-none"
                value={editing.description}
                onChange={(e) => setEditing((s) => (s ? { ...s, description: e.target.value } : s))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="field-label">Пріоритет</label>
                <select
                  className="select"
                  value={editing.priority}
                  onChange={(e) =>
                    setEditing((s) =>
                      s
                        ? {
                            ...s,
                            priority: e.target.value as 'HIGH' | 'MEDIUM' | 'LOW',
                          }
                        : s,
                    )
                  }
                >
                  <option value="HIGH">Високий</option>
                  <option value="MEDIUM">Середній</option>
                  <option value="LOW">Низький</option>
                </select>
              </div>
              <div>
                <label className="field-label">Дедлайн</label>
                <input
                  type="date"
                  className="input"
                  value={editing.dueDate}
                  onChange={(e) => setEditing((s) => (s ? { ...s, dueDate: e.target.value } : s))}
                />
              </div>
            </div>
            {editError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-[10px] px-3 py-2">{editError}</p>
            )}
            <div className="flex gap-3 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="flex-1 btn-secondary"
              >
                Скасувати
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!editing) return;
                  if (!editing.title.trim()) {
                    setEditError('Введіть назву');
                    return;
                  }
                  const trim = (v: string): string | undefined => {
                    const t = v.trim();
                    return t === '' ? undefined : t;
                  };
                  updateMutation.mutate({
                    id: editing.id,
                    title: editing.title.trim(),
                    description: trim(editing.description),
                    priority: editing.priority,
                    dueDate: editing.dueDate ? new Date(editing.dueDate) : null,
                  });
                }}
                disabled={updateMutation.isPending}
                className="flex-1 btn-primary"
              >
                {updateMutation.isPending ? 'Збереження…' : 'Зберегти'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
