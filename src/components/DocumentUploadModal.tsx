'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Modal } from '@/components/ui/Modal';
import { Loader2, UploadCloud, FileText, Pencil, FilePlus } from 'lucide-react';

interface DocumentUploadModalProps {
  open: boolean;
  onClose: () => void;
  standardId: string;
  /** Fires with the new Document's id + type after a successful create/upload.
   *  Parent decides what to do next — e.g. auto-open in editor for
   *  STANDARD/TECH_SPEC. The callback is kept optional and zero-arg-safe
   *  via default values for existing call sites. */
  onSaved?: (newDoc?: { id: string; type: UploadableDocType }) => void;
  /** When true the "Дозволити правки" checkbox starts ticked — used
   *  by the "Імпортувати з Word" entry point that's specifically
   *  intended for collaborative-editing uploads. */
  defaultAllowEdits?: boolean;
  /** Which tab the modal opens on. "+ Створити" opens on 'empty',
   *  "Імпортувати з Word" / generic upload opens on 'upload'. */
  defaultMode?: 'upload' | 'empty';
  /** Default document type to preselect in the picker. Parent computes
   *  the smart default based on what's already attached to the standard
   *  (e.g. when there's no TECH_SPEC yet → TECH_SPEC; otherwise STANDARD). */
  initialType?: UploadableDocType;
}

// Types offered in the create / upload picker. Mirrors UPLOADABLE_DOC_TYPES
// on the server. MEETING_MINUTES is excluded — the Протоколи module is
// the single source of truth for those now; FINAL was collapsed into
// STANDARD (the locked snapshot post-voting IS the final).
type UploadableDocType = 'STANDARD' | 'TECH_SPEC' | 'FEEDBACK' | 'AGENDA' | 'ATTACHMENT';
const TYPE_OPTIONS: { value: UploadableDocType; label: string }[] = [
  { value: 'TECH_SPEC', label: 'ТЗ (технічне завдання)' },
  { value: 'STANDARD', label: 'Стандарт' },
  { value: 'FEEDBACK', label: 'Відгук' },
  { value: 'AGENDA', label: 'Порядок денний' },
  { value: 'ATTACHMENT', label: 'Додатковий матеріал' },
];

// Only these two types own the "actual" tag and the
// "max one per standard" cap; for the rest the toggle is hidden.
const HAS_CURRENT_FLAG = new Set<UploadableDocType>(['STANDARD', 'TECH_SPEC']);

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
  defaultMode = 'upload',
  initialType = 'STANDARD',
}: DocumentUploadModalProps) {
  const utils = trpc.useUtils();
  // 'upload' — pick a file from disk; 'empty' — type a filename and
  // open the WYSIWYG editor immediately on a blank doc.
  const [mode, setMode] = useState<'upload' | 'empty'>(defaultMode);
  const [file, setFile] = useState<File | null>(null);
  const [emptyFilename, setEmptyFilename] = useState('');
  const [version, setVersion] = useState('v1.0');
  const [type, setType] = useState<UploadableDocType>(initialType);
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

  const createEmptyMutation = trpc.document.createEmpty.useMutation();

  useEffect(() => {
    if (open) {
      setMode(defaultMode);
      setFile(null);
      setEmptyFilename('');
      setVersion('v1.0');
      setType(initialType);
      setIsCurrent(true);
      setAllowEdits(defaultAllowEdits);
      setNote('');
      setError(null);
      setProgress('idle');
    }
  }, [open, defaultAllowEdits, defaultMode, initialType]);

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
    if (!version.trim()) {
      setError('Введіть версію');
      return;
    }

    // Create-empty branch — no S3, just a tRPC mutation that yields a
    // Document row with bodyHtml=''. Caller can then open the WYSIWYG.
    if (mode === 'empty') {
      const name = emptyFilename.trim();
      if (!name) {
        setError('Введіть назву документа');
        return;
      }
      try {
        setProgress('confirming');
        const created = await createEmptyMutation.mutateAsync({
          standardId,
          filename: name,
          type,
          version: version.trim(),
          note: note.trim() || undefined,
          isCurrent: isCurrent && HAS_CURRENT_FLAG.has(type),
        });
        invalidateAfterUpload();
        onSaved?.({ id: created.id, type });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не вдалося створити документ');
        setProgress('idle');
      }
      return;
    }

    if (!file) {
      setError('Оберіть файл');
      return;
    }

    try {
      setProgress('uploading');
      const form = new FormData();
      form.append('file', file);
      form.append('type', type);
      form.append('version', version.trim());
      form.append('isCurrent', String(isCurrent && HAS_CURRENT_FLAG.has(type)));
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
      // Read the created doc id from the JSON response so the parent can
      // auto-open the editor on STANDARD/TECH_SPEC uploads. Response was
      // not consumed above (we only inspected it on !resp.ok), so .json()
      // here is the first read.
      let createdId: string | null = null;
      try {
        const j = (await resp.json()) as { id?: string } | null;
        createdId = j?.id ?? null;
      } catch {
        /* the row was created — parent will just skip the auto-open */
      }
      invalidateAfterUpload();
      onSaved?.(createdId ? { id: createdId, type } : undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження');
      setProgress('idle');
    }
  }

  const busy = progress !== 'idle';

  return (
    <Modal open={open} onClose={onClose} title="Новий документ" size="md">
      {/* Wrap in a <form> so Enter in single-line fields (filename /
          version) submits; textareas (note) keep newline behavior. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          void submit();
        }}
        className="space-y-4"
      >
        {/* Mode toggle: pick a file from disk or start with a blank
            document and write straight into the WYSIWYG editor. */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-page rounded-[10px] border border-hairline">
          <button
            type="button"
            onClick={() => setMode('upload')}
            disabled={busy}
            className={`text-xs font-semibold px-3 py-2 rounded-md inline-flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'upload' ? 'bg-card text-ink shadow-sm' : 'text-mid hover:text-ink'
            }`}
          >
            <UploadCloud className="w-3.5 h-3.5" />
            Завантажити файл
          </button>
          <button
            type="button"
            onClick={() => setMode('empty')}
            disabled={busy}
            className={`text-xs font-semibold px-3 py-2 rounded-md inline-flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'empty' ? 'bg-card text-ink shadow-sm' : 'text-mid hover:text-ink'
            }`}
          >
            <FilePlus className="w-3.5 h-3.5" />
            Створити порожній
          </button>
        </div>

        {/* File picker or filename input depending on mode. */}
        {mode === 'upload' ? (
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
        ) : (
          <div>
            <label className="field-label">Назва документа *</label>
            <input
              className="input"
              value={emptyFilename}
              onChange={(e) => setEmptyFilename(e.target.value)}
              placeholder="Проєкт ТЗ"
              disabled={busy}
              autoFocus
            />
            <p className="text-[11px] text-light mt-1">
              .docx буде додано автоматично. Після створення відкривається у WYSIWYG-редакторі.
            </p>
          </div>
        )}

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
          {/* "Актуальна версія" tag is only meaningful for STANDARD and
              TECH_SPEC (max 1 active per standard). For other types many
              docs can coexist without any of them being marked actual,
              so we hide the toggle instead of letting the user set a
              meaningless flag. */}
          {HAS_CURRENT_FLAG.has(type) && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isCurrent}
                onChange={(e) => setIsCurrent(e.target.checked)}
                className="w-4 h-4 accent-brand"
              />
              <span className="text-ink">Позначити як актуальну версію</span>
            </label>
          )}
          {mode === 'upload' ? (
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
          ) : (
            <p className="text-xs text-mid bg-page rounded-[10px] px-3 py-2 inline-flex items-center gap-1.5">
              <Pencil className="w-3.5 h-3.5 text-brand" />
              Документ буде створений як редагований — одразу можна писати у WYSIWYG.
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-[10px] px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 justify-end pt-2 border-t border-hairline">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={busy}>
            Скасувати
          </button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {progress === 'getting-url'
              ? 'Отримуємо URL…'
              : progress === 'uploading'
                ? 'Завантажуємо…'
                : progress === 'confirming'
                  ? 'Реєструємо…'
                  : mode === 'empty'
                    ? 'Створити'
                    : 'Завантажити'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
