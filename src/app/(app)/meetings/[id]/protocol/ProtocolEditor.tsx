'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import {
  Plus,
  Trash2,
  Save,
  Download,
  FileText,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { can } from '@/lib/rbac';
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

interface AgendaDraft {
  id?: string;
  order: number;
  title: string;
  speakerId: string;
  heardText: string;
  discussionText: string;
  decisionText: string;
  deadline: string;
  responsibleId: string;
  open: boolean; // UI state — expanded
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
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!meeting) return;
    setChairmanId(meeting.chairmanId ?? '');
    setItems(
      meeting.agendaItems.map((a, idx) => ({
        id: a.id,
        order: a.order ?? idx + 1,
        title: a.title,
        speakerId: a.speakerId ?? '',
        heardText: a.heardText ?? '',
        discussionText: a.discussionText ?? '',
        decisionText: a.decisionText ?? '',
        deadline: a.deadline ? new Date(a.deadline).toISOString().slice(0, 10) : '',
        responsibleId: a.responsibleId ?? '',
        open: true,
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

  function saveItem(idx: number) {
    const it = items[idx];
    if (!it || !canEdit) return;
    setSavingId(it.id ?? `new-${idx}`);
    const due = it.deadline ? new Date(it.deadline) : null;
    upsertItemMutation.mutate(
      {
        id: it.id,
        meetingId,
        order: it.order,
        title: it.title || `Пункт ${idx + 1}`,
        speakerId: it.speakerId === '' ? null : it.speakerId,
        heardText: it.heardText.trim() || null,
        discussionText: it.discussionText.trim() || null,
        decisionText: it.decisionText.trim() || null,
        deadline: due,
        responsibleId: it.responsibleId === '' ? null : it.responsibleId,
      },
      {
        onSettled: () => setSavingId(null),
      },
    );
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

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        order: prev.length + 1,
        title: '',
        speakerId: '',
        heardText: '',
        discussionText: '',
        decisionText: '',
        deadline: '',
        responsibleId: '',
        open: true,
      },
    ]);
  }

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

      {/* Agenda items */}
      <div className="card overflow-hidden">
        <div className="card-head">
          <h2 className="font-bold text-ink">Порядок денний / Пункти протоколу</h2>
          {canEdit && (
            <button onClick={addItem} className="btn-add">
              <Plus className="w-3.5 h-3.5" />
              Пункт
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="py-12 text-center text-light text-sm">
            Пункти не додано — натисніть «+ Пункт»
          </div>
        ) : (
          <div className="divide-y divide-hairline">
            {items.map((it, idx) => (
              <div key={it.id ?? `new-${idx}`} className="px-5 py-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-bold text-mid w-6 text-center font-mono">
                    {idx + 1}.
                  </span>
                  <input
                    className="input flex-1"
                    placeholder="Тема пункту…"
                    value={it.title}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, title: e.target.value } : p)),
                      )
                    }
                  />
                  <button
                    onClick={() =>
                      setItems((prev) =>
                        prev.map((p, i) => (i === idx ? { ...p, open: !p.open } : p)),
                      )
                    }
                    className="p-1.5 rounded text-mid hover:bg-pill"
                    title={it.open ? 'Згорнути' : 'Розгорнути'}
                  >
                    {it.open ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                  {canEdit && (
                    <>
                      <button
                        onClick={() => saveItem(idx)}
                        disabled={upsertItemMutation.isPending}
                        className="btn-secondary text-xs px-2.5 py-1.5"
                      >
                        {savingId === (it.id ?? `new-${idx}`) ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        {it.id ? 'Зберегти' : 'Створити'}
                      </button>
                      <button
                        onClick={() => removeItem(idx)}
                        className="p-1.5 rounded hover:bg-red-50 text-mid hover:text-red-600"
                        title="Видалити"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {it.open && (
                  <div className="space-y-3 pl-9">
                    <div>
                      <label className="field-label">Доповідач</label>
                      <select
                        className="select"
                        value={it.speakerId}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((p, i) =>
                              i === idx ? { ...p, speakerId: e.target.value } : p,
                            ),
                          )
                        }
                      >
                        <option value="">— не вказано —</option>
                        {members.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {rankPrefix(m.user.rank)}
                            {m.user.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="field-label">СЛУХАЛИ (доповідь)</label>
                      <textarea
                        rows={3}
                        className="textarea resize-none"
                        disabled={!canEdit}
                        value={it.heardText}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((p, i) =>
                              i === idx ? { ...p, heardText: e.target.value } : p,
                            ),
                          )
                        }
                      />
                    </div>

                    <div>
                      <label className="field-label">ВИСТУПИЛИ (обговорення)</label>
                      <textarea
                        rows={3}
                        className="textarea resize-none"
                        disabled={!canEdit}
                        value={it.discussionText}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((p, i) =>
                              i === idx ? { ...p, discussionText: e.target.value } : p,
                            ),
                          )
                        }
                      />
                    </div>

                    <div>
                      <label className="field-label">ВИРІШИЛИ</label>
                      <textarea
                        rows={3}
                        className="textarea resize-none"
                        disabled={!canEdit}
                        value={it.decisionText}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((p, i) =>
                              i === idx ? { ...p, decisionText: e.target.value } : p,
                            ),
                          )
                        }
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="field-label">Термін</label>
                        <input
                          type="date"
                          className="input"
                          disabled={!canEdit}
                          value={it.deadline}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, deadline: e.target.value } : p,
                              ),
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="field-label">Відповідальний</label>
                        <select
                          className="select"
                          disabled={!canEdit}
                          value={it.responsibleId}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, responsibleId: e.target.value } : p,
                              ),
                            )
                          }
                        >
                          <option value="">— не вказано —</option>
                          {members.map((m) => (
                            <option key={m.userId} value={m.userId}>
                              {rankPrefix(m.user.rank)}
                              {m.user.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
