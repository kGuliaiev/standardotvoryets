'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Modal } from '@/components/ui/Modal';
import { Loader2, Pencil } from 'lucide-react';

/**
 * Lets the leader / secretary edit a document's card metadata in
 * place — without re-uploading the file. Tweakable fields match the
 * ones exposed by the upload modal (type, version, note, isCurrent,
 * allowEdits) so the two flows feel symmetrical.
 *
 * The underlying file (filename, s3Key, sizeBytes) is left alone; a
 * new revision still requires the upload flow.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  doc: {
    id: string;
    filename: string;
    type: string;
    version: string;
    note: string | null;
    isCurrent: boolean;
    allowEdits: boolean;
  } | null;
  onSaved?: () => void;
}

const TYPE_OPTIONS: {
  value:
    | 'DRAFT_STANDARD'
    | 'TECH_SPEC'
    | 'FEEDBACK'
    | 'MEETING_MINUTES'
    | 'AGENDA'
    | 'ATTACHMENT'
    | 'FINAL';
  label: string;
}[] = [
  { value: 'TECH_SPEC', label: 'ТЗ (технічне завдання)' },
  { value: 'DRAFT_STANDARD', label: 'Чернетка стандарту' },
  { value: 'FEEDBACK', label: 'Відгук' },
  { value: 'FINAL', label: 'Фінальна версія' },
  { value: 'AGENDA', label: 'Порядок денний' },
  { value: 'MEETING_MINUTES', label: 'Протокол' },
  { value: 'ATTACHMENT', label: 'Додатковий матеріал' },
];

export function DocumentEditMetaModal({ open, onClose, doc, onSaved }: Props) {
  const utils = trpc.useUtils();
  const [type, setType] = useState<(typeof TYPE_OPTIONS)[number]['value']>('DRAFT_STANDARD');
  const [version, setVersion] = useState('');
  const [note, setNote] = useState('');
  const [isCurrent, setIsCurrent] = useState(false);
  const [allowEdits, setAllowEdits] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed local state from the doc whenever the modal reopens with a
  // different document.
  useEffect(() => {
    if (open && doc) {
      setType(doc.type as (typeof TYPE_OPTIONS)[number]['value']);
      setVersion(doc.version);
      setNote(doc.note ?? '');
      setIsCurrent(doc.isCurrent);
      setAllowEdits(doc.allowEdits);
      setError(null);
    }
  }, [open, doc]);

  const update = trpc.document.updateMeta.useMutation({
    onSuccess: () => {
      void utils.standard.byId.invalidate();
      void utils.document.list.invalidate();
      void utils.document.byWorkingGroup.invalidate();
      onSaved?.();
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  if (!doc) return null;

  const isDocx = doc.filename.toLowerCase().endsWith('.docx');

  function save() {
    if (!doc) return;
    if (!version.trim()) {
      setError('Введіть версію');
      return;
    }
    setError(null);
    update.mutate({
      documentId: doc.id,
      type,
      version: version.trim(),
      note: note.trim() || null,
      isCurrent,
      allowEdits: isDocx ? allowEdits : false,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Редагувати картку документа"
      subtitle={doc.filename}
      size="md"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Тип *</label>
            <select
              className="select"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Версія *</label>
            <input
              className="input font-mono"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="v1.0"
            />
          </div>
        </div>

        <div>
          <label className="field-label">Коментар (необов&apos;язково)</label>
          <textarea
            rows={3}
            className="textarea resize-none"
            placeholder="Що змінилося в цій версії…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isCurrent}
              onChange={(e) => setIsCurrent(e.target.checked)}
              className="w-4 h-4 accent-brand"
            />
            <span className="text-ink">Позначити як актуальну версію</span>
          </label>
          <label
            className={`flex items-start gap-2 text-sm ${
              isDocx ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
            }`}
            title={
              isDocx
                ? 'Документ можна буде відкривати у редакторі та лишати запити на правки'
                : 'Доступно лише для файлів .docx'
            }
          >
            <input
              type="checkbox"
              checked={allowEdits}
              disabled={!isDocx}
              onChange={(e) => setAllowEdits(e.target.checked)}
              className="w-4 h-4 accent-brand mt-0.5"
            />
            <span className="text-ink flex items-center gap-1.5">
              <Pencil className="w-3.5 h-3.5 text-mid" />
              Дозволити правки (колаборативне редагування)
              {!isDocx && <span className="text-[11px] text-light">— тільки для .docx</span>}
            </span>
          </label>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-[10px] px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 justify-end pt-2 border-t border-hairline">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
            disabled={update.isPending}
          >
            Скасувати
          </button>
          <button type="button" onClick={save} disabled={update.isPending} className="btn-primary">
            {update.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Зберегти
          </button>
        </div>
      </div>
    </Modal>
  );
}
