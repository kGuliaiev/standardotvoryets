'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Modal } from '@/components/ui/Modal';
import { Loader2, UploadCloud, FileText, Pencil } from 'lucide-react';

interface DocumentUploadModalProps {
  open: boolean;
  onClose: () => void;
  standardId: string;
  onSaved?: () => void;
  /** When true the "Дозволити правки" checkbox starts ticked — used
   *  by the "Імпортувати з Word" entry point that's specifically
   *  intended for collaborative-editing uploads. */
  defaultAllowEdits?: boolean;
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

const ALLOWED_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
];
const ALLOWED_HINT = 'PDF, DOCX, XLSX, ODT';

export function DocumentUploadModal({
  open,
  onClose,
  standardId,
  onSaved,
  defaultAllowEdits = false,
}: DocumentUploadModalProps) {
  const utils = trpc.useUtils();
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('v1.0');
  const [type, setType] = useState<(typeof TYPE_OPTIONS)[number]['value']>('DRAFT_STANDARD');
  const [isCurrent, setIsCurrent] = useState(true);
  // Default OFF: most uploads are reference material; the leader opts in
  // for documents they want the WG to collaboratively edit. Override
  // via `defaultAllowEdits` when the modal opens from a CTA that
  // explicitly intends a collaborative-edit upload.
  const [allowEdits, setAllowEdits] = useState(defaultAllowEdits);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<'idle' | 'getting-url' | 'uploading' | 'confirming'>(
    'idle',
  );

  useEffect(() => {
    if (open) {
      setFile(null);
      setVersion('v1.0');
      setType('DRAFT_STANDARD');
      setIsCurrent(true);
      setAllowEdits(defaultAllowEdits);
      setNote('');
      setError(null);
      setProgress('idle');
    }
  }, [open, defaultAllowEdits]);

  // Only .docx can be inlined as editable HTML — the server will convert
  // it via mammoth. For PDF/XLSX/etc. we disable the option.
  const fileIsDocx = useMemo(() => {
    if (!file) return false;
    return (
      file.name.toLowerCase().endsWith('.docx') ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  }, [file]);
  useEffect(() => {
    // Reset the flag automatically when the user swaps to a non-docx
    // file so we don't ship a stale `true` to the server.
    if (!fileIsDocx && allowEdits) setAllowEdits(false);
  }, [fileIsDocx, allowEdits]);

  // Server-side proxy upload — keeps the browser away from S3 CORS pain.
  // See src/app/api/standards/[id]/documents/route.ts for the handler.
  function invalidateAfterUpload() {
    void utils.standard.byId.invalidate({ id: standardId });
    void utils.document.list.invalidate({ standardId });
    void utils.document.byWorkingGroup.invalidate();
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) {
      setError('Файл понад 25 МБ');
      return;
    }
    if (f.type && !ALLOWED_MIMES.includes(f.type)) {
      setError(`Формат не підтримується. Дозволені: ${ALLOWED_HINT}`);
      return;
    }
    setFile(f);
    setError(null);
  }

  async function submit() {
    setError(null);
    if (!file) {
      setError('Оберіть файл');
      return;
    }
    if (!version.trim()) {
      setError('Введіть версію');
      return;
    }

    try {
      setProgress('uploading');
      const form = new FormData();
      form.append('file', file);
      form.append('type', type);
      form.append('version', version.trim());
      form.append('isCurrent', String(isCurrent));
      form.append('allowEdits', String(allowEdits && fileIsDocx));
      if (note.trim()) form.append('note', note.trim());

      const resp = await fetch(`/api/standards/${standardId}/documents`, {
        method: 'POST',
        body: form,
      });
      if (!resp.ok) {
        let detail = '';
        try {
          const j = (await resp.json()) as { error?: string; detail?: string };
          detail = j.error ?? '';
          if (j.detail) detail += ` (${j.detail})`;
        } catch {
          /* ignore */
        }
        throw new Error(`HTTP ${resp.status}${detail ? ` · ${detail}` : ''}`);
      }
      setProgress('confirming');
      invalidateAfterUpload();
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження');
      setProgress('idle');
    }
  }

  const busy = progress !== 'idle';

  return (
    <Modal open={open} onClose={onClose} title="Завантажити документ" size="md">
      <div className="space-y-4">
        {/* File picker */}
        <div>
          <label className="field-label">Файл *</label>
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-hairline rounded-[12px] py-7 cursor-pointer hover:border-brand transition-colors">
            <input
              type="file"
              className="hidden"
              accept={ALLOWED_MIMES.join(',')}
              onChange={onPick}
              disabled={busy}
            />
            {file ? (
              <>
                <FileText className="w-7 h-7 text-brand" />
                <span className="text-sm font-semibold text-ink">{file.name}</span>
                <span className="text-[11px] text-light">
                  {(file.size / 1024).toFixed(1)} KB · {file.type || 'unknown'}
                </span>
              </>
            ) : (
              <>
                <UploadCloud className="w-7 h-7 text-light" />
                <span className="text-sm font-semibold text-ink">Натисніть, щоб обрати файл</span>
                <span className="text-[11px] text-light">{ALLOWED_HINT} · до 25 МБ</span>
              </>
            )}
          </label>
        </div>

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
            className={`flex items-start gap-2 text-sm ${fileIsDocx ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
            title={
              fileIsDocx
                ? 'Документ можна буде відкривати у редакторі та лишати запити на правки'
                : 'Доступно лише для файлів .docx (Microsoft Word)'
            }
          >
            <input
              type="checkbox"
              checked={allowEdits}
              disabled={!fileIsDocx}
              onChange={(e) => setAllowEdits(e.target.checked)}
              className="w-4 h-4 accent-brand mt-0.5"
            />
            <span className="text-ink flex items-center gap-1.5">
              <Pencil className="w-3.5 h-3.5 text-mid" />
              Дозволити правки (колаборативне редагування)
              {!fileIsDocx && <span className="text-[11px] text-light">— тільки для .docx</span>}
            </span>
          </label>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-[10px] px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 justify-end pt-2 border-t border-hairline">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>
            Скасувати
          </button>
          <button type="button" onClick={submit} disabled={busy} className="btn-primary">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {progress === 'getting-url'
              ? 'Отримуємо URL…'
              : progress === 'uploading'
                ? 'Завантажуємо…'
                : progress === 'confirming'
                  ? 'Реєструємо…'
                  : 'Завантажити'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
