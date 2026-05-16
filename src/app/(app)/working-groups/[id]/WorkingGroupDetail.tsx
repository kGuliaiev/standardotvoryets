'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Avatar } from '@/components/ui/Avatar';
import { RankBadge } from '@/components/ui/RankBadge';
import { rankLabel } from '@/lib/ranks';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatDate } from '@/lib/utils';
import { can } from '@/lib/rbac';
import { useEscape } from '@/lib/useEscape';
import { Archive, ArchiveRestore } from 'lucide-react';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';

const TABS = [
  { id: 'info', label: 'Інформація' },
  { id: 'members', label: 'Учасники' },
  { id: 'standards', label: 'Стандарти' },
  { id: 'meetings', label: 'Засідання' },
  { id: 'documents', label: 'Документи' },
] as const;

const DOC_TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  DRAFT_STANDARD: { label: 'Чернетка', cls: 'bg-[#EEF4FF] text-[#1A3A8F]' },
  MEETING_MINUTES: { label: 'Протокол', cls: 'bg-[#ECFDF5] text-[#065F46]' },
  AGENDA: { label: 'Порядок денний', cls: 'bg-[#FFF7E6] text-[#92400E]' },
  ATTACHMENT: { label: 'Додаток', cls: 'bg-[#EDF0F7] text-[#4B5880]' },
  FINAL: { label: 'Фінальна версія', cls: 'bg-violet-50 text-violet-700' },
};

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

type TabId = (typeof TABS)[number]['id'];

const ROLE_OPTIONS: { value: WorkingGroupRole; label: string }[] = [
  { value: 'LEADER', label: 'Керівник РГ' },
  { value: 'DEPUTY', label: 'Заступник керівника' },
  { value: 'SECRETARY', label: 'Секретар' },
  { value: 'MEMBER', label: 'Учасник' },
  { value: 'GUEST', label: 'Гість / Спостерігач' },
];

const FORMAT_LABELS: Record<string, string> = {
  ONLINE: 'Онлайн',
  OFFLINE: 'Офлайн',
  HYBRID: 'Гібрид',
};

const MEETING_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PLANNED: { label: 'Заплановано', cls: 'bg-blue-50 text-blue-700' },
  IN_PROGRESS: { label: 'Проводиться', cls: 'bg-amber-50 text-amber-700' },
  COMPLETED: { label: 'Завершено', cls: 'bg-green-50 text-green-700' },
  CANCELLED: { label: 'Скасовано', cls: 'bg-pill text-light' },
};

interface Props {
  id: string;
}

export function WorkingGroupDetail({ id }: Props) {
  const { data: session } = useSession();
  const [tab, setTab] = useState<TabId>('info');
  const [showAddMember, setShowAddMember] = useState(false);
  const [showEditName, setShowEditName] = useState(false);
  const [addForm, setAddForm] = useState({ email: '', role: 'MEMBER' as WorkingGroupRole });
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [addError, setAddError] = useState('');

  const utils = trpc.useUtils();
  const { data: group, isLoading } = trpc.workingGroup.byId.useQuery({ id });
  const { data: standards } = trpc.standard.list.useQuery(
    { workingGroupId: id, page: 1, pageSize: 50 },
    { enabled: tab === 'standards' },
  );
  const { data: meetings } = trpc.meeting.list.useQuery(
    { workingGroupId: id },
    { enabled: tab === 'meetings' },
  );
  const { data: docsBundle } = trpc.document.byWorkingGroup.useQuery(
    { workingGroupId: id },
    { enabled: tab === 'documents' },
  );

  const inviteMutation = trpc.user.invite.useMutation({
    onSuccess: () => {
      void utils.workingGroup.byId.invalidate({ id });
      setShowAddMember(false);
      setAddForm({ email: '', role: 'MEMBER' });
      setAddError('');
    },
    onError: (e) => setAddError(e.message),
  });

  const removeMutation = trpc.workingGroup.removeMember.useMutation({
    onSuccess: () => void utils.workingGroup.byId.invalidate({ id }),
  });

  const changeRoleMutation = trpc.workingGroup.changeMemberRole.useMutation({
    onSuccess: () => void utils.workingGroup.byId.invalidate({ id }),
  });

  const updateMutation = trpc.workingGroup.update.useMutation({
    onSuccess: () => {
      void utils.workingGroup.byId.invalidate({ id });
      setShowEditName(false);
    },
  });

  const router = useRouter();
  const archiveMutation = trpc.workingGroup.setArchived.useMutation({
    onSuccess: () => {
      void utils.workingGroup.list.invalidate();
      router.push('/working-groups');
    },
  });

  useEscape(showAddMember, () => {
    setShowAddMember(false);
    setAddError('');
  });
  useEscape(showEditName, () => setShowEditName(false));

  if (isLoading) {
    return <div className="py-16 text-center text-light text-sm">Завантаження…</div>;
  }
  if (!group) {
    return <div className="py-16 text-center text-light text-sm">Групу не знайдено</div>;
  }

  const userCtx = session
    ? {
        globalRole: session.user.globalRole as GlobalRole,
        memberships: (session.user.memberships ?? []) as {
          workingGroupId: string;
          role: WorkingGroupRole;
        }[],
      }
    : null;
  const isAdmin = session?.user.globalRole === 'ADMIN';
  const canInvite = userCtx ? isAdmin || can(userCtx, 'wg:invite', id) : false;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/working-groups"
            className="text-light hover:text-mid text-sm transition-colors"
          >
            ← Робочі групи
          </Link>
          <span className="text-slate-200">/</span>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: group.color }} />
            <span className="font-mono text-sm text-mid">{group.code}</span>
            <h1 className="text-xl font-bold text-ink">{group.name}</h1>
          </div>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button
              onClick={() => {
                if (
                  confirm(`${group.isArchived ? 'Відновити' : 'Архівувати'} групу "${group.name}"?`)
                ) {
                  archiveMutation.mutate({ id, isArchived: !group.isArchived });
                }
              }}
              disabled={archiveMutation.isPending}
              className="text-xs text-mid hover:text-ink border border-hairline rounded-lg px-3 py-1.5 hover:bg-page transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {group.isArchived ? (
                <ArchiveRestore className="w-3.5 h-3.5" />
              ) : (
                <Archive className="w-3.5 h-3.5" />
              )}
              {group.isArchived ? 'Відновити' : 'Архівувати'}
            </button>
          )}
          {canInvite && (
            <button
              onClick={() => {
                setEditForm({ name: group.name, description: group.description ?? '' });
                setShowEditName(true);
              }}
              className="text-xs text-light hover:text-mid border border-hairline rounded-lg px-3 py-1.5 hover:bg-page transition-colors"
            >
              Редагувати
            </button>
          )}
        </div>
      </div>

      {/* Archived banner */}
      {group.isArchived && (
        <div className="rounded-[10px] border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-2.5">
          Цю робочу групу архівовано. Дії над нею недоступні.
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-hairline">
        <div className="flex gap-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-mid hover:text-ink hover:border-slate-300'
              }`}
            >
              {t.label}
              {t.id === 'members' && (
                <span className="ml-1.5 text-xs bg-pill text-mid rounded-full px-1.5 py-0.5">
                  {group.members.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'info' && (
        <div className="bg-card rounded-xl border border-hairline p-6 space-y-5">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-light uppercase tracking-wide mb-1">Код</p>
              <p className="font-mono font-semibold text-ink">{group.code}</p>
            </div>
            <div>
              <p className="text-xs text-light uppercase tracking-wide mb-1">Колір</p>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded" style={{ backgroundColor: group.color }} />
                <span className="font-mono text-sm text-mid">{group.color}</span>
              </div>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-light uppercase tracking-wide mb-1">Назва</p>
              <p className="font-semibold text-ink">{group.name}</p>
            </div>
            {group.description && (
              <div className="col-span-2">
                <p className="text-xs text-light uppercase tracking-wide mb-1">Опис</p>
                <p className="text-sm text-mid leading-relaxed">{group.description}</p>
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-hairline">
            <div className="text-center">
              <p className="text-2xl font-bold text-ink">{group.members.length}</p>
              <p className="text-xs text-light mt-0.5">Учасників</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-ink">{group._count.standards}</p>
              <p className="text-xs text-light mt-0.5">Стандартів</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-ink">{group._count.meetings}</p>
              <p className="text-xs text-light mt-0.5">Засідань</p>
            </div>
          </div>
        </div>
      )}

      {tab === 'members' && (
        <div className="bg-card rounded-xl border border-hairline overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-hairline">
            <span className="text-sm font-medium text-ink">
              {group.members.length} учасник
              {group.members.length === 1 ? '' : group.members.length < 5 ? 'и' : 'ів'}
            </span>
            {canInvite && (
              <button
                onClick={() => setShowAddMember(true)}
                className="text-xs bg-blue-700 text-white px-3 py-1.5 rounded-lg hover:bg-blue-800 transition-colors font-medium"
              >
                + Додати учасника
              </button>
            )}
          </div>

          {/* Members list */}
          {group.members.length === 0 ? (
            <div className="py-12 text-center text-light text-sm">Учасників немає</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-page border-b border-hairline">
                <tr className="text-left text-xs text-mid uppercase tracking-wide">
                  <th className="px-5 py-3 font-medium">Учасник</th>
                  <th className="px-3 py-3 font-medium">Email</th>
                  <th className="px-3 py-3 font-medium">Роль</th>
                  <th className="px-3 py-3 font-medium">З</th>
                  {canInvite && <th className="px-3 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {group.members.map((m) => (
                  <tr key={m.userId} className="hover:bg-page transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={m.user.name} size="sm" />
                        <div className="min-w-0">
                          <p className="font-medium text-ink flex items-center gap-1.5 flex-wrap">
                            <RankBadge rank={m.user.rank} variant="icon" />
                            {m.user.rank && m.user.rank !== 'CIVILIAN' && (
                              <span className="text-xs text-mid font-normal">
                                {rankLabel(m.user.rank)}
                              </span>
                            )}
                            <span>{m.user.name}</span>
                          </p>
                          {m.user.position && (
                            <p
                              className="text-[11px] text-light line-clamp-1 mt-0.5"
                              title={m.user.position}
                            >
                              {m.user.position}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-mid text-xs">{m.user.email}</td>
                    <td className="px-3 py-3">
                      {canInvite && session?.user.id !== m.userId ? (
                        <select
                          value={m.role}
                          onChange={(e) =>
                            changeRoleMutation.mutate({
                              workingGroupId: id,
                              userId: m.userId,
                              role: e.target.value as WorkingGroupRole,
                            })
                          }
                          className="text-xs border border-hairline rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs bg-pill text-mid px-2 py-1 rounded-full">
                          {ROLE_OPTIONS.find((o) => o.value === m.role)?.label ?? m.role}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-light">{formatDate(m.joinedAt)}</td>
                    {canInvite && (
                      <td className="px-3 py-3 text-right">
                        {session?.user.id !== m.userId && (
                          <button
                            onClick={() => {
                              if (confirm(`Видалити ${m.user.name} з групи?`)) {
                                removeMutation.mutate({ workingGroupId: id, userId: m.userId });
                              }
                            }}
                            className="text-xs text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded hover:bg-red-50"
                          >
                            Видалити
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'standards' && (
        <div className="bg-card rounded-xl border border-hairline overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-hairline">
            <span className="text-sm font-medium text-ink">Стандарти групи</span>
            <Link
              href={`/standards/new?wg=${id}`}
              className="text-xs bg-blue-700 text-white px-3 py-1.5 rounded-lg hover:bg-blue-800 transition-colors font-medium"
            >
              + Новий стандарт
            </Link>
          </div>
          {!standards || standards.items.length === 0 ? (
            <div className="py-12 text-center text-light text-sm">Стандартів немає</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-page border-b border-hairline">
                <tr className="text-left text-xs text-mid uppercase tracking-wide">
                  <th className="px-5 py-3 font-medium">Код / Назва</th>
                  <th className="px-3 py-3 font-medium">Статус</th>
                  <th className="px-3 py-3 font-medium">Прогрес</th>
                  <th className="px-3 py-3 font-medium">Дедлайн</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {standards.items.map((s) => (
                  <tr key={s.id} className="hover:bg-page transition-colors">
                    <td className="px-5 py-3.5 max-w-xs">
                      <Link href={`/standards/${s.id}`} className="block group">
                        <span className="font-mono text-xs text-light group-hover:text-blue-500">
                          {s.code}
                        </span>
                        <p className="font-medium text-ink group-hover:text-blue-700 line-clamp-1 mt-0.5">
                          {s.title}
                        </p>
                      </Link>
                    </td>
                    <td className="px-3 py-3.5">
                      <StatusBadge status={s.status} size="sm" />
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-pill rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${s.progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-light">{s.progress}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-xs text-mid">
                      {s.deadline ? formatDate(s.deadline) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'meetings' && (
        <div className="bg-card rounded-xl border border-hairline overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-hairline">
            <span className="text-sm font-medium text-ink">Засідання групи</span>
            <Link
              href={`/meetings/new?wg=${id}`}
              className="text-xs bg-blue-700 text-white px-3 py-1.5 rounded-lg hover:bg-blue-800 transition-colors font-medium"
            >
              + Нове засідання
            </Link>
          </div>
          {!meetings || meetings.length === 0 ? (
            <div className="py-12 text-center text-light text-sm">Засідань немає</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-page border-b border-hairline">
                <tr className="text-left text-xs text-mid uppercase tracking-wide">
                  <th className="px-5 py-3 font-medium">Тема</th>
                  <th className="px-3 py-3 font-medium">Дата</th>
                  <th className="px-3 py-3 font-medium">Формат</th>
                  <th className="px-3 py-3 font-medium">Статус</th>
                  <th className="px-3 py-3 font-medium">Учасники</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {meetings.map((m) => {
                  const s = MEETING_STATUS_LABELS[m.status] ?? { label: m.status, cls: '' };
                  return (
                    <tr key={m.id} className="hover:bg-page transition-colors">
                      <td className="px-5 py-3.5 max-w-xs">
                        <Link
                          href={`/meetings/${m.id}`}
                          className="font-medium text-ink hover:text-blue-700 line-clamp-1"
                        >
                          {m.title}
                        </Link>
                      </td>
                      <td className="px-3 py-3.5 text-xs text-mid">{formatDate(m.startAt)}</td>
                      <td className="px-3 py-3.5 text-xs text-mid">
                        {FORMAT_LABELS[m.format] ?? m.format}
                      </td>
                      <td className="px-3 py-3.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>
                          {s.label}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-xs text-light">{m._count.attendances}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'documents' && (
        <div className="space-y-5">
          {/* Documents */}
          <div className="card overflow-hidden">
            <div className="card-head">
              <h3 className="font-bold text-ink">
                Документи стандартів
                <span className="ml-2 text-xs text-light font-normal">
                  ({docsBundle?.documents.length ?? 0})
                </span>
              </h3>
            </div>
            {!docsBundle ? (
              <div className="py-10 text-center text-light text-sm">Завантаження…</div>
            ) : docsBundle.documents.length === 0 ? (
              <div className="py-10 text-center text-light text-sm">
                У стандартах цієї групи ще немає завантажених документів
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[#FAFBFD] border-b border-hairline">
                  <tr className="text-left text-[10px] text-light uppercase tracking-wide">
                    <th className="px-5 py-2.5 font-bold">Файл</th>
                    <th className="px-3 py-2.5 font-bold">Тип</th>
                    <th className="px-3 py-2.5 font-bold">Стандарт</th>
                    <th className="px-3 py-2.5 font-bold">Версія</th>
                    <th className="px-3 py-2.5 font-bold">Розмір</th>
                    <th className="px-3 py-2.5 font-bold">Завантажив</th>
                    <th className="px-3 py-2.5 font-bold">Дата / час</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {docsBundle.documents.map((d) => {
                    const tInfo = DOC_TYPE_LABELS[d.type] ?? {
                      label: d.type,
                      cls: 'bg-pill text-mid',
                    };
                    const ext = d.filename.split('.').pop()?.toUpperCase().slice(0, 4) ?? '';
                    return (
                      <tr key={d.id} className="hover:bg-[#FAFBFD]">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-brand-soft text-brand rounded-[8px] flex items-center justify-center text-[10px] font-bold shrink-0">
                              {ext}
                            </div>
                            <span className="text-ink font-medium truncate max-w-[260px]">
                              {d.filename}
                            </span>
                            {d.isCurrent && (
                              <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-[#ECFDF5] text-[#065F46]">
                                Актуальний
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${tInfo.cls}`}
                          >
                            {tInfo.label}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <Link
                            href={`/standards/${d.standard.id}`}
                            className="font-mono text-xs text-mid hover:text-brand"
                          >
                            {d.standard.code}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-xs text-mid font-mono">{d.version ?? '—'}</td>
                        <td className="px-3 py-3 text-xs text-mid">{formatBytes(d.sizeBytes)}</td>
                        <td className="px-3 py-3 text-xs text-mid">{d.uploadedBy.name}</td>
                        <td className="px-3 py-3 text-xs text-light font-mono">
                          {new Date(d.uploadedAt).toLocaleString('uk-UA', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Protocols */}
          <div className="card overflow-hidden">
            <div className="card-head">
              <h3 className="font-bold text-ink">
                Протоколи засідань
                <span className="ml-2 text-xs text-light font-normal">
                  ({docsBundle?.protocols.length ?? 0})
                </span>
              </h3>
            </div>
            {!docsBundle ? (
              <div className="py-10 text-center text-light text-sm">Завантаження…</div>
            ) : docsBundle.protocols.length === 0 ? (
              <div className="py-10 text-center text-light text-sm">
                Протоколів ще немає. Додавайте їх на сторінці засідання.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[#FAFBFD] border-b border-hairline">
                  <tr className="text-left text-[10px] text-light uppercase tracking-wide">
                    <th className="px-5 py-2.5 font-bold">Засідання</th>
                    <th className="px-3 py-2.5 font-bold">Дата засідання</th>
                    <th className="px-3 py-2.5 font-bold">Записав</th>
                    <th className="px-3 py-2.5 font-bold">Оновлено</th>
                    <th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {docsBundle.protocols.map((p) => (
                    <tr key={p.id} className="hover:bg-[#FAFBFD]">
                      <td className="px-5 py-3 font-medium text-ink">
                        <Link href={`/meetings/${p.id}`} className="hover:text-brand">
                          {p.meetingTitle}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-xs text-mid font-mono">
                        {new Date(p.meetingDate).toLocaleDateString('uk-UA')}
                      </td>
                      <td className="px-3 py-3 text-xs text-mid">{p.uploadedBy.name}</td>
                      <td className="px-3 py-3 text-xs text-light font-mono">
                        {new Date(p.updatedAt).toLocaleString('uk-UA', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link
                          href={`/meetings/${p.id}`}
                          className="text-xs text-brand hover:underline"
                        >
                          Відкрити →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Add member modal */}
      {showAddMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-ink mb-4">Додати учасника</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-mid mb-1">Email *</label>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-mid mb-1">Роль</label>
                <select
                  value={addForm.role}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, role: e.target.value as WorkingGroupRole }))
                  }
                  className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {addError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{addError}</p>
              )}
              <p className="text-xs text-light">
                Якщо користувач ще не зареєстрований — буде надіслано запрошення на email.
              </p>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => {
                    setShowAddMember(false);
                    setAddError('');
                  }}
                  className="flex-1 py-2 text-sm border border-hairline rounded-lg hover:bg-page transition-colors"
                >
                  Скасувати
                </button>
                <button
                  onClick={() => {
                    if (!addForm.email) return;
                    inviteMutation.mutate({
                      email: addForm.email,
                      workingGroupId: id,
                      role: addForm.role,
                    });
                  }}
                  disabled={inviteMutation.isPending || !addForm.email}
                  className="flex-1 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors font-medium"
                >
                  {inviteMutation.isPending ? 'Додавання…' : 'Додати'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit group modal */}
      {showEditName && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-card rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-semibold text-ink mb-4">Редагувати групу</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-mid mb-1">Назва</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-mid mb-1">Опис</label>
                <textarea
                  rows={3}
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowEditName(false)}
                  className="flex-1 py-2 text-sm border border-hairline rounded-lg hover:bg-page transition-colors"
                >
                  Скасувати
                </button>
                <button
                  onClick={() =>
                    updateMutation.mutate({
                      id,
                      name: editForm.name,
                      description: editForm.description,
                    })
                  }
                  disabled={updateMutation.isPending}
                  className="flex-1 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 transition-colors font-medium"
                >
                  {updateMutation.isPending ? 'Збереження…' : 'Зберегти'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
