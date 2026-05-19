'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc/client';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { RichTextEditor } from '@/components/ui/RichTextEditor';
import { InlineComments, InlineCommentsList } from '@/components/InlineComments';
import { splitHtmlBlocks, htmlToPlainText, normalizeBodyHtml } from '@/lib/standardBody';
import { wordDiff } from '@/lib/wordDiff';
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
  FileDown,
} from 'lucide-react';
import { can } from '@/lib/rbac';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';
import type { RouterOutputs } from '@/lib/trpc/client';

type SuggestionListItem = RouterOutputs['suggestion']['list'][number];

/**
 * The collaborative editor used to live only on a Standard. Now it also
 * powers per-document editing for uploaded .docx files that the leader
 * flagged as "allow edits". The data flow is identical — TipTap HTML
 * body + paragraph-indexed suggestions — only the target table differs.
 */
export type BodyEditorTarget =
  | { kind: 'standard'; standardId: string; workingGroupId: string }
  | {
      kind: 'document';
      documentId: string;
      /** The parent standard is still needed for permission lookups and to
       *  invalidate the right query when the body changes. */
      parentStandardId: string;
      workingGroupId: string;
    };

interface Props {
  target: BodyEditorTarget;
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

export function StandardBodyEditor({ target, bodyText, bodyUpdatedAt, bodyUpdatedBy }: Props) {
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

  const canEditMeta = userCtx ? can(userCtx, 'standard:editMeta', target.workingGroupId) : false;
  const canSuggest = userCtx ? can(userCtx, 'comment:add', target.workingGroupId) : false;

  // Body is HTML emitted by TipTap (legacy plain-text bodies are migrated to
  // <p>-wrapped HTML transparently inside splitHtmlBlocks).
  const normalizedBody = useMemo(() => normalizeBodyHtml(bodyText), [bodyText]);
  const paragraphs = useMemo(() => splitHtmlBlocks(normalizedBody), [normalizedBody]);

  // Single object the suggestion router uses to identify the target.
  // Memoised so the tRPC query key stays stable across renders.
  const targetInput = useMemo(
    () =>
      target.kind === 'standard'
        ? ({ standardId: target.standardId } as const)
        : ({ documentId: target.documentId } as const),
    [target],
  );
  /** The parent standard ID — used to invalidate `standard.byId` so the
   *  surrounding page (documents list, body header) refetches when this
   *  editor mutates something. */
  const parentStandardId = target.kind === 'standard' ? target.standardId : target.parentStandardId;

  // Poll every 5s so a suggestion submitted by one collaborator shows up
  // on everyone else's open document without a manual refresh. The query
  // payload is tiny (just open + recent resolved edits) so the bandwidth
  // cost is negligible. Polling pauses automatically when the tab is in
  // the background.
  const { data: suggestions } = trpc.suggestion.list.useQuery(targetInput, {
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
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
  /** Right rail tabs — Зміни (suggestions) or Коментарі (inline). */
  const [railTab, setRailTab] = useState<'changes' | 'comments'>('changes');
  // Shared inline-comments query so the rail tab badge can show a
  // counter alongside Зміни — InlineComments component also queries
  // the same endpoint (cache deduplicates so it's free).
  const { data: inlineCommentsList } = trpc.inlineComment.list.useQuery(targetInput, {
    staleTime: 0,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  // Reference into the body container — `InlineComments` uses it to
  // scope selection capture and to scroll-to-paragraph from the rail.
  const articleRef = useRef<HTMLElement>(null);
  // Holds HTML returned by /api/import-body while the user confirms a
  // destructive replace (only used when a body already exists).
  const [pendingImport, setPendingImport] = useState<{ html: string; filename: string } | null>(
    null,
  );

  const pendingSuggestionCount = useMemo(
    () => (suggestions ?? []).filter((s) => s.status === 'PENDING').length,
    [suggestions],
  );
  const suggestionsTotal = suggestions?.length ?? 0;
  const inlineCommentsOpenCount = useMemo(
    () => (inlineCommentsList ?? []).filter((c) => c.status === 'OPEN').length,
    [inlineCommentsList],
  );
  const inlineCommentsTotal = inlineCommentsList?.length ?? 0;

  const invalidateSuggestions = () => void utils.suggestion.list.invalidate(targetInput);
  const invalidateBody = () => void utils.standard.byId.invalidate({ id: parentStandardId });

  const createMutation = trpc.suggestion.create.useMutation({
    onSuccess: () => {
      invalidateSuggestions();
      setDraft(null);
    },
  });
  const reactMutation = trpc.suggestion.react.useMutation({
    onSuccess: () => invalidateSuggestions(),
  });
  const acceptMutation = trpc.suggestion.accept.useMutation({
    onSuccess: () => {
      invalidateSuggestions();
      invalidateBody();
    },
    onError: (e) => alert(e.message),
  });
  const rejectMutation = trpc.suggestion.reject.useMutation({
    onSuccess: () => invalidateSuggestions(),
  });
  const updateBodyMutation = trpc.suggestion.updateBody.useMutation({
    onSuccess: () => {
      invalidateBody();
      setBulkOpen(false);
    },
    onError: (e) => alert(e.message),
  });
  const replaceBodyMutation = trpc.suggestion.replaceBody.useMutation({
    onSuccess: () => {
      invalidateBody();
      invalidateSuggestions();
      setBulkOpen(false);
      setPendingImport(null);
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
      ...targetInput,
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
            standardIdForUpload={parentStandardId}
            variant="primary"
            onImported={(html) => updateBodyMutation.mutate({ ...targetInput, bodyText: html })}
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
          standardIdForUpload={parentStandardId}
          bodyAlreadyExists={false}
          pendingSuggestionCount={0}
          onClose={() => setBulkOpen(false)}
          onSave={(text) => updateBodyMutation.mutate({ ...targetInput, bodyText: text })}
          onReplace={(text) => updateBodyMutation.mutate({ ...targetInput, bodyText: text })}
          isPending={updateBodyMutation.isPending}
        />
      </div>
    );
  }

  // Resolved at render time so export URL switches between
  // /api/standards/[id]/export-body and /api/documents/[id]/export-body.
  const exportUrl =
    target.kind === 'standard'
      ? `/api/standards/${target.standardId}/export-body`
      : `/api/documents/${target.documentId}/export-body`;

  // Sticky offset for the action toolbar:
  //   - document target → editor lives inside a Modal whose title is
  //     pinned to top-0, so the toolbar sits just under it.
  //   - standard target → standalone page scroll, toolbar pins at top.
  // px-* extends the bg across the surrounding container padding so the
  // scrolling text behind doesn't peek through on either side; the
  // matching -mx-* compensates so the strip doesn't overflow its
  // grid column.
  const isInModal = target.kind === 'document';
  const toolbarSticky = isInModal
    ? 'sticky top-[51px] md:top-[71px] z-10 bg-card/90 backdrop-blur-md -mx-5 md:-mx-7 px-5 md:px-7 py-2 border-b border-hairline'
    : 'sticky top-0 z-10 bg-card/90 backdrop-blur-md py-2 border-b border-hairline';

  return (
    <div className="space-y-3">
      {/* Header strip / action toolbar — pinned to top so it stays
          reachable while scrolling long documents. Lives OUTSIDE the
          grid so it spans the full width and the right rail starts at
          the same vertical position as the article body. */}
      <div className={`${toolbarSticky} flex items-center justify-between flex-wrap gap-2`}>
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
        <div className="flex items-center gap-1.5 flex-wrap">
          <a
            href={exportUrl}
            download
            className="text-xs px-2.5 py-1 rounded border border-hairline text-mid hover:text-ink hover:bg-pill inline-flex items-center gap-1.5"
            title="Зберегти текст документа як файл Microsoft Word (.docx)"
          >
            <FileDown className="w-3 h-3" />
            Експортувати .docx
          </a>
          {canEditMeta && (
            <DocxImportButton
              standardIdForUpload={parentStandardId}
              variant="header"
              onImported={(html, filename) => setPendingImport({ html, filename })}
              disabled={replaceBodyMutation.isPending}
            />
          )}
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
      </div>

      {/* Two columns under the sticky toolbar: body article on the
          left, comments + decisions rail on the right. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 items-start">
        {/* Body blocks (HTML, rendered via prose classes).
            space-y-1 ≈ Word's normal paragraph rhythm; hover actions
            float on top of the text instead of expanding the layout. */}
        <article
          ref={articleRef}
          className="bg-card rounded-xl border border-hairline p-5 sm:p-8 space-y-1"
        >
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

        {/* Right rail card with two tabs: Зміни (suggestions) and
            Коментарі (inline). Sticky so the rail stays put while the
            body scrolls underneath. Each tab has its own scrollable
            content area (max-h on the tab body itself) — the rail
            never has to scroll as a unit. */}
        <div
          className={`${
            isInModal
              ? 'lg:sticky lg:top-[88px] lg:self-start lg:h-[calc(92vh-110px)]'
              : 'lg:sticky lg:top-4 lg:self-start lg:h-[calc(100vh-3rem)]'
          }`}
        >
          {/* Card with a hard-bounded height so sticky positioning
              actually stays put. `h-[...]` (not max-h) keeps the
              wrapper size predictable — sticky doesn't behave well
              when its content can grow taller than the scrollport. */}
          <div className="bg-card rounded-xl border border-hairline overflow-hidden flex flex-col h-full">
            <div className="flex border-b border-hairline shrink-0">
              <RailTabButton
                active={railTab === 'changes'}
                onClick={() => setRailTab('changes')}
                label="Зміни"
                open={pendingSuggestionCount}
                total={suggestionsTotal}
              />
              <RailTabButton
                active={railTab === 'comments'}
                onClick={() => setRailTab('comments')}
                label="Коментарі"
                open={inlineCommentsOpenCount}
                total={inlineCommentsTotal}
              />
            </div>
            {/* The tab body owns its own overflow — the card never
                scrolls as a whole, the inner list does. */}
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {railTab === 'changes' ? (
                <ChangesPanel
                  suggestions={suggestions ?? []}
                  resolvedRecent={resolvedRecent}
                  articleRef={articleRef}
                />
              ) : (
                <InlineCommentsList
                  target={targetInput}
                  canComment={canSuggest}
                  articleRef={articleRef}
                />
              )}
            </div>
          </div>
          {/* InlineComments overlay (no rail rendering) mounted
              always so selection capture, the floating composer, and
              inline highlights work regardless of which tab is
              active. */}
          <InlineComments
            target={targetInput}
            canComment={canSuggest}
            articleRef={articleRef}
            showRail={false}
          />
        </div>
      </div>

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
        standardIdForUpload={parentStandardId}
        bodyAlreadyExists={!!bodyText}
        pendingSuggestionCount={pendingSuggestionCount}
        onClose={() => setBulkOpen(false)}
        onSave={(text) => updateBodyMutation.mutate({ ...targetInput, bodyText: text })}
        onReplace={(text) => replaceBodyMutation.mutate({ ...targetInput, bodyText: text })}
        isPending={updateBodyMutation.isPending || replaceBodyMutation.isPending}
      />

      {/* Top-level import confirmation: only shown when the body already
          has content (otherwise the import write is non-destructive and
          we apply it immediately). */}
      <ImportConfirmModal
        pending={pendingImport}
        pendingSuggestionCount={pendingSuggestionCount}
        isApplying={replaceBodyMutation.isPending}
        onCancel={() => setPendingImport(null)}
        onConfirm={() => {
          if (pendingImport) {
            replaceBodyMutation.mutate({ ...targetInput, bodyText: pendingImport.html });
          }
        }}
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
    <section
      className={`group relative rounded ${
        hasPending
          ? 'border-l-2 border-amber-400 pl-3 -ml-3'
          : 'hover:bg-pill/40 -mx-2 px-2 transition-colors'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-[10px] text-light font-mono tabular-nums w-5 shrink-0 pt-1 select-none">
          {idx + 1}
        </span>
        <div className="flex-1 min-w-0" data-paragraph-idx={idx}>
          {/* HTML body block — sanitized by TipTap's schema on write, so safe
              to dangerouslySetInnerHTML on read. `data-paragraph-idx` on
              the wrapper lets InlineComments map a text selection back
              to a block index. */}
          <div
            className={`${READONLY_PROSE_CLASSES} break-words`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
      {/* Floating action bar — overlays the text rather than pushing
          layout, so paragraphs stay tightly packed when no one's
          hovering. Becomes visible on hover OR when a child receives
          focus (keyboard accessibility). */}
      {canSuggest && (
        <div className="absolute right-1 top-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity bg-card/95 backdrop-blur-sm border border-hairline rounded shadow-sm flex items-center gap-0.5 px-0.5 py-0.5 z-10">
          <button
            onClick={onSuggestReplace}
            className="p-1 rounded text-mid hover:text-brand hover:bg-pill"
            title="Запропонувати правку цього параграфа"
            aria-label="Змінити"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onSuggestInsert}
            className="p-1 rounded text-mid hover:text-brand hover:bg-pill"
            title="Запропонувати новий параграф після цього"
            aria-label="Додати після"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onSuggestDelete}
            className="p-1 rounded text-mid hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
            title="Запропонувати видалити цей параграф"
            aria-label="Видалити"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

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

                {/* For REPLACE: show the original as a quiet grey
                    reference, then a word-level diff line with red
                    strike-through removals + green additions. Much
                    easier to scan than two redundant blocks. */}
                {s.operation === 'REPLACE' && (
                  <div className="text-[13px] leading-relaxed space-y-1.5">
                    <p className="text-[12px] text-light italic line-clamp-2">
                      {htmlToPlainText(s.originalText) || '—'}
                    </p>
                    <p className="leading-relaxed">
                      {wordDiff(
                        htmlToPlainText(s.originalText),
                        htmlToPlainText(s.proposedText),
                      ).map((part, i) => {
                        if (part.type === 'eq') return <span key={i}>{part.text}</span>;
                        if (part.type === 'del')
                          return (
                            <span
                              key={i}
                              className="line-through text-red-600 dark:text-red-400 bg-red-50/60 dark:bg-red-900/20 rounded px-0.5"
                            >
                              {part.text}
                            </span>
                          );
                        return (
                          <span
                            key={i}
                            className="text-emerald-700 dark:text-emerald-300 bg-emerald-50/70 dark:bg-emerald-900/20 rounded px-0.5 font-medium"
                          >
                            {part.text}
                          </span>
                        );
                      })}
                    </p>
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
  // Compare HTML, not plain text, so changes that affect only formatting
  // (alignment, bold, italic, etc.) still count as a valid edit. Two
  // bodies with identical text but different alignment must be allowed
  // through.
  const sameAsOriginal =
    draft.operation === 'REPLACE' && draft.proposedText.trim() === draft.originalText.trim();

  // Sniff the block tag of the original vs the proposed so we can warn
  // the user when they accidentally demoted a heading to a paragraph
  // (common when typing over a heading drops the block type).
  const originalTag = /^\s*<(\w+)/.exec(draft.originalText)?.[1]?.toLowerCase();
  const proposedTag = /^\s*<(\w+)/.exec(draft.proposedText)?.[1]?.toLowerCase();
  const blockTypeChanged =
    draft.operation === 'REPLACE' &&
    originalTag &&
    proposedTag &&
    originalTag !== proposedTag &&
    /^h[1-6]$/.test(originalTag);

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
            {blockTypeChanged && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded px-2.5 py-1.5 inline-flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Оригінал — заголовок ({originalTag?.toUpperCase()}). Зараз ваш текст оформлений як{' '}
                {proposedTag === 'p' ? 'звичайний абзац' : proposedTag?.toUpperCase()}. Натисніть
                кнопку {originalTag?.toUpperCase()} у тулбарі, щоб повернути стиль.
              </p>
            )}
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
  standardIdForUpload,
  bodyAlreadyExists,
  pendingSuggestionCount,
  onClose,
  onSave,
  onReplace,
  isPending,
}: {
  open: boolean;
  initial: string;
  /** Used only to build the .docx import URL — the import endpoint just
   *  converts the file and returns HTML, so we always hit the parent
   *  standard route. */
  standardIdForUpload: string;
  bodyAlreadyExists: boolean;
  pendingSuggestionCount: number;
  onClose: () => void;
  onSave: (text: string) => void;
  onReplace: (text: string) => void;
  isPending: boolean;
}) {
  const [html, setHtml] = useState(initial);
  // The editor seeds `content` only once at mount; bumping this key
  // forces a remount when an import replaces the buffer mid-session.
  const [editorKey, setEditorKey] = useState(0);
  // Tracks whether the current buffer came from a .docx import. When true,
  // saving uses replaceBody (which wipes orphaned suggestions) instead of
  // updateBody.
  const [importedFromDocx, setImportedFromDocx] = useState(false);
  // re-sync when modal (re)opens with a different initial value
  useEffect(() => {
    if (open) {
      setHtml(initial);
      setImportedFromDocx(false);
      setEditorKey((k) => k + 1);
    }
  }, [initial, open]);

  const handleSave = () => {
    if (importedFromDocx && bodyAlreadyExists) {
      onReplace(html);
    } else {
      onSave(html);
    }
  };

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
            standardIdForUpload={standardIdForUpload}
            variant="secondary"
            onImported={(imported) => {
              setHtml(imported);
              setImportedFromDocx(true);
              setEditorKey((k) => k + 1);
            }}
          />
        </div>
        {importedFromDocx && bodyAlreadyExists && pendingSuggestionCount > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded px-2.5 py-1.5 inline-flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            При збереженні буде видалено {pendingSuggestionCount}{' '}
            {pluralizeUk(
              pendingSuggestionCount,
              'відкриту правку',
              'відкриті правки',
              'відкритих правок',
            )}
            , оскільки вони відносяться до попереднього тексту.
          </p>
        )}
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
          <button onClick={handleSave} disabled={isPending} className="btn-primary">
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Зберегти
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Ukrainian plural form: 1 → 'one', 2-4 → 'few', 5+ → 'many'. */
function pluralizeUk(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Tab button for the right rail with an inline open/total counter. */
function RailTabButton({
  active,
  onClick,
  label,
  open,
  total,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  open: number;
  total: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide border-b-2 transition-colors inline-flex items-center justify-center gap-1.5 ${
        active
          ? 'border-brand text-ink bg-card'
          : 'border-transparent text-mid hover:text-ink hover:bg-pill/50'
      }`}
    >
      {label}
      <span className="tabular-nums font-normal text-light">
        {open > 0 && <span className="text-amber-600 dark:text-amber-400 font-bold">{open}</span>}
        {open > 0 ? ' / ' : ''}
        {total}
      </span>
    </button>
  );
}

/** Tab content for the "Зміни" tab — pending suggestions on top
 *  (clickable to scroll to the source paragraph) + recently
 *  resolved decisions below. */
function ChangesPanel({
  suggestions,
  resolvedRecent,
  articleRef,
}: {
  suggestions: SuggestionListItem[];
  resolvedRecent: SuggestionListItem[];
  articleRef: React.RefObject<HTMLElement>;
}) {
  const pending = suggestions.filter((s) => s.status === 'PENDING');

  function scrollToParagraph(idx: number) {
    const el = articleRef.current?.querySelector(`[data-paragraph-idx="${idx}"]`);
    if (!(el instanceof HTMLElement)) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Green pulse for "change" navigation so it visually differs from
    // the amber pulse used by inline-comment clicks.
    el.classList.add('inline-change-flash');
    setTimeout(() => el.classList.remove('inline-change-flash'), 1500);
  }

  if (pending.length === 0 && resolvedRecent.length === 0) {
    return (
      <p className="px-4 py-6 text-[11px] text-light text-center leading-relaxed">
        Правок ще немає. Натисніть олівець біля параграфа, щоб запропонувати зміну.
      </p>
    );
  }

  return (
    <div className="divide-y divide-hairline">
      {pending.length > 0 && (
        <section>
          <div className="px-3 py-1.5 text-[10px] text-amber-700 dark:text-amber-300 font-bold uppercase tracking-wide">
            Відкриті ({pending.length})
          </div>
          <ul className="divide-y divide-hairline">
            {pending.map((s) => (
              <li key={s.id} className="px-3 py-2">
                <button
                  className="w-full text-left hover:bg-pill/40 rounded -mx-1 px-1 py-0.5 transition-colors"
                  onClick={() => scrollToParagraph(s.paragraphIndex)}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                      {s.operation === 'DELETE'
                        ? 'ВИДАЛИТИ'
                        : s.operation === 'INSERT_AFTER'
                          ? 'ДОДАТИ'
                          : 'ЗМІНИТИ'}
                    </span>
                    <span className="text-[10px] text-light">параграф {s.paragraphIndex + 1}</span>
                  </div>
                  <p className="text-[11px] text-mid line-clamp-2">
                    {htmlToPlainText(s.proposedText) || htmlToPlainText(s.originalText) || '—'}
                  </p>
                  <p className="text-[10px] text-light mt-1">{s.author.name}</p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {resolvedRecent.length > 0 && (
        <section>
          <div className="px-3 py-1.5 text-[10px] text-light font-bold uppercase tracking-wide">
            Останні рішення
          </div>
          <ul className="divide-y divide-hairline">
            {resolvedRecent.map((s) => (
              <li key={s.id} className="px-3 py-2">
                <button
                  className="w-full text-left hover:bg-pill/40 rounded -mx-1 px-1 py-0.5 transition-colors"
                  onClick={() => scrollToParagraph(s.paragraphIndex)}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
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
                  <p className="text-[11px] text-mid line-clamp-2">
                    {htmlToPlainText(s.proposedText) || '—'}
                  </p>
                  <p className="text-[10px] text-light mt-1">
                    {s.author.name}
                    {s.resolvedBy && ` → ${s.resolvedBy.name}`}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ImportConfirmModal({
  pending,
  pendingSuggestionCount,
  isApplying,
  onCancel,
  onConfirm,
}: {
  pending: { html: string; filename: string } | null;
  pendingSuggestionCount: number;
  isApplying: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!pending) return null;
  return (
    <Modal open={!!pending} onClose={onCancel} title="Замінити текст документа?" size="md">
      <div className="space-y-4">
        <p className="text-sm text-ink">
          Імпорт <span className="font-semibold">«{pending.filename}»</span> повністю замінить
          поточний текст документа.
        </p>
        {pendingSuggestionCount > 0 && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300 inline-flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Також буде видалено{' '}
              <strong>
                {pendingSuggestionCount}{' '}
                {pluralizeUk(
                  pendingSuggestionCount,
                  'відкриту правку',
                  'відкриті правки',
                  'відкритих правок',
                )}
              </strong>{' '}
              — їхні позиції в параграфах втратять сенс після заміни.
            </span>
          </div>
        )}
        <p className="text-xs text-light">
          Цю дію не можна скасувати. Попередній текст залишиться лише в журналі змін.
        </p>
        <div className="flex justify-end gap-2 pt-2 border-t border-hairline">
          <button onClick={onCancel} disabled={isApplying} className="btn-secondary">
            Скасувати
          </button>
          <button
            onClick={onConfirm}
            disabled={isApplying}
            className="btn-primary bg-red-600 hover:bg-red-700"
          >
            {isApplying && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Замінити текст
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * File picker + upload + .docx→HTML conversion via /api/standards/[id]/import-body.
 *
 * Visual variants:
 *   - `primary`   — the standalone empty-state CTA
 *   - `secondary` — the inline button inside the bulk edit modal
 *   - `header`    — compact button matching the other header actions
 *                   (Export / Edit-all) on the body tab
 */
function DocxImportButton({
  standardIdForUpload,
  variant,
  onImported,
  disabled,
}: {
  /** The conversion endpoint lives under /api/standards/[id]/import-body
   *  for historical reasons; it only converts the .docx and returns
   *  HTML, so any standard that the user can edit is a valid mount
   *  point. The caller passes the parent-standard id regardless of
   *  whether the target body lives on the standard itself or on one of
   *  its documents. */
  standardIdForUpload: string;
  variant: 'primary' | 'secondary' | 'header';
  onImported: (html: string, filename: string) => void;
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
      const res = await fetch(`/api/standards/${standardIdForUpload}/import-body`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        alert(err.error ?? 'Не вдалося імпортувати документ');
        return;
      }
      const data = (await res.json()) as {
        html: string;
        warnings?: string[];
        filename?: string;
      };
      if (data.warnings && data.warnings.length > 0) {
        // Show non-fatal conversion warnings so the user knows some content
        // (e.g. embedded objects) may have been dropped.
        // Quietly logged to the console as well for debugging.
        // eslint-disable-next-line no-console
        console.warn('[import-body] warnings:', data.warnings);
      }
      onImported(data.html, data.filename ?? file.name);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const baseClass =
    variant === 'primary'
      ? 'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-700 text-white text-sm font-semibold hover:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed'
      : variant === 'header'
        ? 'text-xs px-2.5 py-1 rounded border border-hairline text-mid hover:text-ink hover:bg-pill inline-flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed'
        : 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-hairline text-xs font-semibold text-ink hover:bg-pill disabled:opacity-60 disabled:cursor-not-allowed';

  const iconSize = variant === 'primary' ? 'w-4 h-4' : 'w-3 h-3';

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
          <Loader2 className={`${iconSize} animate-spin`} />
        ) : (
          <FileUp className={iconSize} />
        )}
        Імпортувати з Word
      </button>
    </>
  );
}
