import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
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

export const voteRouter = createTRPCRouter({
  // ── openVoting ────────────────────────────────────────────────────────
  openVoting: protectedProcedure
    .input(
      z.object({
        standardId: z.string().cuid(),
        title: z.string().min(3).max(300),
        description: z.string().optional(),
        deadline: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUniqueOrThrow({
        where: { id: input.standardId },
        select: { workingGroupId: true, status: true },
      });

      if (!can(userCtx(ctx.session), 'vote:open', standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      if (standard.status !== 'IN_REVIEW') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Голосування можна відкрити лише для стандарту у статусі "На розгляді"',
        });
      }

      // Check no open voting exists
      const existing = await ctx.db.voting.findFirst({
        where: { standardId: input.standardId, status: 'OPEN' },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Голосування вже відкрито' });
      }

      const [voting] = await ctx.db.$transaction([
        ctx.db.voting.create({
          data: {
            standardId: input.standardId,
            title: input.title,
            description: input.description,
            deadline: input.deadline,
          },
        }),
        ctx.db.standard.update({
          where: { id: input.standardId },
          data: { status: 'VOTING' },
        }),
        ctx.db.standardStatusHistory.create({
          data: {
            standardId: input.standardId,
            fromStatus: 'IN_REVIEW',
            toStatus: 'VOTING',
            changedById: ctx.session.user.id,
            note: `Відкрито голосування: ${input.title}`,
          },
        }),
      ]);

      // TODO: Notify all RG members (TASK-018)

      return voting;
    }),

  // ── cast ─────────────────────────────────────────────────────────────
  cast: protectedProcedure
    .input(
      z.object({
        votingId: z.string().cuid(),
        choice: z.enum(['FOR', 'AGAINST', 'ABSTAIN']),
        comment: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const voting = await ctx.db.voting.findUniqueOrThrow({
        where: { id: input.votingId },
        include: { standard: { select: { workingGroupId: true } } },
      });

      if (voting.status === 'CLOSED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Голосування завершено' });
      }

      if (!can(userCtx(ctx.session), 'vote:cast', voting.standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return ctx.db.vote.upsert({
        where: { votingId_userId: { votingId: input.votingId, userId: ctx.session.user.id } },
        create: {
          votingId: input.votingId,
          userId: ctx.session.user.id,
          choice: input.choice,
          comment: input.comment,
        },
        update: { choice: input.choice, comment: input.comment },
      });
    }),

  // ── closeVoting ───────────────────────────────────────────────────────
  closeVoting: protectedProcedure
    .input(z.object({ votingId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const voting = await ctx.db.voting.findUniqueOrThrow({
        where: { id: input.votingId },
        include: {
          standard: { select: { id: true, workingGroupId: true } },
          votes: true,
        },
      });

      if (!can(userCtx(ctx.session), 'vote:open', voting.standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      if (voting.status === 'CLOSED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Голосування вже завершено' });
      }

      // Calculate result
      const forVotes = voting.votes.filter((v) => v.choice === 'FOR').length;
      const againstVotes = voting.votes.filter((v) => v.choice === 'AGAINST').length;
      const total = forVotes + againstVotes;
      const adopted = total > 0 ? forVotes / total > 0.5 : false;
      const newStatus = adopted ? 'ADOPTED' : 'REJECTED';

      await ctx.db.$transaction([
        ctx.db.voting.update({
          where: { id: input.votingId },
          data: { status: 'CLOSED', closedAt: new Date() },
        }),
        ctx.db.standard.update({
          where: { id: voting.standard.id },
          data: { status: newStatus },
        }),
        ctx.db.standardStatusHistory.create({
          data: {
            standardId: voting.standard.id,
            fromStatus: 'VOTING',
            toStatus: newStatus,
            changedById: ctx.session.user.id,
            note: `Голосування завершено. За: ${forVotes}, Проти: ${againstVotes}`,
          },
        }),
      ]);

      return { status: newStatus, forVotes, againstVotes, total };
    }),

  // ── results ───────────────────────────────────────────────────────────
  results: protectedProcedure
    .input(z.object({ votingId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const voting = await ctx.db.voting.findUniqueOrThrow({
        where: { id: input.votingId },
        include: { votes: true },
      });

      const forVotes = voting.votes.filter((v) => v.choice === 'FOR').length;
      const against = voting.votes.filter((v) => v.choice === 'AGAINST').length;
      const abstain = voting.votes.filter((v) => v.choice === 'ABSTAIN').length;
      const myVote = voting.votes.find((v) => v.userId === ctx.session.user.id);

      return {
        votingId: voting.id,
        status: voting.status,
        title: voting.title,
        forVotes,
        against,
        abstain,
        total: voting.votes.length,
        myVote: myVote?.choice ?? null,
        deadline: voting.deadline,
      };
    }),

  // ── current ───────────────────────────────────────────────────────────
  current: protectedProcedure
    .input(z.object({ standardId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const open = await ctx.db.voting.findFirst({
        where: { standardId: input.standardId, status: 'OPEN' },
        include: { votes: true, standard: { select: { id: true, workingGroupId: true } } },
      });

      // Lazy auto-close: if deadline has passed, close + transition standard status
      if (open?.deadline && new Date(open.deadline) <= new Date()) {
        const forVotes = open.votes.filter((v) => v.choice === 'FOR').length;
        const againstVotes = open.votes.filter((v) => v.choice === 'AGAINST').length;
        const total = forVotes + againstVotes;
        const adopted = total > 0 ? forVotes / total > 0.5 : false;
        const newStatus = adopted ? 'ADOPTED' : 'REJECTED';

        await ctx.db.$transaction([
          ctx.db.voting.update({
            where: { id: open.id },
            data: { status: 'CLOSED', closedAt: new Date() },
          }),
          ctx.db.standard.update({
            where: { id: open.standard.id },
            data: { status: newStatus },
          }),
          ctx.db.standardStatusHistory.create({
            data: {
              standardId: open.standard.id,
              fromStatus: 'VOTING',
              toStatus: newStatus,
              changedById: ctx.session.user.id,
              note: `Автоматичне завершення за дедлайном. За: ${forVotes}, Проти: ${againstVotes}`,
            },
          }),
        ]);
        return null;
      }

      return open;
    }),

  // ── history ───────────────────────────────────────────────────────────
  history: protectedProcedure
    .input(z.object({ standardId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.voting.findMany({
        where: { standardId: input.standardId },
        include: {
          votes: {
            include: { user: { select: { id: true, name: true } } },
          },
        },
        orderBy: { openedAt: 'desc' },
      });
    }),
});
