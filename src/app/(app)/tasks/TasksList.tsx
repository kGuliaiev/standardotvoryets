'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  LayoutList,
  ListTree,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { Avatar } from '@/components/ui/Avatar';
import { TaskFormModal } from '@/components/TaskFormModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { DueDateChip } from '@/lib/dueDate';
import { useExpandedTasks } from '@/lib/useExpandedTasks';
import { useLocalStorageState } from '@/lib/useLocalStorageState';

const PRIORITY_DOT: Record<string, string> = {
  HIGH: 'bg-red-500',
  MEDIUM: 'bg-amber-400',
  LOW: 'bg-emerald-400',
};

type FilterMode = 'all' | 'open' | 'done' | 'mine';

interface TaskRow {
  id: string;
  title: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  dueDate: Date | string | null;
  description: string | null;
  assigneeId: string | null;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
  standardId: string;
  standard: {
    id: string;
    code: string;
    indeks: string | null;
    title: string;
    workingGroupId: string;
  };
  createdById: string;
  // Present on task.list (full subtask fields). Missing on rows that
  // come from other queries — treat as empty.
  checklistItems?: {
    id: string;
    title: string;
    isDone: boolean;
    dueDate: Date | string | null;
    assigneeId: string | null;
    order: number;
    assignee: { id: string; name: string; avatarUrl: string | null } | null;
  }[];
}

// Due chip + days-remaining label moved to @/lib/dueDate so the
// standard's Завдання tab can render identical rows without
// importing from the global page.

export function TasksList() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const { isExpanded, toggle: toggleExpanded, setAll: setExpandedAll } = useExpandedTasks();
  // Tree view groups tasks by РГ → Стандарт when scope is 'all' or
  // 'wg'; flat view keeps the current single-list rendering. Persisted
  // per browser so returning to /tasks lands in the preferred mode.
  const [viewMode, setViewMode] = useLocalStorageState<'tree' | 'flat'>(
    'tasks.viewMode.v1',
    'tree',
  );

  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');
  const [selectedScope, setSelectedScope] = useState<
    { kind: 'all' } | { kind: 'wg'; id: string } | { kind: 'std'; id: string; wgId: string }
  >({ kind: 'all' });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskRow | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<TaskRow | null>(null);

  const { data: groups } = trpc.workingGroup.list.useQuery();
  const { data: standardsResp } = trpc.standard.list.useQuery({ page: 1, pageSize: 200 });
  const { data: tasks } = trpc.task.list.useQuery({
    workingGroupId:
      selectedScope.kind === 'wg'
        ? selectedScope.id
        : selectedScope.kind === 'std'
          ? selectedScope.wgId
          : undefined,
    standardId: selectedScope.kind === 'std' ? selectedScope.id : undefined,
  });

  const utils = trpc.useUtils();
  const toggleTask = trpc.task.changeStatus.useMutation({
    onSuccess: () => {
      void utils.task.list.invalidate();
      void utils.dashboard.kpis.invalidate();
      void utils.dashboard.navCounts.invalidate();
    },
  });
  const deleteTask = trpc.task.delete.useMutation({
    onSuccess: () => void utils.task.list.invalidate(),
  });

  type StandardItem = NonNullable<typeof standardsResp>['items'][number];
  const standardsByWg = useMemo(() => {
    const map = new Map<string, StandardItem[]>();
    (standardsResp?.items ?? []).forEach((s) => {
      const arr = map.get(s.workingGroupId) ?? [];
      arr.push(s);
      map.set(s.workingGroupId, arr);
    });
    return map;
  }, [standardsResp]);

  // Counts per scope
  const tasksByStandard = useMemo(() => {
    const map = new Map<string, { open: number; overdue: number }>();
    const now = new Date();
    (tasks ?? []).forEach((t) => {
      const cur = map.get(t.standardId) ?? { open: 0, overdue: 0 };
      const isOpen = t.status === 'OPEN' || t.status === 'IN_PROGRESS';
      if (isOpen) {
        cur.open += 1;
        if (t.dueDate && new Date(t.dueDate) < now) cur.overdue += 1;
      }
      map.set(t.standardId, cur);
    });
    return map;
  }, [tasks]);

  const tasksByWg = useMemo(() => {
    const map = new Map<string, { open: number; overdue: number }>();
    tasksByStandard.forEach((v, stdId) => {
      const std = standardsResp?.items.find((s) => s.id === stdId);
      if (!std) return;
      const cur = map.get(std.workingGroupId) ?? { open: 0, overdue: 0 };
      cur.open += v.open;
      cur.overdue += v.overdue;
      map.set(std.workingGroupId, cur);
    });
    return map;
  }, [tasksByStandard, standardsResp]);

  // Apply filter to tasks
  const filteredTasks: TaskRow[] = useMemo(() => {
    if (!tasks) return [];
    return (tasks as TaskRow[]).filter((t) => {
      if (filter === 'open' && t.status === 'DONE') return false;
      if (filter === 'done' && t.status !== 'DONE') return false;
      if (filter === 'mine' && t.assigneeId !== userId) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        // Match on task title, internal code, OR the visible indeks-grif —
        // whichever the user typed, they find the task.
        if (
          !t.title.toLowerCase().includes(q) &&
          !t.standard.code.toLowerCase().includes(q) &&
          !(t.standard.indeks ?? '').toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [tasks, filter, search, userId]);

  const openTasks = filteredTasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED');
  const doneTasks = filteredTasks.filter((t) => t.status === 'DONE');

  // Tree grouping only meaningful for 'all' / 'wg' scopes. A specific
  // standard doesn't need a header hierarchy — the flat list is
  // already precisely scoped.
  const treeAvailable = selectedScope.kind !== 'std';
  const effectiveView = treeAvailable ? viewMode : 'flat';

  // Groups the given task set by РГ → Стандарт. Sorted by РГ code,
  // then standard code, then original task order within each std.
  interface StandardGroup {
    stdId: string;
    stdCode: string;
    stdTitle: string;
    stdIndeks: string | null;
    tasks: TaskRow[];
  }
  interface WgGroup {
    wgId: string;
    wgCode: string;
    wgName: string;
    wgColor: string;
    standards: StandardGroup[];
  }
  const groupTasks = useMemo(() => {
    return (list: TaskRow[]): WgGroup[] => {
      const wgMap = new Map<
        string,
        Omit<WgGroup, 'standards'> & { standards: Map<string, StandardGroup> }
      >();
      for (const t of list) {
        const std = standardsResp?.items.find((s) => s.id === t.standardId);
        const wgId = std?.workingGroupId ?? t.standard.workingGroupId;
        const wg = groups?.find((g) => g.id === wgId);
        if (!wg) continue;
        if (!wgMap.has(wg.id)) {
          wgMap.set(wg.id, {
            wgId: wg.id,
            wgCode: wg.code,
            wgName: wg.name,
            wgColor: wg.color,
            standards: new Map(),
          });
        }
        const wgEntry = wgMap.get(wg.id)!;
        const stdId = t.standardId;
        if (!wgEntry.standards.has(stdId)) {
          wgEntry.standards.set(stdId, {
            stdId,
            stdCode: std?.code ?? t.standard.code,
            stdTitle: std?.title ?? t.standard.title,
            stdIndeks: std?.indeks ?? t.standard.indeks,
            tasks: [],
          });
        }
        wgEntry.standards.get(stdId)!.tasks.push(t);
      }
      return Array.from(wgMap.values())
        .map((w) => ({
          ...w,
          standards: Array.from(w.standards.values()).sort((a, b) =>
            a.stdCode.localeCompare(b.stdCode, 'uk'),
          ),
        }))
        .sort((a, b) => a.wgCode.localeCompare(b.wgCode, 'uk'));
    };
  }, [groups, standardsResp]);

  const openTree = useMemo(
    () => (effectiveView === 'tree' ? groupTasks(openTasks) : null),
    [effectiveView, groupTasks, openTasks],
  );
  const doneTree = useMemo(
    () => (effectiveView === 'tree' ? groupTasks(doneTasks) : null),
    [effectiveView, groupTasks, doneTasks],
  );

  // Right-pane breadcrumb
  const scopeLabel = useMemo(() => {
    if (selectedScope.kind === 'all') return 'Усі робочі групи';
    if (selectedScope.kind === 'wg') {
      const g = groups?.find((x) => x.id === selectedScope.id);
      return g ? `${g.code} · ${g.name}` : 'РГ';
    }
    const std = standardsResp?.items.find((x) => x.id === selectedScope.id);
    const g = groups?.find((x) => x.id === selectedScope.wgId);
    return std && g ? `${g.code}  ·  ${std.code} — ${std.title}` : 'Стандарт';
  }, [selectedScope, groups, standardsResp]);

  const totalCount = tasks?.length ?? 0;
  const doneCount = (tasks ?? []).filter((t) => t.status === 'DONE').length;
  const overdueCount = (tasks ?? []).filter(
    (t) =>
      t.status !== 'DONE' &&
      t.status !== 'CANCELLED' &&
      t.dueDate &&
      new Date(t.dueDate) < new Date(),
  ).length;

  return (
    <div className="pg-enter space-y-5">
      <PageHeader
        title="Завдання"
        subtitle={
          <>
            Всього: <b className="text-ink">{totalCount}</b>
            {' · '}Виконано: <b className="text-emerald-600">{doneCount}</b>
            {' · '}Прострочено: <b className="text-red-600">{overdueCount}</b>
          </>
        }
        actions={
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            Завдання
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-5 items-start">
        {/* LEFT: Tree (full-width on mobile, fixed sidebar on lg+) */}
        <aside className="card overflow-hidden self-stretch lg:sticky lg:top-0">
          <div className="p-3 border-b border-hairline">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Пошук по РГ / стандарту"
              className="w-full px-3 py-2 text-[13px] bg-page border border-hairline rounded-[10px] text-ink placeholder:text-light focus:outline-none focus:border-brand"
            />
          </div>
          <div className="py-2 max-h-[calc(100vh-260px)] overflow-y-auto scrollbar-thin">
            <button
              onClick={() => setSelectedScope({ kind: 'all' })}
              className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                selectedScope.kind === 'all' ? 'bg-brand-soft text-brand' : 'text-ink hover:bg-pill'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-light" />
              Усі групи
            </button>
            {(groups ?? []).map((g) => {
              const stdList = standardsByWg.get(g.id) ?? [];
              const isExpanded = expanded[g.id] ?? selectedScope.kind !== 'all';
              const wgStat = tasksByWg.get(g.id) ?? { open: 0, overdue: 0 };
              const isWgSelected =
                (selectedScope.kind === 'wg' && selectedScope.id === g.id) ||
                (selectedScope.kind === 'std' && selectedScope.wgId === g.id);
              return (
                <div key={g.id}>
                  <button
                    onClick={() => {
                      setExpanded((p) => ({ ...p, [g.id]: !isExpanded }));
                      setSelectedScope({ kind: 'wg', id: g.id });
                    }}
                    className={`w-full text-left flex items-center gap-2 px-3 py-2 text-[13px] font-semibold transition-colors ${
                      isWgSelected ? 'bg-brand-soft text-brand' : 'text-ink hover:bg-pill'
                    }`}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-light" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-light" />
                    )}
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: g.color }}
                    />
                    <span className="flex-1 truncate">{g.code}</span>
                    {wgStat.open > 0 && (
                      <span
                        className={`text-[10px] font-bold ${
                          wgStat.overdue > 0 ? 'text-red-600' : 'text-mid'
                        }`}
                      >
                        {wgStat.open}
                        {wgStat.overdue > 0 && <AlertTriangle className="w-3 h-3 inline ml-0.5" />}
                      </span>
                    )}
                  </button>
                  {isExpanded &&
                    stdList.map((s) => {
                      const isSel = selectedScope.kind === 'std' && selectedScope.id === s.id;
                      const stdStat = tasksByStandard.get(s.id) ?? { open: 0, overdue: 0 };
                      return (
                        <button
                          key={s.id}
                          onClick={() => setSelectedScope({ kind: 'std', id: s.id, wgId: g.id })}
                          className={`w-full text-left flex items-center gap-2 px-3 py-1.5 pl-8 text-[12px] transition-colors ${
                            isSel
                              ? 'bg-brand-soft text-brand'
                              : 'text-mid hover:bg-pill hover:text-ink'
                          }`}
                          style={isSel ? { boxShadow: 'inset 2px 0 0 var(--c-brand)' } : undefined}
                        >
                          <span
                            className="font-mono font-bold text-[11px]"
                            style={isSel ? undefined : { color: g.color }}
                          >
                            {s.code}
                          </span>
                          <span className="flex-1 truncate">{s.title}</span>
                          {stdStat.open > 0 && (
                            <span
                              className={`text-[10px] font-bold ${
                                stdStat.overdue > 0 ? 'text-red-600' : 'text-mid'
                              }`}
                            >
                              {stdStat.open}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </aside>

        {/* RIGHT: List */}
        <main className="card overflow-hidden">
          <div className="card-head flex-col items-stretch sm:flex-row sm:items-center gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wide text-light">
                {selectedScope.kind === 'all'
                  ? 'Усі групи'
                  : selectedScope.kind === 'wg'
                    ? groups?.find((g) => g.id === selectedScope.id)?.code
                    : groups?.find((g) => g.id === selectedScope.wgId)?.code}
              </p>
              <h2 className="text-[15px] font-bold text-ink truncate">
                {selectedScope.kind === 'std' ? (
                  <Link
                    href={`/standards/${selectedScope.id}`}
                    className="hover:text-brand transition-colors"
                    title="Відкрити картку стандарту"
                  >
                    {scopeLabel}
                  </Link>
                ) : selectedScope.kind === 'wg' ? (
                  <Link
                    href={`/working-groups/${selectedScope.id}`}
                    className="hover:text-brand transition-colors"
                    title="Відкрити картку робочої групи"
                  >
                    {scopeLabel}
                  </Link>
                ) : (
                  scopeLabel
                )}
              </h2>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 flex-wrap">
              {/* View toggle — only meaningful when tree grouping has
                  something to group (i.e., scope isn't a single
                  standard). */}
              {treeAvailable && (
                <div className="inline-flex rounded-full border border-hairline p-0.5 bg-card">
                  <button
                    onClick={() => setViewMode('tree')}
                    title="Дерево: групувати за РГ + Стандартом"
                    className={`text-[12px] font-semibold px-3 py-1 rounded-full transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
                      viewMode === 'tree' ? 'bg-brand-soft text-brand' : 'text-mid hover:text-ink'
                    }`}
                  >
                    <ListTree className="w-3.5 h-3.5" />
                    Дерево
                  </button>
                  <button
                    onClick={() => setViewMode('flat')}
                    title="Список: усі задачі одним потоком"
                    className={`text-[12px] font-semibold px-3 py-1 rounded-full transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
                      viewMode === 'flat' ? 'bg-brand-soft text-brand' : 'text-mid hover:text-ink'
                    }`}
                  >
                    <LayoutList className="w-3.5 h-3.5" />
                    Список
                  </button>
                </div>
              )}
              {/* Expand-all / collapse-all — visible only when at least
                  one visible task has subtasks. Otherwise the buttons
                  would just be no-ops. */}
              {tasks?.some((t) => (t.checklistItems?.length ?? 0) > 0) && (
                <div className="inline-flex rounded-full border border-hairline p-0.5 bg-card">
                  <button
                    onClick={() =>
                      setExpandedAll(
                        (tasks ?? [])
                          .filter((t) => (t.checklistItems?.length ?? 0) > 0)
                          .map((t) => t.id),
                      )
                    }
                    title="Розгорнути всі підзадачі"
                    className="text-[12px] font-semibold px-3 py-1 rounded-full text-mid hover:text-ink whitespace-nowrap"
                  >
                    Розгорнути все
                  </button>
                  <button
                    onClick={() => setExpandedAll([])}
                    title="Згорнути всі підзадачі"
                    className="text-[12px] font-semibold px-3 py-1 rounded-full text-mid hover:text-ink whitespace-nowrap"
                  >
                    Згорнути все
                  </button>
                </div>
              )}
              <div className="inline-flex rounded-full border border-hairline p-0.5 bg-card">
                {(
                  [
                    ['all', 'Всі'],
                    ['open', 'Відкриті'],
                    ['done', 'Виконані'],
                    ['mine', 'Мої'],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setFilter(k)}
                    className={`text-[12px] font-semibold px-3 py-1 rounded-full transition-colors whitespace-nowrap ${
                      filter === k ? 'bg-brand-soft text-brand' : 'text-mid hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {!tasks ? (
            <div className="py-16 text-center text-light text-sm">Завантаження…</div>
          ) : (
            <div className="p-5 space-y-5">
              {/* Helper: single-task row — used both flat and inside
                  the tree so the row markup stays in one place. */}
              {(() => {
                const renderRow = (t: TaskRow, targetStatus: 'OPEN' | 'DONE') => (
                  <TaskRowItem
                    key={t.id}
                    task={t}
                    toggle={() => toggleTask.mutate({ id: t.id, status: targetStatus })}
                    onEdit={() => setEditingTask(t)}
                    onDelete={() => setDeleteCandidate(t)}
                    // Standard code chip on the row is redundant inside
                    // the tree (the section header already says which
                    // standard). Show it only in flat mode with
                    // 'all'/'wg' scope, matching pre-tree behavior.
                    showStandard={effectiveView === 'flat' && selectedScope.kind !== 'std'}
                    canDelete={t.createdById === userId || session?.user.globalRole === 'ADMIN'}
                    expanded={isExpanded(t.id)}
                    onToggleExpand={() => toggleExpanded(t.id)}
                  />
                );

                const renderTree = (tree: WgGroup[], targetStatus: 'OPEN' | 'DONE') => (
                  <div className="space-y-4">
                    {tree.map((wg) => {
                      const wgCount = wg.standards.reduce((s, x) => s + x.tasks.length, 0);
                      return (
                        <div key={wg.wgId} className="space-y-2">
                          {/* WG header — hidden when scope is a single
                              РГ (redundant with the panel scope label). */}
                          {selectedScope.kind === 'all' && (
                            <div className="flex items-center gap-2 pt-1">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: wg.wgColor }}
                              />
                              <Link
                                href={`/working-groups/${wg.wgId}`}
                                className="text-sm font-bold text-ink hover:text-brand truncate"
                              >
                                {wg.wgCode}
                                <span className="text-mid font-normal ml-1.5">· {wg.wgName}</span>
                              </Link>
                              <span className="text-[11px] text-light shrink-0">{wgCount}</span>
                            </div>
                          )}
                          <div
                            className={
                              selectedScope.kind === 'all' ? 'pl-4 space-y-3' : 'space-y-3'
                            }
                          >
                            {wg.standards.map((std) => (
                              <div key={std.stdId} className="space-y-1.5">
                                <div className="flex items-center gap-1.5 text-[11px]">
                                  <Link
                                    href={`/standards/${std.stdId}`}
                                    className="font-mono text-mid hover:text-brand"
                                  >
                                    {std.stdIndeks ?? std.stdCode}
                                  </Link>
                                  <span className="text-light truncate">— {std.stdTitle}</span>
                                  <span className="text-light shrink-0">· {std.tasks.length}</span>
                                </div>
                                <ul className="space-y-1.5">
                                  {std.tasks.map((t) => renderRow(t, targetStatus))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );

                return (
                  <>
                    {/* OPEN */}
                    <section>
                      <div className="text-[11px] font-bold uppercase tracking-[0.8px] text-light mb-2">
                        Відкриті · {openTasks.length}
                      </div>
                      {openTasks.length === 0 ? (
                        <p className="text-sm text-light px-1 py-3">Завдань немає</p>
                      ) : effectiveView === 'tree' && openTree ? (
                        renderTree(openTree, 'DONE')
                      ) : (
                        <ul className="space-y-2">{openTasks.map((t) => renderRow(t, 'DONE'))}</ul>
                      )}
                      <button
                        onClick={() => setShowCreate(true)}
                        className="mt-2 w-full text-center text-[13px] py-2.5 rounded-[10px] border border-dashed border-hairline text-mid hover:text-brand hover:border-brand transition-colors"
                      >
                        + Додати завдання
                      </button>
                    </section>

                    {/* DONE */}
                    {doneTasks.length > 0 && (
                      <section>
                        <div className="text-[11px] font-bold uppercase tracking-[0.8px] text-light mb-2">
                          Виконані · {doneTasks.length}
                        </div>
                        {effectiveView === 'tree' && doneTree ? (
                          renderTree(doneTree, 'OPEN')
                        ) : (
                          <ul className="space-y-2">
                            {doneTasks.map((t) => renderRow(t, 'OPEN'))}
                          </ul>
                        )}
                      </section>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </main>
      </div>

      <TaskFormModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        initial={
          selectedScope.kind === 'wg'
            ? { workingGroupId: selectedScope.id }
            : selectedScope.kind === 'std'
              ? { workingGroupId: selectedScope.wgId, standardId: selectedScope.id }
              : undefined
        }
        lockedStandardId={selectedScope.kind === 'std' ? selectedScope.id : undefined}
        lockedWorkingGroupId={selectedScope.kind === 'wg' ? selectedScope.id : undefined}
      />
      <TaskFormModal
        open={!!editingTask}
        onClose={() => setEditingTask(null)}
        initial={
          editingTask
            ? {
                id: editingTask.id,
                workingGroupId: editingTask.standard.workingGroupId,
                standardId: editingTask.standardId,
                title: editingTask.title,
                description: editingTask.description ?? '',
                priority: editingTask.priority,
                assigneeId: editingTask.assigneeId ?? '',
                dueDate: editingTask.dueDate
                  ? new Date(editingTask.dueDate).toISOString().slice(0, 10)
                  : '',
              }
            : undefined
        }
      />

      <ConfirmModal
        open={!!deleteCandidate}
        title="Видалити завдання?"
        message={
          deleteCandidate ? (
            <>
              <span className="font-semibold text-ink">«{deleteCandidate.title}»</span> буде
              видалено остаточно. Цю дію не можна скасувати.
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Видалити"
        destructive
        isPending={deleteTask.isPending}
        onClose={() => setDeleteCandidate(null)}
        onConfirm={() => {
          if (!deleteCandidate) return;
          deleteTask.mutate(
            { id: deleteCandidate.id },
            { onSuccess: () => setDeleteCandidate(null) },
          );
        }}
      />
    </div>
  );
}

function TaskRowItem({
  task,
  toggle,
  onEdit,
  onDelete,
  showStandard,
  canDelete,
  expanded,
  onToggleExpand,
}: {
  task: TaskRow;
  toggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  showStandard: boolean;
  canDelete: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const isDone = task.status === 'DONE';
  const due = task.dueDate ? new Date(task.dueDate) : null;
  const dueLabel = <DueDateChip due={due} isDone={isDone} />;
  const hasChecklist = (task.checklistItems?.length ?? 0) > 0;
  const utils = trpc.useUtils();
  // Inline toggle for subtasks so ticking a subtask doesn't require
  // opening the task card. Success re-fetches task.list so both the
  // checklist chip and the row grouping update.
  const toggleSubtask = trpc.task.checklistToggle.useMutation({
    onSuccess: () => void utils.task.list.invalidate(),
  });
  const doneSubtasks = task.checklistItems?.filter((i) => i.isDone).length ?? 0;
  const totalSubtasks = task.checklistItems?.length ?? 0;

  return (
    <li className="group bg-card border border-hairline rounded-[10px] hover:border-brand/40 transition-colors">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={toggle}
          className={`w-[18px] h-[18px] rounded-md border-[1.5px] inline-flex items-center justify-center transition shrink-0 ${
            isDone ? 'bg-emerald-500 border-emerald-500' : 'border-hairline hover:border-brand'
          }`}
          aria-label={isDone ? 'Відновити' : 'Виконати'}
        >
          {isDone && (
            <svg viewBox="0 0 12 12" className="w-3 h-3 fill-none stroke-white stroke-[2.5]">
              <path d="M2.5 6.5 5 9l4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] ?? 'bg-slate-300'}`}
        />
        {/* Title + checklist chip live in a shared flex container so the
            chip sits snugly next to the title text (not on the far
            right). `min-w-0` on the container lets the title truncate
            when space is tight; the chip stays `shrink-0`. */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <Link
            href={`/tasks/${task.id}`}
            className={`min-w-0 text-left text-sm truncate transition-colors ${
              isDone ? 'text-light line-through' : 'text-ink hover:text-brand'
            }`}
          >
            {task.title}
          </Link>
          {hasChecklist && (
            <button
              type="button"
              onClick={onToggleExpand}
              title={
                expanded
                  ? 'Сховати підзадачі'
                  : `Показати підзадачі (${doneSubtasks}/${totalSubtasks})`
              }
              className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-pill text-mid hover:text-brand hover:bg-brand-soft/40 transition-colors shrink-0"
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
              ☑ {doneSubtasks}/{totalSubtasks}
            </button>
          )}
        </div>
        {showStandard && (
          <Link
            href={`/standards/${task.standardId}`}
            // Show the full indeks-grif when it's registered on the standard;
            // otherwise fall back to the shorter internal `code`. Hover
            // reveals whichever isn't in the label so both are always
            // reachable.
            title={task.standard.indeks ? `Внутрішній код: ${task.standard.code}` : undefined}
            className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-pill text-mid hover:text-brand max-w-[220px] truncate"
          >
            {task.standard.indeks ?? task.standard.code}
          </Link>
        )}
        {task.assignee && (
          <div className="inline-flex items-center gap-1.5 shrink-0">
            <Avatar
              name={task.assignee.name}
              avatarUrl={task.assignee.avatarUrl ?? undefined}
              size="xs"
            />
            <span className="text-[11px] text-mid hidden md:inline max-w-[200px] truncate">
              {task.assignee.name}
            </span>
          </div>
        )}
        {dueLabel}
        <div className="ml-1 inline-flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onEdit}
            className="p-1 rounded hover:bg-pill text-mid hover:text-brand"
            title="Редагувати"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {canDelete && (
            <button
              onClick={onDelete}
              className="p-1 rounded hover:bg-red-50 text-mid hover:text-red-600"
              title="Видалити"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {expanded && task.checklistItems && (
        <ul className="border-t border-hairline bg-page/30 px-4 py-2 space-y-1">
          {task.checklistItems.map((sub) => {
            const subDue = sub.dueDate ? new Date(sub.dueDate) : null;
            return (
              <li
                key={sub.id}
                // Reserve a transparent bottom border so hover doesn't
                // shift layout. On hover a dashed hairline appears
                // under the row — visually anchors the meta on the
                // right to the correct title on the left. Skipped on
                // the last row (nothing to separate from).
                className="group flex items-center gap-2 text-sm py-1 border-b border-transparent hover:border-hairline hover:border-dashed last:hover:border-transparent transition-colors"
              >
                <input
                  type="checkbox"
                  checked={sub.isDone}
                  disabled={toggleSubtask.isPending}
                  onChange={() => toggleSubtask.mutate({ id: sub.id })}
                  className="w-3.5 h-3.5 accent-brand cursor-pointer shrink-0"
                />
                <span
                  className={`flex-1 truncate ${sub.isDone ? 'line-through text-light' : 'text-ink'}`}
                >
                  {sub.title}
                </span>
                {/* Meta on the right — mirrors the parent task row:
                    Avatar+name, then DueDateChip (date + «ще N днів»). */}
                {sub.assignee && (
                  <div className="inline-flex items-center gap-1.5 shrink-0">
                    <Avatar
                      name={sub.assignee.name}
                      avatarUrl={sub.assignee.avatarUrl ?? undefined}
                      size="xs"
                    />
                    <span className="text-[11px] text-mid hidden md:inline max-w-[140px] truncate">
                      {sub.assignee.name}
                    </span>
                  </div>
                )}
                <DueDateChip due={subDue} isDone={sub.isDone} />
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
