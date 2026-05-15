import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { logActivity } from '@/server/audit';

// Whitelist of fields we allow to be restored, per entity.
const RESTORABLE_FIELDS: Record<string, string[]> = {
  Standard: [
    'title',
    'description',
    'isoAnalog',
    'category',
    'deadline',
    'responsibleId',
    'progress',
    'status',
  ],
  Meeting: [
    'title',
    'format',
    'location',
    'startAt',
    'durationMins',
    'agendaText',
    'minutesText',
    'status',
  ],
  Task: ['title', 'description', 'priority', 'assigneeId', 'dueDate', 'status'],
  WorkingGroup: ['name', 'description', 'color', 'isArchived'],
  User: ['globalRole', 'isActive'],
};

const DATE_FIELDS = new Set([
  'deadline',
  'startAt',
  'dueDate',
  'createdAt',
  'updatedAt',
  'completedAt',
]);

function coerceValue(field: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (DATE_FIELDS.has(field) && typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d;
  }
  return value;
}

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

  restore: protectedProcedure
    .input(z.object({ logId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const entry = await ctx.db.activityLog.findUniqueOrThrow({
        where: { id: input.logId },
      });

      // Permission: ADMIN or the user who made the original change can revert.
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';
      const isAuthor = entry.userId === ctx.session.user.id;
      if (!isAdmin && !isAuthor) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Лише адмін або автор зміни може скасувати',
        });
      }

      if (!entry.before) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Немає попереднього стану' });
      }

      const allowed = RESTORABLE_FIELDS[entry.entity];
      if (!allowed) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Скасування для ${entry.entity} не підтримується`,
        });
      }

      const before = entry.before as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      for (const field of allowed) {
        if (field in before) {
          data[field] = coerceValue(field, before[field]);
        }
      }

      if (Object.keys(data).length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Немає полів для відновлення',
        });
      }

      // Apply restore. Each entity is its own Prisma model.
      let restored: unknown;
      switch (entry.entity) {
        case 'Standard':
          restored = await ctx.db.standard.update({
            where: { id: entry.entityId },
            data,
          });
          break;
        case 'Meeting':
          restored = await ctx.db.meeting.update({
            where: { id: entry.entityId },
            data,
          });
          break;
        case 'Task':
          restored = await ctx.db.task.update({
            where: { id: entry.entityId },
            data,
          });
          break;
        case 'WorkingGroup':
          restored = await ctx.db.workingGroup.update({
            where: { id: entry.entityId },
            data,
          });
          break;
        case 'User':
          restored = await ctx.db.user.update({
            where: { id: entry.entityId },
            data,
          });
          break;
        default:
          throw new TRPCError({ code: 'BAD_REQUEST' });
      }

      // Log the restore itself
      const restoreEntity = entry.entity as
        | 'Standard'
        | 'Meeting'
        | 'Task'
        | 'WorkingGroup'
        | 'User'
        | 'Document'
        | 'Vote';
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'RESTORE',
        entity: restoreEntity,
        entityId: entry.entityId,
        before: entry.after as Record<string, unknown> | null,
        after: data,
        note: `Скасована зміна від ${new Date(entry.createdAt).toLocaleString('uk-UA')}`,
      });

      return restored;
    }),
});
