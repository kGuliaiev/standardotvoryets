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

      // Collapse the per-recipient fan-out: the same logical event shares
      // (type, title, body, link) and is created within the same minute.
      const seen = new Set<string>();
      const deduped: typeof rows = [];
      for (const n of rows) {
        const minute = Math.floor(new Date(n.createdAt).getTime() / 60_000);
        const key = `${n.type}|${n.title}|${n.body}|${n.link ?? ''}|${minute}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(n);
        if (deduped.length >= input.limit) break;
      }
      return deduped;
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
