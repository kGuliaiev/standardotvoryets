'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Loader2, AlertTriangle } from 'lucide-react';

/**
 * Single shared confirmation dialog. Wraps the existing Modal with
 * a title / message / two buttons (cancel + confirm). Used in place
 * of native `confirm()` so destructive actions match the rest of the
 * UI and so the consuming component can show backend errors inline.
 *
 * Usage:
 * ```tsx
 * <ConfirmModal
 *   open={!!pending}
 *   title="Видалити завдання?"
 *   message={`"${pending?.title}" буде видалено остаточно.`}
 *   confirmLabel="Видалити"
 *   destructive
 *   isPending={deleteMutation.isPending}
 *   error={deleteError}
 *   onConfirm={() => deleteMutation.mutate({ id: pending!.id })}
 *   onClose={() => setPending(null)}
 * />
 * ```
 *
 * `destructive` swaps the confirm button to red. `onConfirm` should
 * trigger the mutation — the parent decides when to close (typically
 * onSuccess) so an error keeps the modal open with the message
 * visible.
 */
interface Props {
  open: boolean;
  title: string;
  /** Body text. Pass a string for plain copy or a node for richer
   *  layouts (lists of affected items, warning callouts, etc.). */
  message: React.ReactNode;
  /** Defaults to "Підтвердити". */
  confirmLabel?: string;
  /** Defaults to "Скасувати". */
  cancelLabel?: string;
  /** Red-tinted confirm button + warning icon in the title row.
   *  Use for irreversible actions. */
  destructive?: boolean;
  /** Shown spinning beside the confirm label while the mutation
   *  is in flight, and disables both buttons. */
  isPending?: boolean;
  /** When set, displayed inline above the buttons. The modal stays
   *  open so the user can retry. */
  error?: string | null;
  /** Type-to-confirm: when set, the confirm button stays disabled until the
   *  user types this exact string (trimmed). Use for high-stakes irreversible
   *  actions (e.g. deleting a standard + all its data). */
  confirmText?: string;
  /** Label/hint rendered above the type-to-confirm input. */
  confirmTextLabel?: React.ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Підтвердити',
  cancelLabel = 'Скасувати',
  destructive = false,
  isPending = false,
  error,
  confirmText,
  confirmTextLabel,
  onConfirm,
  onClose,
}: Props) {
  const [typed, setTyped] = useState('');
  // Clear the type-to-confirm field whenever the modal closes.
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const requiresText = Boolean(confirmText);
  const textMatches = !requiresText || typed.trim() === confirmText;
  const confirmDisabled = isPending || !textMatches;

  // Enter to confirm (when allowed). Esc is already handled by Modal itself.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter' && !confirmDisabled) {
        e.preventDefault();
        onConfirm();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, confirmDisabled, onConfirm]);

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          {destructive && (
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          )}
          <div className="text-sm text-mid flex-1">{message}</div>
        </div>
        {requiresText && (
          <div className="space-y-1.5">
            {confirmTextLabel && (
              <label className="block text-xs text-mid">{confirmTextLabel}</label>
            )}
            <input
              type="text"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmText}
              className="w-full rounded-lg border border-hairline bg-page px-3 py-2 text-sm text-ink font-mono outline-none focus:border-brand"
            />
          </div>
        )}
        {error && (
          <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/30 rounded-md px-3 py-2">
            {error}
          </p>
        )}
        <div className="flex gap-3 justify-end pt-2 border-t border-hairline">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={isPending}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={
              destructive
                ? 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                : 'btn-primary'
            }
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
