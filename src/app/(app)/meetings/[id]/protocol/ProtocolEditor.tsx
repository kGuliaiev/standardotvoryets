'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc/client';
import { useSession } from 'next-auth/react';
import { Download, FileText, Sparkles, ChevronDown, Loader2 } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
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
  speakerName: string; // free-text доповідач (коли немає у складі РГ)
  heardText: string;
  discussionText: string;
  decisionText: string;
  deadline: string;
  responsibleId: string;
  responsibleName: string; // free-text відповідальний
  dirty: boolean; // unsaved changes flag
}

/** Shape returned by meeting.generateProtocolDraft (kept local to avoid a
 *  client import of the server AI module). */
interface AiProtocolDraft {
  agenda: { title: string; speakerId: string | null; speakerName: string | null }[];
  heard: {
    title: string;
    speakerId: string | null;
    speakerName: string | null;
    heardText: string;
    discussionText: string;
  }[];
  decisions: {
    title: string;
    decisionText: string;
    deadline: string | null;
    responsibleId: string | null;
    responsibleName: string | null;
  }[];
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
  // AI draft flow: bump aiPanelKey to remount (collapse + clear) the panel;
  // pendingDraft holds a generated draft awaiting the replace/append choice.
  const [aiPanelKey, setAiPanelKey] = useState(0);
  const [pendingDraft, setPendingDraft] = useState<AiProtocolDraft | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AgendaDraft | null>(null);

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
        speakerName: a.speakerName ?? '',
        heardText: a.heardText ?? '',
        discussionText: a.discussionText ?? '',
        decisionText: a.decisionText ?? '',
        deadline: a.deadline ? new Date(a.deadline).toISOString().slice(0, 10) : '',
        responsibleId: a.responsibleId ?? '',
        responsibleName: a.responsibleName ?? '',
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

  // Separate permission for the AI-draft button (configurable in
  // /admin/permissions). Editing rights are still required to auto-save.
  const canAiDraft = useMemo(() => {
    if (!userCtx || !meeting) return false;
    if (userCtx.globalRole === 'ADMIN') return true;
    return can(userCtx, 'meeting:generateAiDraft', meeting.workingGroup.id);
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

  function payloadFor(it: AgendaDraft) {
    return {
      id: it.id,
      meetingId,
      order: it.order,
      section: it.section,
      title: it.title || `Пункт ${it.order}`,
      speakerId: it.speakerId === '' ? null : it.speakerId,
      speakerName: it.speakerName.trim() || null,
      heardText: it.heardText.trim() || null,
      discussionText: it.discussionText.trim() || null,
      decisionText: it.decisionText.trim() || null,
      deadline: it.deadline ? new Date(it.deadline) : null,
      responsibleId: it.responsibleId === '' ? null : it.responsibleId,
      responsibleName: it.responsibleName.trim() || null,
    };
  }

  async function saveAll() {
    if (!canEdit) return;
    const dirty = items.filter((it) => it.dirty || !it.id);
    if (dirty.length === 0) return;
    setSavingAll(true);
    try {
      for (const it of dirty) {
        // eslint-disable-next-line no-await-in-loop
        const saved = await upsertItemMutation.mutateAsync(payloadFor(it));
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
      // Saved item — confirm via the shared modal before the destructive delete.
      setPendingDelete(it);
    } else {
      // Unsaved draft row — just drop it from state, no confirmation needed.
      setItems((prev) => prev.filter((_, i) => i !== idx));
    }
  }

  /** Convert an AI draft into editor rows (all new + dirty). Order continues
   *  after whatever already exists in each section of `base`. */
  function draftToRows(draft: AiProtocolDraft, base: AgendaDraft[]): AgendaDraft[] {
    const blank = {
      speakerId: '',
      speakerName: '',
      heardText: '',
      discussionText: '',
      decisionText: '',
      deadline: '',
      responsibleId: '',
      responsibleName: '',
    };
    let aOrd = base.filter((p) => p.section === 'AGENDA').length;
    let hOrd = base.filter((p) => p.section === 'HEARD').length;
    let dOrd = base.filter((p) => p.section === 'DECISION').length;
    const rows: AgendaDraft[] = [];
    for (const a of draft.agenda) {
      rows.push({
        ...blank,
        section: 'AGENDA',
        order: ++aOrd,
        title: a.title,
        speakerId: a.speakerId ?? '',
        speakerName: a.speakerName ?? '',
        dirty: true,
      });
    }
    for (const h of draft.heard) {
      rows.push({
        ...blank,
        section: 'HEARD',
        order: ++hOrd,
        title: h.title,
        speakerId: h.speakerId ?? '',
        speakerName: h.speakerName ?? '',
        heardText: h.heardText,
        discussionText: h.discussionText,
        dirty: true,
      });
    }
    for (const d of draft.decisions) {
      rows.push({
        ...blank,
        section: 'DECISION',
        order: ++dOrd,
        title: d.title,
        decisionText: d.decisionText,
        deadline: d.deadline ?? '',
        responsibleId: d.responsibleId ?? '',
        responsibleName: d.responsibleName ?? '',
        dirty: true,
      });
    }
    return rows;
  }

  /** Insert an AI draft and persist immediately. `replace` first deletes the
   *  existing protocol items; `append` keeps them and adds after. Always
   *  collapses + clears the AI panel afterwards. */
  async function applyAndSave(draft: AiProtocolDraft, mode: 'replace' | 'append') {
    if (!canEdit) return;
    setSavingAll(true);
    setAiNote(null);
    try {
      if (mode === 'replace') {
        const ids = items.filter((it) => it.id).map((it) => it.id!);
        for (const id of ids) {
          // eslint-disable-next-line no-await-in-loop
          await deleteItemMutation.mutateAsync({ id });
        }
      }
      const base = mode === 'replace' ? [] : items;
      const rows = draftToRows(draft, base);
      setItems([...base, ...rows]);
      for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop
        const saved = await upsertItemMutation.mutateAsync(payloadFor(row));
        setItems((prev) => prev.map((p) => (p === row ? { ...p, id: saved.id, dirty: false } : p)));
      }
      await utils.meeting.byId.invalidate({ id: meetingId });
      setAiNote(
        mode === 'replace'
          ? `Протокол замінено ШІ-чернеткою (${rows.length} пунктів). Збережено.`
          : `Додано ${rows.length} пунктів зі ШІ-чернетки. Збережено.`,
      );
    } finally {
      setSavingAll(false);
      setAiPanelKey((k) => k + 1); // collapse + clear the AI panel
    }
  }

  /** Called when the AI panel returns a draft. If the protocol already has
   *  items, ask replace-or-append; otherwise insert + save straight away. */
  function handleGenerated(draft: AiProtocolDraft) {
    setAiNote(null);
    if (items.length > 0) {
      setPendingDraft(draft);
    } else {
      void applyAndSave(draft, 'append');
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
          speakerName: '',
          heardText: '',
          discussionText: '',
          decisionText: '',
          deadline: '',
          responsibleId: '',
          responsibleName: '',
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

  // For the assembled "Текст протоколу" view (mirrors the Word/PDF export):
  // chairman = explicit chairman else the WG leader; present = confirmed
  // attendees minus the chairman & secretary (listed separately above).
  const secretaryUser = members.find((m) => m.role === 'SECRETARY')?.user ?? null;
  const leaderUser = members.find((m) => m.role === 'LEADER')?.user ?? null;
  const chairmanForView = meeting.chairman ?? leaderUser;
  const presentNames = meeting.attendances
    .filter(
      (a) =>
        a.status === 'CONFIRMED' &&
        a.user.id !== chairmanForView?.id &&
        a.user.id !== secretaryUser?.id,
    )
    .map((a) => a.user.name);
  // External presenters (free-text speakers not in the WG roster) were present
  // too — add their names to «Присутні» so a доповідач never goes unlisted.
  const extraPresent = Array.from(
    new Set(
      items
        .filter((it) => it.section === 'AGENDA' || it.section === 'HEARD')
        .map((it) => it.speakerName.trim())
        .filter((n) => n.length > 0),
    ),
  ).filter((n) => !presentNames.includes(n));
  const presentAll = [...presentNames, ...extraPresent];

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

      {/* Header card — compact two-row layout */}
      <div className="card px-5 py-3.5">
        {/* Row 1: number (left) · WG name (center) · download buttons (right) */}
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <h1 className="text-[17px] font-extrabold text-navy whitespace-nowrap">{titleStr}</h1>
          <p className="text-sm text-mid text-center truncate min-w-0">
            {meeting.workingGroup.code} «{meeting.workingGroup.name}»
          </p>
          <div className="flex gap-2 items-center justify-self-end">
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

        {/* Row 2: chairman select (left) · date (right) */}
        <div className="flex items-center justify-between gap-3 mt-2.5">
          <select
            className="select flex-1 max-w-md"
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
          <span className="text-xs text-mid whitespace-nowrap shrink-0">
            {new Date(meeting.startAt).toLocaleDateString('uk-UA', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}
          </span>
        </div>
      </div>

      {/* ШІ-чернетка: секретар пише вільним текстом → ШІ структурує у 3 розділи */}
      {canEdit && canAiDraft && (
        <AiDraftPanel key={aiPanelKey} meetingId={meetingId} onGenerated={handleGenerated} />
      )}
      {aiNote && (
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-2 text-sm text-emerald-800 dark:text-emerald-300">
          {aiNote}
        </div>
      )}

      {/* Replace-or-append choice when the protocol already has items */}
      {pendingDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-card rounded-xl border border-hairline shadow-xl max-w-md w-full p-5 space-y-4">
            <div>
              <h3 className="text-base font-bold text-ink">Протокол уже містить пункти</h3>
              <p className="text-sm text-mid mt-1">
                У редакторі вже є заповнені пункти. Що зробити зі ШІ-чернеткою?
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  const d = pendingDraft;
                  setPendingDraft(null);
                  void applyAndSave(d, 'append');
                }}
                className="btn-primary w-full justify-center"
              >
                Доповнити (залишити наявні)
              </button>
              <button
                onClick={() => {
                  const d = pendingDraft;
                  setPendingDraft(null);
                  void applyAndSave(d, 'replace');
                }}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
              >
                Замінити (видалити наявні)
              </button>
              <button
                onClick={() => setPendingDraft(null)}
                className="btn-secondary w-full justify-center"
              >
                Скасувати
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={pendingDelete !== null}
        title="Видалити пункт протоколу?"
        message={
          pendingDelete?.title
            ? `«${pendingDelete.title}» буде видалено остаточно.`
            : 'Пункт буде видалено остаточно.'
        }
        confirmLabel="Видалити"
        destructive
        isPending={deleteItemMutation.isPending}
        error={deleteItemMutation.error?.message ?? null}
        onConfirm={() => {
          const id = pendingDelete?.id;
          if (!id) return;
          deleteItemMutation.mutate({ id }, { onSuccess: () => setPendingDelete(null) });
        }}
        onClose={() => setPendingDelete(null)}
      />

      {/* Two-column layout: protocol main + narrow attendance rail.
          Stacks vertically on <lg so the attendance card sits below
          on phones / tablets. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-5 items-start">
        <ProtocolTabs
          items={items}
          members={members}
          chairman={chairmanForView}
          secretary={secretaryUser}
          meetingTitle={meeting.title}
          meetingStartAt={meeting.startAt}
          wgCode={meeting.workingGroup.code}
          wgName={meeting.workingGroup.name}
          presentNames={presentAll}
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

/* ─────────── ШІ-чернетка протоколу ─────────── */

function AiDraftPanel({
  meetingId,
  onGenerated,
}: {
  meetingId: string;
  onGenerated: (d: AiProtocolDraft) => void;
}) {
  const { data: aiEnabled, isLoading: enabledLoading } = trpc.meeting.aiEnabled.useQuery();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  const gen = trpc.meeting.generateProtocolDraft.useMutation({
    onSuccess: (draft) => onGenerated(draft),
  });

  const configured = aiEnabled === true;
  const tooShort = text.trim().length < 10;

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-5 py-3.5 text-left hover:bg-pill/50 transition-colors"
      >
        <Sparkles className="w-4 h-4 text-brand shrink-0" />
        <span className="text-sm font-bold text-ink">ШІ-чернетка протоколу</span>
        <span className="text-xs text-light hidden sm:inline">
          напишіть своїми словами — ШІ заповнить розділи
        </span>
        {!enabledLoading && !configured && (
          <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-pill text-light">
            не налаштовано
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-light ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-hairline space-y-3">
          {!configured ? (
            <p className="text-xs text-mid leading-relaxed pt-3">
              Функція вимкнена: не задано змінну середовища{' '}
              <code className="font-mono text-[11px] bg-pill px-1 py-0.5 rounded">
                ANTHROPIC_API_KEY
              </code>
              . Додайте ключ у налаштуваннях застосунку, щоб увімкнути генерацію.
            </p>
          ) : (
            <>
              <textarea
                rows={8}
                className="textarea resize-y w-full mt-3"
                placeholder={
                  'Опишіть засідання вільним текстом. Напр.:\n\nОбговорили поетапний план виконання програми стандартизації на 2026 рік. Доповідала Масленникова — про строки розроблення стандартів. Гуляєв звернув увагу на форму ТЗ за наказом № 832. Вирішили: Жуку підготувати проєкти ТЗ до 1 травня, відповідальний — Іщук.'
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={gen.isPending}
              />
              {gen.error && (
                <p className="text-xs text-red-600 dark:text-red-400">{gen.error.message}</p>
              )}
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-light">
                  Присутні й дата беруться із засідання. Згенеровані пункти одразу зберігаються —
                  потім їх можна відредагувати.
                </p>
                <button
                  type="button"
                  onClick={() => gen.mutate({ meetingId, rawText: text.trim() })}
                  disabled={gen.isPending || tooShort}
                  className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50 shrink-0"
                >
                  {gen.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  {gen.isPending ? 'Генерую…' : 'Згенерувати'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
