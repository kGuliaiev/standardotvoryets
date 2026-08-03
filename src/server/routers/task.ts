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
          // Full subtask fields — the row can expand inline via a chevron
          // and show titles + due dates + assignees without a follow-up
          // fetch. Payload is bounded (typical task has <10 subtasks).
          checklistItems: {
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
          },
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
          checklistItems: {
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
          },
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
    .input(
      z.object({
        id: z.string().cuid(),
        // Every field is `optional`: partial patch. `null` is the
        // explicit "clear" for the nullable fields (description /
        // dueDate / assigneeId) so the client can disambiguate
        // "unchanged" (undefined) from "erase" (null).
        title: z.string().min(1).max(500).optional(),
        description: z.string().max(5000).nullable().optional(),
        dueDate: z.date().nullable().optional(),
        assigneeId: z.string().cuid().nullable().optional(),
      }),
    )
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
      const data: {
        title?: string;
        description?: string | null;
        dueDate?: Date | null;
        assigneeId?: string | null;
      } = {};
      if (input.title !== undefined) data.title = input.title.trim();
      if (input.description !== undefined) data.description = input.description;
      if (input.dueDate !== undefined) data.dueDate = input.dueDate;
      if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId;
      return ctx.db.taskChecklistItem.update({
        where: { id: input.id },
        data,
        include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
      });
    }),

  // Reorder items within a task. Client sends the desired sequence
  // (all item ids in the new order); server rewrites `order` in a
  // single transaction. Missing ids keep their existing order — this
  // keeps the RPC forgiving if a concurrent delete raced with the
  // reorder.
  checklistReorder: protectedProcedure
    .input(
      z.object({
        taskId: z.string().cuid(),
        orderedIds: z.array(z.string().cuid()).min(1).max(500),
      }),
    )
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
      // Only reorder items that actually belong to this task — silently
      // ignore ids that don't (client desync, race with delete).
      const own = await ctx.db.taskChecklistItem.findMany({
        where: { taskId: input.taskId, id: { in: input.orderedIds } },
        select: { id: true },
      });
      const ownSet = new Set(own.map((i) => i.id));
      const finalOrder = input.orderedIds.filter((id) => ownSet.has(id));
      await ctx.db.$transaction(
        finalOrder.map((id, idx) =>
          ctx.db.taskChecklistItem.update({ where: { id }, data: { order: idx + 1 } }),
        ),
      );
      return { ok: true };
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

  // ── copyFromTemplate ────────────────────────────────────────────────
  // Clone every task (+ its subtasks) from a source standard into a
  // target one. Task and subtask due dates are rebased against the
  // target's stage plan: each source date is bound to its closest
  // source stage (by absolute distance), then a new date is placed
  // relative to the SAME stage on the target (same day-offset).
  //   - If a source date has no set stages to bind to → keep as-is
  //   - If the target's matched stage is null           → clear
  //     (a stage-anchored task without a target anchor cannot be
  //     placed meaningfully)
  // Assignees are dropped (cleared) by default — copying between WGs
  // means source assignees may not be members of the target WG.
  copyFromTemplate: protectedProcedure
    .input(
      z.object({
        sourceStandardId: z.string().cuid(),
        targetStandardId: z.string().cuid(),
        // 'append' — add cloned tasks alongside existing ones
        // 'replace' — delete the target's existing tasks first
        mode: z.enum(['append', 'replace']).default('append'),
        resetAssignees: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.sourceStandardId === input.targetStandardId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Джерело і ціль співпадають — оберіть інший стандарт',
        });
      }

      const [source, target] = await Promise.all([
        ctx.db.standard.findUniqueOrThrow({
          where: { id: input.sourceStandardId },
          include: {
            tasks: {
              include: {
                checklistItems: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        }),
        ctx.db.standard.findUniqueOrThrow({
          where: { id: input.targetStandardId },
          select: {
            id: true,
            workingGroupId: true,
            techSpecDueDate: true,
            draftDueDate: true,
            feedbackDueDate: true,
            techReviewDueDate: true,
            finalDueDate: true,
          },
        }),
      ]);

      const uctx = userCtx(ctx.session);
      if (!can(uctx, 'task:create', target.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      type StageKey = 'techSpec' | 'draft' | 'feedback' | 'techReview' | 'final';
      const STAGE_FIELDS: Record<StageKey, keyof typeof source> = {
        techSpec: 'techSpecDueDate',
        draft: 'draftDueDate',
        feedback: 'feedbackDueDate',
        techReview: 'techReviewDueDate',
        final: 'finalDueDate',
      };

      function stageDate(std: Record<string, unknown>, k: StageKey): Date | null {
        const v = std[STAGE_FIELDS[k]] as Date | null | undefined;
        return v ? new Date(v) : null;
      }

      // Bind a date to the nearest source stage. Returns null if no
      // source stage has a date (fully unstructured template).
      function nearestStage(due: Date): StageKey | null {
        let bestKey: StageKey | null = null;
        let bestDiff = Number.POSITIVE_INFINITY;
        for (const k of Object.keys(STAGE_FIELDS) as StageKey[]) {
          const d = stageDate(source, k);
          if (!d) continue;
          const diff = Math.abs(due.getTime() - d.getTime());
          if (diff < bestDiff) {
            bestKey = k;
            bestDiff = diff;
          }
        }
        return bestKey;
      }

      function rebase(due: Date | null): Date | null {
        if (!due) return null;
        const k = nearestStage(due);
        if (!k) return due; // template with no stages — leave the raw date
        const srcAnchor = stageDate(source, k);
        const tgtAnchor = stageDate(target, k);
        if (!srcAnchor || !tgtAnchor) return null;
        const offsetMs = due.getTime() - srcAnchor.getTime();
        return new Date(tgtAnchor.getTime() + offsetMs);
      }

      // Perform the copy inside a single transaction so a partial
      // failure (bad rebase, race with delete) leaves neither side
      // half-copied.
      const result = await ctx.db.$transaction(
        async (tx) => {
          let replaced = 0;
          if (input.mode === 'replace') {
            const del = await tx.task.deleteMany({ where: { standardId: target.id } });
            replaced = del.count;
          }
          let createdTasks = 0;
          let createdSubtasks = 0;
          for (const src of source.tasks) {
            const clonedTask = await tx.task.create({
              data: {
                standardId: target.id,
                createdById: ctx.session.user.id,
                assigneeId: input.resetAssignees ? null : src.assigneeId,
                title: src.title,
                description: src.description,
                priority: src.priority,
                // Status resets to OPEN — a cloned template item is fresh
                // work, not a mirror of the source's completion state.
                status: 'OPEN',
                dueDate: src.dueDate ? rebase(new Date(src.dueDate)) : null,
              },
            });
            createdTasks += 1;
            for (const sub of src.checklistItems) {
              await tx.taskChecklistItem.create({
                data: {
                  taskId: clonedTask.id,
                  title: sub.title,
                  description: sub.description,
                  order: sub.order,
                  isDone: false,
                  dueDate: sub.dueDate ? rebase(new Date(sub.dueDate)) : null,
                  assigneeId: input.resetAssignees ? null : sub.assigneeId,
                },
              });
              createdSubtasks += 1;
            }
          }
          return { createdTasks, createdSubtasks, replaced };
        },
        { timeout: 30_000 },
      );

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'Task',
        entityId: target.id,
        note:
          `Скопійовано з шаблону: ${result.createdTasks} задач, ${result.createdSubtasks} підзадач` +
          (input.mode === 'replace' ? `, видалено попередніх: ${result.replaced}` : ''),
      });

      return result;
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
