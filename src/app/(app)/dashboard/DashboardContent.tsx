'use client';

import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Avatar } from '@/components/ui/Avatar';
import { formatDate, formatDateTime } from '@/lib/utils';

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

export function DashboardContent() {
  const { data: session } = useSession();

  const { data: wgStats, isLoading: loadingStats } = trpc.workingGroup.stats.useQuery({});
  const { data: upcoming } = trpc.meeting.upcomingForUser.useQuery({ limit: 5 });
  const { data: myTasks } = trpc.task.list.useQuery({
    assigneeId: session?.user?.id,
    status: 'OPEN',
  }, { enabled: !!session?.user?.id });
  const { data: recentStandards } = trpc.standard.list.useQuery({ page: 1, pageSize: 8 });

  // Aggregate standards by status across all WGs
  const totalStandards = wgStats?.reduce((sum, g) => sum + g.standardsCount, 0) ?? 0;
  const meetingsPlanned = wgStats?.reduce((sum, g) => sum + g.meetingsPlanned, 0) ?? 0;
  const meetingsDone = wgStats?.reduce((sum, g) => sum + g.meetingsDone, 0) ?? 0;
  const openTasks = myTasks?.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length ?? 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Вітаємо, {session?.user?.name?.split(' ')[0] ?? 'колего'} 👋
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          {new Date().toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Стандартів" value={loadingStats ? '…' : totalStandards} sub="у ваших РГ" color="text-blue-700" />
        <StatCard label="Нарад цього місяця" value={loadingStats ? '…' : meetingsPlanned + meetingsDone} sub={`${meetingsDone} завершено`} color="text-indigo-700" />
        <StatCard label="Моїх завдань" value={openTasks} sub="відкритих" color={openTasks > 0 ? 'text-amber-600' : 'text-slate-600'} />
        <StatCard label="Робочих груп" value={loadingStats ? '…' : (wgStats?.length ?? 0)} sub="членство" color="text-emerald-700" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming meetings */}
        <div className="lg:col-span-1 bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Найближчі наради</h2>
            <Link href="/meetings" className="text-xs text-blue-600 hover:underline">Всі</Link>
          </div>
          <div className="divide-y divide-slate-50">
            {upcoming?.length === 0 && (
              <p className="text-sm text-slate-400 px-5 py-6 text-center">Нарад не заплановано</p>
            )}
            {upcoming?.map((m) => {
              const myAttendance = m.attendances[0];
              return (
                <Link key={m.id} href={`/meetings/${m.id}`} className="flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors">
                  <div
                    className="mt-0.5 w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: m.workingGroup.color }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{m.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{formatDateTime(m.startAt)}</p>
                    {myAttendance && (
                      <span className={`text-xs mt-1 inline-block ${
                        myAttendance.status === 'CONFIRMED' ? 'text-green-600' :
                        myAttendance.status === 'DECLINED' ? 'text-red-500' : 'text-slate-400'
                      }`}>
                        {myAttendance.status === 'CONFIRMED' ? '✓ Підтверджено' :
                         myAttendance.status === 'DECLINED' ? '✗ Відмовлено' : '? Очікує'}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Recent standards */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Останні стандарти</h2>
            <Link href="/standards" className="text-xs text-blue-600 hover:underline">Всі</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
                  <th className="px-5 py-2.5 font-medium">Код / Назва</th>
                  <th className="px-3 py-2.5 font-medium">РГ</th>
                  <th className="px-3 py-2.5 font-medium">Статус</th>
                  <th className="px-3 py-2.5 font-medium">Оновлено</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {recentStandards?.items.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <Link href={`/standards/${s.id}`} className="hover:text-blue-700">
                        <span className="font-mono text-xs text-slate-400 mr-2">{s.code}</span>
                        <span className="font-medium text-slate-800">{s.title}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className="inline-block w-2 h-2 rounded-full mr-1.5"
                        style={{ backgroundColor: s.workingGroup.color }}
                      />
                      <span className="text-xs text-slate-500">{s.workingGroup.code}</span>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={s.status} size="sm" />
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400">
                      {formatDate(s.updatedAt)}
                    </td>
                  </tr>
                ))}
                {recentStandards?.items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-slate-400 text-sm">
                      Стандартів немає
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* My tasks */}
      {(myTasks?.length ?? 0) > 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Мої завдання</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {myTasks?.slice(0, 5).map((task) => (
              <Link
                key={task.id}
                href={`/standards/${task.standardId}`}
                className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50 transition-colors"
              >
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  task.priority === 'HIGH' ? 'bg-red-500' :
                  task.priority === 'MEDIUM' ? 'bg-amber-400' : 'bg-slate-300'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{task.title}</p>
                  <p className="text-xs text-slate-400">{task.standard.code} · {task.standard.workingGroup.code}</p>
                </div>
                {task.dueDate && (
                  <span className={`text-xs flex-shrink-0 ${
                    new Date(task.dueDate) < new Date() ? 'text-red-600 font-medium' : 'text-slate-400'
                  }`}>
                    {formatDate(task.dueDate)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* WG summary */}
      {(wgStats?.length ?? 0) > 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Робочі групи</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {wgStats?.map((g) => (
              <Link
                key={g.id}
                href={`/working-groups/${g.id}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors"
              >
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: g.color }} />
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-slate-800">{g.code}</span>
                  <span className="text-slate-400 text-sm ml-2">{g.name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500 flex-shrink-0">
                  <span>{g.standardsCount} стандартів</span>
                  <span>{g.membersCount} учасників</span>
                  {g.meetingsPlanned > 0 && (
                    <span className="text-blue-600">{g.meetingsPlanned} планових нарад</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
