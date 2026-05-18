'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc/client';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
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

/** Split text into paragraphs in the same way the backend does. */
function splitParas(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

type OpKind = 'REPLACE' | 'INSERT_AFTER' | 'DELETE';

interface DraftSuggestion {
  paragraphIndex: number;
  originalText: string;
  proposedText: string;
  operation: OpKind;
  rationale: string;
}

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

  const paragraphs = useMemo(() => splitParas(bodyText), [bodyText]);

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
  const [bulkText, setBulkText] = useState(bodyText ?? '');

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
    // Empty body — invite the leader to seed it
    return (
      <div className="bg-card rounded-xl border border-hairline p-8 text-center space-y-3">
        <Edit3 className="w-8 h-8 text-mid mx-auto opacity-60" />
        <p className="text-sm text-mid">Текст документа ще не додано.</p>
        <button
          onClick={() => {
            setBulkText('');
            setBulkOpen(true);
          }}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 text-white text-sm font-semibold hover:bg-blue-800"
        >
          <Plus className="w-4 h-4" />
          Додати текст
        </button>

        <BulkEditModal
          open={bulkOpen}
          initial={bulkText}
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
                setBulkText(bodyText ?? '');
                setBulkOpen(true);
              }}
              className="text-xs px-2.5 py-1 rounded border border-hairline text-mid hover:text-ink hover:bg-pill inline-flex items-center gap-1.5"
              title="Редагувати весь текст одразу (для бувлк-правок)"
            >
              <Edit3 className="w-3 h-3" />
              Редагувати все
            </button>
          )}
        </div>

        {/* Body paragraphs */}
        <article className="bg-card rounded-xl border border-hairline p-5 sm:p-8 space-y-5">
          {paragraphs.map((p, idx) => {
            const pending = pendingBySection.get(idx) ?? [];
            return (
              <ParagraphBlock
                key={idx}
                idx={idx}
                text={p}
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
                <p className="text-[11px] text-mid line-clamp-2">{s.proposedText || '—'}</p>
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
        onClose={() => setBulkOpen(false)}
        onSave={(text) => updateBodyMutation.mutate({ standardId, bodyText: text })}
        isPending={updateBodyMutation.isPending}
      />
    </div>
  );
}

interface ParagraphBlockProps {
  idx: number;
  text: string;
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
  text,
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
          <p className="text-[14px] text-ink leading-relaxed whitespace-pre-wrap break-words">
            {text}
          </p>
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

                {/* Word-style redline */}
                {s.operation === 'REPLACE' && (
                  <div className="text-[13px] leading-relaxed">
                    <p className="line-through text-red-600 dark:text-red-400 opacity-80 mb-1 whitespace-pre-wrap">
                      {s.originalText}
                    </p>
                    <p className="text-emerald-700 dark:text-emerald-300 font-medium whitespace-pre-wrap">
                      {s.proposedText}
                    </p>
                  </div>
                )}
                {s.operation === 'INSERT_AFTER' && (
                  <p className="text-[13px] text-emerald-700 dark:text-emerald-300 font-medium whitespace-pre-wrap leading-relaxed">
                    + {s.proposedText}
                  </p>
                )}
                {s.operation === 'DELETE' && (
                  <p className="text-[13px] line-through text-red-600 dark:text-red-400 whitespace-pre-wrap leading-relaxed">
                    {s.originalText}
                  </p>
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

  return (
    <Modal open={!!draft} onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        {draft.operation !== 'INSERT_AFTER' && (
          <div>
            <label className="field-label">Поточний текст</label>
            <p className="bg-page border border-hairline rounded-[10px] px-3 py-2 text-sm text-mid whitespace-pre-wrap">
              {draft.originalText || '(порожньо)'}
            </p>
          </div>
        )}
        {draft.operation !== 'DELETE' && (
          <div>
            <label className="field-label">
              {draft.operation === 'INSERT_AFTER' ? 'Новий параграф' : 'Запропонований текст'}
            </label>
            <textarea
              rows={6}
              autoFocus
              value={draft.proposedText}
              onChange={(e) => onChange({ ...draft, proposedText: e.target.value })}
              className="textarea resize-none"
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
              (draft.operation === 'INSERT_AFTER' && !draft.proposedText.trim()) ||
              (draft.operation === 'REPLACE' &&
                draft.proposedText.trim() === draft.originalText.trim())
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
  onClose,
  onSave,
  isPending,
}: {
  open: boolean;
  initial: string;
  onClose: () => void;
  onSave: (text: string) => void;
  isPending: boolean;
}) {
  const [text, setText] = useState(initial);
  // re-sync when modal (re)opens with a different initial value
  useEffect(() => {
    if (open) setText(initial);
  }, [initial, open]);

  return (
    <Modal open={open} onClose={onClose} title="Редагувати текст документа" size="xl">
      <div className="space-y-4">
        <p className="text-xs text-mid">
          Прямі правки керівника, обходячи механізм запитів. Розділяйте параграфи порожнім рядком —
          система рахує їх по «\n\n». Зміна тут не створює запитів на голосування.
        </p>
        <textarea
          rows={20}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="textarea resize-y font-mono text-sm"
          placeholder="Введіть текст документа…"
        />
        <div className="flex justify-end gap-2 pt-2 border-t border-hairline">
          <button onClick={onClose} className="btn-secondary">
            Скасувати
          </button>
          <button onClick={() => onSave(text)} disabled={isPending} className="btn-primary">
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Зберегти
          </button>
        </div>
      </div>
    </Modal>
  );
}
