import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { logActivity } from '@/server/audit';
import { seesAllWorkingGroups } from '@/server/permissions';
import { notifyStandardStatusChanged } from '@/server/notify';
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

export const standardRouter = createTRPCRouter({
  // ── list (paginated + filtered) ───────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        workingGroupId: z.string().cuid().optional(),
        status: z
          .enum(['DRAFT', 'IN_REVIEW', 'VOTING', 'ADOPTED', 'REJECTED', 'ARCHIVED'])
          .optional(),
        search: z.string().optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const seesAll = seesAllWorkingGroups(ctx.session.user);
      const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];

      const where = {
        ...(input.workingGroupId
          ? { workingGroupId: input.workingGroupId }
          : seesAll
            ? {}
            : { workingGroupId: { in: memberGroupIds } }),
        ...(input.status ? { status: input.status } : {}),
        ...(input.search
          ? {
              OR: [
                { code: { contains: input.search, mode: 'insensitive' as const } },
                { title: { contains: input.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        ctx.db.standard.findMany({
          where,
          include: {
            workingGroup: { select: { id: true, code: true, color: true } },
            responsible: { select: { id: true, name: true, avatarUrl: true } },
            _count: { select: { documents: true, comments: true, tasks: true } },
          },
          orderBy: { updatedAt: 'desc' },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.db.standard.count({ where }),
      ]);

      return {
        items,
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(total / input.pageSize),
      };
    }),

  // ── byId ─────────────────────────────────────────────────────────────
  byId: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUnique({
        where: { id: input.id },
        include: {
          workingGroup: {
            include: {
              members: {
                include: {
                  user: {
                    select: { id: true, name: true, avatarUrl: true, rank: true, position: true },
                  },
                },
              },
            },
          },
          responsible: { select: { id: true, name: true, avatarUrl: true } },
          documents: {
            include: { uploadedBy: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'desc' },
          },
          comments: {
            include: {
              author: { select: { id: true, name: true, avatarUrl: true } },
              replies: {
                include: { author: { select: { id: true, name: true, avatarUrl: true } } },
              },
            },
            where: { parentId: null },
            orderBy: { createdAt: 'desc' },
          },
          votes: {
            include: { votes: { include: { user: { select: { id: true, name: true } } } } },
            orderBy: { openedAt: 'desc' },
          },
          tasks: {
            include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
            orderBy: { createdAt: 'desc' },
          },
          statusHistory: {
            orderBy: { changedAt: 'desc' },
            include: {
              changedBy: { select: { id: true, name: true, avatarUrl: true, rank: true } },
            },
          },
        },
      });

      if (!standard) throw new TRPCError({ code: 'NOT_FOUND' });

      const seesAll = seesAllWorkingGroups(ctx.session.user);
      const isMember = standard.workingGroup.members.some((m) => m.userId === ctx.session.user.id);
      if (!seesAll && !isMember) throw new TRPCError({ code: 'FORBIDDEN' });

      return standard;
    }),

  // ── create ───────────────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        workingGroupId: z.string().cuid(),
        code: z.string().min(2).max(30),
        title: z.string().min(5).max(300),
        description: z.string().optional(),
        isoAnalog: z.string().optional(),
        category: z.string().optional(),
        deadline: z.date().optional(),
        responsibleId: z.string().cuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!can(userCtx(ctx.session), 'standard:create', input.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const existing = await ctx.db.standard.findUnique({
        where: { workingGroupId_code: { workingGroupId: input.workingGroupId, code: input.code } },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Стандарт з таким кодом вже існує' });
      }

      const standard = await ctx.db.standard.create({
        data: input,
      });

      // Create initial status history record
      await ctx.db.standardStatusHistory.create({
        data: {
          standardId: standard.id,
          fromStatus: null,
          toStatus: 'DRAFT',
          changedById: ctx.session.user.id,
          note: 'Стандарт створено',
        },
      });

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'Standard',
        entityId: standard.id,
        after: standard,
      });

      return standard;
    }),

  // ── update ───────────────────────────────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        title: z.string().min(5).max(300).optional(),
        description: z.string().optional(),
        isoAnalog: z.string().optional(),
        category: z.string().optional(),
        deadline: z.date().optional().nullable(),
        responsibleId: z.string().cuid().optional().nullable(),
        progress: z.number().min(0).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUniqueOrThrow({ where: { id: input.id } });

      const uctx = userCtx(ctx.session);
      if (!can(uctx, 'standard:editMeta', standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const { id, ...data } = input;
      const updated = await ctx.db.standard.update({ where: { id }, data });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Standard',
        entityId: id,
        before: standard,
        after: updated,
      });
      return updated;
    }),

  // ── changeStatus ──────────────────────────────────────────────────────
  changeStatus: protectedProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        status: z.enum(['DRAFT', 'IN_REVIEW', 'VOTING', 'ADOPTED', 'REJECTED', 'ARCHIVED']),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUniqueOrThrow({ where: { id: input.id } });

      if (!can(userCtx(ctx.session), 'standard:changeStatus', standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const [updated] = await ctx.db.$transaction([
        ctx.db.standard.update({
          where: { id: input.id },
          data: { status: input.status },
        }),
        ctx.db.standardStatusHistory.create({
          data: {
            standardId: input.id,
            fromStatus: standard.status,
            toStatus: input.status,
            changedById: ctx.session.user.id,
            note: input.note,
          },
        }),
      ]);

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: input.status === 'ARCHIVED' ? 'ARCHIVE' : 'STATUS_CHANGE',
        entity: 'Standard',
        entityId: input.id,
        before: { status: standard.status },
        after: { status: input.status },
        note: input.note,
      });

      await notifyStandardStatusChanged(
        ctx.db,
        input.id,
        standard.status,
        input.status,
        ctx.session.user.id,
      );

      return updated;
    }),

  // ── confirmStage (secretary/leader marks a stage as actually completed)
  //   Toggling: pass confirmed=true to set timestamp, false to clear it.
  //   currentStage is auto-recomputed as the first unconfirmed stage.
  confirmStage: protectedProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        stage: z.enum(['TECH_SPEC', 'DRAFTING', 'FEEDBACK', 'TECH_REVIEW', 'FINALIZATION']),
        confirmed: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUniqueOrThrow({ where: { id: input.id } });
      // Only secretary, leader, deputy, or admin can confirm stages
      const uctx = userCtx(ctx.session);
      const m = uctx.memberships.find((mb) => mb.workingGroupId === standard.workingGroupId);
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';
      const canConfirm =
        isAdmin || m?.role === 'SECRETARY' || m?.role === 'LEADER' || m?.role === 'DEPUTY';
      if (!canConfirm) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Лише секретар, керівник або заступник РГ можуть підтверджувати етапи',
        });
      }

      const STAGE_KEY: Record<typeof input.stage, keyof typeof standard> = {
        TECH_SPEC: 'techSpecCompletedAt',
        DRAFTING: 'draftCompletedAt',
        FEEDBACK: 'feedbackCompletedAt',
        TECH_REVIEW: 'techReviewCompletedAt',
        FINALIZATION: 'finalCompletedAt',
      } as const;

      const key = STAGE_KEY[input.stage];
      const updateData: Record<string, Date | null | string> = {
        [key]: input.confirmed ? new Date() : null,
      };

      // Recompute currentStage = first unconfirmed stage (or COMPLETED if all set)
      const merged = { ...standard, [key]: input.confirmed ? new Date() : null };
      const order = ['TECH_SPEC', 'DRAFTING', 'FEEDBACK', 'TECH_REVIEW', 'FINALIZATION'] as const;
      let next = 'COMPLETED' as
        | 'TECH_SPEC'
        | 'DRAFTING'
        | 'FEEDBACK'
        | 'TECH_REVIEW'
        | 'FINALIZATION'
        | 'COMPLETED';
      for (const s of order) {
        if (!merged[STAGE_KEY[s]]) {
          next = s;
          break;
        }
      }
      updateData.currentStage = next;

      const updated = await ctx.db.standard.update({
        where: { id: input.id },
        data: updateData,
      });

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'STATUS_CHANGE',
        entity: 'Standard',
        entityId: input.id,
        before: { [String(key)]: standard[key] },
        after: { [String(key)]: updateData[key] },
        note: `Етап ${input.stage}: ${input.confirmed ? 'підтверджено виконання' : 'знято підтвердження'}`,
      });
      return updated;
    }),

  // ── delete (ADMIN only) ───────────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.globalRole !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const before = await ctx.db.standard.findUniqueOrThrow({ where: { id: input.id } });
      const deleted = await ctx.db.standard.delete({ where: { id: input.id } });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'DELETE',
        entity: 'Standard',
        entityId: input.id,
        before,
      });
      return deleted;
    }),
});
