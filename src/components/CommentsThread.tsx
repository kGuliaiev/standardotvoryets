'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import { Avatar } from '@/components/ui/Avatar';
import { Pencil, Trash2, Reply, Loader2, X, Check } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import {
  MentionTextarea,
  renderMentions,
  type MentionCandidate,
} from '@/components/ui/MentionTextarea';

interface Comment {
  id: string;
  body: string;
  parentId: string | null;
  authorId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  author: { id: string; name: string; avatarUrl: string | null };
}

export function CommentsThread({ standardId }: { standardId: string }) {
  const { data: session } = useSession();
  const utils = trpc.useUtils();
  const { data: comments, isLoading } = trpc.comment.list.useQuery({ standardId });
  const { data: standard } = trpc.standard.byId.useQuery({ id: standardId });
  const { data: workingGroup } = trpc.workingGroup.byId.useQuery(
    { id: standard?.workingGroupId ?? '' },
    { enabled: !!standard?.workingGroupId },
  );
  const mentionCandidates: MentionCandidate[] = useMemo(() => {
    if (!workingGroup) return [];
    return workingGroup.members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      hint:
        m.role === 'LEADER'
          ? 'Керівник'
          : m.role === 'DEPUTY'
            ? 'Заступник'
            : m.role === 'SECRETARY'
              ? 'Секретар'
              : undefined,
    }));
  }, [workingGroup]);

  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  /** Click "Відповісти" → set replyingTo, scroll the comment into
   *  view, and let the reply textarea autoFocus once mounted. */
  function openReply(id: string) {
    setReplyingTo(id);
    setReplyDraft('');
    setError(null);
    // Defer one frame so the reply composer mounts before we scroll
    // (and the new height is included in the scroll target).
    requestAnimationFrame(() => {
      const el = document.getElementById(`comment-${id}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function submitDraft() {
    if (!draft.trim()) return;
    createMutation.mutate({ standardId, body: draft });
  }
  function submitReply() {
    if (!replyDraft.trim() || !replyingTo) return;
    createMutation.mutate({ standardId, body: replyDraft, parentId: replyingTo });
  }

  // Deep-link support from /discussions:
  //   ?reply=<id>   → auto-open the reply composer + scroll to it
  //   ?compose=1    → autofocus the main "Залишити коментар" textarea
  const searchParams = useSearchParams();
  const composerRef = useRef<HTMLDivElement>(null);
  const replyParam = searchParams.get('reply');
  const composeParam = searchParams.get('compose');
  useEffect(() => {
    if (!comments) return;
    if (replyParam) {
      openReply(replyParam);
    } else if (composeParam) {
      const ta = composerRef.current?.querySelector('textarea');
      if (ta instanceof HTMLTextAreaElement) {
        ta.focus();
        composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, replyParam, composeParam]);

  const invalidate = () => {
    void utils.comment.list.invalidate({ standardId });
    void utils.standard.byId.invalidate({ id: standardId });
    void utils.activityLog.list.invalidate({ entity: 'Standard', entityId: standardId });
  };

  const createMutation = trpc.comment.create.useMutation({
    onSuccess: () => {
      invalidate();
      setDraft('');
      setReplyDraft('');
      setReplyingTo(null);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });
  const updateMutation = trpc.comment.update.useMutation({
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setEditDraft('');
    },
    onError: (e) => setError(e.message),
  });
  // Optimistic delete — pull the row out of the local cache before the
  // server round-trip so the user sees it disappear immediately.
  // `onMutate` snapshots + edits the cache; `onError` restores it;
  // `onSettled` invalidates to reconcile with whatever the server
  // ultimately stored. Pattern lifted from TanStack Query docs.
  const deleteMutation = trpc.comment.delete.useMutation({
    onMutate: async ({ id }) => {
      await utils.comment.list.cancel({ standardId });
      const prev = utils.comment.list.getData({ standardId });
      utils.comment.list.setData({ standardId }, (old) =>
        old ? old.filter((c) => c.id !== id && c.parentId !== id) : old,
      );
      return { prev };
    },
    onError: (e, _input, ctx) => {
      // Restore the snapshot so the comment reappears.
      if (ctx?.prev) utils.comment.list.setData({ standardId }, ctx.prev);
      setError(e.message);
    },
    onSettled: invalidate,
  });

  const tree = useMemo(() => {
    if (!comments) return [];
    const list = comments as Comment[];
    const byParent = new Map<string | null, Comment[]>();
    list.forEach((c) => {
      const arr = byParent.get(c.parentId) ?? [];
      arr.push(c);
      byParent.set(c.parentId, arr);
    });
    const roots = byParent.get(null) ?? [];
    return roots.map((r) => ({ ...r, replies: byParent.get(r.id) ?? [] }));
  }, [comments]);

  const canDelete = (c: Comment) =>
    c.authorId === session?.user.id || session?.user.globalRole === 'ADMIN';

  return (
    <div className="card overflow-hidden">
      <div className="card-head">
        <h3 className="font-bold text-ink">
          Обговорення
          {comments && comments.length > 0 && (
            <span className="ml-2 text-xs text-light font-normal">{comments.length}</span>
          )}
        </h3>
      </div>

      <div className="p-5 space-y-5">
        {/* Composer */}
        {session?.user && (
          <div ref={composerRef} className="flex gap-3">
            <Avatar
              name={session.user.name ?? 'U'}
              avatarUrl={session.user.image ?? undefined}
              size="sm"
            />
            <div className="flex-1 space-y-2">
              <MentionTextarea
                value={draft}
                onChange={setDraft}
                candidates={mentionCandidates}
                rows={2}
                placeholder="Залишити коментар…  Використовуйте @ для згадки колег."
                onSubmit={submitDraft}
              />
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-light">
                  {draft.trim().length}/5000
                  <span className="ml-2 text-light/70">· ⌘+Enter — надіслати</span>
                </p>
                <button
                  onClick={submitDraft}
                  disabled={!draft.trim() || createMutation.isPending}
                  className="btn-primary"
                >
                  {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Надіслати
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-[10px] px-3 py-2">{error}</p>
        )}

        {/* Thread */}
        {isLoading ? (
          <p className="text-center text-light text-sm py-6">Завантаження…</p>
        ) : tree.length === 0 ? (
          <p className="text-center text-light text-sm py-6">
            Коментарів ще немає. Залишіть перший!
          </p>
        ) : (
          <ul className="space-y-5">
            {tree.map((c) => (
              <CommentItem
                key={c.id}
                comment={c}
                replies={c.replies}
                userId={session?.user.id}
                canDelete={canDelete(c)}
                mentionCandidates={mentionCandidates}
                replyingTo={replyingTo}
                onReply={openReply}
                onCancelReply={() => {
                  setReplyingTo(null);
                  setReplyDraft('');
                }}
                replyDraft={replyDraft}
                setReplyDraft={setReplyDraft}
                onSubmitReply={submitReply}
                editingId={editingId}
                editDraft={editDraft}
                onStartEdit={(id, body) => {
                  setEditingId(id);
                  setEditDraft(body);
                  setError(null);
                }}
                onChangeEdit={setEditDraft}
                onCancelEdit={() => {
                  setEditingId(null);
                  setEditDraft('');
                }}
                onSaveEdit={(id) => updateMutation.mutate({ id, body: editDraft })}
                onDelete={(id) => {
                  if (confirm('Видалити коментар?')) deleteMutation.mutate({ id });
                }}
                pending={createMutation.isPending || updateMutation.isPending}
                canDeleteReply={(r) =>
                  r.authorId === session?.user.id || session?.user.globalRole === 'ADMIN'
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  replies,
  userId,
  canDelete,
  mentionCandidates,
  replyingTo,
  onReply,
  onCancelReply,
  replyDraft,
  setReplyDraft,
  onSubmitReply,
  editingId,
  editDraft,
  onStartEdit,
  onChangeEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  pending,
  canDeleteReply,
}: {
  comment: Comment;
  replies: Comment[];
  userId?: string;
  canDelete: boolean;
  mentionCandidates: MentionCandidate[];
  replyingTo: string | null;
  onReply: (id: string) => void;
  onCancelReply: () => void;
  replyDraft: string;
  setReplyDraft: (v: string) => void;
  onSubmitReply: () => void;
  editingId: string | null;
  editDraft: string;
  onStartEdit: (id: string, body: string) => void;
  onChangeEdit: (v: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string) => void;
  onDelete: (id: string) => void;
  pending: boolean;
  canDeleteReply: (r: Comment) => boolean;
}) {
  const isEditing = editingId === comment.id;
  const isReplying = replyingTo === comment.id;

  return (
    <li>
      <CommentRow
        comment={comment}
        isOwn={comment.authorId === userId}
        canDelete={canDelete}
        isEditing={isEditing}
        editDraft={editDraft}
        onChangeEdit={onChangeEdit}
        onStartEdit={() => onStartEdit(comment.id, comment.body)}
        onCancelEdit={onCancelEdit}
        onSaveEdit={() => onSaveEdit(comment.id)}
        onDelete={() => onDelete(comment.id)}
        onReply={() => onReply(comment.id)}
        pending={pending}
        mentionCandidates={mentionCandidates}
      />

      {/* Reply composer — appears right under the message being
          replied to. autoFocus + onSubmit gives ⌘+Enter shortcut. */}
      {isReplying && (
        <div className="ml-11 mt-3 flex gap-2 items-start">
          <div className="flex-1">
            <MentionTextarea
              value={replyDraft}
              onChange={setReplyDraft}
              candidates={mentionCandidates}
              rows={2}
              placeholder={`Відповісти ${comment.author.name}…`}
              autoFocus
              onSubmit={onSubmitReply}
            />
            <p className="text-[10px] text-light/80 mt-1">⌘+Enter — надіслати · Esc — скасувати</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              onClick={onSubmitReply}
              disabled={!replyDraft.trim() || pending}
              className="p-1.5 rounded-[8px] bg-brand text-white hover:bg-navy disabled:opacity-50"
              title="Надіслати"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={onCancelReply}
              className="p-1.5 rounded-[8px] border border-hairline text-mid hover:text-ink"
              title="Скасувати"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Replies */}
      {replies.length > 0 && (
        <ul className="ml-11 mt-3 space-y-3 border-l-2 border-hairline pl-4">
          {replies.map((r) => (
            <li key={r.id}>
              <CommentRow
                comment={r}
                isOwn={r.authorId === userId}
                canDelete={canDeleteReply(r)}
                isEditing={editingId === r.id}
                editDraft={editDraft}
                onChangeEdit={onChangeEdit}
                onStartEdit={() => onStartEdit(r.id, r.body)}
                onCancelEdit={onCancelEdit}
                onSaveEdit={() => onSaveEdit(r.id)}
                onDelete={() => onDelete(r.id)}
                onReply={undefined /* no nested replies */}
                pending={pending}
                mentionCandidates={mentionCandidates}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function CommentRow({
  comment,
  isOwn,
  canDelete,
  isEditing,
  editDraft,
  onChangeEdit,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReply,
  pending,
  mentionCandidates,
}: {
  comment: Comment;
  isOwn: boolean;
  canDelete: boolean;
  isEditing: boolean;
  editDraft: string;
  onChangeEdit: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  onReply?: () => void;
  pending: boolean;
  mentionCandidates: MentionCandidate[];
}) {
  const edited =
    new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 1500;
  return (
    <div className="flex gap-3 group">
      <Avatar
        name={comment.author.name}
        avatarUrl={comment.author.avatarUrl ?? undefined}
        size="sm"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-ink text-[13px]">{comment.author.name}</span>
          <span className="text-[11px] text-light">{formatDateTime(comment.createdAt)}</span>
          {edited && <span className="text-[10px] text-light italic">· редаговано</span>}
          {/* Reply lives inline with the timestamp so it's always
              discoverable — much better than a hover-only action. */}
          {onReply && !isEditing && (
            <button
              onClick={onReply}
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-brand hover:text-navy font-semibold"
            >
              <Reply className="w-3.5 h-3.5" />
              Відповісти
            </button>
          )}
        </div>
        {isEditing ? (
          <div className="mt-1.5 space-y-2">
            <MentionTextarea
              value={editDraft}
              onChange={onChangeEdit}
              candidates={mentionCandidates}
              rows={3}
              autoFocus
              onSubmit={onSaveEdit}
            />
            <div className="flex gap-2 items-center">
              <button
                onClick={onSaveEdit}
                disabled={!editDraft.trim() || pending}
                className="btn-primary"
              >
                {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Зберегти
              </button>
              <button onClick={onCancelEdit} className="btn-secondary">
                Скасувати
              </button>
              <span className="text-[10px] text-light/80">⌘+Enter — зберегти</span>
            </div>
          </div>
        ) : (
          <p
            id={`comment-${comment.id}`}
            className="text-[14px] text-ink whitespace-pre-wrap leading-relaxed mt-0.5 scroll-mt-24"
          >
            {renderMentions(comment.body)}
          </p>
        )}

        {!isEditing && (isOwn || canDelete) && (
          <div className="flex items-center gap-3 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {isOwn && (
              <button
                onClick={onStartEdit}
                className="inline-flex items-center gap-1 text-[11px] text-mid hover:text-brand"
              >
                <Pencil className="w-3.5 h-3.5" />
                Редагувати
              </button>
            )}
            {canDelete && (
              <button
                onClick={onDelete}
                className="inline-flex items-center gap-1 text-[11px] text-mid hover:text-red-600"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Видалити
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
