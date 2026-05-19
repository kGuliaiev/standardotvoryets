'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Modal } from '@/components/ui/Modal';
import { Loader2 } from 'lucide-react';

interface TaskInitial {
  id?: string;
  workingGroupId?: string;
  standardId?: string;
  title?: string;
  description?: string;
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  assigneeId?: string;
  dueDate?: string; // YYYY-MM-DD
}

interface TaskFormModalProps {
  open: boolean;
  onClose: () => void;
  initial?: TaskInitial;
  /** lock WG and Standard selectors (when creating from a standard page) */
  lockedStandardId?: string;
  /** locks WG only (when on a WG page) */
  lockedWorkingGroupId?: string;
  onSaved?: () => void;
}

const PRIORITY_DOT: Record<'HIGH' | 'MEDIUM' | 'LOW', string> = {
  HIGH: 'bg-red-500',
  MEDIUM: 'bg-amber-400',
  LOW: 'bg-emerald-400',
};

export function TaskFormModal({
  open,
  onClose,
  initial,
  lockedStandardId,
  lockedWorkingGroupId,
  onSaved,
}: TaskFormModalProps) {
  const editing = !!initial?.id;
  const utils = trpc.useUtils();

  const [form, setForm] = useState({
    workingGroupId: '',
    standardId: '',
    title: '',
    description: '',
    priority: 'MEDIUM' as 'HIGH' | 'MEDIUM' | 'LOW',
    assigneeId: '',
    dueDate: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({
        workingGroupId: initial?.workingGroupId ?? lockedWorkingGroupId ?? '',
        standardId: initial?.standardId ?? lockedStandardId ?? '',
        title: initial?.title ?? '',
        description: initial?.description ?? '',
        priority: initial?.priority ?? 'MEDIUM',
        assigneeId: initial?.assigneeId ?? '',
        dueDate: initial?.dueDate ?? '',
      });
      setError(null);
    }
  }, [open, initial, lockedStandardId, lockedWorkingGroupId]);

  const { data: groups } = trpc.workingGroup.list.useQuery(undefined, {
    enabled: open && !lockedStandardId,
  });
  // When the modal is locked to a specific standard, fetch its WG to get
  // the member list (for the assignee picker) and the labels we render
  // instead of the WG/Standard selects.
  const { data: lockedStandard } = trpc.standard.byId.useQuery(
    { id: lockedStandardId ?? '' },
    { enabled: open && !!lockedStandardId },
  );
  const { data: wgDetail } = trpc.workingGroup.byId.useQuery(
    { id: lockedStandard?.workingGroupId ?? form.workingGroupId },
    {
      enabled:
        open && (lockedStandardId ? !!lockedStandard?.workingGroupId : !!form.workingGroupId),
    },
  );
  const { data: standards } = trpc.standard.list.useQuery(
    { workingGroupId: form.workingGroupId, page: 1, pageSize: 100 },
    { enabled: open && !!form.workingGroupId && !lockedStandardId },
  );

  const members = useMemo(() => wgDetail?.members ?? [], [wgDetail]);

  const createMutation = trpc.task.create.useMutation({
    onSuccess: () => {
      void utils.task.list.invalidate();
      void utils.dashboard.kpis.invalidate();
      void utils.dashboard.navCounts.invalidate();
      onSaved?.();
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  const updateMutation = trpc.task.update.useMutation({
    onSuccess: () => {
      void utils.task.list.invalidate();
      void utils.dashboard.kpis.invalidate();
      void utils.dashboard.navCounts.invalidate();
      if (initial?.id) {
        void utils.activityLog.list.invalidate({ entity: 'Task', entityId: initial.id });
      }
      onSaved?.();
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function submit() {
    setError(null);
    if (!form.title.trim()) {
      setError('Введіть назву завдання');
      return;
    }
    if (!form.standardId) {
      setError('Оберіть стандарт');
      return;
    }
    const trim = (v: string): string | undefined => {
      const t = v.trim();
      return t === '' ? undefined : t;
    };
    const due = form.dueDate ? new Date(form.dueDate) : null;
    if (editing && initial?.id) {
      updateMutation.mutate({
        id: initial.id,
        title: form.title.trim(),
        description: trim(form.description),
        priority: form.priority,
        assigneeId: form.assigneeId === '' ? null : form.assigneeId,
        dueDate: due,
      });
    } else {
      createMutation.mutate({
        standardId: form.standardId,
        title: form.title.trim(),
        description: trim(form.description),
        priority: form.priority,
        assigneeId: form.assigneeId === '' ? undefined : form.assigneeId,
        dueDate: due ?? undefined,
      });
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Редагувати завдання' : 'Нове завдання'}
      subtitle={
        editing ? undefined : "Завдання прив'язується до конкретного стандарту в робочій групі"
      }
      size="md"
    >
      <div className="space-y-4">
        {!editing && lockedStandardId ? (
          // Locked-to-standard mode: render read-only context line instead
          // of dropdowns. Caller already knows the WG + Standard, asking
          // again would be needless clicks.
          <div className="rounded-[10px] bg-page border border-hairline px-3 py-2.5 text-xs">
            {lockedStandard ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: lockedStandard.workingGroup.color }}
                  />
                  <span className="font-mono text-mid font-semibold">
                    {lockedStandard.workingGroup.code}
                  </span>
                </span>
                <span className="text-light">·</span>
                <span className="font-mono text-mid">{lockedStandard.code}</span>
                <span className="text-light">·</span>
                <span className="text-ink truncate min-w-0 flex-1">{lockedStandard.title}</span>
              </div>
            ) : (
              <span className="text-light">Завантаження контексту…</span>
            )}
          </div>
        ) : !editing ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label">Робоча група</label>
              <select
                className="select"
                value={form.workingGroupId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, workingGroupId: e.target.value, standardId: '' }))
                }
                disabled={!!lockedWorkingGroupId}
              >
                <option value="">— оберіть —</option>
                {groups?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code} — {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Стандарт</label>
              <select
                className="select"
                value={form.standardId}
                onChange={(e) => setForm((f) => ({ ...f, standardId: e.target.value }))}
                disabled={!form.workingGroupId}
              >
                <option value="">— оберіть —</option>
                {standards?.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.title.slice(0, 40)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}

        <div>
          <label className="field-label">Назва завдання *</label>
          <input
            className="input"
            placeholder="Що необхідно зробити…"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            autoFocus
          />
        </div>

        {/* Виконавець на цілий рядок — це найважливіше поле, з
            довгим списком імен. Термін і Пріоритет нижче рівними
            половинками, обидва компактні. */}
        <div>
          <label className="field-label">Виконавець</label>
          <select
            className="select"
            value={form.assigneeId}
            onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))}
          >
            <option value="">— не вказано —</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Термін</label>
            <input
              type="date"
              className="input"
              value={form.dueDate}
              onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            />
          </div>
          <div>
            <label className="field-label">Пріоритет</label>
            <div className="relative">
              <span
                className={`absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full pointer-events-none ${PRIORITY_DOT[form.priority]}`}
              />
              <select
                className="select pl-7"
                value={form.priority}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    priority: e.target.value as 'HIGH' | 'MEDIUM' | 'LOW',
                  }))
                }
              >
                <option value="HIGH">Високий</option>
                <option value="MEDIUM">Середній</option>
                <option value="LOW">Низький</option>
              </select>
            </div>
          </div>
        </div>

        <div>
          <label className="field-label">Опис (необов&apos;язково)</label>
          <textarea
            rows={3}
            className="textarea resize-none"
            placeholder="Деталі, посилання на документ…"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-[10px] px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 justify-end pt-2 border-t border-hairline">
          <button type="button" onClick={onClose} className="btn-secondary">
            Скасувати
          </button>
          <button type="button" onClick={submit} disabled={isPending} className="btn-primary">
            {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {editing ? 'Зберегти' : 'Створити'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
