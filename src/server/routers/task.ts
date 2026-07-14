import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { logActivity } from '@/server/audit';
import { seesAllWorkingGroups } from '@/server/permissions';
import { notifyTaskAssigned, notifyTaskCompleted } from '@/server/notify';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';

function userCtx(session: {
  user: { globalRole: string; memberships: { workingGroupId: string; role: string }[] };
}) {
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
      const seesAll = seesAllWorkingGroups(ctx.session.user);

      // Build where clause
      const standardWhere = input.standardId
        ? { id: input.standardId }
        : input.workingGroupId
          ? { workingGroupId: input.workingGroupId }
          : seesAll
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
              // Real programme index-grif — surfaced on /tasks so the
              // chip matches the standard's actual registry name
              // instead of the shorter internal `code`. Nullable —
              // client falls back to `code` when unset.
              indeks: true,
              title: true,
              workingGroupId: true,
              workingGroup: { select: { id: true, code: true, color: true } },
            },
          },
          assignee: { select: { id: true, name: true, avatarUrl: true } },
          createdBy: { select: { id: true, name: true } },
          // Just the flags — the row-level badge only needs done/total.
          checklistItems: { select: { id: true, isDone: true } },
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
          createdBy: { select: { id: true, name: true, avatarUrl: true } },
          completedBy: { select: { id: true, name: true, avatarUrl: true } },
          checklistItems: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
        },
      });
      if (!task) throw new TRPCError({ code: 'NOT_FOUND' });

      // RBAC: byId exposes the task with its standard + working group.
      // Restrict to members (admins/director/secretaries see all) — previously
      // any authed user could read any task by cuid (B-7).
      const isMember = ctx.session.user.memberships?.some(
        (m) => m.workingGroupId === task.standard.workingGroupId,
      );
      if (!seesAllWorkingGroups(ctx.session.user) && !isMember) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
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

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'Task',
        entityId: task.id,
        after: task,
      });

      if (task.assigneeId) {
        await notifyTaskAssigned(ctx.db, task.id, ctx.session.user.id);
      }

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
      const updated = await ctx.db.task.update({ where: { id }, data });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Task',
        entityId: id,
        before: task,
        after: updated,
      });

      // Notify new assignee if assignment changed (and is not the actor)
      if (
        data.assigneeId &&
        data.assigneeId !== task.assigneeId &&
        data.assigneeId !== ctx.session.user.id
      ) {
        await notifyTaskAssigned(ctx.db, id, ctx.session.user.id);
      }

      return updated;
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

      const updated = await ctx.db.task.update({
        where: { id: input.id },
        data: {
          status: input.status,
          completedAt: input.status === 'DONE' ? new Date() : null,
          completedById: input.status === 'DONE' ? ctx.session.user.id : null,
        },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'STATUS_CHANGE',
        entity: 'Task',
        entityId: input.id,
        before: { status: task.status },
        after: { status: input.status },
      });

      if (input.status === 'DONE' && task.status !== 'DONE') {
        await notifyTaskCompleted(ctx.db, input.id, ctx.session.user.id);
      }

      return updated;
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

      const deleted = await ctx.db.task.delete({ where: { id: input.id } });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'DELETE',
        entity: 'Task',
        entityId: input.id,
        before: task,
      });
      return deleted;
    }),

  // ── checklist ────────────────────────────────────────────────────────
  // Subtasks under a Task: title + isDone + order. No dates, no
  // assignees — kept intentionally simple. Anyone who can update the
  // parent task can also manage its checklist. Deletes cascade with
  // the parent (DB-side).

  checklistAdd: protectedProcedure
    .input(z.object({ taskId: z.string().cuid(), title: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.task.findUniqueOrThrow({
        where: { id: input.taskId },
        include: { standard: { select: { workingGroupId: true } } },
      });
      const uctx = userCtx(ctx.session);
      const isCreator = task.createdById === ctx.session.user.id;
      const isAssignee = task.assigneeId === ctx.session.user.id;
      if (!can(uctx, 'task:editAny', task.standard.workingGroupId) && !isCreator && !isAssignee) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      // Append at the end — cheapest and no reorder churn.
      const last = await ctx.db.taskChecklistItem.aggregate({
        where: { taskId: input.taskId },
        _max: { order: true },
      });
      const created = await ctx.db.taskChecklistItem.create({
        data: {
          taskId: input.taskId,
          title: input.title.trim(),
          order: (last._max.order ?? 0) + 1,
        },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'TaskChecklistItem',
        entityId: created.id,
        after: created,
        note: `Додано підзадачу «${created.title}»`,
      });
      return created;
    }),

  checklistToggle: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.taskChecklistItem.findUniqueOrThrow({
        where: { id: input.id },
        include: { task: { include: { standard: { select: { workingGroupId: true } } } } },
      });
      const uctx2 = userCtx(ctx.session);
      const isCreator2 = item.task.createdById === ctx.session.user.id;
      const isAssignee2 = item.task.assigneeId === ctx.session.user.id;
      if (
        !can(uctx2, 'task:editAny', item.task.standard.workingGroupId) &&
        !isCreator2 &&
        !isAssignee2
      ) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const updated = await ctx.db.taskChecklistItem.update({
        where: { id: input.id },
        data: { isDone: !item.isDone },
      });
      return updated;
    }),

  checklistUpdate: protectedProcedure
    .input(z.object({ id: z.string().cuid(), title: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.taskChecklistItem.findUniqueOrThrow({
        where: { id: input.id },
        include: { task: { include: { standard: { select: { workingGroupId: true } } } } },
      });
      const uctx2 = userCtx(ctx.session);
      const isCreator2 = item.task.createdById === ctx.session.user.id;
      const isAssignee2 = item.task.assigneeId === ctx.session.user.id;
      if (
        !can(uctx2, 'task:editAny', item.task.standard.workingGroupId) &&
        !isCreator2 &&
        !isAssignee2
      ) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      return ctx.db.taskChecklistItem.update({
        where: { id: input.id },
        data: { title: input.title.trim() },
      });
    }),

  checklistDelete: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.taskChecklistItem.findUniqueOrThrow({
        where: { id: input.id },
        include: { task: { include: { standard: { select: { workingGroupId: true } } } } },
      });
      const uctx2 = userCtx(ctx.session);
      const isCreator2 = item.task.createdById === ctx.session.user.id;
      const isAssignee2 = item.task.assigneeId === ctx.session.user.id;
      if (
        !can(uctx2, 'task:editAny', item.task.standard.workingGroupId) &&
        !isCreator2 &&
        !isAssignee2
      ) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      await ctx.db.taskChecklistItem.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  // ── overdue ───────────────────────────────────────────────────────────
  overdue: protectedProcedure.query(async ({ ctx }) => {
    const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];
    const isAdmin = ctx.session.user.globalRole === 'ADMIN';

    return ctx.db.task.findMany({
      where: {
        dueDate: { lt: new Date() },
        status: { notIn: ['DONE', 'CANCELLED'] },
        ...(isAdmin ? {} : { standard: { workingGroupId: { in: memberGroupIds } } }),
      },
      include: {
        standard: { select: { id: true, code: true, workingGroupId: true } },
        assignee: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: 'asc' },
    });
  }),
});
