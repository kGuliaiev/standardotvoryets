'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc/client';
import {
  Calendar,
  CheckSquare,
  MessageSquare,
  Vote as VoteIcon,
  FileText,
  Mail,
  Bell,
  Save,
  Target,
  CalendarDays,
  AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { toast } from '@/lib/toast';

interface SettingsState {
  meetingRemindLead1Hours: number;
  meetingRemindLead2Hours: number | null;
  meetingInviteOnCreate: boolean;
  meetingChangeNotify: boolean;
  taskAssignNotify: boolean;
  taskDeadlineLeadHours: number;
  taskOverdueNotify: boolean;
  taskCompleteNotify: boolean;
  voteOpenedNotify: boolean;
  voteClosingLeadHours: number;
  voteClosedNotify: boolean;
  standardStatusNotify: boolean;
  commentMentionNotify: boolean;
  documentUploadNotify: boolean;
  channelEmail: boolean;
  channelInApp: boolean;
  stageDueSoonNotify: boolean;
  stageDueLeadDays1: number;
  stageDueLeadDays2: number;
  stageOverdueNotify: boolean;
  stageCompletedNotify: boolean;
  weeklyDigestEnabled: boolean;
  attendanceDeclinedNotify: boolean;
  protocolPublishedNotify: boolean;
}

const DAY_OPTIONS = [
  { v: 1, l: '1 день' },
  { v: 2, l: '2 дні' },
  { v: 3, l: '3 дні' },
  { v: 5, l: '5 днів' },
  { v: 7, l: '7 днів' },
  { v: 14, l: '14 днів' },
  { v: 30, l: '30 днів' },
];

const HOUR_OPTIONS = [
  { v: 0, l: 'миттєво' },
  { v: 1, l: '1 година' },
  { v: 3, l: '3 години' },
  { v: 6, l: '6 годин' },
  { v: 12, l: '12 годин' },
  { v: 24, l: '24 години' },
  { v: 48, l: '2 доби' },
  { v: 72, l: '3 доби' },
  { v: 168, l: 'тиждень' },
];

export function SystemSettingsForm() {
  const { data: session } = useSession();
  const router = useRouter();
  const isAdmin = session?.user.globalRole === 'ADMIN';

  useEffect(() => {
    if (session && !isAdmin) router.replace('/dashboard');
  }, [session, isAdmin, router]);

  const { data, isLoading } = trpc.admin.getSettings.useQuery(undefined, { enabled: isAdmin });
  const utils = trpc.useUtils();
  const update = trpc.admin.updateSettings.useMutation({
    onSuccess: () => {
      void utils.admin.getSettings.invalidate();
      setSavedAt(new Date());
    },
  });

  const [form, setForm] = useState<SettingsState | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeError, setWipeError] = useState<string | null>(null);

  const wipeVotings = trpc.vote.adminWipeAll.useMutation({
    onSuccess: (r) => {
      setWipeOpen(false);
      setWipeError(null);
      toast.success(
        `Очищено ${r.votingCount} голосувань, ${r.voteCount} голосів. Повернуто ${r.revertedStandards} стандартів на розгляд.`,
      );
    },
    onError: (e) => setWipeError(e.message),
  });

  useEffect(() => {
    if (data && !form) {
      setForm({
        meetingRemindLead1Hours: data.meetingRemindLead1Hours,
        meetingRemindLead2Hours: data.meetingRemindLead2Hours,
        meetingInviteOnCreate: data.meetingInviteOnCreate,
        meetingChangeNotify: data.meetingChangeNotify,
        taskAssignNotify: data.taskAssignNotify,
        taskDeadlineLeadHours: data.taskDeadlineLeadHours,
        taskOverdueNotify: data.taskOverdueNotify,
        taskCompleteNotify: data.taskCompleteNotify,
        voteOpenedNotify: data.voteOpenedNotify,
        voteClosingLeadHours: data.voteClosingLeadHours,
        voteClosedNotify: data.voteClosedNotify,
        standardStatusNotify: data.standardStatusNotify,
        commentMentionNotify: data.commentMentionNotify,
        documentUploadNotify: data.documentUploadNotify,
        channelEmail: data.channelEmail,
        channelInApp: data.channelInApp,
        stageDueSoonNotify: data.stageDueSoonNotify,
        stageDueLeadDays1: data.stageDueLeadDays1,
        stageDueLeadDays2: data.stageDueLeadDays2,
        stageOverdueNotify: data.stageOverdueNotify,
        stageCompletedNotify: data.stageCompletedNotify,
        weeklyDigestEnabled: data.weeklyDigestEnabled,
        attendanceDeclinedNotify: data.attendanceDeclinedNotify,
        protocolPublishedNotify: data.protocolPublishedNotify,
      });
    }
  }, [data, form]);

  if (session && !isAdmin) return null;

  function set<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function save() {
    if (!form) return;
    update.mutate(form);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Налаштування системи"
        subtitle="Правила сповіщень, канали доставки та лід-час нагадувань"
        actions={
          <button
            onClick={save}
            disabled={!form || update.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {update.isPending ? 'Збереження…' : 'Зберегти'}
          </button>
        }
      />
      {savedAt && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700">
          Збережено о {savedAt.toLocaleTimeString('uk-UA')}
        </div>
      )}

      {isLoading || !form ? (
        <div className="bg-card rounded-xl border border-hairline p-12 text-center text-light text-sm">
          Завантаження…
        </div>
      ) : (
        <>
          {/* Settings cards flow into 2 columns on desktop. Using CSS
              multi-column instead of grid means each column stacks
              cards independently (masonry-style) — no forced row
              alignment so a short card next to a tall one doesn't
              stretch or leave a gap. `break-inside-avoid` keeps each
              card whole within its column. */}
          <div className="columns-1 lg:columns-2 gap-5 [&>*]:break-inside-avoid [&>*]:mb-5">
            {/* Channels */}
            <Card icon={<Bell size={18} />} title="Канали доставки">
              <p className="text-xs text-mid mb-3">
                Глобальні канали для всіх типів подій. Користувач може вимкнути для себе в профілі.
              </p>
              <Toggle
                label="В додатку (дзвіночок у меню)"
                checked={form.channelInApp}
                onChange={(v) => set('channelInApp', v)}
              />
              <Toggle
                label={
                  <span className="flex items-center gap-1.5">
                    <Mail size={14} className="text-mid" /> Email
                  </span>
                }
                checked={form.channelEmail}
                onChange={(v) => set('channelEmail', v)}
              />
            </Card>

            {/* Meetings */}
            <Card icon={<Calendar size={18} />} title="Засідання">
              <Toggle
                label="Сповіщати запрошення при створенні засідання"
                checked={form.meetingInviteOnCreate}
                onChange={(v) => set('meetingInviteOnCreate', v)}
              />
              <Toggle
                label="Сповіщати при зміні дати або порядку денного"
                checked={form.meetingChangeNotify}
                onChange={(v) => set('meetingChangeNotify', v)}
              />
              <Toggle
                label="Сповіщати голову та секретаря, коли учасник відмовляється"
                checked={form.attendanceDeclinedNotify}
                onChange={(v) => set('attendanceDeclinedNotify', v)}
              />
              <Toggle
                label="Сповіщати РГ, коли протокол отримав номер (опубліковано)"
                checked={form.protocolPublishedNotify}
                onChange={(v) => set('protocolPublishedNotify', v)}
              />
              <Field label="Нагадування №1 — за скільки часу до засідання">
                <select
                  value={form.meetingRemindLead1Hours}
                  onChange={(e) => set('meetingRemindLead1Hours', Number(e.target.value))}
                  className="select"
                >
                  {HOUR_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Нагадування №2 (необов'язкове)">
                <select
                  value={form.meetingRemindLead2Hours ?? -1}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    set('meetingRemindLead2Hours', n < 0 ? null : n);
                  }}
                  className="select"
                >
                  <option value={-1}>— не використовувати —</option>
                  {HOUR_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </select>
              </Field>
            </Card>

            {/* Stages */}
            <Card icon={<Target size={18} />} title="Етапи стандартів (поетапний план)">
              <Toggle
                label="Сповіщати про наближення дедлайну етапу"
                checked={form.stageDueSoonNotify}
                onChange={(v) => set('stageDueSoonNotify', v)}
              />
              <Field label="Перше нагадування (in-app, всім членам РГ)">
                <select
                  value={form.stageDueLeadDays1}
                  onChange={(e) => set('stageDueLeadDays1', Number(e.target.value))}
                  className="select"
                >
                  {DAY_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Друге нагадування (in-app + email керівництву)">
                <select
                  value={form.stageDueLeadDays2}
                  onChange={(e) => set('stageDueLeadDays2', Number(e.target.value))}
                  className="select"
                >
                  {DAY_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </select>
              </Field>
              <Toggle
                label="Сповіщати про прострочений етап (один раз)"
                checked={form.stageOverdueNotify}
                onChange={(v) => set('stageOverdueNotify', v)}
              />
              <Toggle
                label="Сповіщати керівництво, коли етап підтверджено"
                checked={form.stageCompletedNotify}
                onChange={(v) => set('stageCompletedNotify', v)}
              />
            </Card>

            {/* Weekly digest */}
            <Card icon={<CalendarDays size={18} />} title="Тижневий звіт (понеділок 09:00)">
              <Toggle
                label="Надсилати тижневий звіт керівникам, заступникам, секретарям РГ та керівництву"
                checked={form.weeklyDigestEnabled}
                onChange={(v) => set('weeklyDigestEnabled', v)}
              />
              <p className="text-xs text-light leading-relaxed">
                Звіт містить: прострочені етапи, дедлайни найближчих 7 днів, заплановані засідання
                тижня, відкриті голосування. Порожні звіти не надсилаються.
              </p>
            </Card>

            {/* Tasks */}
            <Card icon={<CheckSquare size={18} />} title="Завдання">
              <Toggle
                label="Сповіщати виконавця при призначенні завдання"
                checked={form.taskAssignNotify}
                onChange={(v) => set('taskAssignNotify', v)}
              />
              <Toggle
                label="Сповіщати при прострочці дедлайну"
                checked={form.taskOverdueNotify}
                onChange={(v) => set('taskOverdueNotify', v)}
              />
              <Toggle
                label="Сповіщати ініціатора про завершення завдання"
                checked={form.taskCompleteNotify}
                onChange={(v) => set('taskCompleteNotify', v)}
              />
              <Field label="Нагадування за скільки часу до терміну">
                <select
                  value={form.taskDeadlineLeadHours}
                  onChange={(e) => set('taskDeadlineLeadHours', Number(e.target.value))}
                  className="select"
                >
                  {HOUR_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </select>
              </Field>
            </Card>

            {/* Votes */}
            <Card icon={<VoteIcon size={18} />} title="Голосування">
              <Toggle
                label="Сповіщати при відкритті голосування"
                checked={form.voteOpenedNotify}
                onChange={(v) => set('voteOpenedNotify', v)}
              />
              <Toggle
                label="Сповіщати при закритті голосування"
                checked={form.voteClosedNotify}
                onChange={(v) => set('voteClosedNotify', v)}
              />
              <Field label="Нагадування за скільки часу до закриття">
                <select
                  value={form.voteClosingLeadHours}
                  onChange={(e) => set('voteClosingLeadHours', Number(e.target.value))}
                  className="select"
                >
                  {HOUR_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </select>
              </Field>
            </Card>

            {/* Standards & comments & docs */}
            <Card icon={<FileText size={18} />} title="Стандарти, коментарі, документи">
              <Toggle
                label="Сповіщати при зміні статусу стандарту"
                checked={form.standardStatusNotify}
                onChange={(v) => set('standardStatusNotify', v)}
              />
              <Toggle
                label={
                  <span className="flex items-center gap-1.5">
                    <MessageSquare size={14} className="text-mid" /> Згадки в коментарях (@user)
                  </span>
                }
                checked={form.commentMentionNotify}
                onChange={(v) => set('commentMentionNotify', v)}
              />
              <Toggle
                label="Сповіщати при завантаженні документів"
                checked={form.documentUploadNotify}
                onChange={(v) => set('documentUploadNotify', v)}
              />
            </Card>
          </div>

          {/* Reference: notification matrix — kept full-width so the
              4-column rules table has room to breathe. */}
          <Card icon={<Bell size={18} />} title="Правила сповіщень — коротко">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-mid border-b border-hairline">
                  <th className="py-2 pr-3 font-medium">Подія</th>
                  <th className="py-2 pr-3 font-medium">Кому</th>
                  <th className="py-2 pr-3 font-medium">Канал</th>
                  <th className="py-2 font-medium">Час</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                <Row e="Створено засідання" w="всі учасники РГ" c="email + дзвіночок" t="одразу" />
                <Row
                  e="Нагадування про засідання"
                  w="підтверджені учасники"
                  c="email + дзвіночок"
                  t={`за ${form.meetingRemindLead1Hours} год${form.meetingRemindLead2Hours != null ? ` та за ${form.meetingRemindLead2Hours} год` : ''}`}
                />
                <Row e="Призначено завдання" w="виконавець" c="email + дзвіночок" t="одразу" />
                <Row
                  e="Нагадування про дедлайн"
                  w="виконавець"
                  c="email + дзвіночок"
                  t={`за ${form.taskDeadlineLeadHours} год`}
                />
                <Row e="Дедлайн прострочений" w="виконавець + ініціатор" c="email" t="одразу" />
                <Row e="Завершено завдання" w="ініціатор" c="дзвіночок" t="одразу" />
                <Row e="Відкрито голосування" w="члени РГ" c="email + дзвіночок" t="одразу" />
                <Row
                  e="Голосування завершується"
                  w="хто ще не проголосував"
                  c="email"
                  t={`за ${form.voteClosingLeadHours} год`}
                />
                <Row e="Закрито голосування" w="члени РГ" c="дзвіночок" t="одразу" />
                <Row e="Зміна статусу стандарту" w="члени РГ" c="дзвіночок" t="одразу" />
                <Row e="Згадка @user в коментарі" w="згаданий" c="дзвіночок" t="одразу" />
                <Row
                  e="Етап стандарту — наближення"
                  w="всі члени РГ + керівництво"
                  c="дзвіночок (email для керівництва на 2-му)"
                  t={`за ${form.stageDueLeadDays1} та ${form.stageDueLeadDays2} дн`}
                />
                <Row
                  e="Етап прострочено"
                  w="керівництво РГ + DIRECTOR/ADMIN"
                  c="email + дзвіночок"
                  t="одного разу"
                />
                <Row
                  e="Етап виконано"
                  w="керівництво РГ + DIRECTOR/ADMIN"
                  c="дзвіночок"
                  t="одразу"
                />
                <Row
                  e="Тижневий звіт"
                  w="керівники, заступники, секретарі, DIRECTOR/ADMIN"
                  c="email + дзвіночок"
                  t="понеділок 09:00"
                />
                <Row
                  e="Відмова на засіданні"
                  w="голова + керівник + секретар"
                  c="дзвіночок"
                  t="одразу"
                />
                <Row e="Протокол отримав номер" w="всі члени РГ" c="email + дзвіночок" t="одразу" />
              </tbody>
            </table>
          </Card>

          {/* Danger zone — destructive, system-wide operations. Kept at the
              very bottom so it doesn't get accidentally tapped while scrolling
              through normal settings. */}
          <section className="bg-card rounded-xl border border-red-300 dark:border-red-700/60 p-5">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={18} className="text-red-600" />
              <h2 className="text-base font-semibold text-ink">Небезпечна зона</h2>
            </div>
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="text-sm text-ink font-medium">Очистити всі голосування</p>
                  <p className="text-xs text-mid mt-0.5">
                    Видаляє всі голосування та голоси по системі. Стандарти у статусах{' '}
                    <span className="font-mono">VOTING / ADOPTED / REJECTED</span> повертаються у{' '}
                    <span className="font-mono">IN_REVIEW</span> для повторного голосування. Дія
                    незворотна.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setWipeError(null);
                    setWipeOpen(true);
                  }}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-red-300 dark:border-red-700/60 bg-red-50 dark:bg-red-900/20 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40"
                >
                  Очистити
                </button>
              </div>
            </div>
          </section>

          <ConfirmModal
            open={wipeOpen}
            title="Очистити всі голосування?"
            destructive
            message={
              <div className="space-y-2">
                <p>
                  Будуть видалені <strong>всі</strong> голосування та голоси по всій системі.
                </p>
                <p>
                  Усі стандарти у статусах{' '}
                  <span className="font-mono">VOTING / ADOPTED / REJECTED</span> будуть повернуті у{' '}
                  <span className="font-mono">IN_REVIEW</span>.
                </p>
                <p className="text-red-700 dark:text-red-400">Дія незворотна.</p>
              </div>
            }
            confirmText="WIPE-ALL-VOTINGS"
            confirmTextLabel={
              <>
                Для підтвердження введіть <span className="font-mono">WIPE-ALL-VOTINGS</span>:
              </>
            }
            confirmLabel="Очистити все"
            isPending={wipeVotings.isPending}
            error={wipeError}
            onConfirm={() => wipeVotings.mutate({ confirm: 'WIPE-ALL-VOTINGS' })}
            onClose={() => {
              if (!wipeVotings.isPending) {
                setWipeOpen(false);
                setWipeError(null);
              }
            }}
          />
        </>
      )}
    </div>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-xl border border-hairline p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-brand">{icon}</span>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span className="text-sm text-ink">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-brand' : 'bg-hairline'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-ink">{label}</span>
      <div className="w-44">{children}</div>
    </label>
  );
}

function Row({ e, w, c, t }: { e: string; w: string; c: string; t: string }) {
  return (
    <tr>
      <td className="py-2 pr-3 text-ink">{e}</td>
      <td className="py-2 pr-3 text-mid">{w}</td>
      <td className="py-2 pr-3 text-mid">{c}</td>
      <td className="py-2 text-mid">{t}</td>
    </tr>
  );
}
