'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, Check, Clock, AlertTriangle, User, Calendar } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { ActivityFeed } from '@/components/ActivityFeed';
import { TaskFormModal } from '@/components/TaskFormModal';
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
          className="font-mono text-light hover:text-brand"
        >
          {task.standard.code}
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
                onClick={() => {
                  if (confirm(`Видалити завдання "${task.title}"?`))
                    deleteMutation.mutate({ id: task.id });
                }}
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
