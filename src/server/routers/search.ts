import { z } from 'zod';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { seesAllWorkingGroups } from '@/server/permissions';

export const searchRouter = createTRPCRouter({
  global: protectedProcedure
    .input(z.object({ q: z.string().min(2).max(120) }))
    .query(async ({ ctx, input }) => {
      const seesAll = seesAllWorkingGroups(ctx.session.user);
      const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];
      const wgFilter = seesAll ? {} : { workingGroupId: { in: memberGroupIds } };

      const q = input.q.trim();

      const [standards, meetings, tasks, workingGroups, users] = await Promise.all([
        ctx.db.standard.findMany({
          where: {
            ...wgFilter,
            OR: [
              { code: { contains: q, mode: 'insensitive' } },
              { title: { contains: q, mode: 'insensitive' } },
              { isoAnalog: { contains: q, mode: 'insensitive' } },
              { category: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            code: true,
            title: true,
            status: true,
            workingGroup: { select: { id: true, code: true, color: true } },
          },
          take: 5,
          orderBy: { updatedAt: 'desc' },
        }),
        ctx.db.meeting.findMany({
          where: {
            ...wgFilter,
            title: { contains: q, mode: 'insensitive' },
          },
          select: {
            id: true,
            title: true,
            startAt: true,
            status: true,
            workingGroup: { select: { id: true, code: true, color: true } },
          },
          take: 5,
          orderBy: { startAt: 'desc' },
        }),
        ctx.db.task.findMany({
          where: {
            ...(seesAll ? {} : { standard: { workingGroupId: { in: memberGroupIds } } }),
            title: { contains: q, mode: 'insensitive' },
          },
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            standardId: true,
            standard: { select: { id: true, code: true } },
          },
          take: 5,
          orderBy: { updatedAt: 'desc' },
        }),
        ctx.db.workingGroup.findMany({
          where: {
            ...(seesAll ? {} : { id: { in: memberGroupIds } }),
            isArchived: false,
            OR: [
              { code: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: { id: true, code: true, name: true, color: true },
          take: 5,
          orderBy: { code: 'asc' },
        }),
        ctx.db.user.findMany({
          where: {
            isActive: true,
            // Visibility: ADMIN/DIRECTOR see everyone; others see only users
            // who share at least one WG membership with them.
            ...(seesAll
              ? {}
              : { memberships: { some: { workingGroupId: { in: memberGroupIds } } } }),
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { position: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            name: true,
            email: true,
            position: true,
            rank: true,
            avatarUrl: true,
            memberships: {
              select: {
                role: true,
                workingGroup: { select: { id: true, code: true, color: true } },
              },
              orderBy: { joinedAt: 'asc' },
              take: 1,
            },
          },
          take: 8,
          orderBy: { name: 'asc' },
        }),
      ]);

      return { standards, meetings, tasks, workingGroups, users };
    }),
});
