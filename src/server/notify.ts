/**
 * Central notification dispatcher.
 *
 * Each emit() call:
 *   1. Reads SystemSettings (singleton row, id=1) to check whether this event
 *      type is enabled and on which channels.
 *   2. Filters recipients by per-user notifyInApp / notifyEmail.
 *   3. Writes a Notification row (in-app) and best-effort sends email.
 *
 * Errors are caught and logged — a failed notification must NOT break the
 * originating mutation (e.g. meeting creation).
 */

import type { PrismaClient, NotificationType } from '@prisma/client';
import { sendEmail } from './email';
import { env } from '@/lib/env';

type Channel = 'inApp' | 'email';

interface EmitArgs {
  db: PrismaClient;
  recipients: { id: string; email: string; notifyInApp: boolean; notifyEmail: boolean }[];
  excludeUserId?: string; // don't notify the actor
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  channelEnabled: { inApp: boolean; email: boolean }; // per-event toggle from settings
  emailHtml?: string; // optional rich HTML; falls back to body
}

async function getSettings(db: PrismaClient) {
  const s = await db.systemSettings.findUnique({ where: { id: 1 } });
  return s ?? (await db.systemSettings.create({ data: { id: 1 } }));
}

async function emit(args: EmitArgs) {
  const settings = await getSettings(args.db);
  const channels: Channel[] = [];
  if (args.channelEnabled.inApp && settings.channelInApp) channels.push('inApp');
  if (args.channelEnabled.email && settings.channelEmail) channels.push('email');
  if (channels.length === 0) return;

  const targets = args.recipients.filter((r) => r.id !== args.excludeUserId);

  await Promise.all(
    targets.flatMap((u) => {
      const ops: Promise<unknown>[] = [];
      if (channels.includes('inApp') && u.notifyInApp) {
        ops.push(
          args.db.notification
            .create({
              data: {
                userId: u.id,
                type: args.type,
                title: args.title,
                body: args.body,
                link: args.link,
              },
            })
            .catch((e: unknown) => console.error('[notify] in-app failed', u.id, e)),
        );
      }
      if (channels.includes('email') && u.notifyEmail && u.email) {
        ops.push(
          sendEmail({
            to: u.email,
            subject: args.title,
            html: args.emailHtml ?? `<p>${escape(args.body)}</p>`,
          }).catch((e: unknown) => console.error('[notify] email failed', u.id, e)),
        );
      }
      return ops;
    }),
  );
}

function escape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Recipient helpers ────────────────────────────────────────────────── */

async function workingGroupRecipients(db: PrismaClient, workingGroupId: string) {
  const members = await db.workingGroupMember.findMany({
    where: { workingGroupId },
    select: {
      user: {
        select: { id: true, email: true, notifyInApp: true, notifyEmail: true, isActive: true },
      },
    },
  });
  return members
    .map((m) => m.user)
    .filter((u) => u.isActive)
    .map((u) => ({
      id: u.id,
      email: u.email,
      notifyInApp: u.notifyInApp,
      notifyEmail: u.notifyEmail,
    }));
}

async function singleUserRecipient(db: PrismaClient, userId: string) {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, notifyInApp: true, notifyEmail: true, isActive: true },
  });
  if (!u?.isActive) return [];
  return [
    {
      id: u.id,
      email: u.email,
      notifyInApp: u.notifyInApp,
      notifyEmail: u.notifyEmail,
    },
  ];
}

/**
 * Leadership of a WG: LEADER + DEPUTY + SECRETARY rolled into one list.
 * Used for stage notifications targeted at people responsible for the work.
 */
async function wgLeadershipRecipients(db: PrismaClient, workingGroupId: string) {
  const members = await db.workingGroupMember.findMany({
    where: {
      workingGroupId,
      role: { in: ['LEADER', 'DEPUTY', 'SECRETARY'] },
    },
    select: {
      user: {
        select: { id: true, email: true, notifyInApp: true, notifyEmail: true, isActive: true },
      },
    },
  });
  return members
    .map((m) => m.user)
    .filter((u) => u.isActive)
    .map((u) => ({
      id: u.id,
      email: u.email,
      notifyInApp: u.notifyInApp,
      notifyEmail: u.notifyEmail,
    }));
}

/** All active DIRECTOR + ADMIN users — they see everything across all WGs. */
async function directorAndAdminRecipients(db: PrismaClient) {
  const users = await db.user.findMany({
    where: {
      isActive: true,
      globalRole: { in: ['DIRECTOR', 'ADMIN'] },
    },
    select: { id: true, email: true, notifyInApp: true, notifyEmail: true },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    notifyInApp: u.notifyInApp,
    notifyEmail: u.notifyEmail,
  }));
}

function dedupeRecipients(
  groups: { id: string; email: string; notifyInApp: boolean; notifyEmail: boolean }[][],
) {
  const seen = new Set<string>();
  const out: { id: string; email: string; notifyInApp: boolean; notifyEmail: boolean }[] = [];
  for (const list of groups) {
    for (const u of list) {
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      out.push(u);
    }
  }
  return out;
}

const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');

/* ── Event API ─────────────────────────────────────────────────────────── */

export async function notifyMeetingCreated(
  db: PrismaClient,
  meetingId: string,
  actorUserId: string,
) {
  try {
    const m = await db.meeting.findUnique({
      where: { id: meetingId },
      include: { workingGroup: { select: { id: true, code: true } } },
    });
    if (!m) return;
    const settings = await getSettings(db);
    if (!settings.meetingInviteOnCreate) return;
    const recipients = await workingGroupRecipients(db, m.workingGroupId);
    await emit({
      db,
      recipients,
      excludeUserId: actorUserId,
      type: 'MEETING_INVITE',
      title: `Нове засідання: ${m.title}`,
      body: `${m.workingGroup.code} — ${formatDate(m.startAt)}`,
      link: `/meetings/${m.id}`,
      channelEnabled: { inApp: true, email: true },
    });
  } catch (e) {
    console.error('[notifyMeetingCreated]', e);
  }
}

export async function notifyMeetingChanged(
  db: PrismaClient,
  meetingId: string,
  actorUserId: string,
  change: string,
) {
  try {
    const m = await db.meeting.findUnique({
      where: { id: meetingId },
      include: { workingGroup: { select: { id: true, code: true } } },
    });
    if (!m) return;
    const settings = await getSettings(db);
    if (!settings.meetingChangeNotify) return;
    const recipients = await workingGroupRecipients(db, m.workingGroupId);
    await emit({
      db,
      recipients,
      excludeUserId: actorUserId,
      type: 'MEETING_INVITE',
      title: `Зміни в засіданні: ${m.title}`,
      body: `${m.workingGroup.code} — ${change}`,
      link: `/meetings/${m.id}`,
      channelEnabled: { inApp: true, email: true },
    });
  } catch (e) {
    console.error('[notifyMeetingChanged]', e);
  }
}

export async function notifyTaskAssigned(db: PrismaClient, taskId: string, actorUserId: string) {
  try {
    const t = await db.task.findUnique({
      where: { id: taskId },
      include: { standard: { select: { code: true } } },
    });
    if (!t?.assigneeId) return;
    const settings = await getSettings(db);
    if (!settings.taskAssignNotify) return;
    const recipients = await singleUserRecipient(db, t.assigneeId);
    await emit({
      db,
      recipients,
      excludeUserId: actorUserId,
      type: 'TASK_ASSIGNED',
      title: `Призначено завдання: ${t.title}`,
      body: `${t.standard.code} · ${t.dueDate ? `до ${formatDate(t.dueDate)}` : 'без дедлайну'}`,
      link: `/tasks/${t.id}`,
      channelEnabled: { inApp: true, email: true },
    });
  } catch (e) {
    console.error('[notifyTaskAssigned]', e);
  }
}

export async function notifyTaskCompleted(db: PrismaClient, taskId: string, actorUserId: string) {
  try {
    const t = await db.task.findUnique({
      where: { id: taskId },
      include: { standard: { select: { code: true } } },
    });
    if (!t?.createdById) return;
    const settings = await getSettings(db);
    if (!settings.taskCompleteNotify) return;
    const recipients = await singleUserRecipient(db, t.createdById);
    await emit({
      db,
      recipients,
      excludeUserId: actorUserId,
      type: 'TASK_ASSIGNED',
      title: `Завдання виконано: ${t.title}`,
      body: `${t.standard.code}`,
      link: `/tasks/${t.id}`,
      channelEnabled: { inApp: true, email: false },
    });
  } catch (e) {
    console.error('[notifyTaskCompleted]', e);
  }
}

export async function notifyVoteOpened(db: PrismaClient, votingId: string, actorUserId: string) {
  try {
    const v = await db.voting.findUnique({
      where: { id: votingId },
      include: { standard: { select: { workingGroupId: true, code: true } } },
    });
    if (!v) return;
    const settings = await getSettings(db);
    if (!settings.voteOpenedNotify) return;
    const recipients = await workingGroupRecipients(db, v.standard.workingGroupId);
    await emit({
      db,
      recipients,
      excludeUserId: actorUserId,
      type: 'VOTE_OPENED',
      title: `Відкрито голосування: ${v.title}`,
      body: `${v.standard.code}${v.deadline ? ` · до ${formatDate(v.deadline)}` : ''}`,
      link: `/standards/${v.standardId}`,
      channelEnabled: { inApp: true, email: true },
    });
  } catch (e) {
    console.error('[notifyVoteOpened]', e);
  }
}

export async function notifyVoteClosed(
  db: PrismaClient,
  votingId: string,
  outcome: string,
  actorUserId?: string,
) {
  try {
    const v = await db.voting.findUnique({
      where: { id: votingId },
      include: { standard: { select: { workingGroupId: true, code: true } } },
    });
    if (!v) return;
    const settings = await getSettings(db);
    if (!settings.voteClosedNotify) return;
    const recipients = await workingGroupRecipients(db, v.standard.workingGroupId);
    await emit({
      db,
      recipients,
      excludeUserId: actorUserId,
      type: 'VOTE_CLOSED',
      title: `Голосування завершено: ${v.title}`,
      body: `${v.standard.code} · ${outcome}`,
      link: `/standards/${v.standardId}`,
      channelEnabled: { inApp: true, email: false },
    });
  } catch (e) {
    console.error('[notifyVoteClosed]', e);
  }
}

export async function notifyStandardStatusChanged(
  db: PrismaClient,
  standardId: string,
  fromStatus: string,
  toStatus: string,
  actorUserId: string,
) {
  try {
    const s = await db.standard.findUnique({
      where: { id: standardId },
      include: { workingGroup: { select: { id: true, code: true } } },
    });
    if (!s) return;
    const settings = await getSettings(db);
    if (!settings.standardStatusNotify) return;
    const recipients = await workingGroupRecipients(db, s.workingGroupId);
    await emit({
      db,
      recipients,
      excludeUserId: actorUserId,
      type: 'STANDARD_STATUS_CHANGED',
      title: `Стандарт ${s.code}: ${fromStatus} → ${toStatus}`,
      body: s.title,
      link: `/standards/${s.id}`,
      channelEnabled: { inApp: true, email: false },
    });
  } catch (e) {
    console.error('[notifyStandardStatusChanged]', e);
  }
}

export async function notifyMeetingReminder(
  db: PrismaClient,
  meetingId: string,
  hoursAhead: number,
) {
  try {
    const m = await db.meeting.findUnique({
      where: { id: meetingId },
      include: {
        workingGroup: { select: { code: true } },
        attendances: {
          where: { status: { in: ['CONFIRMED', 'PENDING'] } },
          select: {
            user: {
              select: {
                id: true,
                email: true,
                notifyInApp: true,
                notifyEmail: true,
                isActive: true,
              },
            },
          },
        },
      },
    });
    if (!m) return;
    const recipients = m.attendances
      .map((a) => a.user)
      .filter((u) => u.isActive)
      .map((u) => ({
        id: u.id,
        email: u.email,
        notifyInApp: u.notifyInApp,
        notifyEmail: u.notifyEmail,
      }));

    const lead =
      hoursAhead >= 24 ? `завтра` : hoursAhead === 1 ? `за 1 годину` : `за ${hoursAhead} год`;

    await emit({
      db,
      recipients,
      type: 'MEETING_REMINDER',
      title: `Нагадування: ${m.title}`,
      body: `${m.workingGroup.code} · ${lead} (${formatDate(m.startAt)})`,
      link: `/meetings/${m.id}`,
      channelEnabled: { inApp: true, email: true },
    });
  } catch (e) {
    console.error('[notifyMeetingReminder]', e);
  }
}

export async function notifyTaskDeadlineSoon(db: PrismaClient, taskId: string, hoursAhead: number) {
  try {
    const t = await db.task.findUnique({
      where: { id: taskId },
      include: { standard: { select: { code: true } } },
    });
    if (!t?.assigneeId) return;
    const recipients = await singleUserRecipient(db, t.assigneeId);
    await emit({
      db,
      recipients,
      type: 'TASK_OVERDUE',
      title: `Завдання наближається до дедлайну: ${t.title}`,
      body: `${t.standard.code} · залишилось ~${hoursAhead} год`,
      link: `/tasks/${t.id}`,
      channelEnabled: { inApp: true, email: true },
    });
  } catch (e) {
    console.error('[notifyTaskDeadlineSoon]', e);
  }
}

export async function notifyTaskOverdue(db: PrismaClient, taskId: string) {
  try {
    const t = await db.task.findUnique({
      where: { id: taskId },
      include: { standard: { select: { code: true } } },
    });
    if (!t) return;
    const settings = await getSettings(db);
    if (!settings.taskOverdueNotify) return;
    const recipientIds = Array.from(
      new Set([t.assigneeId, t.createdById].filter((id): id is string => !!id)),
    );
    const recipients = (
      await Promise.all(recipientIds.map((id) => singleUserRecipient(db, id)))
    ).flat();
    await emit({
      db,
      recipients,
      type: 'TASK_OVERDUE',
      title: `Завдання прострочене: ${t.title}`,
      body: `${t.standard.code} · дедлайн ${t.dueDate ? formatDate(t.dueDate) : '—'}`,
      link: `/tasks/${t.id}`,
      channelEnabled: { inApp: true, email: true },
    });
  } catch (e) {
    console.error('[notifyTaskOverdue]', e);
  }
}

export async function notifyVoteClosingSoon(
  db: PrismaClient,
  votingId: string,
  hoursAhead: number,
) {
  try {
    const v = await db.voting.findUnique({
      where: { id: votingId },
      include: {
        standard: { select: { workingGroupId: true, code: true } },
        votes: { select: { userId: true } },
      },
    });
    if (!v) return;
    const voted = new Set(v.votes.map((vt) => vt.userId));
    const all = await workingGroupRecipients(db, v.standard.workingGroupId);
    const recipients = all.filter((u) => !voted.has(u.id));
    if (recipients.length === 0) return;
    await emit({
      db,
      recipients,
      type: 'VOTE_OPENED',
      title: `Голосування завершується: ${v.title}`,
      body: `${v.standard.code} · залишилось ~${hoursAhead} год · ви ще не голосували`,
      link: `/standards/${v.standardId}`,
      channelEnabled: { inApp: true, email: true },
    });
  } catch (e) {
    console.error('[notifyVoteClosingSoon]', e);
  }
}

function formatDate(d: Date) {
  return new Date(d).toLocaleString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateShort(d: Date) {
  return new Date(d).toLocaleDateString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/* ── Stage events ──────────────────────────────────────────────────────── */

export type StageKey = 'techSpec' | 'draft' | 'feedback' | 'techReview' | 'final';

export const STAGE_LABEL_UA: Record<StageKey, string> = {
  techSpec: 'ТЗ',
  draft: 'Проєкт',
  feedback: 'Відгуки',
  techReview: 'Технічна перевірка',
  final: 'Остаточна редакція',
};

/**
 * Pre-deadline reminder for a standard stage.
 *  - daysAhead >= stageDueLeadDays2 → in-app to everyone in WG + DIRECTOR/ADMIN
 *  - daysAhead <= stageDueLeadDays2 → also email to LEADER/DEPUTY/SECRETARY
 */
export async function notifyStageDueSoon(
  db: PrismaClient,
  standardId: string,
  stage: StageKey,
  daysAhead: number,
) {
  try {
    const s = await db.standard.findUnique({
      where: { id: standardId },
      include: { workingGroup: { select: { id: true, code: true } } },
    });
    if (!s) return;
    const settings = await getSettings(db);
    if (!settings.stageDueSoonNotify) return;

    const dueField = `${stage}DueDate` as const;
    const completedField = `${stage}CompletedAt` as const;
    const due = s[dueField];
    if (!due || s[completedField]) return;

    const isUrgent = daysAhead <= settings.stageDueLeadDays2;

    const members = await workingGroupRecipients(db, s.workingGroupId);
    const leadership = await wgLeadershipRecipients(db, s.workingGroupId);
    const seniors = await directorAndAdminRecipients(db);
    const all = dedupeRecipients([members, seniors]);

    const leadIds = new Set(leadership.map((u) => u.id));
    const seniorIds = new Set(seniors.map((u) => u.id));

    // Anyone who should receive email this time:
    const emailables = new Set<string>();
    if (isUrgent) {
      // Urgent: leadership + DIRECTOR/ADMIN get email
      leadership.forEach((u) => emailables.add(u.id));
      seniors.forEach((u) => emailables.add(u.id));
    }

    // Tweak per-recipient: in-app always (if user allows), email only for selected
    const recipients = all.map((u) => ({
      ...u,
      notifyEmail: u.notifyEmail && emailables.has(u.id),
    }));

    const stageLabel = STAGE_LABEL_UA[stage];
    const title = isUrgent
      ? `${stageLabel} — завтра дедлайн: ${s.code}`
      : `${stageLabel} — за ${daysAhead} днів: ${s.code}`;
    const body = `${s.workingGroup.code} · «${s.title}» · ${formatDateShort(due)}`;

    await emit({
      db,
      recipients,
      type: 'STAGE_DUE_SOON',
      title,
      body,
      link: `/standards/${s.id}`,
      channelEnabled: { inApp: true, email: true },
    });

    // Silence unused-var warnings (we'll need leadIds/seniorIds when wiring digest)
    void leadIds;
    void seniorIds;
  } catch (e) {
    console.error('[notifyStageDueSoon]', e);
  }
}

/** One-shot notification when a stage crosses its deadline without completion. */
export async function notifyStageOverdue(db: PrismaClient, standardId: string, stage: StageKey) {
  try {
    const s = await db.standard.findUnique({
      where: { id: standardId },
      include: { workingGroup: { select: { id: true, code: true } } },
    });
    if (!s) return;
    const settings = await getSettings(db);
    if (!settings.stageOverdueNotify) return;

    const dueField = `${stage}DueDate` as const;
    const completedField = `${stage}CompletedAt` as const;
    const due = (s as unknown as Record<string, Date | null>)[dueField];
    const completed = (s as unknown as Record<string, Date | null>)[completedField];
    if (!due || completed) return;

    const leadership = await wgLeadershipRecipients(db, s.workingGroupId);
    const seniors = await directorAndAdminRecipients(db);
    const recipients = dedupeRecipients([leadership, seniors]);

    const stageLabel = STAGE_LABEL_UA[stage];
    await emit({
      db,
      recipients,
      type: 'STAGE_OVERDUE',
      title: `${stageLabel} прострочено: ${s.code}`,
      body: `${s.workingGroup.code} · «${s.title}» · дедлайн був ${formatDateShort(due)}`,
      link: `/standards/${s.id}`,
      channelEnabled: { inApp: true, email: true },
    });
  } catch (e) {
    console.error('[notifyStageOverdue]', e);
  }
}

/** Sent immediately when a secretary/leader confirms a stage as done. */
export async function notifyStageCompleted(
  db: PrismaClient,
  standardId: string,
  stage: StageKey,
  byUserId: string,
) {
  try {
    const s = await db.standard.findUnique({
      where: { id: standardId },
      include: { workingGroup: { select: { id: true, code: true } } },
    });
    if (!s) return;
    const settings = await getSettings(db);
    if (!settings.stageCompletedNotify) return;

    const leadership = await wgLeadershipRecipients(db, s.workingGroupId);
    const seniors = await directorAndAdminRecipients(db);
    const recipients = dedupeRecipients([leadership, seniors]);

    const stageLabel = STAGE_LABEL_UA[stage];
    await emit({
      db,
      recipients,
      excludeUserId: byUserId,
      type: 'STAGE_COMPLETED',
      title: `${stageLabel} виконано: ${s.code}`,
      body: `${s.workingGroup.code} · «${s.title}»`,
      link: `/standards/${s.id}`,
      channelEnabled: { inApp: true, email: false },
    });
  } catch (e) {
    console.error('[notifyStageCompleted]', e);
  }
}

/* ── Attendance + protocol events ──────────────────────────────────────── */

/**
 * Fired when a member changes their attendance to DECLINED (either via
 * `meeting.confirmAttendance` or when a secretary marks them via
 * `meeting.setAttendance`). Notifies the meeting's chairman + the WG
 * secretary so they can plan around the missing quorum.
 *
 *  excludeUserId = the actor (so when secretary marks themselves declined,
 *                  they don't notify themselves).
 */
export async function notifyAttendanceDeclined(
  db: PrismaClient,
  meetingId: string,
  declinedUserId: string,
  actorUserId: string,
) {
  try {
    const m = await db.meeting.findUnique({
      where: { id: meetingId },
      include: {
        workingGroup: {
          select: {
            id: true,
            code: true,
            members: {
              where: { role: { in: ['LEADER', 'SECRETARY'] } },
              select: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    notifyInApp: true,
                    notifyEmail: true,
                    isActive: true,
                  },
                },
              },
            },
          },
        },
        chairman: {
          select: {
            id: true,
            email: true,
            notifyInApp: true,
            notifyEmail: true,
            isActive: true,
            name: true,
          },
        },
      },
    });
    if (!m) return;
    const settings = await getSettings(db);
    if (!settings.attendanceDeclinedNotify) return;

    const declinedUser = await db.user.findUnique({
      where: { id: declinedUserId },
      select: { name: true },
    });

    // Recipients: chairman + LEADER + SECRETARY of WG; dedupe + skip inactive.
    const chairman = m.chairman?.isActive
      ? [
          {
            id: m.chairman.id,
            email: m.chairman.email,
            notifyInApp: m.chairman.notifyInApp,
            notifyEmail: m.chairman.notifyEmail,
          },
        ]
      : [];
    const wgLeads = m.workingGroup.members
      .map((mm) => mm.user)
      .filter((u) => u.isActive)
      .map((u) => ({
        id: u.id,
        email: u.email,
        notifyInApp: u.notifyInApp,
        notifyEmail: u.notifyEmail,
      }));
    const recipients = dedupeRecipients([chairman, wgLeads]);

    await emit({
      db,
      recipients,
      excludeUserId: actorUserId,
      type: 'ATTENDANCE_DECLINED',
      title: `Відмова на засіданні: ${declinedUser?.name ?? 'учасник'}`,
      body: `${m.workingGroup.code} · «${m.title}» · ${formatDate(m.startAt)}`,
      link: `/meetings/${m.id}`,
      channelEnabled: { inApp: true, email: false },
    });
  } catch (e) {
    console.error('[notifyAttendanceDeclined]', e);
  }
}

/**
 * Fired when `meeting.assignProtocolNumber` succeeds — i.e. the secretary
 * has finalized the protocol. Notifies all WG members with a link to the
 * meeting (where they can read or download the protocol).
 */
export async function notifyProtocolPublished(
  db: PrismaClient,
  meetingId: string,
  actorUserId: string,
) {
  try {
    const m = await db.meeting.findUnique({
      where: { id: meetingId },
      include: { workingGroup: { select: { id: true, code: true } } },
    });
    if (!m) return;
    const settings = await getSettings(db);
    if (!settings.protocolPublishedNotify) return;

    const recipients = await workingGroupRecipients(db, m.workingGroupId);
    await emit({
      db,
      recipients,
      excludeUserId: actorUserId,
      type: 'PROTOCOL_PUBLISHED',
      title: `Протокол готовий: ${m.title}`,
      body: `${m.workingGroup.code} · протокол №${m.protocolNumber} · ${formatDate(m.startAt)}`,
      link: `/meetings/${m.id}`,
      channelEnabled: { inApp: true, email: true },
    });
  } catch (e) {
    console.error('[notifyProtocolPublished]', e);
  }
}

/* ── Weekly digest (Monday 09:00 Kyiv) ─────────────────────────────────── */

interface DigestBucket {
  overdue: {
    standardCode: string;
    standardTitle: string;
    wgCode: string;
    stage: StageKey;
    due: Date;
  }[];
  upcoming7d: {
    standardCode: string;
    standardTitle: string;
    wgCode: string;
    stage: StageKey;
    due: Date;
    daysLeft: number;
  }[];
  meetingsThisWeek: {
    title: string;
    wgCode: string;
    startAt: Date;
    confirmed: number;
    total: number;
  }[];
  openVotings: { title: string; standardCode: string; deadline: Date | null }[];
}

const STAGE_FIELDS: { key: StageKey; due: keyof DbStandardLite; done: keyof DbStandardLite }[] = [
  { key: 'techSpec', due: 'techSpecDueDate', done: 'techSpecCompletedAt' },
  { key: 'draft', due: 'draftDueDate', done: 'draftCompletedAt' },
  { key: 'feedback', due: 'feedbackDueDate', done: 'feedbackCompletedAt' },
  { key: 'techReview', due: 'techReviewDueDate', done: 'techReviewCompletedAt' },
  { key: 'final', due: 'finalDueDate', done: 'finalCompletedAt' },
];

interface DbStandardLite {
  id: string;
  code: string;
  title: string;
  workingGroupId: string;
  workingGroup: { code: string };
  techSpecDueDate: Date | null;
  techSpecCompletedAt: Date | null;
  draftDueDate: Date | null;
  draftCompletedAt: Date | null;
  feedbackDueDate: Date | null;
  feedbackCompletedAt: Date | null;
  techReviewDueDate: Date | null;
  techReviewCompletedAt: Date | null;
  finalDueDate: Date | null;
  finalCompletedAt: Date | null;
}

async function buildDigestForWg(
  db: PrismaClient,
  workingGroupId: string | null,
): Promise<DigestBucket> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAhead = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const sevenDaysFromTodayEnd = new Date(today.getTime() + 8 * 24 * 60 * 60 * 1000);

  const where = workingGroupId
    ? { workingGroupId, indeks: { not: null } }
    : { indeks: { not: null } };

  const standards = (await db.standard.findMany({
    where,
    include: { workingGroup: { select: { code: true } } },
  })) as unknown as DbStandardLite[];

  const overdue: DigestBucket['overdue'] = [];
  const upcoming: DigestBucket['upcoming7d'] = [];

  for (const s of standards) {
    for (const stg of STAGE_FIELDS) {
      const due = s[stg.due] as Date | null;
      const done = s[stg.done] as Date | null;
      if (!due || done) continue;
      if (due < today) {
        overdue.push({
          standardCode: s.code,
          standardTitle: s.title,
          wgCode: s.workingGroup.code,
          stage: stg.key,
          due,
        });
      } else if (due <= sevenDaysAhead) {
        const daysLeft = Math.max(
          0,
          Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)),
        );
        upcoming.push({
          standardCode: s.code,
          standardTitle: s.title,
          wgCode: s.workingGroup.code,
          stage: stg.key,
          due,
          daysLeft,
        });
      }
    }
  }

  overdue.sort((a, b) => a.due.getTime() - b.due.getTime());
  upcoming.sort((a, b) => a.due.getTime() - b.due.getTime());

  const meetings = await db.meeting.findMany({
    where: {
      ...(workingGroupId ? { workingGroupId } : {}),
      startAt: { gte: today, lt: sevenDaysFromTodayEnd },
      status: { not: 'CANCELLED' },
    },
    include: {
      workingGroup: { select: { code: true } },
      attendances: { select: { status: true } },
    },
    orderBy: { startAt: 'asc' },
  });
  const meetingsThisWeek = meetings.map((m) => ({
    title: m.title,
    wgCode: m.workingGroup.code,
    startAt: m.startAt,
    confirmed: m.attendances.filter((a) => a.status === 'CONFIRMED').length,
    total: m.attendances.length,
  }));

  const votings = await db.voting.findMany({
    where: {
      status: 'OPEN',
      ...(workingGroupId ? { standard: { workingGroupId } } : {}),
    },
    include: { standard: { select: { code: true } } },
    orderBy: { deadline: 'asc' },
  });
  const openVotings = votings.map((v) => ({
    title: v.title,
    standardCode: v.standard.code,
    deadline: v.deadline,
  }));

  return { overdue, upcoming7d: upcoming, meetingsThisWeek, openVotings };
}

function renderDigestHtml(scopeLabel: string, b: DigestBucket): string {
  const li = (s: string) => `<li>${s}</li>`;
  const dateOnly = (d: Date) => formatDateShort(d);
  const dateTime = (d: Date) => formatDate(d);
  const overdueSec =
    b.overdue.length === 0
      ? `<p style="color:#0F7B3B">Прострочених етапів немає.</p>`
      : `<ul>${b.overdue
          .map((x) =>
            li(
              `<strong style="color:#C82333">${STAGE_LABEL_UA[x.stage]}</strong> · ${x.wgCode} · ${x.standardCode} «${escape(x.standardTitle)}» — дедлайн ${dateOnly(x.due)}`,
            ),
          )
          .join('')}</ul>`;

  const upcomingSec =
    b.upcoming7d.length === 0
      ? `<p style="color:#8a96b0">Етапів з дедлайном цього тижня немає.</p>`
      : `<ul>${b.upcoming7d
          .map((x) =>
            li(
              `<strong>${STAGE_LABEL_UA[x.stage]}</strong> · ${x.wgCode} · ${x.standardCode} «${escape(x.standardTitle)}» — за ${x.daysLeft} дн. (${dateOnly(x.due)})`,
            ),
          )
          .join('')}</ul>`;

  const meetingsSec =
    b.meetingsThisWeek.length === 0
      ? `<p style="color:#8a96b0">Засідань цього тижня немає.</p>`
      : `<ul>${b.meetingsThisWeek
          .map((m) =>
            li(
              `${m.wgCode} · «${escape(m.title)}» — ${dateTime(m.startAt)} (підтвердило ${m.confirmed}/${m.total})`,
            ),
          )
          .join('')}</ul>`;

  const votesSec =
    b.openVotings.length === 0
      ? `<p style="color:#8a96b0">Відкритих голосувань немає.</p>`
      : `<ul>${b.openVotings
          .map((v) =>
            li(
              `${v.standardCode} · «${escape(v.title)}»${v.deadline ? ` — до ${dateOnly(v.deadline)}` : ''}`,
            ),
          )
          .join('')}</ul>`;

  return `
    <div style="font-family:Arial,sans-serif;color:#1a2540;max-width:680px;line-height:1.5">
      <h2 style="color:#0f2b6b;margin:0 0 4px 0">Тижневий звіт · ${scopeLabel}</h2>
      <p style="color:#8a96b0;margin:0 0 18px 0;font-size:13px">Станом на ${dateOnly(new Date())}</p>

      <h3 style="color:#0f2b6b;border-bottom:2px solid #C82333;padding-bottom:4px">Прострочені етапи (${b.overdue.length})</h3>
      ${overdueSec}

      <h3 style="color:#0f2b6b;border-bottom:2px solid #1a56db;padding-bottom:4px;margin-top:24px">Найближчі дедлайни — 7 днів (${b.upcoming7d.length})</h3>
      ${upcomingSec}

      <h3 style="color:#0f2b6b;border-bottom:2px solid #1a56db;padding-bottom:4px;margin-top:24px">Засідання цього тижня (${b.meetingsThisWeek.length})</h3>
      ${meetingsSec}

      <h3 style="color:#0f2b6b;border-bottom:2px solid #1a56db;padding-bottom:4px;margin-top:24px">Відкриті голосування (${b.openVotings.length})</h3>
      ${votesSec}

      <p style="margin-top:32px;color:#8a96b0;font-size:11px">
        Цей звіт надсилається автоматично щопонеділка о 09:00 керівникам, заступникам, секретарям РГ та керівництву центру.
      </p>
    </div>`;
}

/** Run the weekly digest for all leadership recipients. Returns counts. */
export async function sendWeeklyDigest(db: PrismaClient) {
  const settings = await getSettings(db);
  if (!settings.weeklyDigestEnabled) return { sent: 0, skipped: 0 };

  // Per-WG leadership (one digest per user, scoped to their WG)
  const wgs = await db.workingGroup.findMany({ select: { id: true, code: true, name: true } });

  let sent = 0;
  let skipped = 0;

  for (const wg of wgs) {
    const leadership = await wgLeadershipRecipients(db, wg.id);
    if (leadership.length === 0) {
      skipped++;
      continue;
    }
    const bucket = await buildDigestForWg(db, wg.id);
    // Skip empty digests
    if (
      bucket.overdue.length === 0 &&
      bucket.upcoming7d.length === 0 &&
      bucket.meetingsThisWeek.length === 0 &&
      bucket.openVotings.length === 0
    ) {
      skipped++;
      continue;
    }
    const html = renderDigestHtml(`${wg.code} «${wg.name}»`, bucket);
    await emit({
      db,
      recipients: leadership,
      type: 'WEEKLY_DIGEST',
      title: `Тижневий звіт ${wg.code}`,
      body: `Прострочено: ${bucket.overdue.length} · Цього тижня: ${bucket.upcoming7d.length}`,
      link: `/reports`,
      channelEnabled: { inApp: true, email: true },
      emailHtml: html,
    });
    sent += leadership.length;
  }

  // DIRECTOR/ADMIN — one all-WG digest each
  const seniors = await directorAndAdminRecipients(db);
  if (seniors.length > 0) {
    const bucket = await buildDigestForWg(db, null);
    if (
      bucket.overdue.length > 0 ||
      bucket.upcoming7d.length > 0 ||
      bucket.meetingsThisWeek.length > 0 ||
      bucket.openVotings.length > 0
    ) {
      const html = renderDigestHtml('Усі робочі групи', bucket);
      await emit({
        db,
        recipients: seniors,
        type: 'WEEKLY_DIGEST',
        title: `Тижневий звіт · усі РГ`,
        body: `Прострочено: ${bucket.overdue.length} · Цього тижня: ${bucket.upcoming7d.length}`,
        link: `/reports`,
        channelEnabled: { inApp: true, email: true },
        emailHtml: html,
      });
      sent += seniors.length;
    } else {
      skipped++;
    }
  }

  return { sent, skipped };
}

export { appUrl };
