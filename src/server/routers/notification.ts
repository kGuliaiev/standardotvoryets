import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { seesAllWorkingGroups } from '@/server/permissions';
import type { NotificationType, PrismaClient } from '@prisma/client';

const NOTIFICATION_TYPES = [
  'MEETING_INVITE',
  'MEETING_REMINDER',
  'VOTE_OPENED',
  'VOTE_CLOSED',
  'DOCUMENT_UPLOADED',
  'COMMENT_ADDED',
  'TASK_ASSIGNED',
  'TASK_OVERDUE',
  'STANDARD_STATUS_CHANGED',
  'STAGE_DUE_SOON',
  'STAGE_OVERDUE',
  'STAGE_COMPLETED',
  'WEEKLY_DIGEST',
  'ATTENDANCE_DECLINED',
  'PROTOCOL_PUBLISHED',
  'MENTION',
  'SUGGESTION_NEW',
  'SUGGESTION_RESOLVED',
] as const;

export const notificationRouter = createTRPCRouter({
  // ── list ─────────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        unreadOnly: z.boolean().default(false),
        limit: z.number().min(1).max(200).default(50),
        types: z.array(z.enum(NOTIFICATION_TYPES)).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.notification.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input.unreadOnly ? { read: false } : {}),
          ...(input.types && input.types.length > 0 ? { type: { in: input.types } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
      });
    }),

  // ── listForStandard ───────────────────────────────────────────────────
  // Standard-scoped "Журнал": every notification about this standard,
  // across all recipients, de-duplicated (a single event fans out to
  // many users). Covers notifications linking to /standards/<id> plus
  // this standard's own tasks (which link to /tasks/<id>). Meetings are
  // tied to the working group, not the standard, so they're excluded.
  listForStandard: protectedProcedure
    .input(
      z.object({
        standardId: z.string().cuid(),
        types: z.array(z.enum(NOTIFICATION_TYPES)).optional(),
        limit: z.number().min(1).max(500).default(300),
      }),
    )
    .query(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUnique({
        where: { id: input.standardId },
        select: { workingGroup: { select: { members: { select: { userId: true } } } } },
      });
      if (!standard) throw new TRPCError({ code: 'NOT_FOUND' });
      const seesAll = seesAllWorkingGroups(ctx.session.user);
      const isMember = standard.workingGroup.members.some((m) => m.userId === ctx.session.user.id);
      if (!seesAll && !isMember) throw new TRPCError({ code: 'FORBIDDEN' });

      const tasks = await ctx.db.task.findMany({
        where: { standardId: input.standardId },
        select: { id: true },
      });
      const taskLinks = tasks.map((t) => `/tasks/${t.id}`);

      const rows = await ctx.db.notification.findMany({
        where: {
          AND: [
            ...(input.types && input.types.length > 0 ? [{ type: { in: input.types } }] : []),
            {
              OR: [
                { link: { startsWith: `/standards/${input.standardId}` } },
                ...(taskLinks.length > 0 ? [{ link: { in: taskLinks } }] : []),
              ],
            },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      });

      // The journal is a SHARED activity feed, so personalised titles read
      // wrong for other viewers. A mention notification is stored as
      // "<Author> згадав вас у коментарі" (addressed to the mentioned person);
      // shown to anyone else it falsely implies they were mentioned. Re-title
      // mentions neutrally here — the personalised "…згадав вас…" still appears
      // in the recipient's own inbox (feedForUser), which uses the raw title.
      const MENTION_SUFFIX = ' згадав вас у коментарі';
      const journalTitle = (type: NotificationType, title: string): string => {
        if (type === 'MENTION' && title.endsWith(MENTION_SUFFIX)) {
          return `${title.slice(0, -MENTION_SUFFIX.length)} написав коментар`;
        }
        return title;
      };

      // Collapse the per-recipient fan-out (same type/title/body/link within
      // the same minute = one event) and flag whether *this* user still has
      // an unread copy of it, so the journal can highlight what's new for them.
      const me = ctx.session.user.id;
      const groups = new Map<
        string,
        {
          id: string;
          type: NotificationType;
          title: string;
          body: string;
          link: string | null;
          createdAt: Date;
          unread: boolean;
        }
      >();
      for (const n of rows) {
        const minute = Math.floor(new Date(n.createdAt).getTime() / 60_000);
        const key = `${n.type}|${n.title}|${n.body}|${n.link ?? ''}|${minute}`;
        const mineUnread = n.userId === me && !n.read;
        const existing = groups.get(key);
        if (!existing) {
          groups.set(key, {
            id: n.id,
            type: n.type,
            title: journalTitle(n.type, n.title),
            body: n.body,
            link: n.link,
            createdAt: n.createdAt,
            unread: mineUnread,
          });
        } else if (mineUnread) {
          existing.unread = true;
        }
      }
      return Array.from(groups.values()).slice(0, input.limit);
    }),

  // ── markStandardRead ──────────────────────────────────────────────────
  // Marks the CURRENT user's unread notifications for this standard (and
  // its tasks) as read — i.e. only what the journal shows here, not the
  // whole notification inbox.
  markStandardRead: protectedProcedure
    .input(z.object({ standardId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const tasks = await ctx.db.task.findMany({
        where: { standardId: input.standardId },
        select: { id: true },
      });
      const taskLinks = tasks.map((t) => `/tasks/${t.id}`);
      const res = await ctx.db.notification.updateMany({
        where: {
          userId: ctx.session.user.id,
          read: false,
          OR: [
            { link: { startsWith: `/standards/${input.standardId}` } },
            ...(taskLinks.length > 0 ? [{ link: { in: taskLinks } }] : []),
          ],
        },
        data: { read: true },
      });
      return { ok: true, count: res.count };
    }),

  // ── unreadCount ───────────────────────────────────────────────────────
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.notification.count({
      where: { userId: ctx.session.user.id, read: false },
    });
  }),

  // ── markRead ─────────────────────────────────────────────────────────
  markRead: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.notification.update({
        where: { id: input.id, userId: ctx.session.user.id },
        data: { read: true },
      });
    }),

  // ── markAllRead ───────────────────────────────────────────────────────
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    return ctx.db.notification.updateMany({
      where: { userId: ctx.session.user.id, read: false },
      data: { read: true },
    });
  }),

  // ── delete a single notification ─────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      // Ownership-scoped delete: notification must belong to caller
      return ctx.db.notification.deleteMany({
        where: { id: input.id, userId: ctx.session.user.id },
      });
    }),

  // ── deleteAll (for the current user) ─────────────────────────────────
  deleteAll: protectedProcedure.mutation(async ({ ctx }) => {
    return ctx.db.notification.deleteMany({
      where: { userId: ctx.session.user.id },
    });
  }),
});

// ── Helper: create a notification (used by other routers) ─────────────────────
export async function createNotification(
  db: PrismaClient,
  {
    userId,
    type,
    title,
    body,
    link,
  }: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    link?: string;
  },
) {
  return db.notification.create({
    data: { userId, type, title, body, link },
  });
}
