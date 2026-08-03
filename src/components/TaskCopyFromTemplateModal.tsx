'use client';

import { useEffect, useState } from 'react';
import { Loader2, FileText, AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { trpc } from '@/lib/trpc/client';
import { toast } from '@/lib/toast';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Target standard — cloned tasks land here, dates rebased against its
   *  stage plan. */
  targetStandardId: string;
  /** True when the target already has tasks — the modal shows a
   *  radio for append vs replace and forces an explicit choice. */
  targetHasExistingTasks: boolean;
  onSuccess?: () => void;
}

export function TaskCopyFromTemplateModal({
  open,
  onClose,
  targetStandardId,
  targetHasExistingTasks,
  onSuccess,
}: Props) {
  const utils = trpc.useUtils();
  const { data: templates, isLoading } = trpc.standard.templates.useQuery(
    { exclude: targetStandardId },
    { enabled: open },
  );

  const [sourceId, setSourceId] = useState<string>('');
  const [mode, setMode] = useState<'append' | 'replace'>('append');

  useEffect(() => {
    if (open) {
      setSourceId('');
      setMode('append');
    }
  }, [open]);

  const copy = trpc.task.copyFromTemplate.useMutation({
    onSuccess: (r) => {
      const parts = [`${r.createdTasks} задач · ${r.createdSubtasks} підзадач`];
      if (r.replaced > 0) parts.push(`видалено ${r.replaced}`);
      toast.success(`Скопійовано: ${parts.join(', ')}`);
      void utils.task.list.invalidate();
      void utils.standard.byId.invalidate({ id: targetStandardId });
      onSuccess?.();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Modal open={open} onClose={onClose} title="Створити задачі з шаблону" size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!sourceId || copy.isPending) return;
          copy.mutate({
            sourceStandardId: sourceId,
            targetStandardId,
            mode,
            resetAssignees: true,
          });
        }}
        className="space-y-4"
      >
        <p className="text-sm text-mid">
          Обрана з шаблону структура задач і підзадач буде скопійована у цей стандарт. Дедлайни
          автоматично зміщуються так, щоб зберегти відношення до відповідного етапу поетапного
          плану.
        </p>

        {/* Source picker */}
        <div>
          <label className="field-label">Шаблон-джерело</label>
          {isLoading ? (
            <div className="py-6 text-center text-light text-sm">Завантаження…</div>
          ) : !templates || templates.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-hairline p-4 text-sm text-mid text-center">
              Немає стандартів, позначених як шаблон. Відкрийте потрібний стандарт → «Редагувати» →
              «Шаблон задач для інших стандартів».
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
              {templates.map((t) => (
                <label
                  key={t.id}
                  className={`flex items-start gap-3 p-2.5 rounded-[10px] border cursor-pointer transition-colors ${
                    sourceId === t.id
                      ? 'border-brand bg-brand-soft/30'
                      : 'border-hairline hover:border-brand/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="template-source"
                    checked={sourceId === t.id}
                    onChange={() => setSourceId(t.id)}
                    className="mt-1 w-4 h-4 accent-brand"
                  />
                  <span
                    className="w-2 h-2 rounded-full mt-2 shrink-0"
                    style={{ backgroundColor: t.workingGroup.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink truncate">
                      {t.indeks ?? t.code} — {t.title}
                    </div>
                    <div className="text-[11px] text-mid mt-0.5 inline-flex items-center gap-1.5">
                      <FileText className="w-3 h-3" />
                      {t._count.tasks} задач · {t.workingGroup.code}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Existing-tasks handling */}
        {targetHasExistingTasks && (
          <div className="rounded-[10px] border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
            <div className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>У цього стандарту вже є задачі. Виберіть, що з ними зробити:</span>
            </div>
            <div className="space-y-1.5 pl-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="copy-mode"
                  checked={mode === 'append'}
                  onChange={() => setMode('append')}
                  className="w-4 h-4 accent-brand"
                />
                <span className="text-ink">Залишити існуючі + додати нові з шаблону</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="copy-mode"
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                  className="w-4 h-4 accent-brand"
                />
                <span className="text-red-700 dark:text-red-300 font-medium">
                  Видалити всі існуючі й замінити на задачі з шаблону
                </span>
              </label>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-3 border-t border-hairline">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 btn-secondary"
            disabled={copy.isPending}
          >
            Скасувати
          </button>
          <button
            type="submit"
            disabled={!sourceId || copy.isPending}
            className="flex-1 btn-primary disabled:opacity-50"
          >
            {copy.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {copy.isPending
              ? 'Копіювання…'
              : mode === 'replace'
                ? 'Замінити на шаблон'
                : 'Скопіювати'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
