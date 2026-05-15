import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { seesAllWorkingGroups } from '@/server/permissions';

export const dashboardRouter = createTRPCRouter({
  // Aggregated KPIs for dashboard header
  kpis: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const seesAll = seesAllWorkingGroups(ctx.session.user);
    const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];

    const wgFilter = seesAll ? {} : { workingGroupId: { in: memberGroupIds } };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      standardsActive,
      standardsNewThisMonth,
      standardsInReview,
      meetingsThisMonth,
      nextMeeting,
      tasksOverdue,
    ] = await Promise.all([
      ctx.db.standard.count({
        where: { ...wgFilter, status: { in: ['DRAFT', 'IN_REVIEW', 'VOTING'] } },
      }),
      ctx.db.standard.count({
        where: {
          ...wgFilter,
          status: { in: ['DRAFT', 'IN_REVIEW', 'VOTING'] },
          createdAt: { gte: startOfPrevMonth, lt: endOfMonth },
        },
      }),
      ctx.db.standard.count({
        where: { ...wgFilter, status: 'IN_REVIEW' },
      }),
      ctx.db.meeting.count({
        where: {
          ...wgFilter,
          startAt: { gte: startOfMonth, lt: endOfMonth },
        },
      }),
      ctx.db.meeting.findFirst({
        where: {
          ...wgFilter,
          startAt: { gte: now },
          status: 'PLANNED',
        },
        orderBy: { startAt: 'asc' },
        select: { startAt: true },
      }),
      ctx.db.task.count({
        where: {
          assigneeId: userId,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          dueDate: { lt: now },
        },
      }),
    ]);

    return {
      standardsActive,
      standardsNewThisMonth,
      standardsInReview,
      meetingsThisMonth,
      nextMeetingDate: nextMeeting?.startAt ?? null,
      tasksOverdue,
    };
  }),

  // Counts for sidebar badges
  navCounts: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const seesAll = seesAllWorkingGroups(ctx.session.user);
    const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];

    const wgFilter = seesAll ? {} : { workingGroupId: { in: memberGroupIds } };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [standardsActive, meetingsUpcoming, tasksOpenForMe, unreadNotifications, minutesPending] =
      await Promise.all([
        ctx.db.standard.count({
          where: {
            ...wgFilter,
            status: { in: ['DRAFT', 'IN_REVIEW', 'VOTING'] },
          },
        }),
        ctx.db.meeting.count({
          where: {
            ...wgFilter,
            startAt: { gte: startOfMonth, lt: endOfMonth },
            status: { in: ['PLANNED', 'IN_PROGRESS'] },
          },
        }),
        ctx.db.task.count({
          where: {
            assigneeId: userId,
            status: { in: ['OPEN', 'IN_PROGRESS'] },
          },
        }),
        ctx.db.notification.count({
          where: { userId, read: false },
        }),
        ctx.db.meeting.count({
          where: {
            ...wgFilter,
            status: 'COMPLETED',
            minutesText: null,
          },
        }),
      ]);

    return {
      standardsActive,
      meetingsUpcoming,
      tasksOpenForMe,
      unreadNotifications,
      minutesPending,
    };
  }),
});
