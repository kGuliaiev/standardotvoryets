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

export { appUrl };
