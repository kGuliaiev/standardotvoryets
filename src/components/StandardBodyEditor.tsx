'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc/client';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { splitHtmlBlocks, htmlToPlainText, normalizeBodyHtml } from '@/lib/standardBody';
import {
  Pencil,
  ThumbsUp,
  ThumbsDown,
  Check,
  X as XIcon,
  Plus,
  Edit3,
  Loader2,
  AlertCircle,
  FileUp,
} from 'lucide-react';
import { can } from '@/lib/rbac';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';
import type { RouterOutputs } from '@/lib/trpc/client';

type SuggestionListItem = RouterOutputs['suggestion']['list'][number];

interface Props {
  standardId: string;
  workingGroupId: string;
  bodyText: string | null;
  bodyUpdatedAt: Date | string | null;
  bodyUpdatedBy: { name: string } | null;
}

type OpKind = 'REPLACE' | 'INSERT_AFTER' | 'DELETE';

interface DraftSuggestion {
  paragraphIndex: number;
  originalText: string;
  proposedText: string;
  operation: OpKind;
  rationale: string;
}

/**
 * Tailwind prose classes used for read-only rendering of HTML blocks.
 * Kept in sync with the live editor surface in RichTextEditor.tsx so the
 * preview looks identical to the editing experience.
 */
const READONLY_PROSE_CLASSES =
  'prose prose-sm dark:prose-invert max-w-none ' +
  'prose-headings:text-ink prose-p:text-ink prose-li:text-ink prose-strong:text-ink ' +
  'prose-blockquote:text-mid prose-blockquote:border-brand ' +
  'prose-a:text-brand prose-code:text-ink prose-code:bg-pill prose-code:px-1 prose-code:rounded ' +
  'prose-p:my-0 prose-headings:my-0';

export function StandardBodyEditor({
  standardId,
  workingGroupId,
  bodyText,
  bodyUpdatedAt,
  bodyUpdatedBy,
}: Props) {
  const { data: session } = useSession();
  const utils = trpc.useUtils();
  const me = session?.user;
  const userCtx = useMemo(() => {
    if (!me) return null;
    return {
      globalRole: me.globalRole as GlobalRole,
      memberships: (me.memberships ?? []) as {
        workingGroupId: string;
        role: WorkingGroupRole;
      }[],
    };
  }, [me]);

  const canEditMeta = userCtx ? can(userCtx, 'standard:editMeta', workingGroupId) : false;
  const canSuggest = userCtx ? can(userCtx, 'comment:add', workingGroupId) : false;

  // Body is HTML emitted by TipTap (legacy plain-text bodies are migrated to
  // <p>-wrapped HTML transparently inside splitHtmlBlocks).
  const normalizedBody = useMemo(() => normalizeBodyHtml(bodyText), [bodyText]);
  const paragraphs = useMemo(() => splitHtmlBlocks(normalizedBody), [normalizedBody]);

  const { data: suggestions } = trpc.suggestion.list.useQuery(
    { standardId },
    { staleTime: 30_000, refetchOnMount: 'always' },
  );
  const pendingBySection = useMemo(() => {
    const map = new Map<number, SuggestionListItem[]>();
    for (const s of suggestions ?? []) {
      if (s.status !== 'PENDING') continue;
      const arr = map.get(s.paragraphIndex) ?? [];
      arr.push(s);
      map.set(s.paragraphIndex, arr);
    }
    return map;
  }, [suggestions]);

  const resolvedRecent = useMemo(
    () => (suggestions ?? []).filter((s) => s.status !== 'PENDING').slice(0, 10),
    [suggestions],
  );

  const [draft, setDraft] = useState<DraftSuggestion | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState(normalizedBody);

  const createMutation = trpc.suggestion.create.useMutation({
    onSuccess: () => {
      void utils.suggestion.list.invalidate({ standardId });
      setDraft(null);
    },
  });
  const reactMutation = trpc.suggestion.react.useMutation({
    onSuccess: () => void utils.suggestion.list.invalidate({ standardId }),
  });
  const acceptMutation = trpc.suggestion.accept.useMutation({
    onSuccess: () => {
      void utils.suggestion.list.invalidate({ standardId });
      void utils.standard.byId.invalidate({ id: standardId });
    },
    onError: (e) => alert(e.message),
  });
  const rejectMutation = trpc.suggestion.reject.useMutation({
    onSuccess: () => void utils.suggestion.list.invalidate({ standardId }),
  });
  const updateBodyMutation = trpc.suggestion.updateBody.useMutation({
    onSuccess: () => {
      void utils.standard.byId.invalidate({ id: standardId });
      setBulkOpen(false);
    },
    onError: (e) => alert(e.message),
  });

  function openSuggest(idx: number, op: OpKind = 'REPLACE') {
    const original = paragraphs[idx] ?? '';
    setDraft({
      paragraphIndex: idx,
      originalText: original,
      // Seed REPLACE with the original markup so authors edit in place; DELETE
      // keeps proposedText empty per backend contract.
      proposedText: op === 'DELETE' ? '' : original,
      operation: op,
      rationale: '',
    });
  }

  function openInsertAfter(idx: number) {
    setDraft({
      paragraphIndex: idx,
      originalText: paragraphs[idx] ?? '',
      proposedText: '',
      operation: 'INSERT_AFTER',
      rationale: '',
    });
  }

  function submitDraft() {
    if (!draft) return;
    createMutation.mutate({
      standardId,
      paragraphIndex: draft.paragraphIndex,
      originalText: draft.originalText,
      proposedText: draft.proposedText,
      operation: draft.operation,
      rationale: draft.rationale.trim() || undefined,
    });
  }

  function toggleReaction(
    suggestionId: string,
    current: 'LIKE' | 'DISLIKE' | null,
    type: 'LIKE' | 'DISLIKE',
  ) {
    const next = current === type ? null : type;
    reactMutation.mutate({ suggestionId, type: next });
  }

  if (!bodyText && !canEditMeta) {
    return (
      <div className="bg-card rounded-xl border border-hairline p-12 text-center text-light text-sm">
        Текст документа ще не додано. Зверніться до керівника РГ.
      </div>
    );
  }

  if (!bodyText && canEditMeta) {
    // Empty body — invite the leader to seed it (manually or via .docx import)
    return (
      <div className="bg-card rounded-xl border border-hairline p-8 text-center space-y-4">
        <Edit3 className="w-8 h-8 text-mid mx-auto opacity-60" />
        <p className="text-sm text-mid">
          Текст документа ще не додано. Імпортуйте .docx або почніть з нуля.
        </p>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <DocxImportButton
            standardId={standardId}
            variant="primary"
            onImported={(html) => updateBodyMutation.mutate({ standardId, bodyText: html })}
            disabled={updateBodyMutation.isPending}
          />
          <button
            onClick={() => {
              setBulkText('');
              setBulkOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-hairline text-sm font-semibold text-ink hover:bg-pill"
          >
            <Plus className="w-4 h-4" />
            Почати з нуля
          </button>
        </div>

        <BulkEditModal
          open={bulkOpen}
          initial={bulkText}
          standardId={standardId}
          onClose={() => setBulkOpen(false)}
          onSave={(text) => updateBodyMutation.mutate({ standardId, bodyText: text })}
          isPending={updateBodyMutation.isPending}
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 items-start">
      <div className="space-y-2">
        {/* Header strip */}
        <div className="flex items-center justify-between flex-wrap gap-2 px-1">
          <p className="text-[11px] text-light">
            {bodyUpdatedAt && bodyUpdatedBy
              ? `Оновлено ${new Date(bodyUpdatedAt).toLocaleString('uk-UA')} · ${bodyUpdatedBy.name}`
              : 'Без правок'}
            {suggestions && suggestions.filter((s) => s.status === 'PENDING').length > 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400 font-semibold">
                · {suggestions.filter((s) => s.status === 'PENDING').length} відкритих правок
              </span>
            )}
          </p>
          {canEditMeta && (
            <button
              onClick={() => {
                setBulkText(normalizedBody);
                setBulkOpen(true);
              }}
              className="text-xs px-2.5 py-1 rounded border border-hairline text-mid hover:text-ink hover:bg-pill inline-flex items-center gap-1.5"
              title="Редагувати весь текст із форматуванням як у Word"
            >
              <Edit3 className="w-3 h-3" />
              Редагувати все
            </button>
          )}
        </div>

        {/* Body blocks (HTML, rendered via prose classes) */}
        <article className="bg-card rounded-xl border border-hairline p-5 sm:p-8 space-y-5">
          {paragraphs.map((html, idx) => {
            const pending = pendingBySection.get(idx) ?? [];
            return (
              <ParagraphBlock
                key={idx}
                idx={idx}
                html={html}
                pending={pending}
                myUserId={me?.id ?? null}
                canSuggest={canSuggest}
                canResolve={canEditMeta}
                onSuggestReplace={() => openSuggest(idx, 'REPLACE')}
                onSuggestDelete={() => openSuggest(idx, 'DELETE')}
                onSuggestInsert={() => openInsertAfter(idx)}
                onReact={(sid, current, type) => toggleReaction(sid, current, type)}
                onAccept={(sid) => acceptMutation.mutate({ id: sid })}
                onReject={(sid) => rejectMutation.mutate({ id: sid })}
              />
            );
          })}
          {canSuggest && paragraphs.length > 0 && (
            <div className="pt-3 border-t border-hairline">
              <button
                onClick={() => openInsertAfter(paragraphs.length - 1)}
                className="text-xs inline-flex items-center gap-1.5 text-mid hover:text-brand"
              >
                <Plus className="w-3.5 h-3.5" />
                Запропонувати новий параграф у кінці
              </button>
            </div>
          )}
        </article>
      </div>

      {/* Right rail: recent decisions */}
      <aside className="bg-card rounded-xl border border-hairline overflow-hidden lg:sticky lg:top-4">
        <div className="px-4 py-3 border-b border-hairline">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink">Останні рішення</h3>
        </div>
        {resolvedRecent.length === 0 ? (
          <p className="px-4 py-6 text-xs text-light text-center">
            Прийнятих або відхилених правок ще немає
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {resolvedRecent.map((s) => (
              <li key={s.id} className="px-4 py-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      s.status === 'ACCEPTED'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                        : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    }`}
                  >
                    {s.status === 'ACCEPTED' ? 'ПРИЙНЯТО' : 'ВІДХИЛЕНО'}
                  </span>
                  <span className="text-[10px] text-light">параграф {s.paragraphIndex + 1}</span>
                </div>
                {/* Show plaintext preview in the rail to keep it compact */}
                <p className="text-[11px] text-mid line-clamp-2">
                  {htmlToPlainText(s.proposedText) || '—'}
                </p>
                <p className="text-[10px] text-light mt-1">
                  {s.author.name}
                  {s.resolvedBy && ` → ${s.resolvedBy.name}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Suggest modal */}
      <SuggestionDraftModal
        draft={draft}
        onClose={() => setDraft(null)}
        onChange={setDraft}
        onSubmit={submitDraft}
        isPending={createMutation.isPending}
      />

      {/* Bulk-edit modal (leader-only) */}
      <BulkEditModal
        open={bulkOpen}
        initial={bulkText}
        standardId={standardId}
        onClose={() => setBulkOpen(false)}
        onSave={(text) => updateBodyMutation.mutate({ standardId, bodyText: text })}
        isPending={updateBodyMutation.isPending}
      />
    </div>
  );
}

interface ParagraphBlockProps {
  idx: number;
  html: string;
  pending: SuggestionListItem[];
  myUserId: string | null;
  canSuggest: boolean;
  canResolve: boolean;
  onSuggestReplace: () => void;
  onSuggestDelete: () => void;
  onSuggestInsert: () => void;
  onReact: (sid: string, current: 'LIKE' | 'DISLIKE' | null, type: 'LIKE' | 'DISLIKE') => void;
  onAccept: (sid: string) => void;
  onReject: (sid: string) => void;
}

function ParagraphBlock({
  idx,
  html,
  pending,
  myUserId,
  canSuggest,
  canResolve,
  onSuggestReplace,
  onSuggestDelete,
  onSuggestInsert,
  onReact,
  onAccept,
  onReject,
}: ParagraphBlockProps) {
  const hasPending = pending.length > 0;
  return (
    <section className={`group ${hasPending ? 'border-l-2 border-amber-400 pl-3 -ml-3' : ''}`}>
      <div className="flex items-start gap-3">
        <span className="text-[11px] text-light font-mono tabular-nums w-6 shrink-0 pt-1">
          {idx + 1}
        </span>
        <div className="flex-1 min-w-0">
          {/* HTML body block — sanitized by TipTap's schema on write, so safe
              to dangerouslySetInnerHTML on read. */}
          <div
            className={`${READONLY_PROSE_CLASSES} break-words`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {canSuggest && (
            <div className="mt-1 -ml-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={onSuggestReplace}
                className="text-[11px] px-2 py-0.5 rounded text-mid hover:text-brand hover:bg-pill inline-flex items-center gap-1"
                title="Запропонувати правку цього параграфа"
              >
                <Pencil className="w-3 h-3" />
                Змінити
              </button>
              <button
                onClick={onSuggestInsert}
                className="text-[11px] px-2 py-0.5 rounded text-mid hover:text-brand hover:bg-pill inline-flex items-center gap-1"
                title="Запропонувати новий параграф після цього"
              >
                <Plus className="w-3 h-3" />
                Додати після
              </button>
              <button
                onClick={onSuggestDelete}
                className="text-[11px] px-2 py-0.5 rounded text-mid hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 inline-flex items-center gap-1"
                title="Запропонувати видалити цей параграф"
              >
                <XIcon className="w-3 h-3" />
                Видалити
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Pending suggestions for this paragraph */}
      {pending.length > 0 && (
        <div className="mt-3 ml-9 space-y-2">
          {pending.map((s) => {
            const myReaction = s.reactions.find((r) => r.userId === myUserId)?.type ?? null;
            const likeCount = s.reactions.filter((r) => r.type === 'LIKE').length;
            const dislikeCount = s.reactions.filter((r) => r.type === 'DISLIKE').length;
            return (
              <div
                key={s.id}
                className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/10 p-3"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Avatar
                    name={s.author.name}
                    avatarUrl={s.author.avatarUrl ?? undefined}
                    size="xs"
                  />
                  <span className="text-xs font-semibold text-ink">{s.author.name}</span>
                  <span className="text-[10px] text-light">
                    · {new Date(s.createdAt).toLocaleDateString('uk-UA')}
                  </span>
                  <span className="ml-auto text-[10px] text-amber-700 dark:text-amber-300 font-bold uppercase">
                    {s.operation === 'DELETE'
                      ? 'Видалити'
                      : s.operation === 'INSERT_AFTER'
                        ? 'Додати'
                        : 'Змінити'}
                  </span>
                </div>

                {/* Word-style redline — both sides render their HTML */}
                {s.operation === 'REPLACE' && (
                  <div className="text-[13px] leading-relaxed space-y-1.5">
                    <div
                      className={`${READONLY_PROSE_CLASSES} rounded border border-red-200 dark:border-red-800/40 bg-red-50/40 dark:bg-red-900/10 px-2.5 py-1.5 text-red-700 dark:text-red-300 [&_*]:line-through [&_*]:!text-red-700 dark:[&_*]:!text-red-300`}
                      dangerouslySetInnerHTML={{ __html: s.originalText || '<p>—</p>' }}
                    />
                    <div
                      className={`${READONLY_PROSE_CLASSES} rounded border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/40 dark:bg-emerald-900/10 px-2.5 py-1.5 [&_*]:!text-emerald-800 dark:[&_*]:!text-emerald-200`}
                      dangerouslySetInnerHTML={{ __html: s.proposedText || '<p>—</p>' }}
                    />
                  </div>
                )}
                {s.operation === 'INSERT_AFTER' && (
                  <div
                    className={`${READONLY_PROSE_CLASSES} text-[13px] leading-relaxed rounded border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/40 dark:bg-emerald-900/10 px-2.5 py-1.5 [&_*]:!text-emerald-800 dark:[&_*]:!text-emerald-200`}
                    dangerouslySetInnerHTML={{ __html: s.proposedText || '<p>—</p>' }}
                  />
                )}
                {s.operation === 'DELETE' && (
                  <div
                    className={`${READONLY_PROSE_CLASSES} text-[13px] leading-relaxed rounded border border-red-200 dark:border-red-800/40 bg-red-50/40 dark:bg-red-900/10 px-2.5 py-1.5 [&_*]:line-through [&_*]:!text-red-700 dark:[&_*]:!text-red-300`}
                    dangerouslySetInnerHTML={{ __html: s.originalText || '<p>—</p>' }}
                  />
                )}

                {s.rationale && (
                  <p className="mt-2 text-[12px] text-mid italic">
                    <span className="text-light">Обґрунтування: </span>
                    {s.rationale}
                  </p>
                )}

                {/* Reactions + leader actions */}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => onReact(s.id, myReaction, 'LIKE')}
                    disabled={!myUserId}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
                      myReaction === 'LIKE'
                        ? 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700'
                        : 'border-hairline text-mid hover:bg-pill'
                    }`}
                  >
                    <ThumbsUp className="w-3 h-3" />
                    <span className="tabular-nums">{likeCount}</span>
                  </button>
                  <button
                    onClick={() => onReact(s.id, myReaction, 'DISLIKE')}
                    disabled={!myUserId}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
                      myReaction === 'DISLIKE'
                        ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700'
                        : 'border-hairline text-mid hover:bg-pill'
                    }`}
                  >
                    <ThumbsDown className="w-3 h-3" />
                    <span className="tabular-nums">{dislikeCount}</span>
                  </button>
                  {canResolve && (
                    <>
                      <span className="w-px h-5 bg-hairline mx-1" />
                      <button
                        onClick={() => onAccept(s.id)}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 font-semibold"
                      >
                        <Check className="w-3 h-3" />
                        Прийняти
                      </button>
                      <button
                        onClick={() => onReject(s.id)}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 font-semibold"
                      >
                        <XIcon className="w-3 h-3" />
                        Відхилити
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SuggestionDraftModal({
  draft,
  onClose,
  onChange,
  onSubmit,
  isPending,
}: {
  draft: DraftSuggestion | null;
  onClose: () => void;
  onChange: (next: DraftSuggestion) => void;
  onSubmit: () => void;
  isPending: boolean;
}) {
  if (!draft) return null;
  const title =
    draft.operation === 'DELETE'
      ? `Видалити параграф ${draft.paragraphIndex + 1}`
      : draft.operation === 'INSERT_AFTER'
        ? `Додати параграф після ${draft.paragraphIndex + 1}`
        : `Змінити параграф ${draft.paragraphIndex + 1}`;

  const proposedIsEmpty = htmlToPlainText(draft.proposedText).trim().length === 0;
  const sameAsOriginal =
    draft.operation === 'REPLACE' &&
    htmlToPlainText(draft.proposedText).trim() === htmlToPlainText(draft.originalText).trim();

  return (
    <Modal open={!!draft} onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        {draft.operation !== 'INSERT_AFTER' && (
          <div>
            <label className="field-label">Поточний текст</label>
            <div
              className={`${READONLY_PROSE_CLASSES} bg-page border border-hairline rounded-[10px] px-3 py-2 text-sm`}
              dangerouslySetInnerHTML={{ __html: draft.originalText || '<p>(порожньо)</p>' }}
            />
          </div>
        )}
        {draft.operation !== 'DELETE' && (
          <div>
            <label className="field-label">
              {draft.operation === 'INSERT_AFTER' ? 'Новий параграф' : 'Запропонований текст'}
            </label>
            {/* Re-mount editor when switching draft instances so initial HTML
                seeds correctly (TipTap only consumes `content` once). */}
            <RichTextEditor
              key={`${draft.paragraphIndex}-${draft.operation}`}
              initialHtml={draft.proposedText}
              onChange={(html) => onChange({ ...draft, proposedText: html })}
              autoFocus
              placeholder={
                draft.operation === 'INSERT_AFTER'
                  ? 'Введіть текст нового параграфа…'
                  : 'Введіть новий варіант параграфа…'
              }
            />
          </div>
        )}
        <div>
          <label className="field-label">Обґрунтування (необов&apos;язково)</label>
          <textarea
            rows={2}
            value={draft.rationale}
            onChange={(e) => onChange({ ...draft, rationale: e.target.value })}
            className="textarea resize-none"
            placeholder="Чому пропонуєте цю правку?"
          />
        </div>
        {draft.operation === 'DELETE' && (
          <p className="text-xs text-red-600 dark:text-red-400 inline-flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> Параграф буде видалено повністю якщо керівник
            прийме цю правку.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2 border-t border-hairline">
          <button onClick={onClose} className="btn-secondary">
            Скасувати
          </button>
          <button
            onClick={onSubmit}
            disabled={
              isPending ||
              (draft.operation === 'INSERT_AFTER' && proposedIsEmpty) ||
              (draft.operation === 'REPLACE' && (proposedIsEmpty || sameAsOriginal))
            }
            className="btn-primary"
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Запропонувати правку
          </button>
        </div>
      </div>
    </Modal>
  );
}

function BulkEditModal({
  open,
  initial,
  standardId,
  onClose,
  onSave,
  isPending,
}: {
  open: boolean;
  initial: string;
  standardId: string;
  onClose: () => void;
  onSave: (text: string) => void;
  isPending: boolean;
}) {
  const [html, setHtml] = useState(initial);
  // The editor seeds `content` only once at mount; bumping this key
  // forces a remount when an import replaces the buffer mid-session.
  const [editorKey, setEditorKey] = useState(0);
  // re-sync when modal (re)opens with a different initial value
  useEffect(() => {
    if (open) {
      setHtml(initial);
      setEditorKey((k) => k + 1);
    }
  }, [initial, open]);

  return (
    <Modal open={open} onClose={onClose} title="Редагувати текст документа" size="xl">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <p className="text-xs text-mid flex-1 min-w-[280px]">
            Повноцінне форматування як у Word — заголовки, списки, таблиці, посилання. Кожен блок
            (параграф, заголовок, пункт списку, таблиця) — окрема секція для запитів на правку.
            Зміна тут не створює запитів на голосування.
          </p>
          <DocxImportButton
            standardId={standardId}
            variant="secondary"
            onImported={(imported) => {
              setHtml(imported);
              setEditorKey((k) => k + 1);
            }}
          />
        </div>
        {/* Force a fresh editor instance whenever the modal reopens or an
            import replaces the buffer — TipTap ignores `content` updates
            after init. */}
        <RichTextEditor
          key={`bulk-${editorKey}`}
          initialHtml={html}
          onChange={setHtml}
          className="rounded-[10px] border border-hairline bg-card min-h-[400px]"
          autoFocus
        />
        <div className="flex justify-end gap-2 pt-2 border-t border-hairline">
          <button onClick={onClose} className="btn-secondary">
            Скасувати
          </button>
          <button onClick={() => onSave(html)} disabled={isPending} className="btn-primary">
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Зберегти
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * File picker + upload + .docx→HTML conversion via /api/standards/[id]/import-body.
 *
 * Two visual variants:
 *   - `primary` — the standalone empty-state CTA
 *   - `secondary` — the inline button inside the bulk edit modal
 */
function DocxImportButton({
  standardId,
  variant,
  onImported,
  disabled,
}: {
  standardId: string;
  variant: 'primary' | 'secondary';
  onImported: (html: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      alert('Підтримуються лише файли .docx (Microsoft Word).');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/standards/${standardId}/import-body`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error ?? 'Не вдалося імпортувати документ');
        return;
      }
      const data = (await res.json()) as { html: string; warnings?: string[] };
      if (data.warnings && data.warnings.length > 0) {
        // Show non-fatal conversion warnings so the user knows some content
        // (e.g. embedded objects) may have been dropped.
        // Quietly logged to the console as well for debugging.
        // eslint-disable-next-line no-console
        console.warn('[import-body] warnings:', data.warnings);
      }
      onImported(data.html);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const baseClass =
    variant === 'primary'
      ? 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 text-white text-sm font-semibold hover:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed'
      : 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-hairline text-xs font-semibold text-ink hover:bg-pill disabled:opacity-60 disabled:cursor-not-allowed';

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => inputRef.current?.click()}
        className={baseClass}
        title="Завантажити .docx — перетвориться в форматований текст"
      >
        {busy ? (
          <Loader2
            className={variant === 'primary' ? 'w-4 h-4 animate-spin' : 'w-3 h-3 animate-spin'}
          />
        ) : (
          <FileUp className={variant === 'primary' ? 'w-4 h-4' : 'w-3 h-3'} />
        )}
        Імпортувати з Word
      </button>
    </>
  );
}
