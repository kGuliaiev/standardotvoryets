/**
 * Collaborative editing of a standard's body text via discrete
 * "suggestions" (paragraph-level edits that the WG leader resolves).
 *
 * Lifecycle:
 *   create  → status=PENDING. Author is any WG member.
 *   react   → LIKE/DISLIKE per user. Toggles on/off.
 *   accept  → status=ACCEPTED, applies to bodyText. LEADER/DEPUTY/SECRETARY only.
 *   reject  → status=REJECTED. Leader only.
 *
 * Concurrency: applyAccept reads the latest bodyText, splits by /\n\n+/,
 * checks that the paragraph at paragraphIndex still equals originalText.
 * If it drifted (some other suggestion was accepted in between), we
 * return a CONFLICT error so the leader can re-review.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { logActivity } from '@/server/audit';
import { notifySuggestionNew, notifySuggestionResolved } from '@/server/notify';
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
 * Split bodyText into top-level "blocks" the same way the UI does.
 * Body is HTML emitted by TipTap (paragraph, heading, list, etc.).
 * Legacy plain-text bodies are migrated on the fly to <p>-wrapped HTML
 * so the rest of this file only deals with one format.
 *
 * Server-side implementation avoids DOMParser (not available in Node) —
 * uses a tag-depth scanner that handles the limited TipTap schema we
 * allow. For more complex HTML we'd reach for `cheerio`; for now this
 * is intentionally minimal.
 */
function splitParagraphs(body: string | null | undefined): string[] {
  if (!body) return [];
  const trimmed = body.trim();
  if (!trimmed) return [];

  // Legacy plain text — migrate by wrapping each non-empty line group in <p>
  if (!trimmed.startsWith('<')) {
    return trimmed
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map(
        (p) =>
          `<p>${p
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>')}</p>`,
      );
  }

  const blocks: string[] = [];
  let depth = 0;
  let buffer = '';
  const re = /<\/?(\w+)[^>]*>/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    const isClosing = m[0].startsWith('</');
    const tag = (m[1] ?? '').toLowerCase();
    buffer += trimmed.slice(lastIndex, re.lastIndex);
    lastIndex = re.lastIndex;
    if (isClosing) {
      depth--;
      if (depth === 0) {
        blocks.push(buffer);
        buffer = '';
      }
    } else if (!m[0].endsWith('/>')) {
      depth++;
      if (tag === 'br' || tag === 'img' || tag === 'hr') depth--;
    }
  }
  if (buffer.trim()) blocks.push(buffer);
  return blocks.filter((b) => b.trim().length > 0);
}

function joinParagraphs(blocks: string[]): string {
  return blocks.join('');
}

export const suggestionRouter = createTRPCRouter({
  // ── list (everyone with read access to the standard) ─────────────────
  list: protectedProcedure
    .input(
      z.object({
        standardId: z.string().cuid(),
        status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const std = await ctx.db.standard.findUniqueOrThrow({
        where: { id: input.standardId },
        select: { workingGroupId: true },
      });
      const u = userCtx(ctx.session);
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';
      const isDirector = ctx.session.user.globalRole === 'DIRECTOR';
      const isMember = u.memberships.some((m) => m.workingGroupId === std.workingGroupId);
      if (!isAdmin && !isDirector && !isMember) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return ctx.db.standardSuggestion.findMany({
        where: {
          standardId: input.standardId,
          ...(input.status ? { status: input.status } : {}),
        },
        include: {
          author: { select: { id: true, name: true, avatarUrl: true, rank: true } },
          resolvedBy: { select: { id: true, name: true } },
          reactions: { select: { userId: true, type: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      });
    }),

  // ── create (any WG member) ────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        standardId: z.string().cuid(),
        paragraphIndex: z.number().int().min(0),
        originalText: z.string().max(20_000),
        proposedText: z.string().max(20_000),
        operation: z.enum(['REPLACE', 'INSERT_AFTER', 'DELETE']).default('REPLACE'),
        rationale: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const std = await ctx.db.standard.findUniqueOrThrow({
        where: { id: input.standardId },
        select: { workingGroupId: true, code: true, title: true },
      });
      if (!can(userCtx(ctx.session), 'comment:add', std.workingGroupId)) {
        // Reusing comment:add: any member of the WG can suggest.
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const created = await ctx.db.standardSuggestion.create({
        data: {
          standardId: input.standardId,
          authorId: ctx.session.user.id,
          paragraphIndex: input.paragraphIndex,
          originalText: input.originalText,
          proposedText: input.operation === 'DELETE' ? '' : input.proposedText,
          operation: input.operation,
          rationale: input.rationale,
        },
        include: { author: { select: { name: true } } },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'StandardSuggestion',
        entityId: created.id,
        after: created,
        note: `Запропоновано правку до стандарту ${std.code}`,
      });
      await notifySuggestionNew(ctx.db, created.id, ctx.session.user.id);
      return created;
    }),

  // ── react (LIKE / DISLIKE, toggle) ───────────────────────────────────
  react: protectedProcedure
    .input(
      z.object({
        suggestionId: z.string().cuid(),
        type: z.enum(['LIKE', 'DISLIKE']).nullable(),
        // null = remove my reaction entirely
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sug = await ctx.db.standardSuggestion.findUniqueOrThrow({
        where: { id: input.suggestionId },
        select: { standardId: true, standard: { select: { workingGroupId: true } } },
      });
      if (!can(userCtx(ctx.session), 'comment:add', sug.standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (input.type === null) {
        await ctx.db.suggestionReaction.deleteMany({
          where: { suggestionId: input.suggestionId, userId: ctx.session.user.id },
        });
      } else {
        await ctx.db.suggestionReaction.upsert({
          where: {
            suggestionId_userId: {
              suggestionId: input.suggestionId,
              userId: ctx.session.user.id,
            },
          },
          create: {
            suggestionId: input.suggestionId,
            userId: ctx.session.user.id,
            type: input.type,
          },
          update: { type: input.type },
        });
      }
      // Reactions are UX state — no audit-log entry.
      return { ok: true };
    }),

  // ── accept (LEADER/DEPUTY/SECRETARY or ADMIN) ────────────────────────
  accept: protectedProcedure
    .input(z.object({ id: z.string().cuid(), note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const sug = await ctx.db.standardSuggestion.findUniqueOrThrow({
        where: { id: input.id },
        include: { standard: { select: { id: true, workingGroupId: true, bodyText: true } } },
      });
      if (!can(userCtx(ctx.session), 'standard:editMeta', sug.standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (sug.status !== 'PENDING') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Правку вже опрацьовано' });
      }

      // Re-read current paragraphs and verify drift
      const paras = splitParagraphs(sug.standard.bodyText);
      const target = paras[sug.paragraphIndex];
      if (target === undefined) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Параграф №${sug.paragraphIndex + 1} більше не існує — текст документа змінився. Перегляньте правку.`,
        });
      }
      if (target.trim() !== sug.originalText.trim()) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'Текст параграфа змінився з моменту створення правки. Перегляньте її та створіть нову, якщо потрібно.',
        });
      }

      // Apply the operation
      const nextParas = [...paras];
      if (sug.operation === 'REPLACE') {
        nextParas[sug.paragraphIndex] = sug.proposedText;
      } else if (sug.operation === 'DELETE') {
        nextParas.splice(sug.paragraphIndex, 1);
      } else if (sug.operation === 'INSERT_AFTER') {
        nextParas.splice(sug.paragraphIndex + 1, 0, sug.proposedText);
      }
      const nextBody = joinParagraphs(nextParas.filter((p) => p.trim().length > 0));

      await ctx.db.$transaction([
        ctx.db.standard.update({
          where: { id: sug.standardId },
          data: {
            bodyText: nextBody,
            bodyUpdatedAt: new Date(),
            bodyUpdatedById: ctx.session.user.id,
          },
        }),
        ctx.db.standardSuggestion.update({
          where: { id: sug.id },
          data: {
            status: 'ACCEPTED',
            resolvedAt: new Date(),
            resolvedById: ctx.session.user.id,
            resolveNote: input.note,
          },
        }),
      ]);

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'STATUS_CHANGE',
        entity: 'StandardSuggestion',
        entityId: sug.id,
        before: { status: 'PENDING' },
        after: { status: 'ACCEPTED' },
        note: input.note ?? 'Правку прийнято',
      });
      await notifySuggestionResolved(ctx.db, sug.id, 'ACCEPTED', ctx.session.user.id);
      return { ok: true };
    }),

  // ── reject ────────────────────────────────────────────────────────────
  reject: protectedProcedure
    .input(z.object({ id: z.string().cuid(), note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const sug = await ctx.db.standardSuggestion.findUniqueOrThrow({
        where: { id: input.id },
        include: { standard: { select: { workingGroupId: true } } },
      });
      if (!can(userCtx(ctx.session), 'standard:editMeta', sug.standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (sug.status !== 'PENDING') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Правку вже опрацьовано' });
      }
      await ctx.db.standardSuggestion.update({
        where: { id: sug.id },
        data: {
          status: 'REJECTED',
          resolvedAt: new Date(),
          resolvedById: ctx.session.user.id,
          resolveNote: input.note,
        },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'STATUS_CHANGE',
        entity: 'StandardSuggestion',
        entityId: sug.id,
        before: { status: 'PENDING' },
        after: { status: 'REJECTED' },
        note: input.note ?? 'Правку відхилено',
      });
      await notifySuggestionResolved(ctx.db, sug.id, 'REJECTED', ctx.session.user.id);
      return { ok: true };
    }),

  // ── updateBody (LEADER/DEPUTY/SECRETARY or ADMIN: direct edit) ───────
  // Lets the leader bulk-edit the body when there are no pending edits.
  // For routine work members should use create() instead.
  updateBody: protectedProcedure
    .input(z.object({ standardId: z.string().cuid(), bodyText: z.string().max(200_000) }))
    .mutation(async ({ ctx, input }) => {
      const std = await ctx.db.standard.findUniqueOrThrow({
        where: { id: input.standardId },
        select: { workingGroupId: true, bodyText: true },
      });
      if (!can(userCtx(ctx.session), 'standard:editMeta', std.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const updated = await ctx.db.standard.update({
        where: { id: input.standardId },
        data: {
          bodyText: input.bodyText,
          bodyUpdatedAt: new Date(),
          bodyUpdatedById: ctx.session.user.id,
        },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Standard',
        entityId: input.standardId,
        before: { bodyText: std.bodyText ?? '' },
        after: { bodyText: updated.bodyText ?? '' },
        note: 'Оновлено текст документа',
      });
      return updated;
    }),

  // ── replaceBody: import-style atomic body swap ────────────────────────
  // Same permission as updateBody, but also drops every existing
  // suggestion on this standard in a single transaction. Use this when
  // the body is being completely replaced (e.g. .docx import) — leftover
  // suggestions would point at paragraph indices that no longer exist
  // and produce confusing CONFLICT errors when the leader tries to
  // resolve them.
  replaceBody: protectedProcedure
    .input(z.object({ standardId: z.string().cuid(), bodyText: z.string().max(200_000) }))
    .mutation(async ({ ctx, input }) => {
      const std = await ctx.db.standard.findUniqueOrThrow({
        where: { id: input.standardId },
        select: { workingGroupId: true, bodyText: true },
      });
      if (!can(userCtx(ctx.session), 'standard:editMeta', std.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const [deleted, updated] = await ctx.db.$transaction([
        // Reactions cascade via Prisma's onDelete: Cascade on SuggestionReaction.
        ctx.db.standardSuggestion.deleteMany({ where: { standardId: input.standardId } }),
        ctx.db.standard.update({
          where: { id: input.standardId },
          data: {
            bodyText: input.bodyText,
            bodyUpdatedAt: new Date(),
            bodyUpdatedById: ctx.session.user.id,
          },
        }),
      ]);

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Standard',
        entityId: input.standardId,
        before: { bodyText: std.bodyText ?? '' },
        after: { bodyText: updated.bodyText ?? '' },
        note: `Замінено текст документа (імпорт). Видалено правок: ${deleted.count}.`,
      });
      return { ...updated, droppedSuggestionCount: deleted.count };
    }),
});
