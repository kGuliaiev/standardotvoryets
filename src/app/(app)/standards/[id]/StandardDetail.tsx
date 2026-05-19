'use client';

import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Pencil, ChevronDown } from 'lucide-react';
import { StatusBadge, type StandardStatus } from '@/components/ui/StatusBadge';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { ActivityFeed } from '@/components/ActivityFeed';
import { TaskFormModal } from '@/components/TaskFormModal';
import { DocumentUploadModal } from '@/components/DocumentUploadModal';
import { CommentsThread } from '@/components/CommentsThread';
import { StandardBodyEditor } from '@/components/StandardBodyEditor';
import { StandardProgress, hasOverdueStage } from '@/components/standards/StandardProgress';
import { RankBadge } from '@/components/ui/RankBadge';
import { rankLabel, rankWeight, extractSurname } from '@/lib/ranks';
import { formatDate, formatDateTime, formatBytes } from '@/lib/utils';
import { useLocalStorageState } from '@/lib/useLocalStorageState';
import { can } from '@/lib/rbac';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';

type Tab = 'body' | 'documents' | 'comments' | 'tasks' | 'members' | 'voting' | 'history';

// "Текст документа" was deprecated in favour of editing individual
// uploaded documents (Документи → Редагувати). The body tab is kept in
// the type only because old deep-link notifications may still point at
// `?tab=body` — we silently redirect those to `documents` below.
const TABS: { id: Tab; label: string }[] = [
  { id: 'documents', label: 'Документи' },
  { id: 'comments', label: 'Обговорення' },
  { id: 'tasks', label: 'Завдання' },
  { id: 'members', label: 'Учасники' },
  { id: 'voting', label: 'Голосування' },
  { id: 'history', label: 'Історія' },
];

const WG_ROLE_LABELS_UA: Record<string, string> = {
  LEADER: 'Керівник РГ',
  DEPUTY: 'Заступник керівника',
  SECRETARY: 'Секретар',
  MEMBER: 'Член РГ',
  GUEST: 'Гість',
};

const WG_ROLE_ORDER: Record<string, number> = {
  LEADER: 0,
  DEPUTY: 1,
  SECRETARY: 2,
  MEMBER: 3,
  GUEST: 4,
};

const STATUS_TRANSITIONS: Record<StandardStatus, StandardStatus[]> = {
  DRAFT: ['IN_REVIEW', 'ARCHIVED'],
  IN_REVIEW: ['DRAFT', 'ARCHIVED'],
  VOTING: ['IN_REVIEW'],
  ADOPTED: ['ARCHIVED'],
  REJECTED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: [],
};

const STATUS_LABELS: Record<StandardStatus, string> = {
  DRAFT: 'Чернетка',
  IN_REVIEW: 'На розгляді',
  VOTING: 'Голосування',
  ADOPTED: 'Прийнятий',
  REJECTED: 'Відхилений',
  ARCHIVED: 'Архів',
};

const VALID_TABS = new Set<Tab>([
  'body',
  'documents',
  'comments',
  'tasks',
  'members',
  'voting',
  'history',
]);

export function StandardDetail({ id }: { id: string }) {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  // Honor ?tab=<id> from incoming links (notifications deep-link here).
  const queryTab = searchParams.get('tab');
  // Default to Документи now that the body tab is hidden; an explicit
  // `?tab=body` URL still gets redirected to `documents` to avoid
  // breaking old notification deep-links.
  const requested = queryTab && VALID_TABS.has(queryTab as Tab) ? (queryTab as Tab) : 'documents';
  const initialTab: Tab = requested === 'body' ? 'documents' : requested;
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [stepperOpen, setStepperOpen] = useLocalStorageState<boolean>(
    `standard.${id}.stepperOpen`,
    false,
  );

  // If the URL changes (e.g. user clicks another notification while on the
  // same standard page), follow it.
  useEffect(() => {
    if (queryTab && VALID_TABS.has(queryTab as Tab)) {
      const t = queryTab as Tab;
      setActiveTab(t === 'body' ? 'documents' : t);
    }
  }, [queryTab]);

  // Light polling so a leader accepting a suggestion (which rewrites
  // bodyText) propagates to anyone else viewing the standard within ~10s
  // without a manual refresh. `refetchIntervalInBackground: false` means
  // the polling stops when the tab is hidden, so it costs nothing while
  // the page sits in a background tab.
  const {
    data: standard,
    isLoading,
    refetch,
  } = trpc.standard.byId.useQuery(
    { id },
    {
      refetchInterval: 10_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
    },
  );
  const { data: currentVoting } = trpc.vote.current.useQuery({ standardId: id });
  const { data: votingHistory } = trpc.vote.history.useQuery({ standardId: id });
  const { data: tasks } = trpc.task.list.useQuery({ standardId: id });

  const utils = trpc.useUtils();
  const invalidateStandardLists = () => {
    void refetch();
    void utils.standard.list.invalidate();
    void utils.dashboard.kpis.invalidate();
    void utils.dashboard.navCounts.invalidate();
  };

  const confirmStage = trpc.standard.confirmStage.useMutation({
    onSuccess: () => {
      void refetch();
      void utils.standard.list.invalidate();
    },
  });

  const changeStatus = trpc.standard.changeStatus.useMutation({
    onSuccess: invalidateStandardLists,
  });
  const castVote = trpc.vote.cast.useMutation({ onSuccess: () => void refetch() });
  const closeVoting = trpc.vote.closeVoting.useMutation({ onSuccess: invalidateStandardLists });

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    isoAnalog: '',
    category: '',
    deadline: '',
    responsibleId: '',
    progress: 0,
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [docModalOpen, setDocModalOpen] = useState(false);
  // ID of the editable document whose collaborative editor is currently
  // shown as a fullscreen modal (null = no editor open).
  const [editDocId, setEditDocId] = useState<string | null>(null);

  const updateMutation = trpc.standard.update.useMutation({
    onSuccess: () => {
      invalidateStandardLists();
      setEditOpen(false);
    },
    onError: (e) => setEditError(e.message),
  });

  if (isLoading) return <div className="py-16 text-center text-light">Завантаження…</div>;
  if (!standard) return <div className="py-16 text-center text-light">Стандарт не знайдено</div>;

  const userCtx = session?.user
    ? {
        globalRole: session.user.globalRole as GlobalRole,
        memberships: (session.user.memberships ?? []).map(
          (m: { workingGroupId: string; role: string }) => ({
            workingGroupId: m.workingGroupId,
            role: m.role as WorkingGroupRole,
          }),
        ),
      }
    : null;

  const wgId = standard.workingGroupId;
  const canChangeStatus = userCtx ? can(userCtx, 'standard:changeStatus', wgId) : false;
  const canEdit = userCtx ? can(userCtx, 'standard:editMeta', wgId) : false;
  const canOpenVoting = userCtx ? can(userCtx, 'vote:open', wgId) : false;
  const canCastVote = userCtx ? can(userCtx, 'vote:cast', wgId) : false;
  const canUpload = userCtx ? can(userCtx, 'document:upload', wgId) : false;

  const myVote = currentVoting?.votes.find((v) => v.userId === session?.user?.id);
  const forVotes = currentVoting?.votes.filter((v) => v.choice === 'FOR').length ?? 0;
  const againstVotes = currentVoting?.votes.filter((v) => v.choice === 'AGAINST').length ?? 0;
  const abstainVotes = currentVoting?.votes.filter((v) => v.choice === 'ABSTAIN').length ?? 0;
  const totalVotes = currentVoting?.votes.length ?? 0;

  const openTasks = tasks?.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS') ?? [];
  const doneTasks = tasks?.filter((t) => t.status === 'DONE') ?? [];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-mid">
        <Link href="/standards" className="hover:text-blue-600">
          Стандарти
        </Link>
        <span>/</span>
        <span className="font-mono text-light">{standard.code}</span>
      </nav>

      {/* Header row: standard meta card on the left, compact stats card
          on the right (was previously a per-tab right rail). The grid's
          `items-stretch` aligns both card heights for a clean visual
          baseline; stats stay narrow with a fixed ~220px column. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4 items-stretch">
        <div className="bg-card rounded-xl border border-hairline p-5">
          {/* Row 1: meta (WG · code · status · ISO · category) on the left, actions on the right */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2.5 flex-wrap min-w-0">
              <span
                className="inline-block w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: standard.workingGroup.color }}
              />
              <span className="text-sm font-medium text-mid">{standard.workingGroup.code}</span>
              <span className="text-light">·</span>
              <span className="font-mono text-sm text-light">{standard.code}</span>
              <span className="text-light">·</span>
              <StatusBadge status={standard.status} size="sm" />
              {standard.isoAnalog && (
                <span className="text-xs text-mid bg-pill px-2 py-0.5 rounded-md">
                  ISO: {standard.isoAnalog}
                </span>
              )}
              {standard.category && (
                <span className="text-xs text-mid bg-pill px-2 py-0.5 rounded-md">
                  {standard.category}
                </span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {canEdit && (
                <button
                  onClick={() => {
                    setEditForm({
                      title: standard.title,
                      description: standard.description ?? '',
                      isoAnalog: standard.isoAnalog ?? '',
                      category: standard.category ?? '',
                      deadline: standard.deadline
                        ? new Date(standard.deadline).toISOString().slice(0, 10)
                        : '',
                      responsibleId: standard.responsibleId ?? '',
                      progress: standard.progress,
                    });
                    setEditError(null);
                    setEditOpen(true);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold rounded-[10px] border-[1.5px] border-hairline hover:border-brand hover:text-brand text-mid transition-colors inline-flex items-center gap-1.5"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Редагувати
                </button>
              )}
              {canChangeStatus &&
                STATUS_TRANSITIONS[standard.status].map((next) => (
                  <button
                    key={next}
                    onClick={() => changeStatus.mutate({ id, status: next })}
                    disabled={changeStatus.isPending}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-hairline hover:bg-page text-ink transition-colors disabled:opacity-50"
                  >
                    → {STATUS_LABELS[next]}
                  </button>
                ))}
              {canChangeStatus && standard.status === 'IN_REVIEW' && canOpenVoting && (
                <Link
                  href={`/standards/${id}/open-voting`}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                >
                  Відкрити голосування
                </Link>
              )}
            </div>
          </div>

          {/* Title */}
          <h1 className="text-xl font-bold text-ink mt-3 break-words">{standard.title}</h1>

          {/* Collapsible stepper */}
          <div className="mt-4 pt-3 border-t border-hairline">
            <button
              type="button"
              onClick={() => setStepperOpen((o) => !o)}
              className="flex items-center justify-between gap-3 w-full text-left group"
            >
              <span className="text-xs text-mid font-semibold uppercase tracking-wide group-hover:text-ink transition-colors flex flex-col sm:flex-row sm:items-center sm:gap-2 min-w-0">
                <span className="truncate">Поетапний план виконання</span>
                <span className="text-[10px] font-normal normal-case text-light truncate">
                  <span className="hidden sm:inline">· </span>
                  оновлено {formatDateTime(standard.updatedAt)}
                </span>
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {!stepperOpen && hasOverdueStage(standard) && (
                  <span className="text-[11px] text-red-600 dark:text-red-400 font-semibold hidden sm:inline">
                    є прострочений етап
                  </span>
                )}
                {!stepperOpen && hasOverdueStage(standard) && (
                  <span
                    className="sm:hidden w-2 h-2 rounded-full bg-red-500"
                    title="Є прострочений етап"
                  />
                )}
                <ChevronDown
                  size={16}
                  className={`text-mid transition-transform ${stepperOpen ? 'rotate-180' : ''}`}
                />
              </div>
            </button>
            {stepperOpen && (
              <div className="mt-3">
                {!canChangeStatus && (
                  <p className="text-[11px] text-light italic mb-3">
                    Етапи підтверджують секретар / керівник РГ
                  </p>
                )}
                <StandardProgress
                  techSpecDueDate={standard.techSpecDueDate}
                  draftDueDate={standard.draftDueDate}
                  feedbackDueDate={standard.feedbackDueDate}
                  techReviewDueDate={standard.techReviewDueDate}
                  finalDueDate={standard.finalDueDate}
                  techSpecCompletedAt={standard.techSpecCompletedAt}
                  draftCompletedAt={standard.draftCompletedAt}
                  feedbackCompletedAt={standard.feedbackCompletedAt}
                  techReviewCompletedAt={standard.techReviewCompletedAt}
                  finalCompletedAt={standard.finalCompletedAt}
                  onConfirm={
                    canChangeStatus
                      ? (stage, confirmed, completedAt) =>
                          confirmStage.mutate({
                            id: standard.id,
                            stage,
                            confirmed,
                            completedAt,
                          })
                      : undefined
                  }
                  isPending={confirmStage.isPending}
                />
              </div>
            )}
          </div>

          {/* Meta row */}
          {standard.responsible && (
            <div className="mt-4 flex gap-6 flex-wrap text-sm">
              <div className="flex items-center gap-2">
                <span className="text-light text-xs">Відповідальний:</span>
                <Avatar
                  name={standard.responsible.name}
                  avatarUrl={standard.responsible.avatarUrl}
                  size="xs"
                />
                <span className="text-ink text-xs">{standard.responsible.name}</span>
              </div>
            </div>
          )}
        </div>

        {/* Stats card — stretches to header card height for visual
          baseline parity. */}
        <div className="bg-card rounded-xl border border-hairline p-5 flex flex-col">
          <h3 className="font-semibold text-ink mb-3 text-sm uppercase tracking-wide text-light">
            Статистика
          </h3>
          <dl className="space-y-2 text-sm flex-1">
            <div className="flex justify-between">
              <dt className="text-mid">Документів</dt>
              <dd className="font-medium tabular-nums">{standard.documents?.length ?? 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-mid">Коментарів</dt>
              <dd className="font-medium tabular-nums">{standard.comments?.length ?? 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-mid">Завдань</dt>
              <dd className="font-medium tabular-nums">{standard.tasks?.length ?? 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-mid">Голосувань</dt>
              <dd className="font-medium tabular-nums">{standard.votes?.length ?? 0}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Tabs */}
      {(() => {
        // Counts shown as small chips next to each tab label
        const counts: Partial<Record<Tab, number>> = {
          documents: standard.documents.length,
          comments: standard.comments.length,
          tasks: tasks?.length ?? 0,
          members: standard.workingGroup.members.length,
          voting: (votingHistory?.length ?? 0) + (currentVoting ? 1 : 0),
          history: standard.statusHistory.length,
        };
        // Distinct tone for tasks: amber when there are OPEN ones (signals
        // attention); neutral when only DONE/CANCELLED remain.
        const tabTone: Partial<Record<Tab, 'neutral' | 'amber'>> = {
          tasks: openTasks.length > 0 ? 'amber' : 'neutral',
        };
        return (
          <div className="border-b border-hairline overflow-x-auto scrollbar-thin">
            <nav className="flex gap-0 -mb-px min-w-max">
              {TABS.map((tab) => {
                const count = counts[tab.id];
                const tone = tabTone[tab.id] ?? 'neutral';
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 sm:px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'border-blue-600 text-blue-700'
                        : 'border-transparent text-mid hover:text-ink hover:border-slate-300'
                    }`}
                  >
                    {tab.label}
                    {typeof count === 'number' && count > 0 && (
                      <span
                        className={`ml-1.5 text-xs rounded-full px-1.5 py-0.5 tabular-nums ${
                          tone === 'amber'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                            : 'bg-pill text-mid'
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
        );
      })()}

      {/* Description (always visible, above tabs) */}
      {standard.description && (
        <div className="bg-card rounded-xl border border-hairline p-5">
          <h3 className="font-semibold text-ink mb-2">Опис</h3>
          <p className="text-sm text-mid leading-relaxed whitespace-pre-line">
            {standard.description}
          </p>
        </div>
      )}

      {/* Body tab gets the full page width — it has its own internal
          left/right split. All other tabs keep the standard layout with
          a statistics rail on the right. */}
      {activeTab === 'body' && (
        <StandardBodyEditor
          target={{ kind: 'standard', standardId: id, workingGroupId: wgId }}
          bodyText={standard.bodyText}
          bodyUpdatedAt={standard.bodyUpdatedAt}
          bodyUpdatedBy={standard.bodyUpdatedBy}
        />
      )}

      {/* Tab content — full-width now that statistics moved to the
          header row. */}
      {activeTab !== 'body' && (
        <div className="space-y-4">
          <div className="space-y-4">
            {activeTab === 'documents' && (
              <div className="bg-card rounded-xl border border-hairline">
                <div className="px-5 py-4 border-b border-hairline flex items-center justify-between">
                  <h3 className="font-semibold text-ink">Документи</h3>
                  {canUpload && (
                    <button
                      onClick={() => setDocModalOpen(true)}
                      className="text-xs font-bold text-brand hover:underline"
                    >
                      + Завантажити
                    </button>
                  )}
                </div>
                {standard.documents.length === 0 ? (
                  <div className="py-12 text-center text-light text-sm">Документів немає</div>
                ) : (
                  <div className="divide-y divide-hairline">
                    {standard.documents.map((doc) => {
                      // Suggestion counts by status — only meaningful for
                      // documents that allow edits, otherwise the array is
                      // always empty.
                      const suggCounts = (doc.suggestions ?? []).reduce(
                        (acc, s) => {
                          if (s.status === 'PENDING') acc.pending += 1;
                          else if (s.status === 'ACCEPTED') acc.accepted += 1;
                          else if (s.status === 'REJECTED') acc.rejected += 1;
                          return acc;
                        },
                        { pending: 0, accepted: 0, rejected: 0 },
                      );
                      const suggTotal =
                        suggCounts.pending + suggCounts.accepted + suggCounts.rejected;
                      return (
                        <div key={doc.id} className="flex items-center gap-4 px-5 py-3.5">
                          <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-bold text-blue-600">
                              {doc.filename.split('.').pop()?.toUpperCase().slice(0, 3)}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-ink truncate">{doc.filename}</p>
                            <p className="text-xs text-light flex items-center gap-1.5 flex-wrap">
                              <span>{doc.type}</span>
                              <span>·</span>
                              <span>v{doc.version}</span>
                              <span>·</span>
                              <span>{formatBytes(doc.sizeBytes)}</span>
                              <span>·</span>
                              <span>{doc.uploadedBy.name}</span>
                              {doc.allowEdits && suggTotal > 0 && (
                                <>
                                  <span>·</span>
                                  <span className="inline-flex items-center gap-1">
                                    <span title="Всього правок">
                                      <strong>{suggTotal}</strong>{' '}
                                      {suggTotal === 1
                                        ? 'правка'
                                        : suggTotal < 5
                                          ? 'правки'
                                          : 'правок'}
                                      :
                                    </span>
                                    {suggCounts.pending > 0 && (
                                      <span
                                        className="text-amber-600 dark:text-amber-400"
                                        title="Відкриті — очікують рішення лідера"
                                      >
                                        {suggCounts.pending} відкритих
                                      </span>
                                    )}
                                    {suggCounts.accepted > 0 && (
                                      <span
                                        className="text-emerald-600 dark:text-emerald-400"
                                        title="Прийнято"
                                      >
                                        {suggCounts.accepted} прийнято
                                      </span>
                                    )}
                                    {suggCounts.rejected > 0 && (
                                      <span
                                        className="text-red-600 dark:text-red-400"
                                        title="Відхилено"
                                      >
                                        {suggCounts.rejected} відхилено
                                      </span>
                                    )}
                                  </span>
                                </>
                              )}
                            </p>
                          </div>
                          {doc.isCurrent && (
                            <span className="text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5 flex-shrink-0">
                              Актуальний
                            </span>
                          )}
                          {doc.allowEdits && (
                            <button
                              onClick={() => setEditDocId(doc.id)}
                              className="text-xs px-2.5 py-1 rounded border border-brand text-brand hover:bg-brand hover:text-white transition-colors inline-flex items-center gap-1 flex-shrink-0"
                              title="Відкрити документ у колаборативному редакторі"
                            >
                              <Pencil className="w-3 h-3" />
                              Редагувати
                            </button>
                          )}
                          <DownloadButton documentId={doc.id} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'voting' && (
              <div className="space-y-4">
                {/* Current voting */}
                {currentVoting && (
                  <div className="bg-card rounded-xl border border-amber-200 p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                          <span className="text-xs font-medium text-amber-700 uppercase">
                            Активне голосування
                          </span>
                        </div>
                        <h3 className="font-semibold text-ink">{currentVoting.title}</h3>
                        {currentVoting.deadline && (
                          <p className="text-xs text-mid mt-1">
                            Дедлайн: {formatDateTime(currentVoting.deadline)}
                          </p>
                        )}
                      </div>
                      {canOpenVoting && (
                        <button
                          onClick={() => closeVoting.mutate({ votingId: currentVoting.id })}
                          disabled={closeVoting.isPending}
                          className="text-xs px-3 py-1.5 border border-hairline rounded-lg text-mid hover:bg-page disabled:opacity-50"
                        >
                          Закрити голосування
                        </button>
                      )}
                    </div>

                    {/* Results bar */}
                    <div className="mb-4">
                      <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-pill">
                        {totalVotes > 0 && (
                          <>
                            <div
                              className="bg-green-500 transition-all"
                              style={{ width: `${(forVotes / totalVotes) * 100}%` }}
                            />
                            <div
                              className="bg-red-500 transition-all"
                              style={{ width: `${(againstVotes / totalVotes) * 100}%` }}
                            />
                            <div
                              className="bg-slate-300 transition-all"
                              style={{ width: `${(abstainVotes / totalVotes) * 100}%` }}
                            />
                          </>
                        )}
                      </div>
                      <div className="flex gap-4 mt-2 text-xs">
                        <span className="text-green-700">✓ За: {forVotes}</span>
                        <span className="text-red-700">✗ Проти: {againstVotes}</span>
                        <span className="text-mid">○ Утрим.: {abstainVotes}</span>
                        <span className="text-light ml-auto">Всього: {totalVotes}</span>
                      </div>
                    </div>

                    {/* Cast vote */}
                    {canCastVote && (
                      <div className="flex gap-2">
                        {(['FOR', 'AGAINST', 'ABSTAIN'] as const).map((choice) => (
                          <button
                            key={choice}
                            onClick={() => castVote.mutate({ votingId: currentVoting.id, choice })}
                            disabled={castVote.isPending}
                            className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-colors ${
                              myVote?.choice === choice
                                ? choice === 'FOR'
                                  ? 'bg-green-600 text-white border-green-600'
                                  : choice === 'AGAINST'
                                    ? 'bg-red-600 text-white border-red-600'
                                    : 'bg-slate-600 text-white border-slate-600'
                                : 'border-hairline text-mid hover:bg-page'
                            } disabled:opacity-50`}
                          >
                            {choice === 'FOR'
                              ? '✓ За'
                              : choice === 'AGAINST'
                                ? '✗ Проти'
                                : '○ Утриматись'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Voting history */}
                {votingHistory && votingHistory.filter((v) => v.status === 'CLOSED').length > 0 && (
                  <div className="bg-card rounded-xl border border-hairline">
                    <div className="px-5 py-4 border-b border-hairline">
                      <h3 className="font-semibold text-ink">Архів голосувань</h3>
                    </div>
                    <div className="divide-y divide-hairline">
                      {votingHistory
                        .filter((v) => v.status === 'CLOSED')
                        .map((v) => {
                          const f = v.votes.filter((x) => x.choice === 'FOR').length;
                          const a = v.votes.filter((x) => x.choice === 'AGAINST').length;
                          const total = v.votes.length;
                          const passed = total > 0 && f / (f + a) > 0.5;
                          return (
                            <div key={v.id} className="px-5 py-4">
                              <div className="flex items-center gap-3 mb-1">
                                <span
                                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${passed ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
                                >
                                  {passed ? 'Прийнято' : 'Відхилено'}
                                </span>
                                <span className="text-sm font-medium text-ink">{v.title}</span>
                              </div>
                              <p className="text-xs text-light">
                                За: {f} / Проти: {a} / Утрим:{' '}
                                {v.votes.filter((x) => x.choice === 'ABSTAIN').length} ·{' '}
                                {v.closedAt ? formatDate(v.closedAt) : ''}
                              </p>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {!currentVoting && (!votingHistory || votingHistory.length === 0) && (
                  <div className="bg-card rounded-xl border border-hairline py-12 text-center text-light text-sm">
                    Голосувань не проводилось
                  </div>
                )}
              </div>
            )}

            {activeTab === 'tasks' && (
              <div className="space-y-4">
                <div className="bg-card rounded-xl border border-hairline">
                  <div className="px-5 py-4 border-b border-hairline flex items-center justify-between">
                    <h3 className="font-semibold text-ink">
                      Відкриті завдання ({openTasks.length})
                    </h3>
                    <button
                      onClick={() => setTaskModalOpen(true)}
                      className="text-xs font-bold text-brand hover:underline"
                    >
                      + Додати
                    </button>
                  </div>
                  {openTasks.length === 0 ? (
                    <div className="py-10 text-center text-light text-sm">Завдань немає</div>
                  ) : (
                    <div className="divide-y divide-hairline">
                      {openTasks.map((task) => (
                        <div key={task.id} className="flex items-center gap-4 px-5 py-3.5">
                          <div
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              task.priority === 'HIGH'
                                ? 'bg-red-500'
                                : task.priority === 'MEDIUM'
                                  ? 'bg-amber-400'
                                  : 'bg-slate-300'
                            }`}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-ink">{task.title}</p>
                            <p className="text-xs text-light">
                              {task.status === 'IN_PROGRESS' ? 'В роботі' : 'Відкрито'}
                              {task.dueDate && ` · до ${formatDate(task.dueDate)}`}
                            </p>
                          </div>
                          {task.assignee && (
                            <Avatar
                              name={task.assignee.name}
                              avatarUrl={task.assignee.avatarUrl}
                              size="xs"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {doneTasks.length > 0 && (
                  <div className="bg-card rounded-xl border border-hairline">
                    <div className="px-5 py-4 border-b border-hairline">
                      <h3 className="font-semibold text-ink">Виконані ({doneTasks.length})</h3>
                    </div>
                    <div className="divide-y divide-hairline">
                      {doneTasks.map((task) => (
                        <div key={task.id} className="flex items-center gap-4 px-5 py-3 opacity-60">
                          <span className="text-green-600 text-xs">✓</span>
                          <p className="text-sm text-mid line-through">{task.title}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'comments' && <CommentsThread standardId={id} />}

            {activeTab === 'history' && (
              <div className="space-y-5">
                <ActivityFeed entity="Standard" entityId={id} title="Журнал змін (всі дії)" />
                <div className="bg-card rounded-xl border border-hairline">
                  <div className="px-5 py-4 border-b border-hairline">
                    <h3 className="font-semibold text-ink">Історія статусів</h3>
                  </div>
                  {standard.statusHistory.length === 0 ? (
                    <div className="py-10 text-center text-light text-sm">Історії немає</div>
                  ) : (
                    <div className="px-5 py-4 space-y-4">
                      {standard.statusHistory.map((h, i) => (
                        <div key={h.id} className="relative flex gap-4">
                          {i < standard.statusHistory.length - 1 && (
                            <div className="absolute left-3 top-6 bottom-0 w-px bg-pill" />
                          )}
                          <div className="w-6 h-6 rounded-full bg-brand-soft flex items-center justify-center flex-shrink-0 mt-0.5">
                            <div className="w-2 h-2 rounded-full bg-brand" />
                          </div>
                          <div className="pb-4 flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              {h.fromStatus ? (
                                <>
                                  <StatusBadge status={h.fromStatus} size="sm" />
                                  <span className="text-light text-xs">→</span>
                                </>
                              ) : null}
                              <StatusBadge status={h.toStatus} size="sm" />
                            </div>
                            {h.note && <p className="text-sm text-mid mt-1">{h.note}</p>}
                            <div className="flex items-center gap-2 text-xs text-light mt-1">
                              {h.changedBy && (
                                <span className="flex items-center gap-1.5 text-mid">
                                  <Avatar
                                    name={h.changedBy.name}
                                    avatarUrl={h.changedBy.avatarUrl}
                                    size="xs"
                                  />
                                  <RankBadge rank={h.changedBy.rank} variant="icon" />
                                  <span className="font-medium">{h.changedBy.name}</span>
                                </span>
                              )}
                              <span>·</span>
                              <span>{formatDateTime(h.changedAt)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'members' && (
              <div className="bg-card rounded-xl border border-hairline overflow-hidden">
                <div className="px-5 py-4 border-b border-hairline">
                  <h3 className="font-semibold text-ink">
                    Учасники РГ ({standard.workingGroup.members.length})
                  </h3>
                </div>
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead className="bg-page border-b border-hairline">
                      <tr className="text-left text-[10px] text-light uppercase tracking-wide">
                        <th className="px-5 py-2.5 font-bold">Роль в РГ</th>
                        <th className="px-3 py-2.5 font-bold">ПІБ</th>
                        <th className="px-3 py-2.5 font-bold">Звання</th>
                        <th className="px-3 py-2.5 font-bold">Посада</th>
                        <th className="px-3 py-2.5 font-bold">Телефон</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {[...standard.workingGroup.members]
                        .sort((a, b) => {
                          const r = (WG_ROLE_ORDER[a.role] ?? 99) - (WG_ROLE_ORDER[b.role] ?? 99);
                          if (r !== 0) return r;
                          const w = rankWeight(b.user.rank) - rankWeight(a.user.rank);
                          if (w !== 0) return w;
                          return extractSurname(a.user.name).localeCompare(
                            extractSurname(b.user.name),
                            'uk',
                          );
                        })
                        .map((m) => (
                          <tr key={m.userId} className="hover:bg-pill/40">
                            <td className="px-5 py-3 text-xs text-mid">
                              {WG_ROLE_LABELS_UA[m.role] ?? m.role}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2.5">
                                <Avatar name={m.user.name} avatarUrl={m.user.avatarUrl} size="xs" />
                                <span className="text-ink font-medium">{m.user.name}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-1.5">
                                <RankBadge rank={m.user.rank} variant="icon" />
                                {m.user.rank && m.user.rank !== 'CIVILIAN' && (
                                  <span className="text-xs text-mid">{rankLabel(m.user.rank)}</span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-xs text-mid">{m.user.position ?? '—'}</td>
                            <td className="px-3 py-3 text-xs text-mid font-mono">
                              {m.user.phone ? (
                                <a href={`tel:${m.user.phone}`} className="hover:text-brand">
                                  {m.user.phone}
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Редагувати стандарт"
        subtitle={standard.code}
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="field-label">Назва *</label>
            <input
              className="input"
              value={editForm.title}
              onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>
          <div>
            <label className="field-label">Опис</label>
            <textarea
              rows={4}
              className="textarea resize-none"
              value={editForm.description}
              onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field-label">ISO-аналог</label>
              <input
                className="input"
                value={editForm.isoAnalog}
                onChange={(e) => setEditForm((f) => ({ ...f, isoAnalog: e.target.value }))}
              />
            </div>
            <div>
              <label className="field-label">Категорія</label>
              <input
                className="input"
                value={editForm.category}
                onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field-label">Дедлайн</label>
              <input
                type="date"
                className="input"
                value={editForm.deadline}
                onChange={(e) => setEditForm((f) => ({ ...f, deadline: e.target.value }))}
              />
            </div>
            <div>
              <label className="field-label">Відповідальний</label>
              <select
                className="select"
                value={editForm.responsibleId}
                onChange={(e) => setEditForm((f) => ({ ...f, responsibleId: e.target.value }))}
              >
                <option value="">— не вказано —</option>
                {[...standard.workingGroup.members]
                  .sort((a, b) => {
                    const r = (WG_ROLE_ORDER[a.role] ?? 99) - (WG_ROLE_ORDER[b.role] ?? 99);
                    if (r !== 0) return r;
                    const w = rankWeight(b.user.rank) - rankWeight(a.user.rank);
                    if (w !== 0) return w;
                    return extractSurname(a.user.name).localeCompare(
                      extractSurname(b.user.name),
                      'uk',
                    );
                  })
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.user.name} ({WG_ROLE_LABELS_UA[m.role] ?? m.role})
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div>
            <label className="field-label">Прогрес: {editForm.progress}%</label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={editForm.progress}
              onChange={(e) => setEditForm((f) => ({ ...f, progress: Number(e.target.value) }))}
              className="w-full"
            />
          </div>
          {editError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-[10px] px-3 py-2">{editError}</p>
          )}
          <div className="flex gap-3 pt-2 border-t border-hairline">
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="flex-1 btn-secondary"
            >
              Скасувати
            </button>
            <button
              type="button"
              onClick={() => {
                if (!editForm.title.trim()) {
                  setEditError('Введіть назву');
                  return;
                }
                const trim = (v: string): string | undefined => {
                  const t = v.trim();
                  return t === '' ? undefined : t;
                };
                updateMutation.mutate({
                  id,
                  title: editForm.title.trim(),
                  description: trim(editForm.description),
                  isoAnalog: trim(editForm.isoAnalog),
                  category: trim(editForm.category),
                  deadline: editForm.deadline ? new Date(editForm.deadline) : null,
                  responsibleId: editForm.responsibleId === '' ? null : editForm.responsibleId,
                  progress: editForm.progress,
                });
              }}
              disabled={updateMutation.isPending}
              className="flex-1 btn-primary"
            >
              {updateMutation.isPending ? 'Збереження…' : 'Зберегти'}
            </button>
          </div>
        </div>
      </Modal>

      <TaskFormModal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        initial={{ workingGroupId: standard.workingGroupId, standardId: id }}
        lockedStandardId={id}
        onSaved={() => void refetch()}
      />

      <DocumentUploadModal
        open={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        standardId={id}
        onSaved={() => void refetch()}
      />

      {/* Per-document collaborative editor. Reuses StandardBodyEditor
          with a `document` target — same UX as the standard's main body
          but writes to Document.bodyHtml and shows that document's own
          suggestion list. Opened as a fullscreen modal so the user
          doesn't lose context of the surrounding standard page. */}
      {editDocId &&
        (() => {
          const doc = standard.documents.find((d) => d.id === editDocId);
          if (!doc?.allowEdits) return null;
          return (
            <Modal
              open={!!editDocId}
              onClose={() => setEditDocId(null)}
              title={`Редагування: ${doc.filename}`}
              size="full"
            >
              <StandardBodyEditor
                target={{
                  kind: 'document',
                  documentId: doc.id,
                  parentStandardId: id,
                  workingGroupId: wgId,
                }}
                bodyText={doc.bodyHtml}
                bodyUpdatedAt={doc.bodyUpdatedAt}
                bodyUpdatedBy={doc.bodyUpdatedBy}
              />
            </Modal>
          );
        })()}
    </div>
  );
}

// Окремий компонент для завантаження — lazy query per-document
function DownloadButton({ documentId }: { documentId: string }) {
  const [enabled, setEnabled] = useState(false);
  const { data, isLoading } = trpc.document.getDownloadUrl.useQuery({ documentId }, { enabled });

  useEffect(() => {
    if (data?.url) {
      window.open(data.url, '_blank');
      setEnabled(false);
    }
  }, [data]);

  return (
    <button
      onClick={() => setEnabled(true)}
      disabled={isLoading}
      className="text-xs text-blue-600 hover:underline disabled:opacity-50 flex-shrink-0"
    >
      {isLoading ? '…' : '↓ Завантажити'}
    </button>
  );
}
