import { createTRPCRouter, protectedProcedure } from '@/server/trpc';

export const dashboardRouter = createTRPCRouter({
  // Counts for sidebar badges
  navCounts: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const isAdmin = ctx.session.user.globalRole === 'ADMIN';
    const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];

    const wgFilter = isAdmin ? {} : { workingGroupId: { in: memberGroupIds } };

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
