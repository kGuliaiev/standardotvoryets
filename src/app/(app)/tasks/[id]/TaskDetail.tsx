'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Pencil,
  Trash2,
  Check,
  Clock,
  AlertTriangle,
  User,
  Calendar,
  X,
  Plus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { ActivityFeed } from '@/components/ActivityFeed';
import { TaskFormModal } from '@/components/TaskFormModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { formatDate, formatDateTime } from '@/lib/utils';

const STATUS_TONE: Record<string, { label: string; cls: string }> = {
  OPEN: { label: 'Відкрите', cls: 'bg-[#EEF4FF] text-[#1A3A8F]' },
  IN_PROGRESS: {
    label: 'В роботі',
    cls: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  },
  DONE: { label: 'Виконано', cls: 'bg-[#ECFDF5] text-[#065F46]' },
  CANCELLED: { label: 'Скасовано', cls: 'bg-pill text-mid' },
};

const PRIORITY: Record<string, { label: string; dot: string }> = {
  HIGH: { label: 'Високий', dot: 'bg-red-500' },
  MEDIUM: { label: 'Середній', dot: 'bg-amber-400' },
  LOW: { label: 'Низький', dot: 'bg-emerald-400' },
};

export function TaskDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const utils = trpc.useUtils();
  const { data: task, isLoading } = trpc.task.byId.useQuery({ id });
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invalidate = () => {
    void utils.task.byId.invalidate({ id });
    void utils.task.list.invalidate();
    void utils.activityLog.list.invalidate({ entity: 'Task', entityId: id });
    void utils.dashboard.kpis.invalidate();
    void utils.dashboard.navCounts.invalidate();
  };

  const toggleStatusMutation = trpc.task.changeStatus.useMutation({
    onSuccess: invalidate,
  });
  const deleteMutation = trpc.task.delete.useMutation({
    onSuccess: () => router.push('/tasks'),
  });

  if (isLoading) {
    return <div className="py-16 text-center text-light text-sm">Завантаження…</div>;
  }
  if (!task) {
    return <div className="py-16 text-center text-light text-sm">Завдання не знайдено</div>;
  }

  const status = STATUS_TONE[task.status] ?? { label: task.status, cls: '' };
  const priority = PRIORITY[task.priority] ?? { label: task.priority, dot: 'bg-slate-300' };
  const isDone = task.status === 'DONE';
  const isOverdue = !isDone && task.dueDate && new Date(task.dueDate) < new Date();

  const canEdit =
    session?.user.globalRole === 'ADMIN' ||
    task.createdById === session?.user.id ||
    task.assigneeId === session?.user.id;
  const canDelete = session?.user.globalRole === 'ADMIN' || task.createdById === session?.user.id;

  return (
    <div className="space-y-5 pg-enter">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-mid">
        <Link href="/tasks" className="hover:text-brand">
          Завдання
        </Link>
        <span>/</span>
        <Link
          href={`/standards/${task.standardId}`}
          title={task.standard.indeks ? `Внутрішній код: ${task.standard.code}` : undefined}
          className="font-mono text-light hover:text-brand"
        >
          {task.standard.indeks ?? task.standard.code}
        </Link>
      </nav>

      {/* Header card */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 mb-2">
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ backgroundColor: task.standard.workingGroup.color }}
              />
              <span className="text-sm font-medium text-mid">
                {task.standard.workingGroup.code}
              </span>
              <span className="text-light">·</span>
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold`}>
                <span className={`w-1.5 h-1.5 rounded-full ${priority.dot}`} />
                {priority.label}
              </span>
            </div>
            <h1
              className={`text-xl font-bold mb-3 ${isDone ? 'text-light line-through' : 'text-ink'}`}
            >
              {task.title}
            </h1>
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-[11px] px-2.5 py-1 rounded-full font-semibold ${status.cls}`}>
                {status.label}
              </span>
              {isOverdue && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold rounded-full px-2 py-0.5 pill-rose">
                  <AlertTriangle className="w-3 h-3" /> Прострочено
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            {canEdit && (
              <button
                onClick={() =>
                  toggleStatusMutation.mutate({
                    id: task.id,
                    status: isDone ? 'OPEN' : 'DONE',
                  })
                }
                disabled={toggleStatusMutation.isPending}
                className="btn-secondary"
              >
                <Check className="w-3.5 h-3.5" />
                {isDone ? 'Відкрити' : 'Виконано'}
              </button>
            )}
            {canEdit && (
              <button onClick={() => setEditOpen(true)} className="btn-secondary">
                <Pencil className="w-3.5 h-3.5" />
                Редагувати
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => setDeleteOpen(true)}
                className="btn-secondary text-red-600 hover:text-red-700 hover:border-red-300"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Видалити
              </button>
            )}
          </div>
        </div>

        {/* Description */}
        {task.description && (
          <div className="mt-5 pt-4 border-t border-hairline">
            <p className="field-label mb-1">Опис</p>
            <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">
              {task.description}
            </p>
          </div>
        )}

        {/* Checklist — subtasks with full task-like fields (title +
            description + isDone + dueDate + assignee + reorderable
            order). Managed by task creator, assignee, or anyone with
            task:editAny. */}
        <TaskChecklist
          taskId={id}
          workingGroupId={task.standard.workingGroupId}
          items={task.checklistItems ?? []}
          onChanged={invalidate}
        />
      </div>

      {/* Audit/meta grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetaCard
          title="Створено"
          icon={<Calendar className="w-3.5 h-3.5" />}
          when={task.createdAt}
          by={task.createdBy}
          accentClass="bg-brand"
        />
        {task.completedAt && task.completedBy ? (
          <MetaCard
            title="Закрито"
            icon={<Check className="w-3.5 h-3.5" />}
            when={task.completedAt}
            by={task.completedBy}
            accentClass="bg-emerald-500"
          />
        ) : (
          <div className="card p-5 opacity-70">
            <p className="field-label flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Не закрите
            </p>
            <p className="text-sm text-mid mt-1.5">
              {task.dueDate ? `Очікувано до ${formatDate(task.dueDate)}` : 'Без терміну'}
            </p>
          </div>
        )}

        <div className="card p-5">
          <p className="field-label flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" />
            Виконавець
          </p>
          {task.assignee ? (
            <div className="flex items-center gap-2.5 mt-2">
              <Avatar
                name={task.assignee.name}
                avatarUrl={task.assignee.avatarUrl ?? undefined}
                size="sm"
              />
              <span className="text-sm text-ink">{task.assignee.name}</span>
            </div>
          ) : (
            <p className="text-sm text-light mt-2">Не призначено</p>
          )}
        </div>

        <div className="card p-5">
          <p className="field-label flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            Дедлайн
          </p>
          {task.dueDate ? (
            <p className={`text-sm mt-2 font-mono ${isOverdue ? 'text-red-600' : 'text-ink'}`}>
              {formatDate(task.dueDate)}
            </p>
          ) : (
            <p className="text-sm text-light mt-2">Не вказано</p>
          )}
        </div>
      </div>

      {/* Activity feed */}
      <ActivityFeed entity="Task" entityId={id} title="Журнал змін" />

      {/* Edit modal */}
      <TaskFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initial={{
          id: task.id,
          workingGroupId: task.standard.workingGroupId,
          standardId: task.standardId,
          title: task.title,
          description: task.description ?? '',
          priority: task.priority,
          assigneeId: task.assigneeId ?? '',
          dueDate: task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : '',
        }}
        onSaved={invalidate}
      />

      <ConfirmModal
        open={deleteOpen}
        title="Видалити завдання?"
        message={
          <>
            <span className="font-semibold text-ink">«{task.title}»</span> буде видалено остаточно.
            Цю дію не можна скасувати.
          </>
        }
        confirmLabel="Видалити"
        destructive
        isPending={deleteMutation.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() =>
          deleteMutation.mutate({ id: task.id }, { onSuccess: () => setDeleteOpen(false) })
        }
      />
    </div>
  );
}

interface ChecklistItem {
  id: string;
  title: string;
  description: string | null;
  isDone: boolean;
  order: number;
  dueDate: Date | string | null;
  assigneeId: string | null;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
}

function TaskChecklist({
  taskId,
  workingGroupId,
  items,
  onChanged,
}: {
  taskId: string;
  workingGroupId: string;
  items: ChecklistItem[];
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState('');
  // Which row is expanded (showing extra fields).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Which row is title-editing.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');

  // WG members for the assignee dropdown — same source as the parent
  // task's edit modal.
  const { data: wg } = trpc.workingGroup.byId.useQuery({ id: workingGroupId });
  const members = wg?.members ?? [];

  const add = trpc.task.checklistAdd.useMutation({ onSuccess: onChanged });
  const toggle = trpc.task.checklistToggle.useMutation({ onSuccess: onChanged });
  const update = trpc.task.checklistUpdate.useMutation({
    onSuccess: () => {
      setEditingId(null);
      onChanged();
    },
  });
  const remove = trpc.task.checklistDelete.useMutation({ onSuccess: onChanged });
  const reorder = trpc.task.checklistReorder.useMutation({ onSuccess: onChanged });

  const done = items.filter((i) => i.isDone).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const submitDraft = () => {
    const t = draft.trim();
    if (!t) return;
    add.mutate({ taskId, title: t });
    setDraft('');
  };

  // Swap item[idx] with its neighbour (idx + delta), then persist.
  const move = (idx: number, delta: -1 | 1) => {
    const next = [...items];
    const swap = idx + delta;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap]!, next[idx]!];
    reorder.mutate({ taskId, orderedIds: next.map((i) => i.id) });
  };

  const toIsoDate = (d: Date | string | null | undefined): string =>
    d ? new Date(d).toISOString().slice(0, 10) : '';

  return (
    <div className="mt-5 pt-4 border-t border-hairline">
      <div className="flex items-center justify-between mb-3">
        <p className="field-label mb-0">
          Підзадачі
          {total > 0 && (
            <span className="ml-2 text-xs text-light font-normal">
              {done}/{total}
            </span>
          )}
        </p>
        {total > 0 && (
          <div className="flex items-center gap-2 min-w-[120px]">
            <div className="flex-1 h-1.5 rounded-full bg-pill overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] text-mid font-mono w-8 text-right">{pct}%</span>
          </div>
        )}
      </div>

      {items.length > 0 && (
        <ul className="space-y-1 mb-3">
          {items.map((item, idx) => {
            const isExpanded = expandedId === item.id;
            const isTitleEditing = editingId === item.id;
            const dueOverdue = !item.isDone && item.dueDate && new Date(item.dueDate) < new Date();
            return (
              <li
                key={item.id}
                className="group rounded-[10px] border border-hairline bg-card hover:border-brand/40 transition-colors"
              >
                <div className="flex items-start gap-2 px-2.5 py-1.5">
                  <input
                    type="checkbox"
                    checked={item.isDone}
                    disabled={toggle.isPending}
                    onChange={() => toggle.mutate({ id: item.id })}
                    className="mt-1 w-4 h-4 accent-brand cursor-pointer shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    {isTitleEditing ? (
                      <input
                        type="text"
                        value={editingDraft}
                        autoFocus
                        onChange={(e) => setEditingDraft(e.target.value)}
                        onBlur={() => {
                          const t = editingDraft.trim();
                          if (t && t !== item.title) update.mutate({ id: item.id, title: t });
                          else setEditingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.currentTarget.blur();
                          } else if (e.key === 'Escape') {
                            setEditingId(null);
                          }
                        }}
                        className="input w-full text-sm py-1"
                      />
                    ) : (
                      <span
                        className={`text-sm cursor-text leading-relaxed block ${
                          item.isDone ? 'line-through text-light' : 'text-ink'
                        }`}
                        onClick={() => {
                          setEditingId(item.id);
                          setEditingDraft(item.title);
                        }}
                      >
                        {item.title}
                      </span>
                    )}
                    {/* Row meta — assignee chip + due chip. Only rendered
                        when at least one is set, so a bare item stays
                        compact. */}
                    {!isTitleEditing && (item.assignee ?? item.dueDate) && (
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {item.assignee && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-mid">
                            <Avatar
                              name={item.assignee.name}
                              avatarUrl={item.assignee.avatarUrl ?? undefined}
                              size="xs"
                            />
                            <span className="truncate max-w-[160px]">{item.assignee.name}</span>
                          </span>
                        )}
                        {item.dueDate && (
                          <span
                            className={`text-[11px] font-mono ${dueOverdue ? 'text-red-600 dark:text-red-400 font-bold' : 'text-mid'}`}
                          >
                            📅 {formatDate(item.dueDate)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Reorder + expand + delete — appear on row hover. */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      type="button"
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0 || reorder.isPending}
                      title="Вгору"
                      className="p-1 rounded text-light hover:text-ink hover:bg-pill disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(idx, 1)}
                      disabled={idx === items.length - 1 || reorder.isPending}
                      title="Вниз"
                      className="p-1 rounded text-light hover:text-ink hover:bg-pill disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      title={isExpanded ? 'Згорнути' : 'Розгорнути деталі'}
                      className={`p-1 rounded transition-colors ${isExpanded ? 'text-brand bg-brand-soft/40' : 'text-light hover:text-ink hover:bg-pill'}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate({ id: item.id })}
                      disabled={remove.isPending}
                      title="Видалити підзадачу"
                      className="p-1 rounded text-light hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {/* Expanded editor — description / due / assignee.
                    Autosave on blur (textarea) / change (date + select)
                    so there's no explicit save button. */}
                {isExpanded && (
                  <div className="border-t border-hairline px-3 py-3 space-y-3 bg-page/30">
                    <div>
                      <label className="field-label">Опис</label>
                      <textarea
                        rows={2}
                        className="textarea resize-none w-full text-sm"
                        placeholder="Деталі, посилання…"
                        defaultValue={item.description ?? ''}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          const norm = v === '' ? null : v;
                          if (norm !== (item.description ?? null)) {
                            update.mutate({ id: item.id, description: norm });
                          }
                        }}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="field-label">Термін</label>
                        <input
                          type="date"
                          className="input"
                          defaultValue={toIsoDate(item.dueDate)}
                          onChange={(e) => {
                            const v = e.target.value;
                            update.mutate({ id: item.id, dueDate: v ? new Date(v) : null });
                          }}
                        />
                      </div>
                      <div>
                        <label className="field-label">Виконавець</label>
                        <select
                          className="select"
                          value={item.assigneeId ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            update.mutate({ id: item.id, assigneeId: v === '' ? null : v });
                          }}
                        >
                          <option value="">— не вказано —</option>
                          {members.map((m) => (
                            <option key={m.userId} value={m.userId}>
                              {m.user.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Quick-add */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submitDraft();
            }
          }}
          placeholder="Нова підзадача…"
          className="input flex-1 text-sm py-1.5"
          disabled={add.isPending}
        />
        <button
          type="button"
          onClick={submitDraft}
          disabled={!draft.trim() || add.isPending}
          className="btn-secondary inline-flex items-center gap-1 py-1.5 px-3 text-sm disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" />
          Додати
        </button>
      </div>
    </div>
  );
}

function MetaCard({
  title,
  icon,
  when,
  by,
  accentClass,
}: {
  title: string;
  icon: React.ReactNode;
  when: Date | string;
  by: { id: string; name: string; avatarUrl: string | null };
  accentClass: string;
}) {
  return (
    <div className="card p-5 relative overflow-hidden">
      <span className={`absolute top-0 left-0 right-0 h-[3px] ${accentClass}`} />
      <p className="field-label flex items-center gap-1.5">
        {icon}
        {title}
      </p>
      <div className="flex items-center gap-2.5 mt-2">
        <Avatar name={by.name} avatarUrl={by.avatarUrl ?? undefined} size="sm" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink truncate">{by.name}</p>
          <p className="text-[11px] text-light font-mono">{formatDateTime(when)}</p>
        </div>
      </div>
    </div>
  );
}
