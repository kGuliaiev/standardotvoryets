'use client';

import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
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

const TABS: { id: Tab; label: string }[] = [
  { id: 'body', label: 'Текст документа' },
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

export function StandardDetail({ id }: { id: string }) {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<Tab>('body');
  const [stepperOpen, setStepperOpen] = useLocalStorageState<boolean>(
    `standard.${id}.stepperOpen`,
    false,
  );

  const { data: standard, isLoading, refetch } = trpc.standard.byId.useQuery({ id });
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

      {/* Header card */}
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

      {/* Tabs */}
      <div className="border-b border-hairline overflow-x-auto scrollbar-thin">
        <nav className="flex gap-0 -mb-px min-w-max">
          {TABS.map((tab) => (
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
              {tab.id === 'documents' && standard.documents.length > 0 && (
                <span className="ml-1.5 text-xs bg-pill text-mid rounded-full px-1.5 py-0.5">
                  {standard.documents.length}
                </span>
              )}
              {tab.id === 'tasks' && openTasks.length > 0 && (
                <span className="ml-1.5 text-xs bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5">
                  {openTasks.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

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
          standardId={id}
          workingGroupId={wgId}
          bodyText={standard.bodyText}
          bodyUpdatedAt={standard.bodyUpdatedAt}
          bodyUpdatedBy={standard.bodyUpdatedBy}
        />
      )}

      {/* Tab content + statistics rail */}
      {activeTab !== 'body' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
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
                    {standard.documents.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-4 px-5 py-3.5">
                        <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-bold text-blue-600">
                            {doc.filename.split('.').pop()?.toUpperCase().slice(0, 3)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ink truncate">{doc.filename}</p>
                          <p className="text-xs text-light">
                            {doc.type} · v{doc.version} · {formatBytes(doc.sizeBytes)} ·{' '}
                            {doc.uploadedBy.name}
                          </p>
                        </div>
                        {doc.isCurrent && (
                          <span className="text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5 flex-shrink-0">
                            Актуальний
                          </span>
                        )}
                        <DownloadButton documentId={doc.id} />
                      </div>
                    ))}
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
              <div className="bg-card rounded-xl border border-hairline p-5">
                <h3 className="font-semibold text-ink mb-3">
                  Учасники РГ ({standard.workingGroup.members.length})
                </h3>
                <div className="space-y-3">
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
                      <div key={m.userId} className="flex items-center gap-3">
                        <Avatar name={m.user.name} avatarUrl={m.user.avatarUrl} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink flex items-center gap-1.5 flex-wrap">
                            <RankBadge rank={m.user.rank} variant="icon" />
                            {m.user.rank && m.user.rank !== 'CIVILIAN' && (
                              <span className="text-xs text-mid font-normal">
                                {rankLabel(m.user.rank)}
                              </span>
                            )}
                            <span>{m.user.name}</span>
                          </p>
                          <p className="text-xs text-light">
                            {WG_ROLE_LABELS_UA[m.role] ?? m.role}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Right rail — always visible Statistics */}
          <div className="space-y-4">
            <div className="bg-card rounded-xl border border-hairline p-5">
              <h3 className="font-semibold text-ink mb-3">Статистика</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-mid">Документів</dt>
                  <dd className="font-medium">{standard.documents?.length ?? 0}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-mid">Коментарів</dt>
                  <dd className="font-medium">{standard.comments?.length ?? 0}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-mid">Завдань</dt>
                  <dd className="font-medium">{standard.tasks?.length ?? 0}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-mid">Голосувань</dt>
                  <dd className="font-medium">{standard.votes?.length ?? 0}</dd>
                </div>
              </dl>
            </div>
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
