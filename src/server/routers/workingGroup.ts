import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { logActivity } from '@/server/audit';
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

export const workingGroupRouter = createTRPCRouter({
  // ── list ─────────────────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const memberships = ctx.session.user.memberships ?? [];
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';
      const isDirector = ctx.session.user.globalRole === 'DIRECTOR';
      // Secretaries see all WGs across the system (per наказ)
      const isAnySecretary = memberships.some((m) => m.role === 'SECRETARY');
      const seesAll = isAdmin || isDirector || isAnySecretary;
      const memberGroupIds = memberships.map((m) => m.workingGroupId);

      return ctx.db.workingGroup.findMany({
        where: {
          ...(seesAll ? {} : { id: { in: memberGroupIds } }),
          ...(input?.includeArchived ? {} : { isArchived: false }),
        },
        include: {
          _count: { select: { members: true, standards: true } },
        },
        orderBy: [{ isArchived: 'asc' }, { code: 'asc' }],
      });
    }),

  // ── byId ─────────────────────────────────────────────────────────────
  byId: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const group = await ctx.db.workingGroup.findUnique({
        where: { id: input.id },
        include: {
          members: {
            include: {
              user: { select: { id: true, name: true, email: true, avatarUrl: true } },
            },
            orderBy: { joinedAt: 'asc' },
          },
          _count: { select: { standards: true, meetings: true } },
        },
      });

      if (!group) throw new TRPCError({ code: 'NOT_FOUND' });

      const isAdmin = ctx.session.user.globalRole === 'ADMIN';
      const isDirector = ctx.session.user.globalRole === 'DIRECTOR';
      const isMember = group.members.some((m) => m.userId === ctx.session.user.id);
      const memberships = ctx.session.user.memberships ?? [];
      const isAnySecretary = memberships.some((m) => m.role === 'SECRETARY');
      if (!isAdmin && !isDirector && !isMember && !isAnySecretary) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return group;
    }),

  // ── create (ADMIN only) ───────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        code: z.string().min(2).max(20),
        name: z.string().min(3).max(200),
        description: z.string().optional(),
        color: z
          .string()
          .regex(/^#[0-9A-F]{6}$/i)
          .default('#1A56DB'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.globalRole !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const existing = await ctx.db.workingGroup.findUnique({ where: { code: input.code } });
      if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'Код вже використовується' });

      return ctx.db.workingGroup.create({ data: input });
    }),

  // ── update ────────────────────────────────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        name: z.string().min(3).max(200).optional(),
        description: z.string().optional(),
        color: z
          .string()
          .regex(/^#[0-9A-F]{6}$/i)
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const uctx = userCtx(ctx.session);
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';
      if (!isAdmin && !can(uctx, 'wg:invite', input.id)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const before = await ctx.db.workingGroup.findUniqueOrThrow({ where: { id: input.id } });
      const { id, ...data } = input;
      const updated = await ctx.db.workingGroup.update({ where: { id }, data });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'WorkingGroup',
        entityId: id,
        before,
        after: updated,
      });
      return updated;
    }),

  // ── addMember ─────────────────────────────────────────────────────────
  addMember: protectedProcedure
    .input(
      z.object({
        workingGroupId: z.string().cuid(),
        userId: z.string().cuid(),
        role: z.enum(['LEADER', 'DEPUTY', 'SECRETARY', 'MEMBER', 'GUEST']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!can(userCtx(ctx.session), 'wg:invite', input.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      return ctx.db.workingGroupMember.upsert({
        where: {
          workingGroupId_userId: { workingGroupId: input.workingGroupId, userId: input.userId },
        },
        create: input,
        update: { role: input.role },
      });
    }),

  // ── removeMember ──────────────────────────────────────────────────────
  removeMember: protectedProcedure
    .input(
      z.object({
        workingGroupId: z.string().cuid(),
        userId: z.string().cuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!can(userCtx(ctx.session), 'wg:removeMember', input.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      return ctx.db.workingGroupMember.delete({
        where: {
          workingGroupId_userId: { workingGroupId: input.workingGroupId, userId: input.userId },
        },
      });
    }),

  // ── changeMemberRole ──────────────────────────────────────────────────
  changeMemberRole: protectedProcedure
    .input(
      z.object({
        workingGroupId: z.string().cuid(),
        userId: z.string().cuid(),
        role: z.enum(['LEADER', 'DEPUTY', 'SECRETARY', 'MEMBER', 'GUEST']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!can(userCtx(ctx.session), 'wg:invite', input.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      return ctx.db.workingGroupMember.update({
        where: {
          workingGroupId_userId: { workingGroupId: input.workingGroupId, userId: input.userId },
        },
        data: { role: input.role },
      });
    }),

  // ── setArchived (ADMIN only) ─────────────────────────────────────────
  setArchived: protectedProcedure
    .input(z.object({ id: z.string().cuid(), isArchived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.globalRole !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const updated = await ctx.db.workingGroup.update({
        where: { id: input.id },
        data: { isArchived: input.isArchived },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: input.isArchived ? 'ARCHIVE' : 'RESTORE',
        entity: 'WorkingGroup',
        entityId: input.id,
        before: { isArchived: !input.isArchived },
        after: { isArchived: input.isArchived },
      });
      return updated;
    }),

  // ── stats ─────────────────────────────────────────────────────────────
  stats: protectedProcedure
    .input(z.object({ workingGroupId: z.string().cuid().optional() }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';

      const groups = await ctx.db.workingGroup.findMany({
        where: {
          ...(input.workingGroupId ? { id: input.workingGroupId } : {}),
          ...(isAdmin ? {} : { id: { in: memberGroupIds } }),
        },
        include: {
          meetings: {
            where: { startAt: { gte: startOfMonth } },
            select: { status: true },
          },
          _count: {
            select: {
              standards: true,
              members: true,
            },
          },
        },
      });

      return groups.map((g) => ({
        id: g.id,
        code: g.code,
        name: g.name,
        color: g.color,
        membersCount: g._count.members,
        standardsCount: g._count.standards,
        meetingsPlanned: g.meetings.filter((m) => m.status === 'PLANNED').length,
        meetingsDone: g.meetings.filter((m) => m.status === 'COMPLETED').length,
        meetingsTotal: g.meetings.length,
      }));
    }),
});
