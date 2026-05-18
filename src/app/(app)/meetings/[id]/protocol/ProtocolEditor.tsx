'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import { Download, FileText } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { can } from '@/lib/rbac';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';
import { ProtocolTabs } from './ProtocolTabs';

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

const ATTENDANCE_OPTIONS = [
  { value: 'PENDING', label: 'Очікується' },
  { value: 'CONFIRMED', label: 'Присутній' },
  { value: 'DECLINED', label: 'Відсутній' },
] as const;

const ATT_TONE: Record<string, string> = {
  PENDING: 'pill-amber',
  CONFIRMED: 'pill-green',
  DECLINED: 'pill-rose',
};

export type ProtocolSection = 'AGENDA' | 'HEARD' | 'DECISION';

export interface AgendaDraft {
  id?: string;
  section: ProtocolSection;
  order: number;
  title: string;
  speakerId: string;
  heardText: string;
  discussionText: string;
  decisionText: string;
  deadline: string;
  responsibleId: string;
  dirty: boolean; // unsaved changes flag
}

function rankPrefix(rank?: string | null) {
  if (!rank) return '';
  const r = RANK_LABELS[rank];
  return r ? `${r} ` : '';
}

function wgNumber(code: string) {
  return /(\d+)/.exec(code)?.[1] ?? code;
}

export function ProtocolEditor({ meetingId }: { meetingId: string }) {
  const { data: session } = useSession();
  const utils = trpc.useUtils();
  const { data: meeting, isLoading } = trpc.meeting.byId.useQuery({ id: meetingId });

  const [items, setItems] = useState<AgendaDraft[]>([]);
  const [chairmanId, setChairmanId] = useState('');
  const [savingAll, setSavingAll] = useState(false);

  useEffect(() => {
    if (!meeting) return;
    setChairmanId(meeting.chairmanId ?? '');
    setItems(
      meeting.agendaItems.map((a, idx) => ({
        id: a.id,
        section: a.section ?? 'AGENDA',
        order: a.order ?? idx + 1,
        title: a.title,
        speakerId: a.speakerId ?? '',
        heardText: a.heardText ?? '',
        discussionText: a.discussionText ?? '',
        decisionText: a.decisionText ?? '',
        deadline: a.deadline ? new Date(a.deadline).toISOString().slice(0, 10) : '',
        responsibleId: a.responsibleId ?? '',
        dirty: false,
      })),
    );
  }, [meeting]);

  const userCtx = useMemo(() => {
    if (!session?.user) return null;
    return {
      globalRole: session.user.globalRole as GlobalRole,
      memberships: (session.user.memberships ?? []) as {
        workingGroupId: string;
        role: WorkingGroupRole;
      }[],
    };
  }, [session]);

  const canEdit = useMemo(() => {
    if (!userCtx || !meeting) return false;
    if (userCtx.globalRole === 'ADMIN') return true;
    return can(userCtx, 'meeting:uploadMinutes', meeting.workingGroup.id);
  }, [userCtx, meeting]);

  const upsertItemMutation = trpc.meeting.upsertAgendaItem.useMutation({
    onSuccess: () => void utils.meeting.byId.invalidate({ id: meetingId }),
  });
  const deleteItemMutation = trpc.meeting.deleteAgendaItem.useMutation({
    onSuccess: () => void utils.meeting.byId.invalidate({ id: meetingId }),
  });
  const updateMeetingMutation = trpc.meeting.update.useMutation({
    onSuccess: () => void utils.meeting.byId.invalidate({ id: meetingId }),
  });
  const setAttendanceMutation = trpc.meeting.setAttendance.useMutation({
    onSuccess: () => void utils.meeting.byId.invalidate({ id: meetingId }),
  });
  const assignProtoMutation = trpc.meeting.assignProtocolNumber.useMutation({
    onSuccess: () => void utils.meeting.byId.invalidate({ id: meetingId }),
  });

  async function saveAll() {
    if (!canEdit) return;
    const dirty = items.filter((it) => it.dirty || !it.id);
    if (dirty.length === 0) return;
    setSavingAll(true);
    try {
      for (const it of dirty) {
        const due = it.deadline ? new Date(it.deadline) : null;
        // eslint-disable-next-line no-await-in-loop
        const saved = await upsertItemMutation.mutateAsync({
          id: it.id,
          meetingId,
          order: it.order,
          section: it.section,
          title: it.title || `Пункт ${it.order}`,
          speakerId: it.speakerId === '' ? null : it.speakerId,
          heardText: it.heardText.trim() || null,
          discussionText: it.discussionText.trim() || null,
          decisionText: it.decisionText.trim() || null,
          deadline: due,
          responsibleId: it.responsibleId === '' ? null : it.responsibleId,
        });
        // Replace the draft with the saved version (id + reset dirty flag)
        setItems((prev) =>
          prev.map((p) =>
            p === it || (p.id && p.id === it.id) ? { ...p, id: saved.id, dirty: false } : p,
          ),
        );
      }
    } finally {
      setSavingAll(false);
    }
  }

  function removeItem(idx: number) {
    const it = items[idx];
    if (!it) return;
    if (it.id) {
      if (confirm('Видалити пункт?')) {
        deleteItemMutation.mutate({ id: it.id });
      }
    } else {
      setItems((prev) => prev.filter((_, i) => i !== idx));
    }
  }

  function addItem(section: ProtocolSection) {
    setItems((prev) => {
      const sameSection = prev.filter((p) => p.section === section);
      return [
        ...prev,
        {
          section,
          order: sameSection.length + 1,
          title: '',
          speakerId: '',
          heardText: '',
          discussionText: '',
          decisionText: '',
          deadline: '',
          responsibleId: '',
          dirty: true,
        },
      ];
    });
  }

  const dirtyCount = items.filter((it) => it.dirty || !it.id).length;

  if (isLoading || !meeting) {
    return <div className="py-16 text-center text-light text-sm">Завантаження…</div>;
  }

  const members = meeting.workingGroup.members ?? [];
  const protoNum = meeting.protocolNumber ?? null;
  const wgNum = wgNumber(meeting.workingGroup.code);
  const year = new Date(meeting.startAt).getFullYear();
  const titleStr = protoNum
    ? `ПРОТОКОЛ № ${protoNum}/${wgNum}/${year}`
    : 'ПРОТОКОЛ № (не присвоєно)';

  // Short Ukrainian role labels for the slim attendance sidebar
  const ROLE_SHORT: Record<string, string> = {
    LEADER: 'Керівник',
    DEPUTY: 'Заступник',
    SECRETARY: 'Секретар',
    MEMBER: 'Член РГ',
    GUEST: 'Гість',
  };
  const ROLE_ORDER: Record<string, number> = {
    LEADER: 0,
    DEPUTY: 1,
    SECRETARY: 2,
    MEMBER: 3,
    GUEST: 4,
  };
  const memberRoleByUserId = new Map(members.map((m) => [m.userId, m.role]));
  const rosterSorted = [...meeting.attendances].sort((a, b) => {
    const ra = memberRoleByUserId.get(a.user.id) ?? 'MEMBER';
    const rb = memberRoleByUserId.get(b.user.id) ?? 'MEMBER';
    const dr = (ROLE_ORDER[ra] ?? 99) - (ROLE_ORDER[rb] ?? 99);
    if (dr !== 0) return dr;
    return a.user.name.localeCompare(b.user.name, 'uk');
  });

  return (
    <div className="space-y-5 pg-enter">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-mid">
        <Link href="/meetings" className="hover:text-brand">
          Засідання
        </Link>
        <span>/</span>
        <Link href={`/meetings/${meetingId}`} className="hover:text-brand truncate">
          {meeting.title}
        </Link>
        <span>/</span>
        <span className="text-ink">Протокол</span>
      </nav>

      {/* Header card */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-extrabold text-navy">{titleStr}</h1>
            <p className="text-sm text-mid mt-1">
              {meeting.workingGroup.code} «{meeting.workingGroup.name}»
            </p>
            <p className="text-xs text-light mt-1 font-mono">
              {new Date(meeting.startAt).toLocaleDateString('uk-UA', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}{' '}
              · м. Київ
            </p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {canEdit && !protoNum && (
              <button
                onClick={() => assignProtoMutation.mutate({ meetingId })}
                disabled={assignProtoMutation.isPending}
                className="btn-secondary"
              >
                Присвоїти №
              </button>
            )}
            <a
              href={`/api/meetings/${meetingId}/protocol.docx`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              <FileText className="w-3.5 h-3.5" />
              Word
            </a>
            <a
              href={`/api/meetings/${meetingId}/protocol`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              <Download className="w-3.5 h-3.5" />
              PDF
            </a>
          </div>
        </div>

        {/* Chairman selector */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5 pt-4 border-t border-hairline">
          <div>
            <label className="field-label">Головуючий</label>
            <select
              className="select"
              value={chairmanId}
              onChange={(e) => {
                const next = e.target.value;
                setChairmanId(next);
                if (canEdit) {
                  updateMeetingMutation.mutate({
                    id: meetingId,
                    chairmanId: next === '' ? null : next,
                  });
                }
              }}
              disabled={!canEdit}
            >
              <option value="">(керівник РГ за замовчуванням)</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {rankPrefix(m.user.rank)}
                  {m.user.name}
                  {m.role === 'LEADER' ? ' · Керівник' : ''}
                  {m.role === 'DEPUTY' ? ' · Заступник' : ''}
                  {m.role === 'SECRETARY' ? ' · Секретар' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Two-column layout: protocol main + narrow attendance rail.
          Stacks vertically on <lg so the attendance card sits below
          on phones / tablets. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-5 items-start">
        <ProtocolTabs
          items={items}
          members={members}
          chairman={meeting.chairman}
          secretary={meeting.workingGroup.members.find((m) => m.role === 'SECRETARY')?.user ?? null}
          meetingTitle={meeting.title}
          meetingStartAt={meeting.startAt}
          wgCode={meeting.workingGroup.code}
          protocolNumber={meeting.protocolNumber ?? null}
          canEdit={canEdit}
          savingAll={savingAll}
          dirtyCount={dirtyCount}
          onChange={setItems}
          onAdd={addItem}
          onSaveAll={saveAll}
          onRemove={removeItem}
        />

        {/* Narrow attendance rail — role only, no rank/position */}
        <aside className="card overflow-hidden lg:sticky lg:top-4 self-start">
          <div className="card-head !px-3 !py-2.5">
            <h2 className="text-xs font-bold text-ink uppercase tracking-wide">Учасники</h2>
            <span className="text-[11px] text-light tabular-nums">
              {meeting.attendances.filter((a) => a.status === 'CONFIRMED').length} /{' '}
              {meeting.attendances.length}
            </span>
          </div>
          <ul className="divide-y divide-hairline">
            {rosterSorted.length === 0 ? (
              <li className="px-3 py-6 text-center text-light text-xs">Учасників немає</li>
            ) : (
              rosterSorted.map((a) => {
                const wgRole = memberRoleByUserId.get(a.user.id);
                return (
                  <li key={a.user.id} className="px-3 py-2 flex items-center gap-2">
                    <Avatar
                      name={a.user.name}
                      avatarUrl={a.user.avatarUrl ?? undefined}
                      size="xs"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-ink truncate font-medium">{a.user.name}</p>
                      {wgRole && (
                        <p className="text-[10px] text-light truncate">
                          {ROLE_SHORT[wgRole] ?? wgRole}
                        </p>
                      )}
                    </div>
                    {canEdit ? (
                      <select
                        aria-label="Присутність"
                        className="text-[10px] border border-hairline rounded px-1 py-0.5 bg-page text-ink focus:outline-none focus:border-brand"
                        value={a.status}
                        onChange={(e) =>
                          setAttendanceMutation.mutate({
                            meetingId,
                            userId: a.user.id,
                            status: e.target.value as 'PENDING' | 'CONFIRMED' | 'DECLINED',
                          })
                        }
                      >
                        <option value="CONFIRMED">✓</option>
                        <option value="DECLINED">✗</option>
                        <option value="PENDING">—</option>
                      </select>
                    ) : (
                      <span
                        className={`text-[10px] font-bold rounded-full w-5 h-5 inline-flex items-center justify-center ${ATT_TONE[a.status]}`}
                        title={
                          ATTENDANCE_OPTIONS.find((o) => o.value === a.status)?.label ?? a.status
                        }
                      >
                        {a.status === 'CONFIRMED' ? '✓' : a.status === 'DECLINED' ? '✗' : '—'}
                      </span>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </aside>
      </div>
    </div>
  );
}
