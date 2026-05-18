/**
 * Centralised cron-job implementations.
 *
 * The same functions are called both from the in-process scheduler
 * (src/instrumentation.ts) and from the HTTP debug endpoints
 * (src/app/api/cron/*). Keep all scheduled work here — never duplicate
 * the body of these functions inside route handlers.
 *
 * Each function returns a JSON-serialisable object so the HTTP routes
 * can respond with stats, and the scheduler can log them.
 */

import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { db } from '@/server/db';
import {
  notifyMeetingReminder,
  notifyTaskDeadlineSoon,
  notifyTaskOverdue,
  notifyVoteClosingSoon,
  notifyStageDueSoon,
  notifyStageOverdue,
  sendWeeklyDigest,
  type StageKey,
} from '@/server/notify';

const oneHourMs = 60 * 60 * 1000;

/**
 * Hourly notifications scan.
 * Reads SystemSettings, finds events in lead-time windows, dedupes via
 * existing Notification rows, and calls the per-event notify helpers.
 *
 * Stage-deadline reminders fire only when the current Kyiv-local hour
 * is 09 to avoid spamming throughout the day.
 */
export async function runNotificationsScan(now: Date = new Date()) {
  const stats = {
    meetingReminders: 0,
    taskDeadlineReminders: 0,
    taskOverdueReminders: 0,
    voteClosingReminders: 0,
    stageDueReminders: 0,
    stageOverdueReminders: 0,
    skippedDuplicates: 0,
    ranAt: now.toISOString(),
    kyivHour: 0,
  };

  const settings =
    (await db.systemSettings.findUnique({ where: { id: 1 } })) ??
    (await db.systemSettings.create({ data: { id: 1 } }));

  /* ── Meeting reminders ───────────────────────────────────────────── */
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
      where: { startAt: { gte: lo, lte: hi }, status: { not: 'CANCELLED' } },
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

  /* ── Task deadline reminders ────────────────────────────────────── */
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

  /* ── Task overdue (one-shot crossing) ───────────────────────────── */
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

  /* ── Vote closing reminders ─────────────────────────────────────── */
  if (settings.voteClosingLeadHours > 0) {
    const lead = settings.voteClosingLeadHours;
    const target = new Date(now.getTime() + lead * oneHourMs);
    const lo = new Date(target.getTime() - oneHourMs / 2);
    const hi = new Date(target.getTime() + oneHourMs / 2);
    const votings = await db.voting.findMany({
      where: { deadline: { gte: lo, lte: hi }, status: 'OPEN' },
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

  /* ── Stage deadline reminders (gated to 09:00 Kyiv) ─────────────── */
  const kyivHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Kyiv',
      hour: '2-digit',
      hour12: false,
    }).format(now),
  );
  stats.kyivHour = kyivHour;
  const isMorningTick = kyivHour === 9;

  const STAGES: { key: StageKey; due: string; done: string }[] = [
    { key: 'techSpec', due: 'techSpecDueDate', done: 'techSpecCompletedAt' },
    { key: 'draft', due: 'draftDueDate', done: 'draftCompletedAt' },
    { key: 'feedback', due: 'feedbackDueDate', done: 'feedbackCompletedAt' },
    { key: 'techReview', due: 'techReviewDueDate', done: 'techReviewCompletedAt' },
    { key: 'final', due: 'finalDueDate', done: 'finalCompletedAt' },
  ];

  if (isMorningTick && settings.stageDueSoonNotify) {
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
      const target = new Date(now.getTime() + lead * dayMs);
      const lo = new Date(target.getFullYear(), target.getMonth(), target.getDate());
      const hi = new Date(target.getFullYear(), target.getMonth(), target.getDate() + 1);

      for (const stg of STAGES) {
        const standards = await db.standard.findMany({
          where: {
            [stg.due]: { gte: lo, lt: hi },
            [stg.done]: null,
            indeks: { not: null },
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
    const dayMs = 24 * oneHourMs;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (const stg of STAGES) {
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

  return stats;
}

/**
 * Weekly digest. Self-gates to Monday 09:00 Kyiv unless force=true.
 */
export async function runWeeklyDigest(opts: { force?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  if (!opts.force) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Kyiv',
      weekday: 'short',
      hour: '2-digit',
      hour12: false,
    })
      .formatToParts(now)
      .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});

    const isMonday = parts.weekday === 'Mon';
    const isNineAM = Number(parts.hour) === 9;
    if (!(isMonday && isNineAM)) {
      return {
        ok: true,
        skipped: true,
        reason: `Not Monday 09:00 Kyiv (current ${parts.weekday} ${parts.hour}:00)`,
        ranAt: now.toISOString(),
      };
    }
  }
  const result = await sendWeeklyDigest(db);
  return { ok: true, ...result, ranAt: now.toISOString() };
}

/**
 * Daily Postgres backup. Spawns `pg_dump` (must be available in PATH),
 * gzips the output, uploads to S3-compatible storage, then prunes
 * objects under `backups/` older than retentionDays.
 *
 * Required env (any S3-compatible: Cloudflare R2, Backblaze B2, AWS,
 * Wasabi, MinIO, DigitalOcean Spaces, Railway S3, etc.):
 *   DATABASE_URL    — Postgres connection string
 *   S3_ENDPOINT     — e.g. https://...r2.cloudflarestorage.com
 *   S3_BUCKET       — bucket name
 *   S3_REGION       — region (use 'auto' for R2)
 *   S3_ACCESS_KEY   — access key id
 *   S3_SECRET_KEY   — secret access key
 */
export async function runDatabaseBackup(opts: { retentionDays?: number; now?: Date } = {}) {
  const retentionDays = opts.retentionDays ?? 30;
  const now = opts.now ?? new Date();

  const env = {
    DATABASE_URL: process.env.DATABASE_URL,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
    S3_SECRET_KEY: process.env.S3_SECRET_KEY,
  };
  const missing = Object.entries(env)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    return {
      ok: false,
      skipped: true,
      reason: `Missing env: ${missing.join(', ')}`,
      ranAt: now.toISOString(),
    };
  }

  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const key = `backups/standardotvorets_${stamp}.sql.gz`;

  // Pipe: pg_dump → gzip → buffer in memory, then upload.
  // For 50MB+ dumps consider streaming directly to S3; for our size
  // (~5–20MB) in-memory is simpler and well within RAM.
  const result = await new Promise<{ buffer: Buffer; dumpErr: string; dumpExit: number | null }>(
    (resolve, reject) => {
      const dump = spawn(
        'pg_dump',
        ['--no-owner', '--no-privileges', '--format=plain', env.DATABASE_URL!],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const gzip = spawn('gzip', ['-9'], { stdio: ['pipe', 'pipe', 'pipe'] });
      dump.stdout.pipe(gzip.stdin);

      let dumpErr = '';
      let gzipErr = '';
      let dumpExit: number | null = null;
      dump.stderr.on('data', (b: Buffer) => (dumpErr += b.toString()));
      gzip.stderr.on('data', (b: Buffer) => (gzipErr += b.toString()));

      const chunks: Buffer[] = [];
      gzip.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      gzip.stdout.on('end', () => resolve({ buffer: Buffer.concat(chunks), dumpErr, dumpExit }));

      dump.on('error', (e) => reject(new Error(`pg_dump spawn failed: ${e.message}`)));
      gzip.on('error', (e) => reject(new Error(`gzip spawn failed: ${e.message}`)));
      dump.on('close', (code) => {
        dumpExit = code;
        if (code !== 0) {
          reject(new Error(`pg_dump exit ${code}: ${dumpErr || gzipErr}`));
        } else if (dumpErr) {
          console.warn('[backup] pg_dump stderr:', dumpErr);
        }
      });
      gzip.on('close', (code) => {
        if (code !== 0) reject(new Error(`gzip exit ${code}: ${gzipErr || dumpErr}`));
      });
    },
  );
  const { buffer, dumpErr, dumpExit } = result;

  if (buffer.length < 1024) {
    return {
      ok: false,
      reason: `Dump suspiciously small (${buffer.length} bytes)`,
      pgDumpExit: dumpExit,
      pgDumpStderr: dumpErr || '(empty)',
      hint: 'If stderr is empty: pg_dump likely connected and returned an empty schema. Check DATABASE_URL host reachability and credentials. If stderr mentions version: install matching postgresql-client-NN in the image.',
      ranAt: now.toISOString(),
    };
  }

  const s3 = new S3Client({
    region: env.S3_REGION!,
    endpoint: env.S3_ENDPOINT!,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY!,
      secretAccessKey: env.S3_SECRET_KEY!,
    },
    forcePathStyle: true,
  });

  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET!,
      Key: key,
      Body: Readable.from(buffer),
      ContentLength: buffer.length,
      ContentType: 'application/gzip',
    }),
  );

  // Prune old objects under backups/
  let pruned = 0;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  let continuationToken: string | undefined;
  do {
    const list = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET!,
        Prefix: 'backups/',
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of list.Contents ?? []) {
      if (obj.LastModified && obj.LastModified < cutoff && obj.Key) {
        await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET!, Key: obj.Key }));
        pruned++;
      }
    }
    continuationToken = list.NextContinuationToken;
  } while (continuationToken);

  return {
    ok: true,
    key,
    bytes: buffer.length,
    pruned,
    retentionDays,
    ranAt: now.toISOString(),
  };
}
