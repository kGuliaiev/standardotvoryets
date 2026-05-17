'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { trpc } from '@/lib/trpc/client';
import { Eye, Pencil, FileText, AlertCircle } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { useSort, sortedRows } from '@/lib/useSort';
import { useLocalStorageState } from '@/lib/useLocalStorageState';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { can } from '@/lib/rbac';
import { formatDate } from '@/lib/utils';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';

const RANK_LABELS: Record<string, string> = {
  CIVILIAN: '',
  LIEUTENANT: 'лейтенант',
  SENIOR_LIEUTENANT: 'старший лейтенант',
  CAPTAIN: 'капітан',
  MAJOR: 'майор',
  LIEUTENANT_COLONEL: 'підполковник',
  COLONEL: 'полковник',
  BRIGADIER_GENERAL: 'бригадний генерал',
  MAJOR_GENERAL: 'генерал-майор',
  LIEUTENANT_GENERAL: 'генерал-лейтенант',
  GENERAL: 'генерал',
};

function rankPrefix(rank: string | null | undefined) {
  if (!rank) return '';
  return RANK_LABELS[rank] ? `${RANK_LABELS[rank]} ` : '';
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PLANNED: {
    label: 'Заплановано',
    cls: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  IN_PROGRESS: {
    label: 'Триває',
    cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  },
  COMPLETED: {
    label: 'Завершено',
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  CANCELLED: { label: 'Скасовано', cls: 'bg-pill text-mid' },
};

interface StoredFilters {
  search: string;
  wgIds: string[];
}
const DEFAULT_FILTERS: StoredFilters = { search: '', wgIds: [] };

export function ProtocolsList() {
  const { data: session } = useSession();
  const { data: meetings, isLoading } = trpc.meeting.protocolsForUser.useQuery(undefined, {
    refetchOnMount: 'always',
    staleTime: 0,
  });
  const { data: groups } = trpc.workingGroup.list.useQuery();
  const [filters, setFilters] = useLocalStorageState<StoredFilters>(
    'protocols.filters.v1',
    DEFAULT_FILTERS,
  );
  const [sort, setSort] = useSort<'protocolNumber' | 'date' | 'title' | 'wg' | 'status'>(
    'date',
    'desc',
  );

  const userCtx = useMemo(
    () =>
      session
        ? {
            globalRole: session.user.globalRole as GlobalRole,
            memberships: (session.user.memberships ?? []) as {
              workingGroupId: string;
              role: WorkingGroupRole;
            }[],
          }
        : null,
    [session],
  );
  const isAdmin = session?.user.globalRole === 'ADMIN';

  const filtered = (meetings ?? []).filter((m) => {
    if (filters.wgIds.length > 0 && !filters.wgIds.includes(m.workingGroup.id)) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const hay =
        `${m.title} ${m.workingGroup.code} ${m.workingGroup.name} ${m.protocolNumber ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const ordered = sortedRows(filtered, sort, (m, key) => {
    switch (key) {
      case 'protocolNumber':
        return m.protocolNumber ?? null;
      case 'date':
        return new Date(m.startAt);
      case 'title':
        return m.title;
      case 'wg':
        return m.workingGroup.code;
      case 'status':
        return m.status;
      default:
        return null;
    }
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Протоколи засідань</h1>
          <p className="text-sm text-mid mt-1">
            Усі протоколи робочих груп, до яких ви маєте доступ
          </p>
        </div>
        <span className="text-xs text-light">
          Знайдено: <span className="font-bold text-ink">{ordered.length}</span>
        </span>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border border-hairline p-4 space-y-3">
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Пошук за назвою / РГ / № протоколу…"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="flex-1 min-w-[220px] px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {groups && groups.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setFilters({ ...filters, wgIds: [] })}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filters.wgIds.length === 0 ? 'bg-blue-700 text-white' : 'text-mid hover:bg-pill'
                }`}
              >
                Всі РГ
              </button>
              {groups.map((g) => {
                const active = filters.wgIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    onClick={() =>
                      setFilters({
                        ...filters,
                        wgIds: active
                          ? filters.wgIds.filter((x) => x !== g.id)
                          : [...filters.wgIds, g.id],
                      })
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
                      active ? 'bg-blue-700 text-white' : 'text-mid hover:bg-pill'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g.color }} />
                    {g.code}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-hairline overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-light text-sm">Завантаження…</div>
        ) : ordered.length === 0 ? (
          <div className="py-16 text-center text-light text-sm">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
            Протоколів не знайдено
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="bg-page border-b border-hairline">
                <tr className="text-left text-xs text-mid uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium w-24">
                    <SortableHeader columnKey="protocolNumber" sort={sort} onSort={setSort}>
                      № протоколу
                    </SortableHeader>
                  </th>
                  <th className="px-3 py-3 font-medium">
                    <SortableHeader columnKey="title" sort={sort} onSort={setSort}>
                      Тема засідання
                    </SortableHeader>
                  </th>
                  <th className="px-3 py-3 font-medium">
                    <SortableHeader columnKey="wg" sort={sort} onSort={setSort}>
                      РГ
                    </SortableHeader>
                  </th>
                  <th className="px-3 py-3 font-medium">
                    <SortableHeader columnKey="date" sort={sort} onSort={setSort}>
                      Дата
                    </SortableHeader>
                  </th>
                  <th className="px-3 py-3 font-medium">
                    <SortableHeader columnKey="status" sort={sort} onSort={setSort}>
                      Статус
                    </SortableHeader>
                  </th>
                  <th className="px-3 py-3 font-medium">Головуючий</th>
                  <th className="px-3 py-3 font-medium text-center">Пункти</th>
                  <th className="px-3 py-3 font-medium text-right">Дії</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {ordered.map((m) => {
                  const statusInfo = STATUS_LABELS[m.status] ?? { label: m.status, cls: '' };
                  const canEdit =
                    isAdmin ||
                    (userCtx ? can(userCtx, 'meeting:uploadMinutes', m.workingGroup.id) : false);
                  const year = new Date(m.startAt).getFullYear();
                  const wgNum = /(\d+)/.exec(m.workingGroup.code)?.[1] ?? '';
                  const protoLabel = m.protocolNumber
                    ? `№ ${m.protocolNumber}/${wgNum}/${year}`
                    : '— чернетка —';
                  return (
                    <tr key={m.id} className="hover:bg-page transition-colors group">
                      <td className="px-4 py-3 font-mono text-xs">
                        {m.protocolNumber ? (
                          <span className="text-ink font-bold">{protoLabel}</span>
                        ) : (
                          <span className="text-light italic">{protoLabel}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 max-w-md">
                        <Link
                          href={`/meetings/${m.id}`}
                          className="font-medium text-ink hover:text-brand line-clamp-1"
                        >
                          {m.title}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/working-groups/${m.workingGroup.id}`}
                          className="inline-flex items-center gap-1.5"
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: m.workingGroup.color }}
                          />
                          <span className="text-xs text-mid font-mono font-semibold">
                            {m.workingGroup.code}
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-xs text-mid whitespace-nowrap">
                        {formatDate(m.startAt)}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${statusInfo.cls}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {(() => {
                          const fallbackLeader = m.workingGroup.members?.[0]?.user;
                          const person = m.chairman ?? fallbackLeader ?? null;
                          if (!person) return <span className="text-light">—</span>;
                          return (
                            <div className="flex items-center gap-1.5">
                              <Avatar name={person.name} size="xs" />
                              <span className="text-mid truncate max-w-[140px]">
                                {rankPrefix(person.rank)}
                                {person.name}
                                {!m.chairman && (
                                  <span
                                    className="text-light ml-1"
                                    title="Керівник РГ за замовчуванням"
                                  >
                                    ·
                                  </span>
                                )}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-3 text-center text-xs text-mid">
                        {m._count.agendaItems}
                      </td>
                      <td className="px-3 py-3">
                        <div className="inline-flex items-center gap-1 justify-end">
                          <Link
                            href={`/meetings/${m.id}`}
                            title="Переглянути"
                            className="p-1.5 rounded text-mid hover:text-brand hover:bg-pill transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Link>
                          {canEdit && (
                            <Link
                              href={`/meetings/${m.id}/protocol`}
                              title="Редагувати"
                              className="p-1.5 rounded text-mid hover:text-brand hover:bg-pill transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Link>
                          )}
                          <a
                            href={`/api/meetings/${m.id}/protocol.docx`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Завантажити Word"
                            className="p-1.5 rounded text-mid hover:text-brand hover:bg-pill transition-colors inline-flex items-center gap-1"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-bold">DOC</span>
                          </a>
                          <a
                            href={`/api/meetings/${m.id}/protocol`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Завантажити PDF"
                            className="p-1.5 rounded text-mid hover:text-brand hover:bg-pill transition-colors inline-flex items-center gap-1"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-bold">PDF</span>
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
