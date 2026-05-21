import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { logActivity } from '@/server/audit';
import { seesAllWorkingGroups } from '@/server/permissions';
import {
  notifyMeetingCreated,
  notifyMeetingChanged,
  notifyAttendanceDeclined,
  notifyProtocolPublished,
} from '@/server/notify';
import { isAiConfigured, generateProtocolDraft } from '@/server/ai/protocol';
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
          workingGroup: { select: { id: true, code: true, name: true, color: true } },
          attendances: { select: { status: true } },
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
        format: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']).default('OFFLINE'),
        location: z.string().optional(),
        startAt: z.date(),
        durationMins: z.number().min(15).max(480).default(60),
        agendaText: z.string().optional(),
        chairmanId: z.string().cuid().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!can(userCtx(ctx.session), 'meeting:create', input.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      // Get all members to auto-create attendance records
      const members = await ctx.db.workingGroupMember.findMany({
        where: { workingGroupId: input.workingGroupId },
        select: { userId: true, role: true },
      });

      // Default chairman = the WG leader, unless caller picked someone explicitly
      const defaultChairmanId =
        input.chairmanId ?? members.find((m) => m.role === 'LEADER')?.userId ?? null;

      const meeting = await ctx.db.meeting.create({
        data: {
          ...input,
          chairmanId: defaultChairmanId,
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

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'Meeting',
        entityId: meeting.id,
        after: meeting,
      });

      await notifyMeetingCreated(ctx.db, meeting.id, ctx.session.user.id);

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
        chairmanId: z.string().cuid().optional().nullable(),
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

      const changeBits: string[] = [];
      if (data.startAt && new Date(data.startAt).getTime() !== new Date(meeting.startAt).getTime())
        changeBits.push('перенесено');
      if (data.title && data.title !== meeting.title) changeBits.push('змінено назву');
      if (data.agendaText !== undefined && data.agendaText !== meeting.agendaText)
        changeBits.push('оновлено порядок денний');
      if (changeBits.length > 0) {
        await notifyMeetingChanged(ctx.db, id, ctx.session.user.id, changeBits.join(', '));
      }

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
      const before = await ctx.db.attendance.findUnique({
        where: {
          meetingId_userId: { meetingId: input.meetingId, userId: ctx.session.user.id },
        },
      });
      const updated = await ctx.db.attendance.update({
        where: {
          meetingId_userId: {
            meetingId: input.meetingId,
            userId: ctx.session.user.id,
          },
        },
        data: { status: input.status, note: input.note },
      });
      // Carry the actor's own name in the log payload so the activity
      // feed renderer can present "<Name>: <status before> → <after>"
      // without an extra round-trip.
      // Write the audit entry under the Meeting entity so it shows up
      // in the meeting page's journal (entity-scoped feed). The
      // `userName` carried in before/after lets the renderer pick out
      // attendance entries and present them with the coloured status
      // pill row.
      const targetName = ctx.session.user.name;
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'STATUS_CHANGE',
        entity: 'Meeting',
        entityId: input.meetingId,
        before: before ? { status: before.status, userName: targetName } : null,
        after: { status: input.status, userName: targetName },
        note: `Підтвердження участі: ${targetName}`,
      });

      // Notify chairman + WG leadership when someone declines
      if (input.status === 'DECLINED' && before?.status !== 'DECLINED') {
        await notifyAttendanceDeclined(
          ctx.db,
          input.meetingId,
          ctx.session.user.id,
          ctx.session.user.id,
        );
      }

      return updated;
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

      const [before, targetUser] = await Promise.all([
        ctx.db.attendance.findUnique({
          where: { meetingId_userId: { meetingId: input.meetingId, userId: input.userId } },
        }),
        ctx.db.user.findUnique({
          where: { id: input.userId },
          select: { name: true },
        }),
      ]);
      const updated = await ctx.db.attendance.upsert({
        where: { meetingId_userId: { meetingId: input.meetingId, userId: input.userId } },
        update: { status: input.status, note: input.note },
        create: {
          meetingId: input.meetingId,
          userId: input.userId,
          status: input.status,
          note: input.note,
        },
      });
      const targetName = targetUser?.name ?? 'учасник';
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: before ? 'STATUS_CHANGE' : 'CREATE',
        // Attendance entries live under the Meeting entity so they
        // show up in the meeting page's journal alongside other
        // meeting changes. `targetUserId` is what RESTORE needs to
        // find the right attendance row — `userName` alone isn't
        // unique. Older entries without it just can't be reverted.
        entity: 'Meeting',
        entityId: input.meetingId,
        before: before
          ? { status: before.status, userName: targetName, targetUserId: input.userId }
          : null,
        after: { status: input.status, userName: targetName, targetUserId: input.userId },
        note: `Зміна явки: ${targetName}`,
      });

      // Notify chairman + WG leadership when the participant transitions to DECLINED
      if (input.status === 'DECLINED' && before?.status !== 'DECLINED') {
        await notifyAttendanceDeclined(ctx.db, input.meetingId, input.userId, ctx.session.user.id);
      }

      return updated;
    }),

  // ── upsertAgendaItem (secretary / leader / admin) ────────────────────
  upsertAgendaItem: protectedProcedure
    .input(
      z.object({
        id: z.string().cuid().optional(),
        meetingId: z.string().cuid(),
        order: z.number().int().min(0),
        title: z.string().min(2).max(500),
        section: z.enum(['AGENDA', 'HEARD', 'DECISION']).default('AGENDA'),
        speakerId: z.string().cuid().optional().nullable(),
        speakerName: z.string().max(200).optional().nullable(),
        heardText: z.string().optional().nullable(),
        discussionText: z.string().optional().nullable(),
        decisionText: z.string().optional().nullable(),
        deadline: z.date().optional().nullable(),
        responsibleId: z.string().cuid().optional().nullable(),
        responsibleName: z.string().max(200).optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const meeting = await ctx.db.meeting.findUniqueOrThrow({
        where: { id: input.meetingId },
      });
      if (!can(userCtx(ctx.session), 'meeting:uploadMinutes', meeting.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      // FK wins over free-text: when a speaker/responsible id is set, null out
      // the free-text name so they never coexist.
      const data = {
        meetingId: input.meetingId,
        order: input.order,
        title: input.title,
        section: input.section,
        speakerId: input.speakerId ?? null,
        speakerName: input.speakerId ? null : (input.speakerName?.trim() ?? '') || null,
        heardText: input.heardText ?? null,
        discussionText: input.discussionText ?? null,
        decisionText: input.decisionText ?? null,
        deadline: input.deadline ?? null,
        responsibleId: input.responsibleId ?? null,
        responsibleName: input.responsibleId ? null : (input.responsibleName?.trim() ?? '') || null,
      };
      if (input.id) {
        const before = await ctx.db.agendaItem.findUnique({ where: { id: input.id } });
        const updated = await ctx.db.agendaItem.update({ where: { id: input.id }, data });
        await logActivity(ctx.db, {
          userId: ctx.session.user.id,
          action: 'UPDATE',
          entity: 'AgendaItem',
          entityId: input.id,
          before,
          after: updated,
        });
        return updated;
      }
      const created = await ctx.db.agendaItem.create({ data });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'AgendaItem',
        entityId: created.id,
        after: created,
      });
      return created;
    }),

  // ── aiEnabled: чи налаштований ШІ (ANTHROPIC_API_KEY) ────────────────
  aiEnabled: protectedProcedure.query(() => isAiConfigured()),

  // ── generateProtocolDraft: ШІ перетворює вільні нотатки на структуру ──
  //    протоколу (порядок денний / слухали-виступили / вирішили). Повертає
  //    ЧЕРНЕТКУ — нічого не зберігає в БД. Присутні й дата закріплені з
  //    даних засідання, не з тексту. Користувач переглядає і зберігає сам.
  generateProtocolDraft: protectedProcedure
    .input(
      z.object({
        meetingId: z.string().cuid(),
        rawText: z.string().min(10).max(20000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const meeting = await ctx.db.meeting.findUnique({
        where: { id: input.meetingId },
        include: {
          workingGroup: {
            select: {
              code: true,
              name: true,
              members: {
                include: { user: { select: { id: true, name: true, rank: true } } },
                orderBy: { joinedAt: 'asc' },
              },
            },
          },
          attendances: {
            where: { status: 'CONFIRMED' },
            include: { user: { select: { id: true, name: true, rank: true } } },
          },
        },
      });
      if (!meeting) throw new TRPCError({ code: 'NOT_FOUND' });

      if (!can(userCtx(ctx.session), 'meeting:uploadMinutes', meeting.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (!isAiConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'ШІ не налаштовано (відсутній ANTHROPIC_API_KEY).',
        });
      }

      try {
        return await generateProtocolDraft(input.rawText, {
          wgCode: meeting.workingGroup.code,
          wgName: meeting.workingGroup.name,
          meetingDateISO: meeting.startAt.toISOString().slice(0, 10),
          attendees: meeting.attendances.map((a) => a.user.name),
          roster: meeting.workingGroup.members.map((m) => ({
            id: m.user.id,
            name: m.user.name,
            rank: m.user.rank,
          })),
        });
      } catch (e) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: e instanceof Error ? e.message : 'Помилка ШІ-генерації протоколу.',
        });
      }
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
      const deleted = await ctx.db.agendaItem.delete({ where: { id: input.id } });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'DELETE',
        entity: 'AgendaItem',
        entityId: input.id,
        before: item,
      });
      return deleted;
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
      const updated = await ctx.db.meeting.update({
        where: { id: input.meetingId },
        data: { protocolNumber: maxNum + 1 },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Meeting',
        entityId: input.meetingId,
        before: { protocolNumber: null },
        after: { protocolNumber: maxNum + 1 },
        note: `Присвоєно протокол № ${maxNum + 1}`,
      });

      // Protocol number assignment = protocol officially published.
      await notifyProtocolPublished(ctx.db, input.meetingId, ctx.session.user.id);

      return updated;
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

      const updated = await ctx.db.meeting.update({
        where: { id: input.meetingId },
        data: { minutesText: input.minutesText },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Meeting',
        entityId: input.meetingId,
        before: { minutesText: meeting.minutesText },
        after: { minutesText: input.minutesText },
        note: 'Завантажено протокол',
      });
      return updated;
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

      const updated = await ctx.db.meeting.update({
        where: { id: input.meetingId },
        data: { status: input.status },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'STATUS_CHANGE',
        entity: 'Meeting',
        entityId: input.meetingId,
        before: { status: meeting.status },
        after: { status: input.status },
      });
      return updated;
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

  // ── protocolsForUser: meetings with any protocol activity in WGs the user can see
  protocolsForUser: protectedProcedure.query(async ({ ctx }) => {
    const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];
    const seesAll = seesAllWorkingGroups(ctx.session.user);

    return ctx.db.meeting.findMany({
      where: {
        ...(seesAll ? {} : { workingGroupId: { in: memberGroupIds } }),
        // "has any protocol activity" = a protocol number assigned, OR minutes
        // text typed, OR at least one agenda item created.
        OR: [
          { protocolNumber: { not: null } },
          { minutesText: { not: null } },
          { agendaItems: { some: {} } },
        ],
      },
      include: {
        workingGroup: {
          select: {
            id: true,
            code: true,
            name: true,
            color: true,
            members: {
              where: { role: 'LEADER' },
              select: {
                user: { select: { id: true, name: true, rank: true } },
              },
              take: 1,
            },
          },
        },
        chairman: { select: { id: true, name: true, rank: true } },
        createdBy: { select: { id: true, name: true } },
        _count: { select: { agendaItems: true, attendances: true } },
      },
      orderBy: [{ startAt: 'desc' }],
    });
  }),

  // ── clearProtocol: wipe the meeting's protocol (number, agenda, minutes)
  //    while KEEPING the meeting itself ──────────────────────────────────
  // A meeting is not necessarily a protocol — it can exist without one — so
  // this only removes protocol content (after which the meeting drops off
  // the /protocols list but stays in /meetings). Guarded by the
  // meeting:deleteProtocol permission (admins always).
  clearProtocol: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const meeting = await ctx.db.meeting.findUnique({ where: { id: input.id } });
      if (!meeting) throw new TRPCError({ code: 'NOT_FOUND' });
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';
      if (
        !isAdmin &&
        !can(userCtx(ctx.session), 'meeting:deleteProtocol', meeting.workingGroupId)
      ) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      // Agenda items are protocol content — remove them; the meeting,
      // attendance and scheduling stay intact.
      await ctx.db.agendaItem.deleteMany({ where: { meetingId: input.id } });
      const updated = await ctx.db.meeting.update({
        where: { id: input.id },
        data: { protocolNumber: null, minutesText: null },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Meeting',
        entityId: meeting.id,
        before: { protocolNumber: meeting.protocolNumber, minutesText: meeting.minutesText },
        after: { protocolNumber: null, minutesText: null },
        note: 'Протокол очищено (засідання збережено)',
      });
      return updated;
    }),
});
