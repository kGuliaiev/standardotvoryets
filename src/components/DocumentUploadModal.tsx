'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { Modal } from '@/components/ui/Modal';
import { Loader2, UploadCloud, FileText } from 'lucide-react';

interface DocumentUploadModalProps {
  open: boolean;
  onClose: () => void;
  standardId: string;
  onSaved?: () => void;
}

const TYPE_OPTIONS: {
  value: 'DRAFT_STANDARD' | 'MEETING_MINUTES' | 'AGENDA' | 'ATTACHMENT' | 'FINAL';
  label: string;
}[] = [
  { value: 'DRAFT_STANDARD', label: 'Чернетка стандарту' },
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
}: DocumentUploadModalProps) {
  const utils = trpc.useUtils();
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('v1.0');
  const [type, setType] = useState<(typeof TYPE_OPTIONS)[number]['value']>('DRAFT_STANDARD');
  const [isCurrent, setIsCurrent] = useState(true);
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
      setNote('');
      setError(null);
      setProgress('idle');
    }
  }, [open]);

  const getUploadUrlMutation = trpc.document.getUploadUrl.useMutation();
  const confirmUploadMutation = trpc.document.confirmUpload.useMutation({
    onSuccess: () => {
      void utils.standard.byId.invalidate({ id: standardId });
      void utils.document.list.invalidate({ standardId });
      void utils.document.byWorkingGroup.invalidate();
      onSaved?.();
      onClose();
    },
    onError: (e) => {
      setError(e.message);
      setProgress('idle');
    },
  });

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
      // 1) Get presigned URL from server
      setProgress('getting-url');
      const { uploadUrl, s3Key } = await getUploadUrlMutation.mutateAsync({
        standardId,
        filename: file.name,
        contentType: file.type,
        type,
        version: version.trim(),
      });

      // 2) Direct upload to S3
      setProgress('uploading');
      const putResp = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!putResp.ok) {
        const text = await putResp.text().catch(() => '');
        throw new Error(
          `Не вдалося завантажити файл (HTTP ${putResp.status}). ${text.slice(0, 120)}`,
        );
      }

      // 3) Confirm: create document record
      setProgress('confirming');
      confirmUploadMutation.mutate({
        standardId,
        s3Key,
        filename: file.name,
        sizeBytes: file.size,
        version: version.trim(),
        type,
        note: note.trim() || undefined,
        isCurrent,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження');
      setProgress('idle');
    }
  }

  const busy = progress !== 'idle' || confirmUploadMutation.isPending;

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

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isCurrent}
            onChange={(e) => setIsCurrent(e.target.checked)}
            className="w-4 h-4 accent-brand"
          />
          <span className="text-ink">Позначити як актуальну версію</span>
        </label>

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
