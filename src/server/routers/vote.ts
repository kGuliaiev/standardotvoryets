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

      // Pass threshold: forVotes / eligibleCount > 0.5
      // eligibleCount = active WG members with role LEADER/DEPUTY/MEMBER.
      // SECRETARY does NOT vote, GUEST does NOT vote — they're excluded
      // from the denominator. ABSTAIN votes count as "не за" (so a vote
      // with 1 abstain and 0 for/against gets REJECTED, which matches
      // the spec "більшість усіх голосуючих").
      const eligibleCount = await ctx.db.workingGroupMember.count({
        where: {
          workingGroupId: voting.standard.workingGroupId,
          role: { in: ['LEADER', 'DEPUTY', 'MEMBER'] },
          user: { isActive: true },
        },
      });

      const forVotes = voting.votes.filter((v) => v.choice === 'FOR').length;
      const againstVotes = voting.votes.filter((v) => v.choice === 'AGAINST').length;
      const total = forVotes + againstVotes;
      const adopted = eligibleCount > 0 && forVotes / eligibleCount > 0.5;
      const newStatus = adopted ? 'ADOPTED' : 'REJECTED';

      await ctx.db.$transaction([
        ctx.db.voting.update({
          where: { id: input.votingId },
          data: {
            status: 'CLOSED',
            closedAt: new Date(),
            eligibleAtClose: eligibleCount,
          },
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
            note: `Голосування завершено. За: ${forVotes} з ${eligibleCount}, Проти: ${againstVotes}`,
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
        note: `Завершено. За: ${forVotes} з ${eligibleCount}, проти: ${againstVotes}. Результат: ${newStatus}`,
      });

      await notifyVoteClosed(
        ctx.db,
        input.votingId,
        adopted ? 'прийнято' : 'відхилено',
        ctx.session.user.id,
      );

      return { status: newStatus, forVotes, againstVotes, total, eligibleCount };
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

      // Same denominator rule as closeVoting — see comments there.
      const eligibleCount = await ctx.db.workingGroupMember.count({
        where: {
          workingGroupId: open.standard.workingGroupId,
          role: { in: ['LEADER', 'DEPUTY', 'MEMBER'] },
          user: { isActive: true },
        },
      });

      const forVotes = open.votes.filter((v) => v.choice === 'FOR').length;
      const againstVotes = open.votes.filter((v) => v.choice === 'AGAINST').length;
      const total = forVotes + againstVotes;
      const adopted = eligibleCount > 0 && forVotes / eligibleCount > 0.5;
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
            data: {
              status: 'CLOSED',
              closedAt: new Date(),
              eligibleAtClose: eligibleCount,
            },
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
              note: `Автоматичне завершення за дедлайном. За: ${forVotes} з ${eligibleCount}, Проти: ${againstVotes}`,
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
        note: `Авто-завершення за дедлайном. За: ${forVotes} з ${eligibleCount}, проти: ${againstVotes}. Результат: ${newStatus}`,
      });
      await notifyVoteClosed(
        ctx.db,
        open.id,
        adopted ? 'прийнято' : 'відхилено',
        ctx.session.user.id,
      );

      return { status: newStatus, forVotes, againstVotes, total, eligibleCount };
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

  // ── adminWipeAll ──────────────────────────────────────────────────────
  // Emergency: wipe every Voting (and its Votes via cascade) across the
  // whole system, and revert any standard currently sitting in
  // VOTING / ADOPTED / REJECTED back to IN_REVIEW so it can be re-voted.
  // ADMIN-only. Used to recover from buggy historical results — see the
  // quorum-formula fix where pre-existing votings were closed under the
  // wrong denominator.
  adminWipeAll: protectedProcedure
    .input(z.object({ confirm: z.literal('WIPE-ALL-VOTINGS') }))
    .mutation(async ({ ctx }) => {
      if (ctx.session.user.globalRole !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Лише адміністратор' });
      }

      // Snapshot standards whose status we'll have to revert. We do this
      // before deleting votings so the audit history is meaningful.
      const affectedStandards = await ctx.db.standard.findMany({
        where: { status: { in: ['VOTING', 'ADOPTED', 'REJECTED'] } },
        select: { id: true, code: true, title: true, status: true },
      });

      const result = await ctx.db.$transaction(async (tx) => {
        const votingCount = await tx.voting.count();
        const voteCount = await tx.vote.count();

        // Vote rows cascade off Voting; deleting Voting kills Votes too.
        await tx.voting.deleteMany({});

        // Revert standards back to IN_REVIEW so they can be re-voted.
        if (affectedStandards.length > 0) {
          await tx.standard.updateMany({
            where: { id: { in: affectedStandards.map((s) => s.id) } },
            data: { status: 'IN_REVIEW' },
          });
          await tx.standardStatusHistory.createMany({
            data: affectedStandards.map((s) => ({
              standardId: s.id,
              fromStatus: s.status,
              toStatus: 'IN_REVIEW' as const,
              changedById: ctx.session.user.id,
              note: 'Адміністративне очищення голосувань — повернуто на розгляд',
            })),
          });
        }

        return { votingCount, voteCount, revertedStandards: affectedStandards.length };
      });

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'DELETE',
        entity: 'Vote',
        entityId: 'ALL',
        note: `Очищено всі голосування: ${result.votingCount} голосувань, ${result.voteCount} голосів, повернуто ${result.revertedStandards} стандартів на розгляд`,
      });

      return result;
    }),
});
