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
      standardsOverdueRaw,
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
      // Standards with any unconfirmed past-due stage (overdue program-plan stage)
      ctx.db.standard.findMany({
        where: {
          ...wgFilter,
          OR: [
            { techSpecDueDate: { lt: now }, techSpecCompletedAt: null },
            { draftDueDate: { lt: now }, draftCompletedAt: null },
            { feedbackDueDate: { lt: now }, feedbackCompletedAt: null },
            { techReviewDueDate: { lt: now }, techReviewCompletedAt: null },
            { finalDueDate: { lt: now }, finalCompletedAt: null },
          ],
        },
        select: { id: true },
      }),
    ]);

    return {
      standardsActive,
      standardsNewThisMonth,
      standardsInReview,
      meetingsThisMonth,
      nextMeetingDate: nextMeeting?.startAt ?? null,
      tasksOverdue,
      standardsOverdueStages: standardsOverdueRaw.length,
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

    const [
      standardsActive,
      meetingsUpcoming,
      tasksOpenForMe,
      unreadNotifications,
      minutesPending,
      workingGroupsTotal,
      standardsTotal,
      protocolsTotal,
      meetingsUnfinished,
    ] = await Promise.all([
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
      // ── Blue "element count" badges: how many items are in each list ──
      ctx.db.workingGroup.count({
        where: { ...(seesAll ? {} : { id: { in: memberGroupIds } }), isArchived: false },
      }),
      ctx.db.standard.count({
        where: { ...wgFilter, status: { not: 'ARCHIVED' } },
      }),
      // Protocols = meetings with any protocol activity (same as protocolsForUser).
      ctx.db.meeting.count({
        where: {
          ...wgFilter,
          OR: [
            { protocolNumber: { not: null } },
            { minutesText: { not: null } },
            { agendaItems: { some: {} } },
          ],
        },
      }),
      // ── Red badge: meetings not yet finished ──
      ctx.db.meeting.count({
        where: { ...wgFilter, status: { in: ['PLANNED', 'IN_PROGRESS'] } },
      }),
    ]);

    return {
      standardsActive,
      meetingsUpcoming,
      tasksOpenForMe,
      unreadNotifications,
      minutesPending,
      workingGroupsTotal,
      standardsTotal,
      protocolsTotal,
      meetingsUnfinished,
    };
  }),

  /**
   * Cross-WG analytics for leadership (DIRECTOR / ADMIN).
   * Always scoped to all WGs regardless of caller membership; returns
   * 403 for everyone else.
   */
  directorAnalytics: protectedProcedure.query(async ({ ctx }) => {
    const role = ctx.session.user.globalRole;
    if (role !== 'DIRECTOR' && role !== 'ADMIN') {
      throw new Error('Forbidden');
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);

    // All program-plan standards (those with an indeks)
    const standards = await ctx.db.standard.findMany({
      where: { indeks: { not: null } },
      include: { workingGroup: { select: { id: true, code: true, color: true, name: true } } },
    });

    type StageKey = 'techSpec' | 'draft' | 'feedback' | 'techReview' | 'final';
    const STAGES: StageKey[] = ['techSpec', 'draft', 'feedback', 'techReview', 'final'];
    const STAGE_LABEL: Record<StageKey, string> = {
      techSpec: 'ТЗ',
      draft: 'Проєкт',
      feedback: 'Відгуки',
      techReview: 'Перевірка',
      final: 'Остаточно',
    };

    // Per-standard derived flags
    function overdueCount(s: (typeof standards)[number]): number {
      let n = 0;
      for (const k of STAGES) {
        const due = s[`${k}DueDate` as const];
        const done = s[`${k}CompletedAt` as const];
        if (due && !done && due < today) n++;
      }
      return n;
    }
    function isFullyComplete(s: (typeof standards)[number]): boolean {
      return STAGES.every((k) => s[`${k}CompletedAt` as const]);
    }
    function currentStage(s: (typeof standards)[number]): StageKey | 'done' {
      for (const k of STAGES) {
        if (!s[`${k}CompletedAt` as const]) return k;
      }
      return 'done';
    }

    // ── KPIs ──────────────────────────────────────────────────────────
    const totalStandards = standards.length;
    const standardsWithOverdue = standards.filter((s) => overdueCount(s) > 0).length;
    const onTrack = standards.filter((s) => !isFullyComplete(s) && overdueCount(s) === 0).length;
    const completedThisQuarter = standards.filter((s) => {
      if (!s.finalCompletedAt) return false;
      return s.finalCompletedAt >= startOfQuarter;
    }).length;
    const fullyCompleted = standards.filter((s) => isFullyComplete(s)).length;

    // ── Per-WG breakdown ──────────────────────────────────────────────
    const wgMap = new Map<
      string,
      {
        id: string;
        code: string;
        name: string;
        color: string;
        total: number;
        completed: number;
        overdue: number;
        onTrack: number;
      }
    >();
    for (const s of standards) {
      const w = wgMap.get(s.workingGroup.id) ?? {
        id: s.workingGroup.id,
        code: s.workingGroup.code,
        name: s.workingGroup.name,
        color: s.workingGroup.color,
        total: 0,
        completed: 0,
        overdue: 0,
        onTrack: 0,
      };
      w.total++;
      if (isFullyComplete(s)) w.completed++;
      else if (overdueCount(s) > 0) w.overdue++;
      else w.onTrack++;
      wgMap.set(s.workingGroup.id, w);
    }
    const perWg = Array.from(wgMap.values()).sort((a, b) => b.total - a.total);

    // ── Stage funnel (how many standards are in each current stage) ──
    const funnel: { stage: string; key: StageKey | 'done'; count: number }[] = [
      ...STAGES.map((k) => ({ stage: STAGE_LABEL[k], key: k, count: 0 })),
      { stage: 'Завершено', key: 'done' as const, count: 0 },
    ];
    for (const s of standards) {
      const cur = currentStage(s);
      const bucket = funnel.find((f) => f.key === cur);
      if (bucket) bucket.count++;
    }

    // ── Top-5 most at-risk ────────────────────────────────────────────
    const mostAtRisk = standards
      .map((s) => ({
        id: s.id,
        code: s.code,
        title: s.title,
        wgCode: s.workingGroup.code,
        wgColor: s.workingGroup.color,
        overdue: overdueCount(s),
        oldestOverdueDays: (() => {
          let oldest = 0;
          for (const k of STAGES) {
            const due = s[`${k}DueDate` as const];
            const done = s[`${k}CompletedAt` as const];
            if (due && !done && due < today) {
              const days = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
              if (days > oldest) oldest = days;
            }
          }
          return oldest;
        })(),
      }))
      .filter((x) => x.overdue > 0)
      .sort((a, b) => b.oldestOverdueDays - a.oldestOverdueDays)
      .slice(0, 5);

    // ── Velocity: stages completed per month, last 6 months ───────────
    const months: { label: string; year: number; month: number; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleDateString('uk-UA', { month: 'short', year: '2-digit' }),
        year: d.getFullYear(),
        month: d.getMonth(),
        count: 0,
      });
    }
    for (const s of standards) {
      for (const k of STAGES) {
        const done = s[`${k}CompletedAt` as const];
        if (!done || done < sixMonthsAgo) continue;
        const bucket = months.find(
          (m) => m.year === done.getFullYear() && m.month === done.getMonth(),
        );
        if (bucket) bucket.count++;
      }
    }

    // ── Meeting activity per WG (last 30 days) ────────────────────────
    const thirtyAgo = new Date(now.getTime() - 30 * 86_400_000);
    const recentMeetings = await ctx.db.meeting.findMany({
      where: { startAt: { gte: thirtyAgo } },
      select: { workingGroupId: true },
    });
    const meetingsByWg = new Map<string, number>();
    for (const m of recentMeetings) {
      meetingsByWg.set(m.workingGroupId, (meetingsByWg.get(m.workingGroupId) ?? 0) + 1);
    }
    const perWgWithMeetings = perWg.map((w) => ({
      ...w,
      meetingsLast30d: meetingsByWg.get(w.id) ?? 0,
    }));

    return {
      kpis: {
        totalStandards,
        onTrack,
        standardsWithOverdue,
        fullyCompleted,
        completedThisQuarter,
      },
      perWg: perWgWithMeetings,
      funnel,
      mostAtRisk,
      velocity: months,
      ranAt: now.toISOString(),
    };
  }),
});
