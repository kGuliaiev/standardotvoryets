'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { StatusBadge, type StandardStatus } from '@/components/ui/StatusBadge';
import { Avatar } from '@/components/ui/Avatar';
import { formatDate } from '@/lib/utils';

const STATUS_TABS: Array<{ value: StandardStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Всі' },
  { value: 'DRAFT', label: 'Чернетки' },
  { value: 'IN_REVIEW', label: 'На розгляді' },
  { value: 'VOTING', label: 'Голосування' },
  { value: 'ADOPTED', label: 'Прийняті' },
  { value: 'REJECTED', label: 'Відхилені' },
  { value: 'ARCHIVED', label: 'Архів' },
];

export function StandardsList() {
  const [search, setSearch] = useState('');
  const [activeStatus, setActiveStatus] = useState<StandardStatus | 'ALL'>('ALL');
  const [wgFilter, setWgFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data: groups } = trpc.workingGroup.list.useQuery();

  const { data, isLoading } = trpc.standard.list.useQuery(
    {
      search: search.length >= 2 ? search : undefined,
      status: activeStatus !== 'ALL' ? activeStatus : undefined,
      workingGroupId: wgFilter || undefined,
      page,
      pageSize: 20,
    },
    { keepPreviousData: true },
  );

  function handleSearch(val: string) {
    setSearch(val);
    setPage(1);
  }

  function handleStatus(val: StandardStatus | 'ALL') {
    setActiveStatus(val);
    setPage(1);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Стандарти</h1>
        <Link
          href="/standards/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors"
        >
          + Новий стандарт
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex gap-3 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Пошук за кодом або назвою…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          {/* WG filter */}
          <select
            value={wgFilter}
            onChange={(e) => { setWgFilter(e.target.value); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Всі РГ</option>
            {groups?.map((g) => (
              <option key={g.id} value={g.id}>{g.code}</option>
            ))}
          </select>
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 flex-wrap">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => handleStatus(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeStatus === tab.value
                  ? 'bg-blue-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Завантаження…</div>
        ) : data?.items.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            <p className="text-2xl mb-2">📄</p>
            Стандартів не знайдено
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-5 py-3 font-medium">Код / Назва</th>
                <th className="px-3 py-3 font-medium">РГ</th>
                <th className="px-3 py-3 font-medium">Статус</th>
                <th className="px-3 py-3 font-medium">Відповідальний</th>
                <th className="px-3 py-3 font-medium">Прогрес</th>
                <th className="px-3 py-3 font-medium">Дедлайн</th>
                <th className="px-3 py-3 font-medium">Оновлено</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.items.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-5 py-3.5 max-w-xs">
                    <Link href={`/standards/${s.id}`} className="block">
                      <span className="font-mono text-xs text-slate-400 group-hover:text-blue-500 transition-colors">
                        {s.code}
                      </span>
                      <p className="font-medium text-slate-800 group-hover:text-blue-700 transition-colors line-clamp-1 mt-0.5">
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
                      <span className="text-xs text-slate-600 font-medium">{s.workingGroup.code}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3.5">
                    <StatusBadge status={s.status} size="sm" />
                  </td>
                  <td className="px-3 py-3.5">
                    {s.responsible ? (
                      <div className="flex items-center gap-2">
                        <Avatar name={s.responsible.name} avatarUrl={s.responsible.avatarUrl} size="xs" />
                        <span className="text-xs text-slate-600 truncate max-w-[100px]">{s.responsible.name}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${s.progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-400">{s.progress}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-3.5">
                    {s.deadline ? (
                      <span className={`text-xs ${new Date(s.deadline) < new Date() && !['ADOPTED', 'ARCHIVED'].includes(s.status) ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                        {formatDate(s.deadline)}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5 text-xs text-slate-400">
                    {formatDate(s.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="border-t border-slate-100 px-5 py-3 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {((page - 1) * 20) + 1}–{Math.min(page * 20, data.total)} з {data.total}
            </span>
            <div className="flex gap-1">
              <button
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50 disabled:cursor-not-allowed"
              >
                ← Назад
              </button>
              <button
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50 disabled:cursor-not-allowed"
              >
                Далі →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Count summary */}
      {data && (
        <p className="text-xs text-slate-400 text-right">
          Знайдено {data.total} стандарт{data.total === 1 ? '' : data.total < 5 ? 'и' : 'ів'}
        </p>
      )}
    </div>
  );
}
