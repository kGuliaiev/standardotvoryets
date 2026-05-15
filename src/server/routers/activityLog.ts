import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';

export const activityLogRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        entity: z.enum(['Standard', 'Meeting', 'Task', 'WorkingGroup', 'User', 'Document', 'Vote']),
        entityId: z.string().cuid(),
        limit: z.number().min(1).max(100).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.activityLog.findMany({
        where: { entity: input.entity, entityId: input.entityId },
        include: {
          user: {
            select: { id: true, name: true, avatarUrl: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
      });
    }),
});
