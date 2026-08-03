import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { logActivity } from '@/server/audit';
import { seesAllWorkingGroups } from '@/server/permissions';
import { notifyStandardStatusChanged, notifyStageCompleted, type StageKey } from '@/server/notify';
import { s3 } from '@/server/s3';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '@/lib/env';
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

/**
 * Standard lifecycle state machine (B-16 / Pack 3). VOTING is only ever
 * reachable via `vote.openVoting` (not changeStatus), and ADOPTED/REJECTED
 * are only ever reachable via `vote.closeVoting` — so they're absent from
 * every list here. ADMIN bypasses this for cleanup / emergency corrections;
 * everyone else must follow the declared transitions.
 */
const STATUS_TRANSITIONS: Record<
  'DRAFT' | 'IN_REVIEW' | 'VOTING' | 'ADOPTED' | 'REJECTED' | 'ARCHIVED',
  ('DRAFT' | 'IN_REVIEW' | 'VOTING' | 'ADOPTED' | 'REJECTED' | 'ARCHIVED')[]
> = {
  DRAFT: ['IN_REVIEW', 'ARCHIVED'],
  IN_REVIEW: ['DRAFT', 'ARCHIVED'],
  VOTING: ['IN_REVIEW'], // manual cancel only; ADOPTED/REJECTED come from vote.closeVoting
  ADOPTED: ['ARCHIVED'],
  REJECTED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: [],
};

function assertAllowedTransition(
  from: keyof typeof STATUS_TRANSITIONS,
  to: keyof typeof STATUS_TRANSITIONS,
  isAdmin: boolean,
) {
  if (from === to || isAdmin) return;
  if (!STATUS_TRANSITIONS[from].includes(to)) {
    const allowed = STATUS_TRANSITIONS[from].join(', ') || '(жодного)';
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Заборонений перехід "${from}" → "${to}". Дозволено: ${allowed}.`,
    });
  }
}

export const standardRouter = createTRPCRouter({
  // ── list (paginated + filtered) ───────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        // Single id (legacy) OR array of ids (multi-select). Array wins if both.
        workingGroupId: z.string().cuid().optional(),
        workingGroupIds: z.array(z.string().cuid()).optional(),
        status: z
          .enum(['DRAFT', 'IN_REVIEW', 'VOTING', 'ADOPTED', 'REJECTED', 'ARCHIVED'])
          .optional(),
        statuses: z
          .array(z.enum(['DRAFT', 'IN_REVIEW', 'VOTING', 'ADOPTED', 'REJECTED', 'ARCHIVED']))
          .optional(),
        search: z.string().optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(500).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const seesAll = seesAllWorkingGroups(ctx.session.user);
      const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];

      // Client-supplied WG filter — multi (workingGroupIds) takes precedence
      // over single. Both must be intersected with the groups the user may
      // see; otherwise passing a foreign WG id leaks that group's standards
      // (B-1). An empty allow-list resolves to `{ in: [] }`, which matches no
      // rows, so the result is an empty page rather than a bypass.
      const requestedIds =
        input.workingGroupIds && input.workingGroupIds.length > 0
          ? input.workingGroupIds
          : input.workingGroupId
            ? [input.workingGroupId]
            : null;
      const allowedIds = requestedIds
        ? seesAll
          ? requestedIds
          : requestedIds.filter((id) => memberGroupIds.includes(id))
        : null;

      const wgFilter = allowedIds
        ? { workingGroupId: { in: allowedIds } }
        : seesAll
          ? {}
          : { workingGroupId: { in: memberGroupIds } };

      const statusFilter =
        input.statuses && input.statuses.length > 0
          ? { status: { in: input.statuses } }
          : input.status
            ? { status: input.status }
            : {};

      const where = {
        ...wgFilter,
        ...statusFilter,
        ...(input.search
          ? {
              OR: [
                { code: { contains: input.search, mode: 'insensitive' as const } },
                { title: { contains: input.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };

      const [items, total] = await Promise.all([
        ctx.db.standard.findMany({
          where,
          include: {
            workingGroup: { select: { id: true, code: true, color: true } },
            responsible: { select: { id: true, name: true, avatarUrl: true } },
            _count: { select: { documents: true, comments: true, tasks: true } },
          },
          orderBy: { updatedAt: 'desc' },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
        }),
        ctx.db.standard.count({ where }),
      ]);

      return {
        items,
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(total / input.pageSize),
      };
    }),

  // ── byId ─────────────────────────────────────────────────────────────
  byId: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUnique({
        where: { id: input.id },
        include: {
          workingGroup: {
            include: {
              members: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      avatarUrl: true,
                      rank: true,
                      position: true,
                      phone: true,
                      // Needed for voting quorum: only active members count
                      // toward the eligible-voter denominator.
                      isActive: true,
                    },
                  },
                },
              },
            },
          },
          responsible: { select: { id: true, name: true, avatarUrl: true } },
          bodyUpdatedBy: { select: { id: true, name: true } },
          documents: {
            include: {
              uploadedBy: { select: { id: true, name: true } },
              bodyUpdatedBy: { select: { id: true, name: true } },
              // Suggestion counts split by status so the documents list
              // can show "5 правок: 2 прийнято / 1 відхилено / 2 нових"
              // without an extra round-trip.
              suggestions: { select: { id: true, status: true } },
              // For locked documents we surface the voting context so
              // the lock badge / editor banner can render "Голосування
              // №3, завершено 12.04.2026" without a follow-up fetch.
              lockedByVoting: { select: { seqNumber: true, closedAt: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
          comments: {
            include: {
              author: { select: { id: true, name: true, avatarUrl: true } },
              replies: {
                include: { author: { select: { id: true, name: true, avatarUrl: true } } },
              },
            },
            where: { parentId: null },
            orderBy: { createdAt: 'desc' },
          },
          votes: {
            include: { votes: { include: { user: { select: { id: true, name: true } } } } },
            orderBy: { openedAt: 'desc' },
          },
          tasks: {
            include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
            orderBy: { createdAt: 'desc' },
          },
          statusHistory: {
            orderBy: { changedAt: 'desc' },
            include: {
              changedBy: { select: { id: true, name: true, avatarUrl: true, rank: true } },
            },
          },
        },
      });

      if (!standard) throw new TRPCError({ code: 'NOT_FOUND' });

      const seesAll = seesAllWorkingGroups(ctx.session.user);
      const isMember = standard.workingGroup.members.some((m) => m.userId === ctx.session.user.id);
      if (!seesAll && !isMember) throw new TRPCError({ code: 'FORBIDDEN' });

      return standard;
    }),

  // ── create ───────────────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        workingGroupId: z.string().cuid(),
        code: z.string().min(2).max(30),
        title: z.string().min(5).max(300),
        description: z.string().optional(),
        isoAnalog: z.string().optional(),
        category: z.string().optional(),
        deadline: z.date().optional(),
        responsibleId: z.string().cuid().optional(),
        // Fields tied to the standardisation program report — surfaced
        // both in /reports and on the standard card so leadership can
        // register program metadata at creation time instead of editing
        // right after.
        partProgram: z.string().max(120).optional(),
        programNumber: z.number().int().min(1).max(9999).optional(),
        indeks: z.string().max(120).optional(),
        oldTitle: z.string().max(300).optional(),
        // Stage deadlines collected upfront in the create form so the
        // poetap diagram on the standard page is populated from day one.
        techSpecDueDate: z.date().optional(),
        draftDueDate: z.date().optional(),
        feedbackDueDate: z.date().optional(),
        techReviewDueDate: z.date().optional(),
        finalDueDate: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!can(userCtx(ctx.session), 'standard:create', input.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const existing = await ctx.db.standard.findUnique({
        where: { workingGroupId_code: { workingGroupId: input.workingGroupId, code: input.code } },
      });
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Стандарт з таким кодом вже існує' });
      }

      const standard = await ctx.db.standard.create({
        data: input,
      });

      // Create initial status history record
      await ctx.db.standardStatusHistory.create({
        data: {
          standardId: standard.id,
          fromStatus: null,
          toStatus: 'DRAFT',
          changedById: ctx.session.user.id,
          note: 'Стандарт створено',
        },
      });

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'Standard',
        entityId: standard.id,
        after: standard,
      });

      return standard;
    }),

  // ── update ───────────────────────────────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        title: z.string().min(5).max(300).optional(),
        description: z.string().optional(),
        isoAnalog: z.string().optional(),
        category: z.string().optional(),
        deadline: z.date().optional().nullable(),
        responsibleId: z.string().cuid().optional().nullable(),
        progress: z.number().min(0).max(100).optional(),
        // Program-report fields — nullable so the edit modal can clear
        // them explicitly. `''` → null in the client so we don't have
        // to distinguish "empty" vs "unchanged" (undefined = untouched).
        partProgram: z.string().max(120).optional().nullable(),
        programNumber: z.number().int().min(1).max(9999).optional().nullable(),
        indeks: z.string().max(120).optional().nullable(),
        oldTitle: z.string().max(300).optional().nullable(),
        // Stage due dates — planned deadlines per program-plan stage.
        // Editable post-create (previously only settable via /standards/new).
        // Nullable so a stage can be cleared. `completedAt` fields stay
        // out of this mutation — those go through confirmStage.
        techSpecDueDate: z.date().optional().nullable(),
        draftDueDate: z.date().optional().nullable(),
        feedbackDueDate: z.date().optional().nullable(),
        techReviewDueDate: z.date().optional().nullable(),
        finalDueDate: z.date().optional().nullable(),
        // Marks this standard as a reusable task template — its tasks +
        // subtasks are eligible sources for task.copyFromTemplate.
        isTaskTemplate: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUniqueOrThrow({ where: { id: input.id } });

      const uctx = userCtx(ctx.session);
      if (!can(uctx, 'standard:editMeta', standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const { id, ...data } = input;
      const updated = await ctx.db.standard.update({ where: { id }, data });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Standard',
        entityId: id,
        before: standard,
        after: updated,
      });
      return updated;
    }),

  // ── changeStatus ──────────────────────────────────────────────────────
  changeStatus: protectedProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        status: z.enum(['DRAFT', 'IN_REVIEW', 'VOTING', 'ADOPTED', 'REJECTED', 'ARCHIVED']),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUniqueOrThrow({ where: { id: input.id } });

      if (!can(userCtx(ctx.session), 'standard:changeStatus', standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      // Pack 3 / B-16: enforce the lifecycle on the server. ADMIN keeps an
      // escape hatch; everyone else must follow STATUS_TRANSITIONS, so
      // DRAFT → ADOPTED-style shortcuts past the voting flow are impossible.
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';
      assertAllowedTransition(standard.status, input.status, isAdmin);

      // Per spec: DRAFT → IN_REVIEW requires at least one active (unlocked)
      // STANDARD document on the standard. Without the actual standard
      // text there's nothing to review or put to a vote. TЗ is NOT
      // required for review/voting — only the standard doc is the gate.
      // ADMIN keeps the escape hatch (e.g. data-recovery).
      if (input.status === 'IN_REVIEW' && standard.status === 'DRAFT' && !isAdmin) {
        const standardDocCount = await ctx.db.document.count({
          where: { standardId: input.id, type: 'STANDARD', lockedAt: null },
        });
        if (standardDocCount === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Спочатку завантажте документ типу «Стандарт» — без нього стандарт не можна перевести «На розгляд».',
          });
        }
      }

      const [updated] = await ctx.db.$transaction([
        ctx.db.standard.update({
          where: { id: input.id },
          data: { status: input.status },
        }),
        ctx.db.standardStatusHistory.create({
          data: {
            standardId: input.id,
            fromStatus: standard.status,
            toStatus: input.status,
            changedById: ctx.session.user.id,
            note: input.note,
          },
        }),
      ]);

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: input.status === 'ARCHIVED' ? 'ARCHIVE' : 'STATUS_CHANGE',
        entity: 'Standard',
        entityId: input.id,
        before: { status: standard.status },
        after: { status: input.status },
        note: input.note,
      });

      await notifyStandardStatusChanged(
        ctx.db,
        input.id,
        standard.status,
        input.status,
        ctx.session.user.id,
      );

      return updated;
    }),

  // ── confirmStage (secretary/leader marks a stage as actually completed)
  //   Toggling: pass confirmed=true to set timestamp, false to clear it.
  //   Optional `completedAt` lets the secretary record the REAL completion
  //   date (which can be earlier than today's click); falls back to now().
  //   currentStage is auto-recomputed as the first unconfirmed stage.
  confirmStage: protectedProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        stage: z.enum(['TECH_SPEC', 'DRAFTING', 'FEEDBACK', 'TECH_REVIEW', 'FINALIZATION']),
        confirmed: z.boolean(),
        completedAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUniqueOrThrow({ where: { id: input.id } });
      // Only secretary, leader, deputy, or admin can confirm stages
      const uctx = userCtx(ctx.session);
      const m = uctx.memberships.find((mb) => mb.workingGroupId === standard.workingGroupId);
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';
      const canConfirm =
        isAdmin || m?.role === 'SECRETARY' || m?.role === 'LEADER' || m?.role === 'DEPUTY';
      if (!canConfirm) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Лише секретар, керівник або заступник РГ можуть підтверджувати етапи',
        });
      }

      const STAGE_KEY: Record<typeof input.stage, keyof typeof standard> = {
        TECH_SPEC: 'techSpecCompletedAt',
        DRAFTING: 'draftCompletedAt',
        FEEDBACK: 'feedbackCompletedAt',
        TECH_REVIEW: 'techReviewCompletedAt',
        FINALIZATION: 'finalCompletedAt',
      } as const;

      const key = STAGE_KEY[input.stage];
      const stampedAt = input.confirmed ? (input.completedAt ?? new Date()) : null;
      const updateData: Record<string, Date | null | string> = {
        [key]: stampedAt,
      };

      // Recompute currentStage = first unconfirmed stage (or COMPLETED if all set)
      const merged = { ...standard, [key]: stampedAt };
      const order = ['TECH_SPEC', 'DRAFTING', 'FEEDBACK', 'TECH_REVIEW', 'FINALIZATION'] as const;
      let next = 'COMPLETED' as
        | 'TECH_SPEC'
        | 'DRAFTING'
        | 'FEEDBACK'
        | 'TECH_REVIEW'
        | 'FINALIZATION'
        | 'COMPLETED';
      for (const s of order) {
        if (!merged[STAGE_KEY[s]]) {
          next = s;
          break;
        }
      }
      updateData.currentStage = next;

      const updated = await ctx.db.standard.update({
        where: { id: input.id },
        data: updateData,
      });

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'STATUS_CHANGE',
        entity: 'Standard',
        entityId: input.id,
        before: { [String(key)]: standard[key] },
        after: { [String(key)]: updateData[key] },
        note: input.confirmed
          ? `Етап ${input.stage}: підтверджено виконання ${stampedAt ? new Date(stampedAt).toLocaleDateString('uk-UA') : ''}`.trim()
          : `Етап ${input.stage}: знято підтвердження`,
      });

      // Notify leadership when a stage is freshly confirmed
      if (input.confirmed && !standard[key]) {
        const STAGE_NOTIFY_KEY: Record<typeof input.stage, StageKey> = {
          TECH_SPEC: 'techSpec',
          DRAFTING: 'draft',
          FEEDBACK: 'feedback',
          TECH_REVIEW: 'techReview',
          FINALIZATION: 'final',
        };
        await notifyStageCompleted(
          ctx.db,
          input.id,
          STAGE_NOTIFY_KEY[input.stage],
          ctx.session.user.id,
        );
      }

      return updated;
    }),

  // ── delete (ADMIN only) ───────────────────────────────────────────────
  // Hard-deletes the standard and EVERY related record. The DB cascade
  // (onDelete: Cascade in schema) removes documents, tasks, votings/votes,
  // comments, inline comments + replies, suggestions and status history. On
  // top of that we best-effort delete the documents' files from S3 (the DB
  // cascade can't reach object storage — they'd otherwise orphan, B-11).
  // Guarded by a server-enforced type-to-confirm: the caller must echo the
  // standard's code, so a stray/automated call can't wipe a standard.
  delete: protectedProcedure
    .input(z.object({ id: z.string().cuid(), confirmCode: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.globalRole !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const before = await ctx.db.standard.findUniqueOrThrow({ where: { id: input.id } });

      if (input.confirmCode.trim() !== before.code) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Код підтвердження не збігається з кодом стандарту',
        });
      }

      // Collect S3 keys before the cascade removes the Document rows.
      const docs = await ctx.db.document.findMany({
        where: { standardId: input.id, s3Key: { not: null } },
        select: { s3Key: true },
      });

      const deleted = await ctx.db.standard.delete({ where: { id: input.id } });

      // Best-effort object-storage cleanup (don't fail the delete on S3 errors).
      let s3Deleted = 0;
      for (const d of docs) {
        if (!d.s3Key) continue;
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: d.s3Key }));
          s3Deleted += 1;
        } catch (e) {
          console.warn('[standard.delete] S3 delete failed (continuing)', e);
        }
      }

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'DELETE',
        entity: 'Standard',
        entityId: input.id,
        before,
        note: `Видалено стандарт ${before.code} та всі пов'язані дані (файлів у сховищі: ${s3Deleted}/${docs.length})`,
      });
      return deleted;
    }),

  // ── bulkUpdate: apply one change to many standards at once ───────────
  // Pattern matches GitHub / Linear bulk-edit: caller passes a list of
  // ids + a partial patch. Each affected standard is checked individually
  // for permission; failures are returned, not thrown, so a partial-batch
  // operation isn't fully wasted.
  bulkUpdate: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.string().cuid()).min(1).max(200),
        patch: z
          .object({
            status: z
              .enum(['DRAFT', 'IN_REVIEW', 'VOTING', 'ADOPTED', 'REJECTED', 'ARCHIVED'])
              .optional(),
            workingGroupId: z.string().cuid().optional(),
          })
          .refine(
            (p) => p.status !== undefined || p.workingGroupId !== undefined,
            'Patch must include at least one field',
          ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const uctx = userCtx(ctx.session);
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';

      const targets = await ctx.db.standard.findMany({
        where: { id: { in: input.ids } },
        select: { id: true, code: true, status: true, workingGroupId: true },
      });

      const updated: string[] = [];
      const skipped: { id: string; reason: string }[] = [];

      for (const t of targets) {
        // Permission: editing meta on the *source* WG
        if (!isAdmin && !can(uctx, 'standard:editMeta', t.workingGroupId)) {
          skipped.push({ id: t.id, reason: 'no permission on source WG' });
          continue;
        }
        // Permission: changing status is a stricter right (LEADERS only by
        // default) than editing meta (STAFF). Without this, a SECRETARY could
        // bulk-flip statuses they cannot change one-by-one (B-2).
        if (
          input.patch.status &&
          input.patch.status !== t.status &&
          !isAdmin &&
          !can(uctx, 'standard:changeStatus', t.workingGroupId)
        ) {
          skipped.push({ id: t.id, reason: 'no permission to change status' });
          continue;
        }
        // Pack 3 / B-16: state-machine on bulk too. ADMIN bypasses.
        if (
          input.patch.status &&
          input.patch.status !== t.status &&
          !isAdmin &&
          !STATUS_TRANSITIONS[t.status].includes(input.patch.status)
        ) {
          skipped.push({
            id: t.id,
            reason: `заборонений перехід ${t.status} → ${input.patch.status}`,
          });
          continue;
        }
        // Permission: also editing meta on the *target* WG when moving
        if (
          input.patch.workingGroupId &&
          input.patch.workingGroupId !== t.workingGroupId &&
          !isAdmin &&
          !can(uctx, 'standard:editMeta', input.patch.workingGroupId)
        ) {
          skipped.push({ id: t.id, reason: 'no permission on target WG' });
          continue;
        }

        const before = { status: t.status, workingGroupId: t.workingGroupId };
        const after = await ctx.db.standard.update({
          where: { id: t.id },
          data: input.patch,
          select: { id: true, status: true, workingGroupId: true },
        });
        await logActivity(ctx.db, {
          userId: ctx.session.user.id,
          action: input.patch.status ? 'STATUS_CHANGE' : 'UPDATE',
          entity: 'Standard',
          entityId: t.id,
          before,
          after,
          note: 'Bulk action',
        });
        if (
          input.patch.status &&
          input.patch.status !== t.status &&
          ctx.session.user.globalRole !== 'ADMIN'
        ) {
          // status change notifications fire elsewhere; mirror them on bulk
          await notifyStandardStatusChanged(
            ctx.db,
            t.id,
            t.status,
            input.patch.status,
            ctx.session.user.id,
          );
        }
        updated.push(t.id);
      }

      return { updated, skipped };
    }),

  // ── templates ─────────────────────────────────────────────────────────
  // Lightweight list of every standard marked isTaskTemplate=true —
  // used by the "Створити з шаблону" picker. Excludes the target
  // standard (client passes exclude to avoid seeing "copy myself into
  // myself"). RBAC: any authed user who can create tasks somewhere
  // can browse templates; we filter to what the user actually sees.
  templates: protectedProcedure
    .input(z.object({ exclude: z.string().cuid().optional() }))
    .query(async ({ ctx, input }) => {
      const seesAll = seesAllWorkingGroups(ctx.session.user);
      const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];
      const wgFilter = seesAll ? {} : { workingGroupId: { in: memberGroupIds } };
      return ctx.db.standard.findMany({
        where: {
          isTaskTemplate: true,
          ...(input.exclude ? { NOT: { id: input.exclude } } : {}),
          ...wgFilter,
        },
        select: {
          id: true,
          code: true,
          title: true,
          indeks: true,
          workingGroup: { select: { code: true, color: true } },
          _count: { select: { tasks: true } },
        },
        orderBy: { code: 'asc' },
      });
    }),
});
