import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import type { NotificationType, PrismaClient } from '@prisma/client';

export const notificationRouter = createTRPCRouter({
  // ── list ─────────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        unreadOnly: z.boolean().default(false),
        limit: z.number().min(1).max(200).default(50),
        types: z
          .array(
            z.enum([
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
            ]),
          )
          .optional(),
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
