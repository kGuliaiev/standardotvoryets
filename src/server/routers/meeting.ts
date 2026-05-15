import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { logActivity } from '@/server/audit';
import { seesAllWorkingGroups } from '@/server/permissions';
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

export const meetingRouter = createTRPCRouter({
  // ── list (for calendar) ───────────────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        workingGroupId: z.string().cuid().optional(),
        month: z.number().min(1).max(12).optional(),
        year: z.number().min(2020).max(2100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];
      const seesAll = seesAllWorkingGroups(ctx.session.user);

      // Date range filter
      let dateFilter = {};
      if (input.month && input.year) {
        const start = new Date(input.year, input.month - 1, 1);
        const end = new Date(input.year, input.month, 0, 23, 59, 59);
        dateFilter = { startAt: { gte: start, lte: end } };
      }

      return ctx.db.meeting.findMany({
        where: {
          ...(input.workingGroupId
            ? { workingGroupId: input.workingGroupId }
            : seesAll
              ? {}
              : { workingGroupId: { in: memberGroupIds } }),
          ...dateFilter,
          status: { not: 'CANCELLED' },
        },
        include: {
          workingGroup: { select: { id: true, code: true, color: true } },
          _count: { select: { attendances: true } },
        },
        orderBy: { startAt: 'asc' },
      });
    }),

  // ── byId ─────────────────────────────────────────────────────────────
  byId: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const meeting = await ctx.db.meeting.findUnique({
        where: { id: input.id },
        include: {
          workingGroup: {
            select: {
              id: true,
              code: true,
              name: true,
              color: true,
              members: {
                include: {
                  user: { select: { id: true, name: true, rank: true, position: true } },
                },
                orderBy: { joinedAt: 'asc' },
              },
            },
          },
          createdBy: { select: { id: true, name: true, rank: true, position: true } },
          chairman: { select: { id: true, name: true, rank: true, position: true } },
          agendaItems: {
            orderBy: { order: 'asc' },
            include: {
              speaker: { select: { id: true, name: true, rank: true, position: true } },
              responsible: { select: { id: true, name: true, rank: true, position: true } },
            },
          },
          attendances: {
            include: {
              user: {
                select: { id: true, name: true, avatarUrl: true, rank: true, position: true },
              },
            },
            orderBy: { user: { name: 'asc' } },
          },
        },
      });

      if (!meeting) throw new TRPCError({ code: 'NOT_FOUND' });
      return meeting;
    }),

  // ── create ───────────────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        workingGroupId: z.string().cuid(),
        title: z.string().min(3).max(300),
        format: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).default('ONLINE'),
        location: z.string().optional(),
        startAt: z.date(),
        durationMins: z.number().min(15).max(480).default(60),
        agendaText: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!can(userCtx(ctx.session), 'meeting:create', input.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      // Get all members to auto-create attendance records
      const members = await ctx.db.workingGroupMember.findMany({
        where: { workingGroupId: input.workingGroupId },
        select: { userId: true },
      });

      const meeting = await ctx.db.meeting.create({
        data: {
          ...input,
          createdById: ctx.session.user.id,
          attendances: {
            create: members.map((m) => ({ userId: m.userId })),
          },
        },
        include: {
          workingGroup: { select: { id: true, code: true, color: true } },
          attendances: { include: { user: { select: { id: true, name: true } } } },
        },
      });

      // TODO: Enqueue email invites (TASK-015)

      return meeting;
    }),

  // ── update ───────────────────────────────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        title: z.string().min(3).max(300).optional(),
        format: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).optional(),
        location: z.string().optional(),
        startAt: z.date().optional(),
        durationMins: z.number().min(15).max(480).optional(),
        agendaText: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const meeting = await ctx.db.meeting.findUniqueOrThrow({ where: { id: input.id } });

      if (!can(userCtx(ctx.session), 'meeting:create', meeting.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const { id, ...data } = input;
      const updated = await ctx.db.meeting.update({ where: { id }, data });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Meeting',
        entityId: id,
        before: meeting,
        after: updated,
      });
      return updated;
    }),

  // ── cancel ────────────────────────────────────────────────────────────
  cancel: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const meeting = await ctx.db.meeting.findUniqueOrThrow({ where: { id: input.id } });

      if (!can(userCtx(ctx.session), 'meeting:cancel', meeting.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const cancelled = await ctx.db.meeting.update({
        where: { id: input.id },
        data: { status: 'CANCELLED' },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'STATUS_CHANGE',
        entity: 'Meeting',
        entityId: input.id,
        before: { status: meeting.status },
        after: { status: 'CANCELLED' },
        note: 'Засідання скасовано',
      });
      return cancelled;
    }),

  // ── confirmAttendance ─────────────────────────────────────────────────
  confirmAttendance: protectedProcedure
    .input(
      z.object({
        meetingId: z.string().cuid(),
        status: z.enum(['CONFIRMED', 'DECLINED']),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.attendance.update({
        where: {
          meetingId_userId: {
            meetingId: input.meetingId,
            userId: ctx.session.user.id,
          },
        },
        data: { status: input.status, note: input.note },
      });
    }),

  // ── setAttendance (secretary / leader / admin can change for anyone) ─
  setAttendance: protectedProcedure
    .input(
      z.object({
        meetingId: z.string().cuid(),
        userId: z.string().cuid(),
        status: z.enum(['PENDING', 'CONFIRMED', 'DECLINED']),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const meeting = await ctx.db.meeting.findUniqueOrThrow({
        where: { id: input.meetingId },
      });
      const uctx = userCtx(ctx.session);
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';
      const isPrivileged = isAdmin || can(uctx, 'meeting:uploadMinutes', meeting.workingGroupId);
      if (!isPrivileged) throw new TRPCError({ code: 'FORBIDDEN' });

      return ctx.db.attendance.upsert({
        where: { meetingId_userId: { meetingId: input.meetingId, userId: input.userId } },
        update: { status: input.status, note: input.note },
        create: {
          meetingId: input.meetingId,
          userId: input.userId,
          status: input.status,
          note: input.note,
        },
      });
    }),

  // ── upsertAgendaItem (secretary / leader / admin) ────────────────────
  upsertAgendaItem: protectedProcedure
    .input(
      z.object({
        id: z.string().cuid().optional(),
        meetingId: z.string().cuid(),
        order: z.number().int().min(0),
        title: z.string().min(2).max(500),
        speakerId: z.string().cuid().optional().nullable(),
        heardText: z.string().optional().nullable(),
        discussionText: z.string().optional().nullable(),
        decisionText: z.string().optional().nullable(),
        deadline: z.date().optional().nullable(),
        responsibleId: z.string().cuid().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const meeting = await ctx.db.meeting.findUniqueOrThrow({
        where: { id: input.meetingId },
      });
      if (!can(userCtx(ctx.session), 'meeting:uploadMinutes', meeting.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const data = {
        meetingId: input.meetingId,
        order: input.order,
        title: input.title,
        speakerId: input.speakerId ?? null,
        heardText: input.heardText ?? null,
        discussionText: input.discussionText ?? null,
        decisionText: input.decisionText ?? null,
        deadline: input.deadline ?? null,
        responsibleId: input.responsibleId ?? null,
      };
      if (input.id) {
        return ctx.db.agendaItem.update({ where: { id: input.id }, data });
      }
      return ctx.db.agendaItem.create({ data });
    }),

  // ── deleteAgendaItem ─────────────────────────────────────────────────
  deleteAgendaItem: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.agendaItem.findUniqueOrThrow({
        where: { id: input.id },
        include: { meeting: { select: { workingGroupId: true } } },
      });
      if (!can(userCtx(ctx.session), 'meeting:uploadMinutes', item.meeting.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      return ctx.db.agendaItem.delete({ where: { id: input.id } });
    }),

  // ── assignProtocolNumber: sequence per WG per year ───────────────────
  assignProtocolNumber: protectedProcedure
    .input(z.object({ meetingId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const meeting = await ctx.db.meeting.findUniqueOrThrow({
        where: { id: input.meetingId },
      });
      if (!can(userCtx(ctx.session), 'meeting:uploadMinutes', meeting.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (meeting.protocolNumber) return meeting;

      const yearStart = new Date(meeting.startAt.getFullYear(), 0, 1);
      const yearEnd = new Date(meeting.startAt.getFullYear() + 1, 0, 1);
      const sameWgYear = await ctx.db.meeting.findMany({
        where: {
          workingGroupId: meeting.workingGroupId,
          startAt: { gte: yearStart, lt: yearEnd },
          protocolNumber: { not: null },
        },
        select: { protocolNumber: true },
      });
      const maxNum = sameWgYear.reduce((m, r) => Math.max(m, r.protocolNumber ?? 0), 0);
      return ctx.db.meeting.update({
        where: { id: input.meetingId },
        data: { protocolNumber: maxNum + 1 },
      });
    }),

  // ── uploadMinutes ─────────────────────────────────────────────────────
  uploadMinutes: protectedProcedure
    .input(
      z.object({
        meetingId: z.string().cuid(),
        minutesText: z.string().min(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const meeting = await ctx.db.meeting.findUniqueOrThrow({ where: { id: input.meetingId } });

      if (!can(userCtx(ctx.session), 'meeting:uploadMinutes', meeting.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return ctx.db.meeting.update({
        where: { id: input.meetingId },
        data: { minutesText: input.minutesText },
      });
    }),

  // ── changeStatus ──────────────────────────────────────────────────────
  changeStatus: protectedProcedure
    .input(
      z.object({
        meetingId: z.string().cuid(),
        status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const meeting = await ctx.db.meeting.findUniqueOrThrow({ where: { id: input.meetingId } });

      if (!can(userCtx(ctx.session), 'meeting:uploadMinutes', meeting.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return ctx.db.meeting.update({
        where: { id: input.meetingId },
        data: { status: input.status },
      });
    }),

  // ── upcomingForUser ───────────────────────────────────────────────────
  upcomingForUser: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(10).default(5) }))
    .query(async ({ ctx, input }) => {
      return ctx.db.meeting.findMany({
        where: {
          startAt: { gte: new Date() },
          status: 'PLANNED',
          attendances: { some: { userId: ctx.session.user.id } },
        },
        include: {
          workingGroup: { select: { id: true, code: true, color: true } },
          attendances: {
            where: { userId: ctx.session.user.id },
            select: { status: true },
          },
        },
        orderBy: { startAt: 'asc' },
        take: input.limit,
      });
    }),
});
