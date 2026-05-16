/**
 * Cron worker for scheduled reminders.
 *
 * Schedule: every hour (Railway cron or external).
 * Auth: GET /api/cron/notifications?secret=$CRON_SECRET
 *       or Bearer header `Authorization: Bearer $CRON_SECRET`.
 *
 * For each scheduled-reminder class it scans events whose lead-time window
 * overlaps the current run, then calls notify.ts. Dedup is provided by the
 * notification rows: we skip if a notification with the same link + type +
 * within the past 23h exists for the recipient.
 *
 * If CRON_SECRET is unset, the endpoint is disabled (returns 503).
 */

import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { env } from '@/lib/env';
import {
  notifyMeetingReminder,
  notifyTaskDeadlineSoon,
  notifyTaskOverdue,
  notifyVoteClosingSoon,
  notifyStageDueSoon,
  notifyStageOverdue,
  type StageKey,
} from '@/server/notify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(req: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get('secret');
  const fromHeader = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return fromQuery === env.CRON_SECRET || fromHeader === env.CRON_SECRET;
}

export async function GET(req: Request) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stats = {
    meetingReminders: 0,
    taskDeadlineReminders: 0,
    taskOverdueReminders: 0,
    voteClosingReminders: 0,
    stageDueReminders: 0,
    stageOverdueReminders: 0,
    skippedDuplicates: 0,
  };

  const settings =
    (await db.systemSettings.findUnique({ where: { id: 1 } })) ??
    (await db.systemSettings.create({ data: { id: 1 } }));

  const now = new Date();
  const oneHourMs = 60 * 60 * 1000;

  /* ── Meeting reminders ───────────────────────────────────────────────── */
  // For each configured lead (lead1, lead2), find meetings starting in
  // [lead - 0.5h, lead + 0.5h] and not yet reminded for that lead.
  const meetingLeads: number[] = [];
  if (settings.meetingRemindLead1Hours > 0) meetingLeads.push(settings.meetingRemindLead1Hours);
  if (settings.meetingRemindLead2Hours && settings.meetingRemindLead2Hours > 0) {
    meetingLeads.push(settings.meetingRemindLead2Hours);
  }
  for (const lead of meetingLeads) {
    const target = new Date(now.getTime() + lead * oneHourMs);
    const lo = new Date(target.getTime() - oneHourMs / 2);
    const hi = new Date(target.getTime() + oneHourMs / 2);
    const meetings = await db.meeting.findMany({
      where: {
        startAt: { gte: lo, lte: hi },
        status: { not: 'CANCELLED' },
      },
      select: { id: true },
    });
    for (const m of meetings) {
      const dup = await db.notification.findFirst({
        where: {
          link: `/meetings/${m.id}`,
          type: 'MEETING_REMINDER',
          title: {
            contains: `${lead >= 24 ? 'завтра' : `за ${lead === 1 ? '1 годину' : `${lead} год`}`}`,
          },
          createdAt: { gte: new Date(now.getTime() - 23 * oneHourMs) },
        },
        select: { id: true },
      });
      if (dup) {
        stats.skippedDuplicates++;
        continue;
      }
      await notifyMeetingReminder(db, m.id, lead);
      stats.meetingReminders++;
    }
  }

  /* ── Task deadline reminders ─────────────────────────────────────────── */
  if (settings.taskDeadlineLeadHours > 0) {
    const lead = settings.taskDeadlineLeadHours;
    const target = new Date(now.getTime() + lead * oneHourMs);
    const lo = new Date(target.getTime() - oneHourMs / 2);
    const hi = new Date(target.getTime() + oneHourMs / 2);
    const tasks = await db.task.findMany({
      where: {
        dueDate: { gte: lo, lte: hi },
        status: { notIn: ['DONE', 'CANCELLED'] },
        assigneeId: { not: null },
      },
      select: { id: true },
    });
    for (const t of tasks) {
      const dup = await db.notification.findFirst({
        where: {
          link: `/tasks/${t.id}`,
          type: 'TASK_OVERDUE',
          createdAt: { gte: new Date(now.getTime() - 23 * oneHourMs) },
        },
        select: { id: true },
      });
      if (dup) {
        stats.skippedDuplicates++;
        continue;
      }
      await notifyTaskDeadlineSoon(db, t.id, lead);
      stats.taskDeadlineReminders++;
    }
  }

  /* ── Task overdue (one-shot when crossing deadline) ──────────────────── */
  if (settings.taskOverdueNotify) {
    const cutoff = new Date(now.getTime() - oneHourMs);
    const tasks = await db.task.findMany({
      where: {
        dueDate: { gte: cutoff, lt: now },
        status: { notIn: ['DONE', 'CANCELLED'] },
      },
      select: { id: true },
    });
    for (const t of tasks) {
      const dup = await db.notification.findFirst({
        where: {
          link: `/tasks/${t.id}`,
          title: { startsWith: 'Завдання прострочене' },
          createdAt: { gte: new Date(now.getTime() - 7 * 24 * oneHourMs) },
        },
        select: { id: true },
      });
      if (dup) {
        stats.skippedDuplicates++;
        continue;
      }
      await notifyTaskOverdue(db, t.id);
      stats.taskOverdueReminders++;
    }
  }

  /* ── Vote closing reminders ──────────────────────────────────────────── */
  if (settings.voteClosingLeadHours > 0) {
    const lead = settings.voteClosingLeadHours;
    const target = new Date(now.getTime() + lead * oneHourMs);
    const lo = new Date(target.getTime() - oneHourMs / 2);
    const hi = new Date(target.getTime() + oneHourMs / 2);
    const votings = await db.voting.findMany({
      where: {
        deadline: { gte: lo, lte: hi },
        status: 'OPEN',
      },
      select: { id: true, standardId: true },
    });
    for (const v of votings) {
      const dup = await db.notification.findFirst({
        where: {
          link: `/standards/${v.standardId}`,
          title: { startsWith: 'Голосування завершується' },
          createdAt: { gte: new Date(now.getTime() - 23 * oneHourMs) },
        },
        select: { id: true },
      });
      if (dup) {
        stats.skippedDuplicates++;
        continue;
      }
      await notifyVoteClosingSoon(db, v.id, lead);
      stats.voteClosingReminders++;
    }
  }

  /* ── Stage deadline reminders + overdue ──────────────────────────────── */
  // Stage notifications are date-based (not hour-based). To avoid spamming
  // every hour, only fire them around 09:00 Kyiv local time.
  const kyivHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Kyiv',
      hour: '2-digit',
      hour12: false,
    }).format(now),
  );
  const isMorningTick = kyivHour === 9;

  if (isMorningTick && settings.stageDueSoonNotify) {
    const STAGES: { key: StageKey; due: string; done: string }[] = [
      { key: 'techSpec', due: 'techSpecDueDate', done: 'techSpecCompletedAt' },
      { key: 'draft', due: 'draftDueDate', done: 'draftCompletedAt' },
      { key: 'feedback', due: 'feedbackDueDate', done: 'feedbackCompletedAt' },
      { key: 'techReview', due: 'techReviewDueDate', done: 'techReviewCompletedAt' },
      { key: 'final', due: 'finalDueDate', done: 'finalCompletedAt' },
    ];
    const leads = Array.from(
      new Set(
        [settings.stageDueLeadDays1, settings.stageDueLeadDays2].filter(
          (n): n is number => typeof n === 'number' && n > 0,
        ),
      ),
    );
    const dayMs = 24 * oneHourMs;
    const sevenDays = 7 * dayMs;

    for (const lead of leads) {
      // Match standards whose due-date falls on the day exactly `lead` days
      // from now (compare by calendar day, not millisecond range).
      const target = new Date(now.getTime() + lead * dayMs);
      const lo = new Date(target.getFullYear(), target.getMonth(), target.getDate());
      const hi = new Date(target.getFullYear(), target.getMonth(), target.getDate() + 1);

      for (const stg of STAGES) {
        const standards = await db.standard.findMany({
          where: {
            [stg.due]: { gte: lo, lt: hi },
            [stg.done]: null,
            indeks: { not: null }, // program-plan items only
          },
          select: { id: true },
        });
        for (const s of standards) {
          const dup = await db.notification.findFirst({
            where: {
              link: `/standards/${s.id}`,
              type: 'STAGE_DUE_SOON',
              title: { contains: `за ${lead} днів` },
              createdAt: { gte: new Date(now.getTime() - sevenDays) },
            },
            select: { id: true },
          });
          if (dup) {
            stats.skippedDuplicates++;
            continue;
          }
          await notifyStageDueSoon(db, s.id, stg.key, lead);
          stats.stageDueReminders++;
        }
      }
    }
  }

  if (isMorningTick && settings.stageOverdueNotify) {
    const STAGES: { key: StageKey; due: string; done: string }[] = [
      { key: 'techSpec', due: 'techSpecDueDate', done: 'techSpecCompletedAt' },
      { key: 'draft', due: 'draftDueDate', done: 'draftCompletedAt' },
      { key: 'feedback', due: 'feedbackDueDate', done: 'feedbackCompletedAt' },
      { key: 'techReview', due: 'techReviewDueDate', done: 'techReviewCompletedAt' },
      { key: 'final', due: 'finalDueDate', done: 'finalCompletedAt' },
    ];
    const dayMs = 24 * oneHourMs;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (const stg of STAGES) {
      // Catches stages that JUST crossed the deadline (their due date was
      // yesterday). One-shot — won't repeat on subsequent days; the weekly
      // digest takes over after.
      const standards = await db.standard.findMany({
        where: {
          [stg.due]: { gte: yesterday, lt: today },
          [stg.done]: null,
          indeks: { not: null },
        },
        select: { id: true },
      });
      for (const s of standards) {
        const dup = await db.notification.findFirst({
          where: {
            link: `/standards/${s.id}`,
            type: 'STAGE_OVERDUE',
            createdAt: { gte: new Date(now.getTime() - 30 * dayMs) },
          },
          select: { id: true },
        });
        if (dup) {
          stats.skippedDuplicates++;
          continue;
        }
        await notifyStageOverdue(db, s.id, stg.key);
        stats.stageOverdueReminders++;
      }
    }
  }

  return NextResponse.json({ ok: true, ...stats, ranAt: now.toISOString(), kyivHour });
}
