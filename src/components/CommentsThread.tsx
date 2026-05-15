'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import { Avatar } from '@/components/ui/Avatar';
import { Pencil, Trash2, Reply, Loader2, X, Check } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';

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

  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

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
  const deleteMutation = trpc.comment.delete.useMutation({
    onSuccess: invalidate,
    onError: (e) => setError(e.message),
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
          <div className="flex gap-3">
            <Avatar
              name={session.user.name ?? 'U'}
              avatarUrl={session.user.image ?? undefined}
              size="sm"
            />
            <div className="flex-1 space-y-2">
              <textarea
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Залишити коментар…"
                className="textarea resize-none"
              />
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-light">{draft.trim().length}/5000</p>
                <button
                  onClick={() => {
                    if (!draft.trim()) return;
                    createMutation.mutate({ standardId, body: draft });
                  }}
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
                replyingTo={replyingTo}
                onReply={(id) => {
                  setReplyingTo(id);
                  setReplyDraft('');
                  setError(null);
                }}
                onCancelReply={() => {
                  setReplyingTo(null);
                  setReplyDraft('');
                }}
                replyDraft={replyDraft}
                setReplyDraft={setReplyDraft}
                onSubmitReply={() => {
                  if (!replyDraft.trim() || !replyingTo) return;
                  createMutation.mutate({
                    standardId,
                    body: replyDraft,
                    parentId: replyingTo,
                  });
                }}
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
      />

      {/* Reply composer */}
      {isReplying && (
        <div className="ml-11 mt-3 flex gap-2 items-start">
          <textarea
            rows={2}
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            placeholder={`Відповісти ${comment.author.name}…`}
            className="textarea resize-none flex-1"
            autoFocus
          />
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
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-semibold text-ink text-[13px]">{comment.author.name}</span>
          <span className="text-[11px] text-light">{formatDateTime(comment.createdAt)}</span>
          {edited && <span className="text-[10px] text-light italic">· редаговано</span>}
        </div>
        {isEditing ? (
          <div className="mt-1.5 space-y-2">
            <textarea
              rows={3}
              value={editDraft}
              onChange={(e) => onChangeEdit(e.target.value)}
              className="textarea resize-none"
              autoFocus
            />
            <div className="flex gap-2">
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
            </div>
          </div>
        ) : (
          <p className="text-[14px] text-ink whitespace-pre-wrap leading-relaxed mt-0.5">
            {comment.body}
          </p>
        )}

        {!isEditing && (
          <div className="flex items-center gap-3 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {onReply && (
              <button
                onClick={onReply}
                className="inline-flex items-center gap-1 text-[11px] text-mid hover:text-brand"
              >
                <Reply className="w-3.5 h-3.5" />
                Відповісти
              </button>
            )}
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
