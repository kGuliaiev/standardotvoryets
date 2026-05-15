import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';

function userCtx(session: { user: { globalRole: string; memberships: Array<{ workingGroupId: string; role: string }> } }) {
  return {
    globalRole: session.user.globalRole as GlobalRole,
    memberships: session.user.memberships.map((m) => ({
      workingGroupId: m.workingGroupId,
      role: m.role as WorkingGroupRole,
    })),
  };
}

export const taskRouter = createTRPCRouter({
  // ── list ─────────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        standardId: z.string().cuid().optional(),
        workingGroupId: z.string().cuid().optional(),
        assigneeId: z.string().cuid().optional(),
        status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';

      // Build where clause
      const standardWhere = input.standardId
        ? { id: input.standardId }
        : input.workingGroupId
          ? { workingGroupId: input.workingGroupId }
          : isAdmin
            ? undefined
            : { workingGroupId: { in: memberGroupIds } };

      return ctx.db.task.findMany({
        where: {
          ...(standardWhere ? { standard: standardWhere } : {}),
          ...(input.standardId ? { standardId: input.standardId } : {}),
          ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        include: {
          standard: {
            select: {
              id: true,
              code: true,
              title: true,
              workingGroupId: true,
              workingGroup: { select: { id: true, code: true, color: true } },
            },
          },
          assignee: { select: { id: true, name: true, avatarUrl: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      });
    }),

  // ── byId ─────────────────────────────────────────────────────────────
  byId: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const task = await ctx.db.task.findUnique({
        where: { id: input.id },
        include: {
          standard: {
            include: { workingGroup: true },
          },
          assignee: { select: { id: true, name: true, avatarUrl: true } },
          createdBy: { select: { id: true, name: true } },
        },
      });
      if (!task) throw new TRPCError({ code: 'NOT_FOUND' });
      return task;
    }),

  // ── create ───────────────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        standardId: z.string().cuid(),
        title: z.string().min(2).max(300),
        description: z.string().optional(),
        priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
        assigneeId: z.string().cuid().optional(),
        dueDate: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUniqueOrThrow({
        where: { id: input.standardId },
        select: { workingGroupId: true },
      });

      if (!can(userCtx(ctx.session), 'task:create', standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const task = await ctx.db.task.create({
        data: {
          ...input,
          createdById: ctx.session.user.id,
        },
      });

      // TODO: Notify assignee (TASK-018)

      return task;
    }),

  // ── update ───────────────────────────────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        title: z.string().min(2).max(300).optional(),
        description: z.string().optional(),
        priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
        assigneeId: z.string().cuid().optional().nullable(),
        dueDate: z.date().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.task.findUniqueOrThrow({
        where: { id: input.id },
        include: { standard: { select: { workingGroupId: true } } },
      });

      const uctx = userCtx(ctx.session);
      const isCreator = task.createdById === ctx.session.user.id;
      const isAssignee = task.assigneeId === ctx.session.user.id;
      const canEditAny = can(uctx, 'task:editAny', task.standard.workingGroupId);

      if (!canEditAny && !isCreator && !isAssignee) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const { id, ...data } = input;
      return ctx.db.task.update({ where: { id }, data });
    }),

  // ── changeStatus ──────────────────────────────────────────────────────
  changeStatus: protectedProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.task.findUniqueOrThrow({
        where: { id: input.id },
        include: { standard: { select: { workingGroupId: true } } },
      });

      const uctx = userCtx(ctx.session);
      const isAssignee = task.assigneeId === ctx.session.user.id;
      const isCreator = task.createdById === ctx.session.user.id;
      const canEditAny = can(uctx, 'task:editAny', task.standard.workingGroupId);

      if (!canEditAny && !isAssignee && !isCreator) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return ctx.db.task.update({
        where: { id: input.id },
        data: {
          status: input.status,
          completedAt: input.status === 'DONE' ? new Date() : null,
        },
      });
    }),

  // ── delete ───────────────────────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.task.findUniqueOrThrow({
        where: { id: input.id },
        include: { standard: { select: { workingGroupId: true } } },
      });

      const uctx = userCtx(ctx.session);
      const isCreator = task.createdById === ctx.session.user.id;
      const canDelete =
        ctx.session.user.globalRole === 'ADMIN' ||
        can(uctx, 'standard:changeStatus', task.standard.workingGroupId) ||
        isCreator;

      if (!canDelete) throw new TRPCError({ code: 'FORBIDDEN' });

      return ctx.db.task.delete({ where: { id: input.id } });
    }),

  // ── overdue ───────────────────────────────────────────────────────────
  overdue: protectedProcedure.query(async ({ ctx }) => {
    const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];
    const isAdmin = ctx.session.user.globalRole === 'ADMIN';

    return ctx.db.task.findMany({
      where: {
        dueDate: { lt: new Date() },
        status: { notIn: ['DONE', 'CANCELLED'] },
        ...(isAdmin
          ? {}
          : { standard: { workingGroupId: { in: memberGroupIds } } }),
      },
      include: {
        standard: { select: { id: true, code: true, workingGroupId: true } },
        assignee: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
  }),
});
