import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { logActivity } from '@/server/audit';
import { notifyVoteOpened, notifyVoteClosed } from '@/server/notify';
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

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'Vote',
        entityId: voting.id,
        after: voting,
        note: `Відкрито голосування: ${voting.title}`,
      });

      await notifyVoteOpened(ctx.db, voting.id, ctx.session.user.id);

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

      const before = await ctx.db.vote.findUnique({
        where: { votingId_userId: { votingId: input.votingId, userId: ctx.session.user.id } },
      });
      const cast = await ctx.db.vote.upsert({
        where: { votingId_userId: { votingId: input.votingId, userId: ctx.session.user.id } },
        create: {
          votingId: input.votingId,
          userId: ctx.session.user.id,
          choice: input.choice,
          comment: input.comment,
        },
        update: { choice: input.choice, comment: input.comment },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'Vote',
        entityId: input.votingId,
        before: before ? { choice: before.choice, comment: before.comment } : null,
        after: { choice: input.choice, comment: input.comment },
        note: `Голос: ${input.choice}`,
      });
      return cast;
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

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'STATUS_CHANGE',
        entity: 'Vote',
        entityId: input.votingId,
        before: { status: 'OPEN' },
        after: { status: 'CLOSED' },
        note: `Завершено. За: ${forVotes}, проти: ${againstVotes}. Результат: ${newStatus}`,
      });

      await notifyVoteClosed(
        ctx.db,
        input.votingId,
        adopted ? 'прийнято' : 'відхилено',
        ctx.session.user.id,
      );

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

  // ── current (read-only) ────────────────────────────────────────────────
  // Pure read. The previous implementation lazily auto-closed an overdue vote
  // *inside this GET* — performing writes attributed to whichever user happened
  // to load the page, with no RBAC and a race that produced duplicate
  // status-history rows under polling (B-9). The close now lives in the
  // closeOverdue mutation below; this query just returns the open vote (even if
  // past deadline, so the client can offer to close it).
  current: protectedProcedure
    .input(z.object({ standardId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.voting.findFirst({
        where: { standardId: input.standardId, status: 'OPEN' },
        include: { votes: true, standard: { select: { id: true, workingGroupId: true } } },
      });
    }),

  // ── closeOverdue ─────────────────────────────────────────────────────────
  // Auto-close an OPEN vote whose deadline has passed. Privileged (vote:open),
  // idempotent and race-safe: the close runs in a Serializable transaction that
  // re-checks status === 'OPEN' inside, so concurrent triggers can't double-close
  // or duplicate status history (B-9).
  closeOverdue: protectedProcedure
    .input(z.object({ standardId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const open = await ctx.db.voting.findFirst({
        where: { standardId: input.standardId, status: 'OPEN' },
        include: { votes: true, standard: { select: { id: true, workingGroupId: true } } },
      });
      if (!open) return null;
      // Only past-deadline votes auto-close here; live ones use closeVoting.
      if (!open.deadline || new Date(open.deadline) > new Date()) return null;

      if (!can(userCtx(ctx.session), 'vote:open', open.standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const forVotes = open.votes.filter((v) => v.choice === 'FOR').length;
      const againstVotes = open.votes.filter((v) => v.choice === 'AGAINST').length;
      const total = forVotes + againstVotes;
      const adopted = total > 0 ? forVotes / total > 0.5 : false;
      const newStatus = adopted ? 'ADOPTED' : 'REJECTED';

      const didClose = await ctx.db.$transaction(
        async (tx) => {
          const fresh = await tx.voting.findFirst({
            where: { id: open.id, status: 'OPEN' },
            select: { id: true },
          });
          if (!fresh) return false; // already closed by a concurrent request
          await tx.voting.update({
            where: { id: open.id },
            data: { status: 'CLOSED', closedAt: new Date() },
          });
          await tx.standard.update({
            where: { id: open.standard.id },
            data: { status: newStatus },
          });
          await tx.standardStatusHistory.create({
            data: {
              standardId: open.standard.id,
              fromStatus: 'VOTING',
              toStatus: newStatus,
              changedById: ctx.session.user.id,
              note: `Автоматичне завершення за дедлайном. За: ${forVotes}, Проти: ${againstVotes}`,
            },
          });
          return true;
        },
        { isolationLevel: 'Serializable' },
      );

      if (!didClose) return null;

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'STATUS_CHANGE',
        entity: 'Vote',
        entityId: open.id,
        before: { status: 'OPEN' },
        after: { status: 'CLOSED' },
        note: `Авто-завершення за дедлайном. За: ${forVotes}, проти: ${againstVotes}. Результат: ${newStatus}`,
      });
      await notifyVoteClosed(
        ctx.db,
        open.id,
        adopted ? 'прийнято' : 'відхилено',
        ctx.session.user.id,
      );

      return { status: newStatus, forVotes, againstVotes, total };
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
