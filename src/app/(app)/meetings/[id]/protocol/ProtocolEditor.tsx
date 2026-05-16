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

  return (
    <div className="space-y-5 pg-enter max-w-5xl">
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
                setChairmanId(e.target.value);
                if (canEdit) {
                  updateMeetingMutation.mutate({
                    id: meetingId,
                    title: meeting.title,
                  });
                  // chairman update would need a meeting.setChairman procedure
                  // For now we just keep the chairman dropdown — Word/PDF look up leader otherwise.
                }
              }}
              disabled={!canEdit}
            >
              <option value="">(керівник РГ за замовчуванням)</option>
              {members
                .filter((m) => m.role === 'LEADER' || m.role === 'DEPUTY')
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {rankPrefix(m.user.rank)}
                    {m.user.name}
                  </option>
                ))}
            </select>
          </div>
        </div>
      </div>

      {/* Attendance */}
      <div className="card overflow-hidden">
        <div className="card-head">
          <h2 className="font-bold text-ink">Присутність</h2>
          <span className="text-[11px] text-light">
            {meeting.attendances.filter((a) => a.status === 'CONFIRMED').length} /{' '}
            {meeting.attendances.length}
          </span>
        </div>
        <div className="divide-y divide-hairline">
          {meeting.attendances.length === 0 ? (
            <div className="px-5 py-8 text-center text-light text-sm">Учасників немає</div>
          ) : (
            meeting.attendances.map((a) => (
              <div key={a.user.id} className="px-5 py-3 flex items-center gap-3">
                <Avatar name={a.user.name} avatarUrl={a.user.avatarUrl ?? undefined} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">
                    {rankPrefix(a.user.rank)}
                    {a.user.name}
                  </p>
                  {a.user.position && (
                    <p className="text-[11px] text-light truncate">{a.user.position}</p>
                  )}
                </div>
                {canEdit ? (
                  <select
                    className="select w-[160px] text-xs"
                    value={a.status}
                    onChange={(e) =>
                      setAttendanceMutation.mutate({
                        meetingId,
                        userId: a.user.id,
                        status: e.target.value as 'PENDING' | 'CONFIRMED' | 'DECLINED',
                      })
                    }
                  >
                    {ATTENDANCE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span
                    className={`text-[11px] font-bold rounded-full px-2.5 py-1 ${ATT_TONE[a.status]}`}
                  >
                    {ATTENDANCE_OPTIONS.find((o) => o.value === a.status)?.label ?? a.status}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Agenda items — tabbed: overview / агенда / слухали / вирішили */}
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
    </div>
  );
}
