'use client';

import { useEffect, useRef, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { StatusBadge, type StandardStatus } from '@/components/ui/StatusBadge';
import { Avatar } from '@/components/ui/Avatar';
import { StandardProgress, hasOverdueStage } from '@/components/standards/StandardProgress';
import { SortableHeader } from '@/components/ui/SortableHeader';
import { useSort, sortedRows } from '@/lib/useSort';
import { useLocalStorageState } from '@/lib/useLocalStorageState';
import { AlertCircle, ChevronDown, Check } from 'lucide-react';
import { formatDate } from '@/lib/utils';

const STATUS_TABS: { value: StandardStatus; label: string }[] = [
  { value: 'DRAFT', label: 'Чернетки' },
  { value: 'IN_REVIEW', label: 'На розгляді' },
  { value: 'VOTING', label: 'Голосування' },
  { value: 'ADOPTED', label: 'Прийняті' },
  { value: 'REJECTED', label: 'Відхилені' },
  { value: 'ARCHIVED', label: 'Архів' },
];

const STORAGE_KEY = 'standards.filters.v1';

interface StoredFilters {
  search: string;
  statuses: StandardStatus[]; // empty = all
  wgIds: string[]; // empty = all
}

const DEFAULT_FILTERS: StoredFilters = { search: '', statuses: [], wgIds: [] };

export function StandardsList() {
  const [filters, setFilters] = useLocalStorageState<StoredFilters>(STORAGE_KEY, DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [wgPickerOpen, setWgPickerOpen] = useState(false);
  const wgPickerRef = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useSort<'code' | 'wg' | 'status' | 'responsible' | 'deadline' | 'stage'>(
    'code',
    'asc',
  );

  // Close WG picker on outside click
  useEffect(() => {
    if (!wgPickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (wgPickerRef.current && !wgPickerRef.current.contains(e.target as Node)) {
        setWgPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [wgPickerOpen]);

  const { data: groups } = trpc.workingGroup.list.useQuery();

  const { data, isLoading } = trpc.standard.list.useQuery(
    {
      search: filters.search.length >= 2 ? filters.search : undefined,
      statuses: filters.statuses.length > 0 ? filters.statuses : undefined,
      workingGroupIds: filters.wgIds.length > 0 ? filters.wgIds : undefined,
      page,
      pageSize: 20,
    },
    { placeholderData: keepPreviousData },
  );

  function setSearch(val: string) {
    setFilters((prev) => ({ ...prev, search: val }));
    setPage(1);
  }

  function toggleStatus(s: StandardStatus) {
    setFilters((prev) => {
      const has = prev.statuses.includes(s);
      return {
        ...prev,
        statuses: has ? prev.statuses.filter((x) => x !== s) : [...prev.statuses, s],
      };
    });
    setPage(1);
  }

  function clearStatuses() {
    setFilters((prev) => ({ ...prev, statuses: [] }));
    setPage(1);
  }

  function toggleWg(id: string) {
    setFilters((prev) => {
      const has = prev.wgIds.includes(id);
      return { ...prev, wgIds: has ? prev.wgIds.filter((x) => x !== id) : [...prev.wgIds, id] };
    });
    setPage(1);
  }

  function clearWgs() {
    setFilters((prev) => ({ ...prev, wgIds: [] }));
    setPage(1);
  }

  const selectedWgs = groups?.filter((g) => filters.wgIds.includes(g.id)) ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Стандарти</h1>
        <Link
          href="/standards/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors"
        >
          + Новий стандарт
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border border-hairline p-4 space-y-3">
        <div className="flex gap-3 flex-wrap items-start">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-light"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Пошук за кодом або назвою…"
              value={filters.search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* WG multi-select picker */}
          <div ref={wgPickerRef} className="relative">
            <button
              type="button"
              onClick={() => setWgPickerOpen((o) => !o)}
              className="flex items-center gap-2 text-sm border border-hairline rounded-lg px-3 py-2 hover:bg-pill focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]"
            >
              <span className="flex-1 text-left truncate">
                {selectedWgs.length === 0
                  ? 'Всі РГ'
                  : selectedWgs.length === 1
                    ? selectedWgs[0]?.code
                    : `${selectedWgs.length} РГ обрано`}
              </span>
              <ChevronDown
                size={14}
                className={`text-mid transition-transform ${wgPickerOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {wgPickerOpen && (
              <div className="absolute z-20 right-0 mt-1 w-72 bg-card border border-hairline rounded-lg shadow-lg p-2 max-h-80 overflow-y-auto">
                <button
                  type="button"
                  onClick={clearWgs}
                  className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs font-medium hover:bg-pill ${
                    filters.wgIds.length === 0 ? 'text-brand' : 'text-mid'
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded border-[1.5px] inline-flex items-center justify-center ${
                      filters.wgIds.length === 0
                        ? 'border-brand bg-brand text-white'
                        : 'border-hairline'
                    }`}
                  >
                    {filters.wgIds.length === 0 && <Check size={10} strokeWidth={3} />}
                  </span>
                  Всі РГ
                </button>
                <div className="my-1 h-px bg-hairline" />
                {groups?.map((g) => {
                  const checked = filters.wgIds.includes(g.id);
                  return (
                    <label
                      key={g.id}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs hover:bg-pill cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleWg(g.id)}
                        className="sr-only"
                      />
                      <span
                        className={`w-4 h-4 rounded border-[1.5px] inline-flex items-center justify-center shrink-0 ${
                          checked ? 'border-brand bg-brand text-white' : 'border-hairline'
                        }`}
                      >
                        {checked && <Check size={10} strokeWidth={3} />}
                      </span>
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: g.color }}
                      />
                      <span className="font-mono text-mid font-semibold whitespace-nowrap shrink-0">
                        {g.code}
                      </span>
                      <span className="text-light truncate min-w-0">{g.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Status tabs (multi-select) — "Всі" clears the rest */}
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={clearStatuses}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filters.statuses.length === 0 ? 'bg-blue-700 text-white' : 'text-mid hover:bg-pill'
            }`}
          >
            Всі
          </button>
          {STATUS_TABS.map((tab) => {
            const active = filters.statuses.includes(tab.value);
            return (
              <button
                key={tab.value}
                onClick={() => toggleStatus(tab.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  active ? 'bg-blue-700 text-white' : 'text-mid hover:bg-pill'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-hairline overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-light text-sm">Завантаження…</div>
        ) : data?.items.length === 0 ? (
          <div className="py-16 text-center text-light text-sm">
            <p className="text-2xl mb-2">📄</p>
            Стандартів не знайдено
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-page border-b border-hairline">
                <tr className="text-left text-xs text-mid uppercase tracking-wide">
                  <th className="px-5 py-3 font-medium">
                    <SortableHeader columnKey="code" sort={sort} onSort={setSort}>
                      Код / Назва
                    </SortableHeader>
                  </th>
                  <th className="px-3 py-3 font-medium">
                    <SortableHeader columnKey="wg" sort={sort} onSort={setSort}>
                      РГ
                    </SortableHeader>
                  </th>
                  <th className="px-3 py-3 font-medium">
                    <SortableHeader columnKey="status" sort={sort} onSort={setSort}>
                      Статус
                    </SortableHeader>
                  </th>
                  <th className="px-3 py-3 font-medium">
                    <SortableHeader columnKey="responsible" sort={sort} onSort={setSort}>
                      Відповідальний
                    </SortableHeader>
                  </th>
                  <th className="px-3 py-3 font-medium w-[240px]">
                    <SortableHeader columnKey="stage" sort={sort} onSort={setSort}>
                      Етапи
                    </SortableHeader>
                  </th>
                  <th className="px-3 py-3 font-medium">
                    <SortableHeader columnKey="deadline" sort={sort} onSort={setSort}>
                      Дедлайн
                    </SortableHeader>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {sortedRows(data?.items, sort, (s, key) => {
                  switch (key) {
                    case 'code':
                      return s.code;
                    case 'wg':
                      return s.workingGroup.code;
                    case 'status':
                      return s.status;
                    case 'responsible':
                      return s.responsible?.name ?? null;
                    case 'deadline':
                      return s.deadline ? new Date(s.deadline) : null;
                    case 'stage':
                      // Sort by earliest unconfirmed due date (overdue first)
                      return s.techSpecCompletedAt
                        ? s.draftCompletedAt
                          ? s.feedbackCompletedAt
                            ? s.techReviewCompletedAt
                              ? s.finalCompletedAt
                                ? new Date(0)
                                : new Date(s.finalDueDate ?? 0)
                              : new Date(s.techReviewDueDate ?? 0)
                            : new Date(s.feedbackDueDate ?? 0)
                          : new Date(s.draftDueDate ?? 0)
                        : new Date(s.techSpecDueDate ?? 0);
                    default:
                      return null;
                  }
                }).map((s) => (
                  <tr key={s.id} className="hover:bg-page transition-colors group">
                    <td className="px-5 py-3.5 max-w-xs">
                      <Link href={`/standards/${s.id}`} className="block">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-light group-hover:text-blue-500 transition-colors">
                            {s.code}
                          </span>
                          {hasOverdueStage(s) && (
                            <span
                              title="Є прострочений етап без підтвердження"
                              className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400 text-[10px] font-bold bg-red-50 dark:bg-red-900/30 rounded px-1 py-0.5"
                            >
                              <AlertCircle className="w-3 h-3" /> прострочка
                            </span>
                          )}
                        </div>
                        <p className="font-medium text-ink group-hover:text-blue-700 transition-colors line-clamp-1 mt-0.5">
                          {s.title}
                        </p>
                      </Link>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: s.workingGroup.color }}
                        />
                        <span className="text-xs text-mid font-medium">{s.workingGroup.code}</span>
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      <StatusBadge status={s.status} size="sm" />
                    </td>
                    <td className="px-3 py-3.5">
                      {s.responsible ? (
                        <div className="flex items-center gap-2">
                          <Avatar
                            name={s.responsible.name}
                            avatarUrl={s.responsible.avatarUrl}
                            size="xs"
                          />
                          <span className="text-xs text-mid truncate max-w-[100px]">
                            {s.responsible.name}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-light">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5">
                      <StandardProgress
                        variant="compact"
                        techSpecDueDate={s.techSpecDueDate}
                        draftDueDate={s.draftDueDate}
                        feedbackDueDate={s.feedbackDueDate}
                        techReviewDueDate={s.techReviewDueDate}
                        finalDueDate={s.finalDueDate}
                        techSpecCompletedAt={s.techSpecCompletedAt}
                        draftCompletedAt={s.draftCompletedAt}
                        feedbackCompletedAt={s.feedbackCompletedAt}
                        techReviewCompletedAt={s.techReviewCompletedAt}
                        finalCompletedAt={s.finalCompletedAt}
                      />
                    </td>
                    <td className="px-3 py-3.5">
                      {s.deadline ? (
                        <span
                          className={`text-xs ${new Date(s.deadline) < new Date() && !['ADOPTED', 'ARCHIVED'].includes(s.status) ? 'text-red-600 font-medium' : 'text-mid'}`}
                        >
                          {formatDate(s.deadline)}
                        </span>
                      ) : (
                        <span className="text-light text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="border-t border-hairline px-5 py-3 flex items-center justify-between">
            <span className="text-xs text-mid">
              {(page - 1) * 20 + 1}–{Math.min(page * 20, data.total)} з {data.total}
            </span>
            <div className="flex gap-1">
              <button
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
                className="px-3 py-1.5 text-xs border border-hairline rounded-lg disabled:opacity-40 hover:bg-page disabled:cursor-not-allowed"
              >
                ← Назад
              </button>
              <button
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
                className="px-3 py-1.5 text-xs border border-hairline rounded-lg disabled:opacity-40 hover:bg-page disabled:cursor-not-allowed"
              >
                Далі →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Count summary */}
      {data && (
        <p className="text-xs text-light text-right">
          Знайдено {data.total} стандарт{data.total === 1 ? '' : data.total < 5 ? 'и' : 'ів'}
        </p>
      )}
    </div>
  );
}
