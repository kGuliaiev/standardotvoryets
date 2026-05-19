/**
 * Inline comments anchored to a text selection inside a body block.
 *
 * Think Google Docs comments: the user highlights a few words inside
 * paragraph 42 and leaves "це формулювання неоднозначне". Each comment
 * carries paragraphIndex + char offsets + a plain-text snapshot of
 * what was originally selected, plus optional threaded replies.
 *
 * Parent is polymorphic — exactly one of standardId / documentId —
 * matching the StandardSuggestion convention so the same editor
 * component can power both flows.
 *
 * Lifecycle:
 *   create  → status=OPEN, any WG member with comment:add
 *   reply   → appends to thread
 *   resolve → status=RESOLVED, leadership only
 *   delete  → author or leadership; cascades replies via FK
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { logActivity } from '@/server/audit';
import type { GlobalRole, WorkingGroupRole, PrismaClient } from '@prisma/client';

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

const targetInput = z
  .object({
    standardId: z.string().cuid().optional(),
    documentId: z.string().cuid().optional(),
  })
  .refine((d) => Boolean(d.standardId) !== Boolean(d.documentId), {
    message: 'Specify exactly one of standardId or documentId',
  });

async function resolveTargetWG(
  db: PrismaClient,
  input: { standardId?: string; documentId?: string },
): Promise<string> {
  if (input.standardId) {
    const std = await db.standard.findUniqueOrThrow({
      where: { id: input.standardId },
      select: { workingGroupId: true },
    });
    return std.workingGroupId;
  }
  const doc = await db.document.findUniqueOrThrow({
    where: { id: input.documentId! },
    select: { standard: { select: { workingGroupId: true } } },
  });
  return doc.standard.workingGroupId;
}

export const inlineCommentRouter = createTRPCRouter({
  // ── list ──────────────────────────────────────────────────────────────
  list: protectedProcedure.input(targetInput).query(async ({ ctx, input }) => {
    const wgId = await resolveTargetWG(ctx.db, input);
    const u = userCtx(ctx.session);
    const isAdmin = ctx.session.user.globalRole === 'ADMIN';
    const isDirector = ctx.session.user.globalRole === 'DIRECTOR';
    const isMember = u.memberships.some((m) => m.workingGroupId === wgId);
    if (!isAdmin && !isDirector && !isMember) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    const where = input.standardId
      ? { standardId: input.standardId }
      : { documentId: input.documentId! };
    return ctx.db.inlineComment.findMany({
      where,
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        resolvedBy: { select: { id: true, name: true } },
        replies: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }),

  // ── create ────────────────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      targetInput.and(
        z.object({
          paragraphIndex: z.number().int().min(0),
          startOffset: z.number().int().min(0),
          endOffset: z.number().int().min(0),
          selectionText: z.string().min(1).max(5000),
          body: z.string().min(1).max(5000),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.endOffset <= input.startOffset) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Невірний діапазон виділення' });
      }
      const wgId = await resolveTargetWG(ctx.db, input);
      if (!can(userCtx(ctx.session), 'comment:add', wgId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const created = await ctx.db.inlineComment.create({
        data: {
          ...(input.standardId
            ? { standardId: input.standardId }
            : { documentId: input.documentId }),
          authorId: ctx.session.user.id,
          paragraphIndex: input.paragraphIndex,
          startOffset: input.startOffset,
          endOffset: input.endOffset,
          selectionText: input.selectionText,
          body: input.body,
        },
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
        },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'InlineComment',
        entityId: created.id,
        after: created,
        note: 'Залишено inline-коментар',
      });
      return created;
    }),

  // ── reply ─────────────────────────────────────────────────────────────
  reply: protectedProcedure
    .input(
      z.object({
        commentId: z.string().cuid(),
        body: z.string().min(1).max(5000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const parent = await ctx.db.inlineComment.findUniqueOrThrow({
        where: { id: input.commentId },
        select: {
          standard: { select: { workingGroupId: true } },
          document: { select: { standard: { select: { workingGroupId: true } } } },
        },
      });
      const wgId = parent.standard?.workingGroupId ?? parent.document?.standard.workingGroupId;
      if (!wgId) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      if (!can(userCtx(ctx.session), 'comment:add', wgId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const created = await ctx.db.inlineCommentReply.create({
        data: {
          commentId: input.commentId,
          authorId: ctx.session.user.id,
          body: input.body,
        },
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
        },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'InlineCommentReply',
        entityId: created.id,
        after: created,
        note: 'Відповідь на inline-коментар',
      });
      return created;
    }),

  // ── resolve / unresolve ───────────────────────────────────────────────
  setResolved: protectedProcedure
    .input(z.object({ id: z.string().cuid(), resolved: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.db.inlineComment.findUniqueOrThrow({
        where: { id: input.id },
        select: {
          status: true,
          standard: { select: { workingGroupId: true } },
          document: { select: { standard: { select: { workingGroupId: true } } } },
        },
      });
      const wgId = c.standard?.workingGroupId ?? c.document?.standard.workingGroupId;
      if (!wgId) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      // Anyone with comment:add can mark resolved — it's a UX state more
      // than an authoritative decision; leadership additionally has
      // permission via the same check.
      if (!can(userCtx(ctx.session), 'comment:add', wgId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const updated = await ctx.db.inlineComment.update({
        where: { id: input.id },
        data: {
          status: input.resolved ? 'RESOLVED' : 'OPEN',
          resolvedAt: input.resolved ? new Date() : null,
          resolvedById: input.resolved ? ctx.session.user.id : null,
        },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'STATUS_CHANGE',
        entity: 'InlineComment',
        entityId: input.id,
        before: { status: c.status },
        after: { status: updated.status },
        note: input.resolved ? 'Закрито inline-коментар' : 'Відкрито inline-коментар',
      });
      return updated;
    }),

  // ── delete ────────────────────────────────────────────────────────────
  // Author or anyone with standard:editMeta (leadership) can delete.
  // Cascade FK takes care of replies.
  delete: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.db.inlineComment.findUniqueOrThrow({
        where: { id: input.id },
        select: {
          authorId: true,
          standard: { select: { workingGroupId: true } },
          document: { select: { standard: { select: { workingGroupId: true } } } },
        },
      });
      const wgId = c.standard?.workingGroupId ?? c.document?.standard.workingGroupId;
      if (!wgId) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const isAuthor = c.authorId === ctx.session.user.id;
      const isLead = can(userCtx(ctx.session), 'standard:editMeta', wgId);
      if (!isAuthor && !isLead) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      await ctx.db.inlineComment.delete({ where: { id: input.id } });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'DELETE',
        entity: 'InlineComment',
        entityId: input.id,
        before: c,
        note: 'Видалено inline-коментар',
      });
      return { ok: true };
    }),
});
