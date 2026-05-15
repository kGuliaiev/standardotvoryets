'use client';

import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import { Avatar } from '@/components/ui/Avatar';
import { Pencil, Plus, Trash2, ArrowRight, Archive, Undo2, Loader2 } from 'lucide-react';

type Entity = 'Standard' | 'Meeting' | 'Task' | 'WorkingGroup' | 'User' | 'Document' | 'Vote';

const REVERSIBLE_ACTIONS = new Set(['UPDATE', 'STATUS_CHANGE', 'ARCHIVE', 'RESTORE']);
const REVERSIBLE_ENTITIES = new Set(['Standard', 'Meeting', 'Task', 'WorkingGroup', 'User']);

const ACTION_META: Record<string, { label: string; icon: typeof Pencil; cls: string }> = {
  CREATE: { label: 'Створено', icon: Plus, cls: 'bg-[#ECFDF5] text-[#065F46]' },
  UPDATE: { label: 'Оновлено', icon: Pencil, cls: 'bg-[#EEF4FF] text-[#1A3A8F]' },
  DELETE: { label: 'Видалено', icon: Trash2, cls: 'bg-[#FEF2F2] text-[#991B1B]' },
  STATUS_CHANGE: { label: 'Зміна статусу', icon: ArrowRight, cls: 'bg-[#FFF7E6] text-[#92400E]' },
  ARCHIVE: { label: 'Архівовано', icon: Archive, cls: 'bg-pill text-mid' },
  RESTORE: { label: 'Відновлено', icon: Undo2, cls: 'bg-[#ECFDF5] text-[#065F46]' },
};

const FIELD_LABELS: Record<string, string> = {
  title: 'Назва',
  description: 'Опис',
  isoAnalog: 'ISO',
  category: 'Категорія',
  deadline: 'Дедлайн',
  responsibleId: 'Відповідальний',
  progress: 'Прогрес',
  status: 'Статус',
  format: 'Формат',
  location: 'Локація',
  startAt: 'Дата початку',
  durationMins: 'Тривалість (хв)',
  agendaText: 'Порядок денний',
  minutesText: 'Протокол',
  priority: 'Пріоритет',
  assigneeId: 'Виконавець',
  dueDate: 'Термін',
  name: 'Назва',
  code: 'Код',
  color: 'Колір',
  isArchived: 'Архівовано',
  isActive: 'Активний',
  globalRole: 'Глобальна роль',
};

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (v instanceof Date) return v.toLocaleString('uk-UA');
  if (typeof v === 'string') {
    // try to detect ISO date
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString('uk-UA');
    }
    if (v.length > 80) return v.slice(0, 80) + '…';
    return v;
  }
  if (typeof v === 'boolean') return v ? 'Так' : 'Ні';
  if (typeof v === 'number') return String(v);
  return JSON.stringify(v);
}

export function ActivityFeed({
  entity,
  entityId,
  title = 'Журнал змін',
}: {
  entity: Entity;
  entityId: string;
  title?: string;
}) {
  const { data: session } = useSession();
  const utils = trpc.useUtils();
  const { data: entries, isLoading } = trpc.activityLog.list.useQuery({
    entity,
    entityId,
    limit: 30,
  });

  const restoreMutation = trpc.activityLog.restore.useMutation({
    onSuccess: () => {
      void utils.activityLog.list.invalidate({ entity, entityId });
      // Invalidate the relevant entity query so list/detail pages refresh
      if (entity === 'Standard') {
        void utils.standard.byId.invalidate({ id: entityId });
        void utils.standard.list.invalidate();
      } else if (entity === 'Meeting') {
        void utils.meeting.byId.invalidate({ id: entityId });
        void utils.meeting.list.invalidate();
      } else if (entity === 'Task') {
        void utils.task.list.invalidate();
      } else if (entity === 'WorkingGroup') {
        void utils.workingGroup.byId.invalidate({ id: entityId });
        void utils.workingGroup.list.invalidate();
      } else if (entity === 'User') {
        void utils.user.list.invalidate();
      }
      void utils.dashboard.kpis.invalidate();
      void utils.dashboard.navCounts.invalidate();
    },
    onError: (e) => alert('Не вдалося скасувати: ' + e.message),
  });

  return (
    <div className="card overflow-hidden">
      <div className="card-head">
        <h3 className="font-bold text-ink">{title}</h3>
        {entries && entries.length > 0 && (
          <span className="text-[11px] text-light">{entries.length}</span>
        )}
      </div>
      {isLoading ? (
        <div className="py-8 text-center text-light text-sm">Завантаження…</div>
      ) : !entries || entries.length === 0 ? (
        <div className="py-8 text-center text-light text-sm">Журнал порожній</div>
      ) : (
        <ul className="divide-y divide-hairline">
          {entries.map((e) => {
            const meta = ACTION_META[e.action] ?? {
              label: e.action,
              icon: Pencil,
              cls: 'bg-pill text-mid',
            };
            const Icon = meta.icon;
            const diff = e.diff as Record<string, { before: unknown; after: unknown }> | null;
            const canUndo =
              REVERSIBLE_ACTIONS.has(e.action) &&
              REVERSIBLE_ENTITIES.has(e.entity) &&
              e.before !== null &&
              (session?.user.id === e.userId || session?.user.globalRole === 'ADMIN');
            const isRestoring =
              restoreMutation.isPending && restoreMutation.variables?.logId === e.id;
            return (
              <li key={e.id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <Avatar name={e.user.name} avatarUrl={e.user.avatarUrl ?? undefined} size="xs" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink text-[13px]">{e.user.name}</span>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5 ${meta.cls}`}
                      >
                        <Icon className="w-3 h-3" />
                        {meta.label}
                      </span>
                      <span className="text-[11px] text-light font-mono ml-auto">
                        {new Date(e.createdAt).toLocaleString('uk-UA', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {canUndo && (
                        <button
                          onClick={() => {
                            if (confirm('Скасувати цю зміну? Стан буде повернуто.')) {
                              restoreMutation.mutate({ logId: e.id });
                            }
                          }}
                          disabled={restoreMutation.isPending}
                          className="text-[10px] font-bold inline-flex items-center gap-1 text-mid hover:text-brand border border-hairline rounded-full px-2 py-0.5 hover:border-brand disabled:opacity-50"
                          title="Скасувати зміну"
                        >
                          {isRestoring ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Undo2 className="w-3 h-3" />
                          )}
                          Скасувати
                        </button>
                      )}
                    </div>
                    {e.note && <p className="text-xs text-mid mt-1.5">{e.note}</p>}
                    {diff && Object.keys(diff).length > 0 && (
                      <div className="mt-2.5 border border-hairline rounded-[10px] overflow-hidden">
                        <table className="w-full text-[11px]">
                          <thead className="bg-[#FAFBFD]">
                            <tr className="text-left text-light uppercase tracking-wide">
                              <th className="px-3 py-1.5 font-bold w-1/4">Поле</th>
                              <th className="px-3 py-1.5 font-bold w-3/8">Було</th>
                              <th className="px-3 py-1.5 font-bold w-3/8">Стало</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-hairline">
                            {Object.entries(diff).map(([field, val]) => (
                              <tr key={field}>
                                <td className="px-3 py-1.5 font-semibold text-ink">
                                  {FIELD_LABELS[field] ?? field}
                                </td>
                                <td className="px-3 py-1.5 text-mid line-through bg-red-50/40">
                                  {fmtValue(val.before)}
                                </td>
                                <td className="px-3 py-1.5 text-ink bg-emerald-50/40">
                                  {fmtValue(val.after)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
