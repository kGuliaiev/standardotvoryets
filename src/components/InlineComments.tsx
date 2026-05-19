'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc/client';
import { Avatar } from '@/components/ui/Avatar';
import { MessageSquare, Check, X as XIcon, Loader2, MessageCirclePlus, Reply } from 'lucide-react';
import type { RouterOutputs } from '@/lib/trpc/client';

/**
 * Inline (selection-anchored) comments — the Google-Docs-style overlay
 * that sits on top of the read-only body view of a Standard or
 * uploaded Document.
 *
 * Two surfaces in one component:
 *
 *   1. A document-level mouseup listener that watches for a non-empty
 *      text selection within an element carrying `data-paragraph-idx`.
 *      When it sees one, a floating "💬 Коментувати" pill appears next
 *      to the selection. Clicking it opens a small composer; on save
 *      the comment is persisted via tRPC and the selection is cleared.
 *
 *   2. A right-rail list of all comments for the target, grouped by
 *      paragraph. Clicking a row scrolls the source paragraph into
 *      view with a brief highlight pulse.
 *
 * Inline highlighting of the commented text in the body is *not* part
 * of v1 — it requires careful DOM range manipulation across formatted
 * HTML and is deferred. The selection snapshot stored on the row
 * (`selectionText`) is shown in the rail instead.
 */

type InlineCommentItem = RouterOutputs['inlineComment']['list'][number];

export type InlineCommentTarget = { standardId: string } | { documentId: string };

interface Props {
  /** The body's owning entity — exactly one of standardId / documentId. */
  target: InlineCommentTarget;
  /** Whether the current user is allowed to leave / reply to comments
   *  (typically anyone with `comment:add` on the WG). */
  canComment: boolean;
  /** Ref to the element that wraps all the paragraph blocks. The
   *  selection listener is scoped to this container. */
  articleRef: React.RefObject<HTMLElement>;
}

interface PendingSelection {
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
  selectionText: string;
  /** Viewport-relative anchor for the floating bubble. */
  anchorX: number;
  anchorY: number;
}

/** Walk text nodes inside `root` and return the absolute character
 *  offset of `(node, offset)` relative to the root's plain text. */
function offsetWithinRoot(root: Element, node: Node, offset: number): number | null {
  if (!root.contains(node)) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === node) return pos + offset;
    pos += n.nodeValue?.length ?? 0;
  }
  // node wasn't a text node (e.g. an element boundary) — fall back to
  // counting everything before it.
  return pos;
}

function findParagraphAncestor(node: Node | null): HTMLElement | null {
  let el = node instanceof Element ? node : (node?.parentElement ?? null);
  while (el && !(el instanceof HTMLElement && el.dataset.paragraphIdx != null)) {
    el = el.parentElement;
  }
  return el;
}

/**
 * Wrap the [start, end) character range inside `root`'s plain text in
 * `<span class="inline-comment-mark" data-comment-id=…>`. Splits the
 * wrapping into per-text-node ranges so it works across formatted
 * markup (bold, italics, links, …) without crossing element
 * boundaries.
 */
function wrapRange(
  root: HTMLElement,
  start: number,
  end: number,
  commentId: string,
  resolved: boolean,
) {
  if (end <= start) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: { node: Text; from: number; to: number }[] = [];
  let pos = 0;
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const len = node.nodeValue?.length ?? 0;
    const nodeStart = pos;
    const nodeEnd = pos + len;
    if (nodeEnd > start && nodeStart < end) {
      const from = Math.max(0, start - nodeStart);
      const to = Math.min(len, end - nodeStart);
      if (to > from) targets.push({ node, from, to });
    }
    pos = nodeEnd;
    if (pos >= end) break;
  }
  for (const t of targets) {
    try {
      const range = document.createRange();
      range.setStart(t.node, t.from);
      range.setEnd(t.node, t.to);
      const span = document.createElement('span');
      span.className = `inline-comment-mark${resolved ? ' resolved' : ''}`;
      span.dataset.commentId = commentId;
      span.title = 'Натисніть, щоб перейти до коментаря';
      range.surroundContents(span);
    } catch {
      // Skip if the range somehow crosses an element boundary — the
      // worst case is one comment without its inline mark.
    }
  }
}

export function InlineComments({ target, canComment, articleRef }: Props) {
  const utils = trpc.useUtils();
  const { data: session } = useSession();
  const me = session?.user;

  const queryInput = useMemo(() => target, [target]);

  const { data: comments } = trpc.inlineComment.list.useQuery(queryInput, {
    staleTime: 0,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const invalidate = useCallback(
    () => void utils.inlineComment.list.invalidate(queryInput),
    [utils, queryInput],
  );

  const createMutation = trpc.inlineComment.create.useMutation({
    onSuccess: () => {
      invalidate();
      setPending(null);
      setDraft('');
    },
    onError: (e) => alert(e.message),
  });
  const replyMutation = trpc.inlineComment.reply.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => alert(e.message),
  });
  const setResolvedMutation = trpc.inlineComment.setResolved.useMutation({
    onSuccess: () => invalidate(),
  });
  const deleteMutation = trpc.inlineComment.delete.useMutation({
    onSuccess: () => invalidate(),
  });

  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [draft, setDraft] = useState('');
  // Hover state for the floating pill — without this it disappears the
  // moment the user clicks because the selection clears.
  const [bubbleActive, setBubbleActive] = useState(false);

  // Document-level mouseup so selections finishing outside the article
  // container still get checked (mousedown-inside, mouseup-outside is
  // a normal browser behaviour).
  useEffect(() => {
    if (!canComment) return;
    function handleMouseUp() {
      // Defer one tick so the browser finishes updating the selection.
      setTimeout(() => {
        const article = articleRef.current;
        if (!article) return;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
          if (!bubbleActive) setPending(null);
          return;
        }
        const range = sel.getRangeAt(0);
        const startPara = findParagraphAncestor(range.startContainer);
        const endPara = findParagraphAncestor(range.endContainer);
        // Reject selections that span multiple paragraphs or leak
        // outside the article entirely.
        if (!startPara || startPara !== endPara || !article.contains(startPara)) {
          if (!bubbleActive) setPending(null);
          return;
        }
        const text = sel.toString().trim();
        if (text.length === 0) {
          if (!bubbleActive) setPending(null);
          return;
        }
        const startOffset = offsetWithinRoot(startPara, range.startContainer, range.startOffset);
        const endOffset = offsetWithinRoot(startPara, range.endContainer, range.endOffset);
        if (startOffset == null || endOffset == null || endOffset <= startOffset) return;
        const rect = range.getBoundingClientRect();
        setPending({
          paragraphIndex: Number(startPara.dataset.paragraphIdx),
          startOffset,
          endOffset,
          selectionText: text.slice(0, 5000),
          anchorX: rect.left + rect.width / 2,
          anchorY: rect.top - 8,
        });
      }, 0);
    }
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [canComment, articleRef, bubbleActive]);

  // Esc to dismiss the composer.
  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPending(null);
        setDraft('');
        setBubbleActive(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);

  // Inline highlighting — wrap commented ranges with a span so the
  // text itself shows where comments live, matching Google Docs. The
  // wrapping is reversible: each run unwraps previous marks first,
  // then re-applies based on the current comments list. Runs whenever
  // the comment list or body changes.
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    // Unwrap any previous marks.
    article.querySelectorAll('span.inline-comment-mark').forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    });
    if (!comments || comments.length === 0) return;
    for (const c of comments) {
      const para = article.querySelector(`[data-paragraph-idx="${c.paragraphIndex}"]`);
      if (!(para instanceof HTMLElement)) continue;
      wrapRange(para, c.startOffset, c.endOffset, c.id, c.status === 'RESOLVED');
    }
  }, [comments, articleRef]);

  // Click on a highlight → scroll the matching rail item into view and
  // pulse it briefly.
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    function onClick(e: MouseEvent) {
      if (!(e.target instanceof Element)) return;
      const mark = e.target.closest('.inline-comment-mark');
      if (!(mark instanceof HTMLElement)) return;
      const id = mark.dataset.commentId;
      if (!id) return;
      const railItem = document.querySelector(`[data-rail-comment-id="${id}"]`);
      if (!(railItem instanceof HTMLElement)) return;
      railItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      railItem.classList.add('inline-comment-flash');
      setTimeout(() => railItem.classList.remove('inline-comment-flash'), 1500);
    }
    article.addEventListener('click', onClick);
    return () => article.removeEventListener('click', onClick);
  }, [articleRef]);

  function submitDraft() {
    if (!pending) return;
    const body = draft.trim();
    if (!body) return;
    createMutation.mutate({
      ...target,
      paragraphIndex: pending.paragraphIndex,
      startOffset: pending.startOffset,
      endOffset: pending.endOffset,
      selectionText: pending.selectionText,
      body,
    });
  }

  function scrollToParagraph(paragraphIndex: number) {
    const el = articleRef.current?.querySelector(
      `[data-paragraph-idx="${paragraphIndex}"]`,
    ) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('inline-comment-flash');
    setTimeout(() => el.classList.remove('inline-comment-flash'), 1500);
  }

  // ── Rail rendering helpers ───────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = new Map<number, InlineCommentItem[]>();
    for (const c of comments ?? []) {
      const arr = map.get(c.paragraphIndex) ?? [];
      arr.push(c);
      map.set(c.paragraphIndex, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [comments]);

  const openCount = useMemo(
    () => (comments ?? []).filter((c) => c.status === 'OPEN').length,
    [comments],
  );

  return (
    <>
      {/* Right-rail panel of all inline comments grouped by paragraph.
          Sticky/scroll behaviour is handled by the parent rail
          wrapper in StandardBodyEditor — both this panel and the
          neighbouring "Останні рішення" panel scroll together. */}
      <aside className="bg-card rounded-xl border border-hairline overflow-hidden">
        <div className="px-4 py-3 border-b border-hairline flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-mid" />
            <h3 className="text-xs font-bold uppercase tracking-wide text-ink">Коментарі</h3>
          </div>
          {openCount > 0 && (
            <span className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 rounded-full px-1.5 py-0.5 tabular-nums">
              {openCount} відкритих
            </span>
          )}
        </div>
        {grouped.length === 0 ? (
          <p className="px-4 py-5 text-[11px] text-light text-center leading-relaxed">
            {canComment
              ? 'Виділіть текст у документі та натисніть «💬 Коментувати», щоб залишити inline-замітку.'
              : 'Коментарів ще немає.'}
          </p>
        ) : (
          <ul className="divide-y divide-hairline max-h-[60vh] overflow-y-auto scrollbar-thin">
            {grouped.map(([paraIdx, items]) => (
              <li key={paraIdx} className="px-3 py-2.5">
                <button
                  className="text-[10px] text-light font-mono uppercase tracking-wide mb-1 hover:text-brand"
                  onClick={() => scrollToParagraph(paraIdx)}
                >
                  Параграф {paraIdx + 1}
                </button>
                <ul className="space-y-2">
                  {items.map((c) => {
                    const isResolved = c.status === 'RESOLVED';
                    const isMine = me?.id === c.author.id;
                    return (
                      <li
                        key={c.id}
                        data-rail-comment-id={c.id}
                        className={`rounded-md border px-2.5 py-2 text-[11px] ${
                          isResolved
                            ? 'border-hairline bg-pill/40 opacity-70'
                            : 'border-amber-200 dark:border-amber-700/60 bg-amber-50/40 dark:bg-amber-900/10'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <Avatar
                            name={c.author.name}
                            avatarUrl={c.author.avatarUrl ?? undefined}
                            size="xs"
                          />
                          <span className="font-semibold text-ink">{c.author.name}</span>
                          <span className="text-[10px] text-light ml-auto">
                            {new Date(c.createdAt).toLocaleDateString('uk-UA')}
                          </span>
                        </div>
                        <p className="italic text-mid line-clamp-2 mb-1.5">
                          «{c.selectionText.slice(0, 120)}
                          {c.selectionText.length > 120 ? '…' : ''}»
                        </p>
                        <p className="text-ink whitespace-pre-wrap leading-snug">{c.body}</p>
                        {c.replies.length > 0 && (
                          <ul className="mt-1.5 pl-2 border-l-2 border-hairline space-y-1">
                            {c.replies.map((r) => (
                              <li key={r.id} className="text-[10.5px]">
                                <span className="font-semibold text-ink">{r.author.name}:</span>{' '}
                                <span className="text-mid">{r.body}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                          {canComment && !isResolved && (
                            <ReplyButton commentId={c.id} replyMutation={replyMutation} />
                          )}
                          {canComment && (
                            <button
                              onClick={() =>
                                setResolvedMutation.mutate({
                                  id: c.id,
                                  resolved: !isResolved,
                                })
                              }
                              className="text-[10px] text-mid hover:text-brand inline-flex items-center gap-0.5"
                              title={isResolved ? 'Знову відкрити' : 'Позначити вирішеним'}
                            >
                              <Check className="w-3 h-3" />
                              {isResolved ? 'Відкрити' : 'Вирішено'}
                            </button>
                          )}
                          {(isMine || canComment) && (
                            <button
                              onClick={() => {
                                if (confirm('Видалити цей коментар?')) {
                                  deleteMutation.mutate({ id: c.id });
                                }
                              }}
                              className="text-[10px] text-mid hover:text-red-600 inline-flex items-center gap-0.5"
                            >
                              <XIcon className="w-3 h-3" />
                              Видалити
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Floating "💬 Коментувати" pill — shown while a valid selection
          exists. Portal'd to body so the fixed positioning isn't
          clipped by any ancestor with overflow:hidden. */}
      {pending &&
        !draft &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: pending.anchorX,
              top: pending.anchorY,
              transform: 'translate(-50%, -100%)',
              zIndex: 1000,
            }}
            onMouseDown={(e) => {
              // Prevent the selection from clearing when the bubble is
              // clicked.
              e.preventDefault();
              setBubbleActive(true);
            }}
          >
            <button
              onClick={() => {
                // Lock the selection state so the composer can take
                // over; the actual textarea will open in place of the
                // pill below.
                setBubbleActive(true);
                setDraft(' '); // non-empty draft triggers composer render
                setTimeout(() => setDraft(''), 0); // clear so placeholder shows
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink text-card rounded-full shadow-modal text-xs font-semibold hover:bg-brand"
            >
              <MessageCirclePlus className="w-3.5 h-3.5" />
              Коментувати
            </button>
          </div>,
          document.body,
        )}

      {/* Composer popover — appears after the pill is clicked. */}
      {pending &&
        bubbleActive &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: Math.min(pending.anchorX, window.innerWidth - 340),
              top: pending.anchorY,
              transform: 'translate(-50%, -100%)',
              zIndex: 1000,
              width: 320,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="bg-card border border-hairline rounded-xl shadow-modal p-3 space-y-2"
          >
            <p className="text-[10px] uppercase tracking-wide text-light">
              Параграф {pending.paragraphIndex + 1}
            </p>
            <p className="text-[11px] italic text-mid line-clamp-2">
              «{pending.selectionText.slice(0, 120)}
              {pending.selectionText.length > 120 ? '…' : ''}»
            </p>
            <textarea
              autoFocus
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  submitDraft();
                }
              }}
              placeholder="Ваш коментар…"
              className="textarea resize-none text-xs"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setPending(null);
                  setDraft('');
                  setBubbleActive(false);
                }}
                className="text-xs text-mid hover:text-ink"
              >
                Скасувати
              </button>
              <button
                onClick={submitDraft}
                disabled={!draft.trim() || createMutation.isPending}
                className="text-xs inline-flex items-center gap-1 px-2.5 py-1 rounded bg-brand text-white font-semibold disabled:opacity-50"
              >
                {createMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
                Зберегти
              </button>
            </div>
            <p className="text-[10px] text-light">⌘+Enter — зберегти · Esc — скасувати</p>
          </div>,
          document.body,
        )}
    </>
  );
}

function ReplyButton({
  commentId,
  replyMutation,
}: {
  commentId: string;
  replyMutation: ReturnType<typeof trpc.inlineComment.reply.useMutation>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] text-mid hover:text-brand inline-flex items-center gap-0.5"
      >
        <Reply className="w-3 h-3" />
        Відповісти
      </button>
    );
  }
  return (
    <div className="w-full mt-1 space-y-1">
      <textarea
        autoFocus
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Відповідь…"
        className="textarea resize-none text-[11px]"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={() => {
            setOpen(false);
            setText('');
          }}
          className="text-[10px] text-mid hover:text-ink"
        >
          Скасувати
        </button>
        <button
          onClick={() => {
            const body = text.trim();
            if (!body) return;
            replyMutation.mutate({ commentId, body });
            setText('');
            setOpen(false);
          }}
          className="text-[10px] px-2 py-0.5 rounded bg-brand text-white"
        >
          Надіслати
        </button>
      </div>
    </div>
  );
}
