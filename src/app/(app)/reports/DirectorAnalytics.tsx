'use client';

import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from 'recharts';
import { AlertTriangle, TrendingUp, Layers, CheckCircle, BookOpen } from 'lucide-react';

export function DirectorAnalytics() {
  const { data, isLoading, error } = trpc.dashboard.directorAnalytics.useQuery(undefined, {
    refetchOnMount: 'always',
    staleTime: 60_000,
  });

  if (error) {
    return (
      <div className="bg-card rounded-xl border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 p-6 text-sm">
        <p className="font-semibold">Не вдалось завантажити аналітику</p>
        <p className="opacity-80 mt-1">{error.message}</p>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="bg-card rounded-xl border border-hairline p-12 text-center text-light text-sm">
        Завантаження…
      </div>
    );
  }

  const { kpis, perWg, funnel, mostAtRisk, velocity } = data;

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi icon={BookOpen} label="Усього в плані" value={kpis.totalStandards} />
        <Kpi icon={TrendingUp} label="В графіку" value={kpis.onTrack} tone="emerald" />
        <Kpi
          icon={AlertTriangle}
          label="З простроченням"
          value={kpis.standardsWithOverdue}
          tone={kpis.standardsWithOverdue > 0 ? 'red' : 'mid'}
        />
        <Kpi
          icon={CheckCircle}
          label="Повністю готові"
          value={kpis.fullyCompleted}
          tone="emerald"
        />
        <Kpi icon={CheckCircle} label="Завершено цей квартал" value={kpis.completedThisQuarter} />
      </div>

      {/* Most at-risk — moved above the charts because the director's
          first question on opening this tab is "what's slipping the
          worst", not "what's the funnel shape". */}
      <div className="bg-card rounded-xl border border-hairline overflow-hidden">
        <div className="px-5 py-3 border-b border-hairline">
          <h3 className="text-sm font-bold text-ink inline-flex items-center gap-2">
            <AlertTriangle size={15} className="text-red-500" />
            Найвища простроченість (топ-5)
          </h3>
        </div>
        {mostAtRisk.length === 0 ? (
          <div className="py-10 text-center text-light text-sm">
            Прострочених стандартів немає 👌
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {mostAtRisk.map((s) => (
              <li key={s.id} className="px-5 py-3 flex items-center gap-3">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: s.wgColor }}
                />
                <span className="font-mono text-xs text-light shrink-0">{s.wgCode}</span>
                <Link
                  href={`/standards/${s.id}`}
                  className="flex-1 text-sm text-ink hover:text-brand truncate"
                >
                  <span className="font-mono text-xs text-light mr-2">{s.code}</span>
                  {s.title}
                </Link>
                <span className="text-xs text-mid shrink-0 tabular-nums">
                  {s.overdue} {s.overdue === 1 ? 'етап' : s.overdue < 5 ? 'етапи' : 'етапів'}
                </span>
                <span className="text-xs font-bold text-red-600 dark:text-red-400 shrink-0 tabular-nums">
                  {s.oldestOverdueDays} дн
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Funnel */}
        <div className="bg-card rounded-xl border border-hairline p-5">
          <h3 className="text-sm font-bold text-ink mb-3 inline-flex items-center gap-2">
            <Layers size={15} /> Розподіл стандартів за поточним етапом
          </h3>
          <div className="h-[240px] -ml-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnel} barCategoryGap={16}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--c-hairline)" vertical={false} />
                <XAxis dataKey="stage" tick={{ fontSize: 11, fill: 'var(--c-mid)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--c-mid)' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--c-card)',
                    border: '1px solid var(--c-hairline)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {funnel.map((entry, i) => (
                    <Cell
                      key={entry.key}
                      fill={
                        entry.key === 'done'
                          ? '#10B981'
                          : i === funnel.length - 2
                            ? '#3B82F6'
                            : '#6366F1'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Velocity */}
        <div className="bg-card rounded-xl border border-hairline p-5">
          <h3 className="text-sm font-bold text-ink mb-3 inline-flex items-center gap-2">
            <TrendingUp size={15} /> Виконано етапів за останні 6 місяців
          </h3>
          <div className="h-[240px] -ml-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={velocity} barCategoryGap={20}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--c-hairline)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--c-mid)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--c-mid)' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--c-card)',
                    border: '1px solid var(--c-hairline)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="#3B82F6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Per-WG table */}
      <div className="bg-card rounded-xl border border-hairline overflow-hidden">
        <div className="px-5 py-3 border-b border-hairline">
          <h3 className="text-sm font-bold text-ink">Підсумок по робочих групах</h3>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm min-w-[680px]">
            <thead className="bg-page border-b border-hairline">
              <tr className="text-left text-xs text-mid uppercase tracking-wide">
                <th className="px-5 py-3 font-medium">РГ</th>
                <th className="px-3 py-3 font-medium text-right">Стандартів</th>
                <th className="px-3 py-3 font-medium text-right">В графіку</th>
                <th className="px-3 py-3 font-medium text-right">З простроченням</th>
                <th className="px-3 py-3 font-medium text-right">Готові</th>
                <th className="px-3 py-3 font-medium text-right">% готовності</th>
                <th className="px-3 py-3 font-medium text-right">Засідань (30 дн)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {perWg.map((w) => {
                const pct = w.total === 0 ? 0 : Math.round((w.completed / w.total) * 100);
                return (
                  <tr key={w.id} className="hover:bg-page transition-colors">
                    <td className="px-5 py-3">
                      <Link
                        href={`/working-groups/${w.id}`}
                        className="inline-flex items-center gap-2 hover:text-brand"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: w.color }}
                        />
                        <span className="font-mono text-xs font-bold text-ink">{w.code}</span>
                        <span className="text-xs text-mid truncate max-w-[200px]">{w.name}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right font-bold text-ink tabular-nums">
                      {w.total}
                    </td>
                    <td className="px-3 py-3 text-right text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {w.onTrack}
                    </td>
                    <td
                      className={`px-3 py-3 text-right tabular-nums font-semibold ${
                        w.overdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-mid'
                      }`}
                    >
                      {w.overdue}
                    </td>
                    <td className="px-3 py-3 text-right text-mid tabular-nums">{w.completed}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-xs text-mid w-9 text-right tabular-nums">{pct}%</span>
                        <div className="w-20 h-1.5 rounded-full bg-pill overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: w.color,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-mid tabular-nums">
                      {w.meetingsLast30d}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import type { LucideIcon } from 'lucide-react';

function Kpi({
  icon: Icon,
  label,
  value,
  tone = 'ink',
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone?: 'ink' | 'emerald' | 'red' | 'mid';
}) {
  const toneCls =
    tone === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'red'
        ? 'text-red-600 dark:text-red-400'
        : tone === 'mid'
          ? 'text-mid'
          : 'text-ink';
  return (
    <div className="bg-card rounded-xl border border-hairline p-4">
      <div className="flex items-center gap-2 text-[11px] text-light uppercase tracking-wider mb-2">
        <Icon size={13} />
        <span className="truncate">{label}</span>
      </div>
      <div className={`text-2xl font-extrabold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}
