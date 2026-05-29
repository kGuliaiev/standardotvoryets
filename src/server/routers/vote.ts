import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { logActivity } from '@/server/audit';
import { notifyVoteOpened, notifyVoteClosed } from '@/server/notify';
import type { GlobalRole, Prisma, PrismaClient, WorkingGroupRole } from '@prisma/client';

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

/**
 * Parse a version string like "v3", "v1.2", "draft" into a bumpable
 * integer. We keep it forgiving: anything we can't parse falls back to
 * "1" and the bump becomes "2". Used when cloning a locked STANDARD
 * document into a fresh editable version after a REJECTED voting.
 */
function bumpVersion(prev: string | null | undefined): string {
  if (!prev) return 'v2';
  const m = /v?(\d+)/i.exec(prev);
  if (!m) return `${prev}-нова`;
  const n = parseInt(m[1]!, 10);
  if (Number.isNaN(n)) return `${prev}-нова`;
  return `v${n + 1}`;
}

/** Render the localised filename suffix appended to the locked snapshot. */
function lockedSuffix(seqNumber: number, closedAt: Date, verdict: 'ADOPTED' | 'DRAFT') {
  const dd = closedAt.toLocaleDateString('uk-UA');
  const v = verdict === 'ADOPTED' ? 'прийнято' : 'відхилено';
  return ` (Голосування №${seqNumber}, ${v} ${dd})`;
}

/**
 * Lock the standard's CURRENT STANDARD-type document onto a voting that
 * just closed, and (when the voting was REJECTED) clone it into a fresh
 * editable version with bumped `version` and isCurrent=true.
 *
 * Runs inside the same transaction as the Voting row update so the
 * lock + standard status change are atomic.
 *
 * @returns `{ lockedDocId, newDraftDocId }` — both nullable. lockedDocId
 *          is null when the standard has no current STANDARD doc (e.g.
 *          early in the lifecycle, vote was opened without one). The
 *          UI handles that gracefully — no doc to show alongside the
 *          archived voting.
 */
async function lockAndCloneStandardDoc(
  tx: PrismaClient | Prisma.TransactionClient,
  args: {
    standardId: string;
    votingId: string;
    seqNumber: number;
    closedAt: Date;
    verdict: 'ADOPTED' | 'DRAFT';
    userId: string;
  },
): Promise<{ lockedDocId: string | null; newDraftDocId: string | null }> {
  // Find the active STANDARD-type document. There may be at most one
  // unlocked STANDARD per standard (server-enforced in document router).
  const current = await tx.document.findFirst({
    where: {
      standardId: args.standardId,
      type: 'STANDARD',
      lockedAt: null,
    },
  });
  if (!current) {
    return { lockedDocId: null, newDraftDocId: null };
  }

  // Lock + rename the current doc.
  const suffix = lockedSuffix(args.seqNumber, args.closedAt, args.verdict);
  const newName = current.filename.includes('Голосування №')
    ? current.filename // never double-append if the worker re-runs somehow
    : `${current.filename}${suffix}`;
  await tx.document.update({
    where: { id: current.id },
    data: {
      filename: newName,
      isCurrent: false,
      lockedAt: args.closedAt,
      lockedByVotingId: args.votingId,
    },
  });
  // Attach the locked snapshot to the voting (inverse relation).
  await tx.voting.update({
    where: { id: args.votingId },
    data: { documentId: current.id },
  });

  // On ADOPTED we don't clone — the locked snapshot IS the final.
  if (args.verdict === 'ADOPTED') {
    return { lockedDocId: current.id, newDraftDocId: null };
  }

  // On REJECT/DRAFT — clone into a fresh editable copy with bumped
  // version. s3Key is null (the clone lives only as bodyHtml until the
  // editor exports it again), so we don't fork the underlying file.
  const newVersion = bumpVersion(current.version);
  const cleanBase = current.filename
    // strip any prior "(Голосування №…)" suffix from previous lock cycles
    .replace(/\s*\(Голосування №\d+[^)]*\)\s*$/, '')
    .trim();
  const cloneName = cleanBase.toLowerCase().endsWith('.docx')
    ? `${cleanBase.replace(/\.docx$/i, '')} ${newVersion}.docx`
    : `${cleanBase} ${newVersion}`;

  const clone = await tx.document.create({
    data: {
      standardId: args.standardId,
      uploadedById: args.userId,
      type: 'STANDARD',
      filename: cloneName,
      s3Key: null,
      sizeBytes: 0,
      version: newVersion,
      note: `Нова версія після голосування №${args.seqNumber}`,
      isCurrent: true,
      allowEdits: true,
      bodyHtml: current.bodyHtml ?? '',
      bodyUpdatedAt: args.closedAt,
      bodyUpdatedById: args.userId,
    },
  });

  return { lockedDocId: current.id, newDraftDocId: clone.id };
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

      // Next seqNumber within this standard — used to name the locked
      // snapshot doc on close ("Стандарт — Голосування №3 (завершено …)").
      const lastSeq = await ctx.db.voting.aggregate({
        where: { standardId: input.standardId },
        _max: { seqNumber: true },
      });
      const nextSeq = (lastSeq._max.seqNumber ?? 0) + 1;

      const [voting] = await ctx.db.$transaction([
        ctx.db.voting.create({
          data: {
            standardId: input.standardId,
            title: input.title,
            description: input.description,
            deadline: input.deadline,
            seqNumber: nextSeq,
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
      // Per user spec: a negative outcome sends the standard back to
      // DRAFT (not REJECTED) so the WG can iterate on a fresh editable
      // copy of the document. ADOPTED stays ADOPTED.
      const newStatus = adopted ? 'ADOPTED' : 'DRAFT';
      const verdict: 'ADOPTED' | 'DRAFT' = adopted ? 'ADOPTED' : 'DRAFT';
      const closedAt = new Date();

      const { lockedDocId, newDraftDocId } = await ctx.db.$transaction(async (tx) => {
        await tx.voting.update({
          where: { id: input.votingId },
          data: {
            status: 'CLOSED',
            closedAt,
            eligibleAtClose: eligibleCount,
          },
        });
        await tx.standard.update({
          where: { id: voting.standard.id },
          data: { status: newStatus },
        });
        await tx.standardStatusHistory.create({
          data: {
            standardId: voting.standard.id,
            fromStatus: 'VOTING',
            toStatus: newStatus,
            changedById: ctx.session.user.id,
            note: `Голосування завершено. За: ${forVotes} з ${eligibleCount}, Проти: ${againstVotes}`,
          },
        });
        return lockAndCloneStandardDoc(tx, {
          standardId: voting.standard.id,
          votingId: input.votingId,
          seqNumber: voting.seqNumber,
          closedAt,
          verdict,
          userId: ctx.session.user.id,
        });
      });

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'STATUS_CHANGE',
        entity: 'Vote',
        entityId: input.votingId,
        before: { status: 'OPEN' },
        after: { status: 'CLOSED' },
        note:
          `Завершено. За: ${forVotes} з ${eligibleCount}, проти: ${againstVotes}.` +
          ` Результат: ${newStatus}` +
          (lockedDocId ? `. Документ заблоковано.` : '') +
          (newDraftDocId ? ' Створено нову версію.' : ''),
      });

      await notifyVoteClosed(
        ctx.db,
        input.votingId,
        adopted ? 'прийнято' : 'відхилено',
        ctx.session.user.id,
      );

      return {
        status: newStatus,
        forVotes,
        againstVotes,
        total,
        eligibleCount,
        lockedDocId,
        newDraftDocId,
      };
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
      const newStatus = adopted ? 'ADOPTED' : 'DRAFT';
      const verdict: 'ADOPTED' | 'DRAFT' = adopted ? 'ADOPTED' : 'DRAFT';
      const closedAt = new Date();

      const result = await ctx.db.$transaction(
        async (tx) => {
          const fresh = await tx.voting.findFirst({
            where: { id: open.id, status: 'OPEN' },
            select: { id: true },
          });
          if (!fresh) return null; // already closed by a concurrent request
          await tx.voting.update({
            where: { id: open.id },
            data: {
              status: 'CLOSED',
              closedAt,
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
          const docs = await lockAndCloneStandardDoc(tx, {
            standardId: open.standard.id,
            votingId: open.id,
            seqNumber: open.seqNumber,
            closedAt,
            verdict,
            userId: ctx.session.user.id,
          });
          return docs;
        },
        { isolationLevel: 'Serializable' },
      );

      if (!result) return null;

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'STATUS_CHANGE',
        entity: 'Vote',
        entityId: open.id,
        before: { status: 'OPEN' },
        after: { status: 'CLOSED' },
        note:
          `Авто-завершення за дедлайном. За: ${forVotes} з ${eligibleCount}, проти: ${againstVotes}.` +
          ` Результат: ${newStatus}` +
          (result.lockedDocId ? `. Документ заблоковано.` : '') +
          (result.newDraftDocId ? ' Створено нову версію.' : ''),
      });
      await notifyVoteClosed(
        ctx.db,
        open.id,
        adopted ? 'прийнято' : 'відхилено',
        ctx.session.user.id,
      );

      return {
        status: newStatus,
        forVotes,
        againstVotes,
        total,
        eligibleCount,
        lockedDocId: result.lockedDocId,
        newDraftDocId: result.newDraftDocId,
      };
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
