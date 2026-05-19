'use client';

import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { useState } from 'react';
import {
  Pencil,
  Plus,
  Trash2,
  ArrowRight,
  Archive,
  Undo2,
  Loader2,
  ChevronDown,
} from 'lucide-react';

type Entity = 'Standard' | 'Meeting' | 'Task' | 'WorkingGroup' | 'User' | 'Document' | 'Vote';

const REVERSIBLE_ACTIONS = new Set(['UPDATE', 'STATUS_CHANGE', 'ARCHIVE', 'RESTORE']);
const REVERSIBLE_ENTITIES = new Set(['Standard', 'Meeting', 'Task', 'WorkingGroup', 'User']);

const ACTION_META: Record<string, { label: string; icon: typeof Pencil; cls: string }> = {
  CREATE: { label: 'Створено', icon: Plus, cls: 'bg-[#ECFDF5] text-[#065F46]' },
  UPDATE: { label: 'Оновлено', icon: Pencil, cls: 'bg-[#EEF4FF] text-[#1A3A8F]' },
  DELETE: { label: 'Видалено', icon: Trash2, cls: 'bg-[#FEF2F2] text-[#991B1B]' },
  STATUS_CHANGE: {
    label: 'Зміна статусу',
    icon: ArrowRight,
    cls: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  },
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

/**
 * Fallback diff: compute before/after diff client-side when the stored
 * `diff` JSON field is empty (older entries written before audit.ts started
 * computing diffs for STATUS_CHANGE etc.).
 */
function computeDiffClient(
  before: unknown,
  after: unknown,
): Record<string, { before: unknown; after: unknown }> | null {
  if (!before && !after) return null;
  if (typeof before !== 'object' && typeof after !== 'object') return null;
  const beforeObj = (before ?? {}) as Record<string, unknown>;
  const afterObj = (after ?? {}) as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]));
  const result: Record<string, { before: unknown; after: unknown }> = {};
  for (const k of keys) {
    if (k === 'createdAt' || k === 'updatedAt') continue;
    const a: unknown = beforeObj[k];
    const b: unknown = afterObj[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      result[k] = { before: a, after: b };
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function ActivityFeed({
  entity,
  entityId,
  title = 'Журнал змін',
  collapsible = true,
  defaultOpen = false,
}: {
  entity: Entity;
  entityId: string;
  title?: string;
  /** Render header as a click-toggle that hides the list. Default true. */
  collapsible?: boolean;
  /** Whether the feed starts expanded. Default false — feeds are noisy
   *  by nature, prefer the page header staying calm until the user
   *  opts in to seeing changes.
   */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { data: session } = useSession();
  const utils = trpc.useUtils();
  const { data: entries, isLoading } = trpc.activityLog.list.useQuery({
    entity,
    entityId,
    limit: 30,
  });

  // Selected log entry to revert. Drives the confirmation modal — we
  // dropped the native confirm()/alert() pair because the error case
  // showed an ugly stack trace in the system dialog.
  const [pendingRestore, setPendingRestore] = useState<{
    logId: string;
    label: string;
  } | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

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
      setPendingRestore(null);
      setRestoreError(null);
    },
    onError: (e) => setRestoreError(e.message),
  });

  return (
    <div className="card overflow-hidden">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="card-head w-full flex items-center justify-between hover:bg-pill/30 transition-colors"
        >
          <h3 className="font-bold text-ink">{title}</h3>
          <div className="flex items-center gap-2">
            {entries && entries.length > 0 && (
              <span className="text-[11px] text-light">{entries.length}</span>
            )}
            <ChevronDown
              size={16}
              className={`text-mid transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </div>
        </button>
      ) : (
        <div className="card-head">
          <h3 className="font-bold text-ink">{title}</h3>
          {entries && entries.length > 0 && (
            <span className="text-[11px] text-light">{entries.length}</span>
          )}
        </div>
      )}
      {collapsible && !open ? null : isLoading ? (
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
            const storedDiff = e.diff as Record<string, { before: unknown; after: unknown }> | null;
            const diff = storedDiff ?? computeDiffClient(e.before, e.after);
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
                            setRestoreError(null);
                            setPendingRestore({
                              logId: e.id,
                              label: `${meta.label} · ${new Date(e.createdAt).toLocaleString(
                                'uk-UA',
                                {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                },
                              )} · ${e.user.name}`,
                            });
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
                    {/* Attendance entries are stored under the Meeting
                        entity but carry `userName` + `status` in their
                        before/after payload — detect by shape rather
                        than by entity so the journal renders them as a
                        coloured status pill row instead of the generic
                        Поле/Було/Стало diff table. */}
                    {isAttendanceEntry(e.before, e.after) ? (
                      <AttendanceChange before={e.before} after={e.after} />
                    ) : (
                      diff &&
                      Object.keys(diff).length > 0 && (
                        <div className="mt-2.5 border border-hairline rounded-[10px] overflow-hidden">
                          <table className="w-full text-[11px]">
                            <thead className="bg-page">
                              <tr className="text-left text-light uppercase tracking-wide">
                                <th className="px-3 py-1.5 font-bold w-1/4">Поле</th>
                                <th className="px-3 py-1.5 font-bold w-3/8">Було</th>
                                <th className="px-3 py-1.5 font-bold w-3/8">Стало</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-hairline">
                              {Object.entries(diff).map(([field, val]) => (
                                <tr key={field}>
                                  <td className="px-3 py-1.5 font-semibold text-ink align-top">
                                    {FIELD_LABELS[field] ?? field}
                                  </td>
                                  <td className="px-3 py-1.5 text-mid line-through bg-red-50 dark:bg-red-900/20 align-top break-words">
                                    {fmtValue(val.before)}
                                  </td>
                                  <td className="px-3 py-1.5 text-ink bg-emerald-50 dark:bg-emerald-900/20 align-top break-words">
                                    {fmtValue(val.after)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Restore confirmation modal — replaces native confirm()/alert()
          so the dialog matches the rest of the app and lets us surface
          server-side errors (e.g. "немає targetUserId у старому записі")
          inline instead of in a system pop-up. */}
      <Modal
        open={!!pendingRestore}
        onClose={() => {
          setPendingRestore(null);
          setRestoreError(null);
        }}
        title="Скасувати зміну?"
        size="sm"
      >
        {pendingRestore && (
          <div className="space-y-4">
            <p className="text-sm text-mid">
              Стан буде повернуто до значень, що існували до цієї дії. Створиться окремий запис у
              журналі (RESTORE) — попередня дія залишається у історії.
            </p>
            <div className="rounded-[10px] border border-hairline bg-page/40 px-3 py-2 text-xs text-ink">
              {pendingRestore.label}
            </div>
            {restoreError && (
              <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/30 rounded-md px-3 py-2">
                {restoreError}
              </p>
            )}
            <div className="flex gap-3 justify-end pt-2 border-t border-hairline">
              <button
                type="button"
                onClick={() => {
                  setPendingRestore(null);
                  setRestoreError(null);
                }}
                className="btn-secondary"
                disabled={restoreMutation.isPending}
              >
                Закрити
              </button>
              <button
                type="button"
                onClick={() => restoreMutation.mutate({ logId: pendingRestore.logId })}
                disabled={restoreMutation.isPending}
                className="btn-primary"
              >
                {restoreMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Скасувати зміну
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Detect attendance entries by their payload shape rather than by
 *  the audit entity column — they're stored under entity="Meeting"
 *  alongside other meeting changes so they show up in the same feed. */
function isAttendanceEntry(before: unknown, after: unknown): boolean {
  const a = after as { userName?: unknown; status?: unknown } | null;
  const b = before as { userName?: unknown; status?: unknown } | null;
  const payload = a ?? b;
  return !!(payload && typeof payload === 'object' && 'userName' in payload && 'status' in payload);
}

/**
 * Compact "Пилип Іванов:  Очікується → ✓ Присутній" line for the
 * attendance-change activity entries. Pulls the user name + statuses
 * out of the audit log's before/after JSON which the meeting router
 * writes specifically for this display.
 */
function AttendanceChange({ before, after }: { before: unknown; after: unknown }) {
  const a = (after as { status?: string; userName?: string } | null) ?? null;
  const b = (before as { status?: string; userName?: string } | null) ?? null;
  if (!a) return null;
  const name = a.userName ?? b?.userName ?? null;
  const bStatus = b?.status;
  const aStatus = a.status;
  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
      {name && <span className="text-mid font-medium">{name}</span>}
      <span className="text-light">·</span>
      {bStatus ? (
        <StatusPill value={bStatus} />
      ) : (
        <span className="text-light italic">не зафіксовано</span>
      )}
      <span className="text-light">→</span>
      {aStatus && <StatusPill value={aStatus} />}
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    CONFIRMED: {
      label: '✓ Присутній',
      cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    },
    DECLINED: {
      label: '✕ Відсутній',
      cls: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    },
    PENDING: {
      label: '⋯ Очікується',
      cls: 'bg-pill text-mid',
    },
  };
  const m = map[value] ?? { label: value, cls: 'bg-pill text-mid' };
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
