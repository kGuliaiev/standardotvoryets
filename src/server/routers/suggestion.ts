/**
 * Collaborative editing of an HTML body (TipTap-formatted) via discrete
 * "suggestions" — paragraph-level edits that a leader resolves.
 *
 * The body can live in two places:
 *   - `Standard.bodyText` (the main collaborative document of each
 *     standard)
 *   - `Document.bodyHtml`  (any uploaded .docx the leader flagged as
 *     "allow edits" — see DocumentUploadModal + import-body conversion)
 *
 * Every mutation takes an exclusive `standardId` OR `documentId` so the
 * same UI component drives both flows. Internally we look up the
 * working group via the corresponding parent, apply RBAC against it,
 * and route reads/writes to the right table.
 *
 * Lifecycle:
 *   create  → status=PENDING. Author is any WG member.
 *   react   → LIKE/DISLIKE per user. Toggles on/off.
 *   accept  → status=ACCEPTED, body updated. LEADER/DEPUTY/SECRETARY only.
 *   reject  → status=REJECTED. Leader only.
 *
 * Concurrency: applyAccept reads the current body, splits into blocks,
 * checks that the block at paragraphIndex still equals originalText.
 * If it drifted (some other suggestion was accepted in between), we
 * return a CONFLICT error so the leader can re-review.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { logActivity } from '@/server/audit';
import { notifySuggestionNew, notifySuggestionResolved } from '@/server/notify';
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

/**
 * Target schema: exactly one of standardId / documentId. Zod can't
 * express XOR cleanly, so we mark both optional and refine the union
 * downstream. Helpers below resolve a target to its workingGroupId.
 */
const targetInput = z
  .object({
    standardId: z.string().cuid().optional(),
    documentId: z.string().cuid().optional(),
  })
  .refine((d) => Boolean(d.standardId) !== Boolean(d.documentId), {
    message: 'Specify exactly one of standardId or documentId',
  });

type ResolvedTarget =
  | { kind: 'standard'; standardId: string; workingGroupId: string; body: string | null }
  | { kind: 'document'; documentId: string; workingGroupId: string; body: string | null };

async function resolveTarget(
  db: PrismaClient,
  input: { standardId?: string; documentId?: string },
): Promise<ResolvedTarget> {
  if (input.standardId) {
    const std = await db.standard.findUniqueOrThrow({
      where: { id: input.standardId },
      select: { workingGroupId: true, bodyText: true },
    });
    return {
      kind: 'standard',
      standardId: input.standardId,
      workingGroupId: std.workingGroupId,
      body: std.bodyText,
    };
  }
  // documentId path
  const doc = await db.document.findUniqueOrThrow({
    where: { id: input.documentId! },
    select: {
      bodyHtml: true,
      allowEdits: true,
      standard: { select: { workingGroupId: true } },
    },
  });
  if (!doc.allowEdits) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Цей документ не позначений як такий, що допускає правки.',
    });
  }
  return {
    kind: 'document',
    documentId: input.documentId!,
    workingGroupId: doc.standard.workingGroupId,
    body: doc.bodyHtml,
  };
}

export const suggestionRouter = createTRPCRouter({
  // ── list (everyone with read access to the parent's working group) ────
  list: protectedProcedure
    .input(
      targetInput.and(z.object({ status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).optional() })),
    )
    .query(async ({ ctx, input }) => {
      const target = await resolveTarget(ctx.db, input);
      const u = userCtx(ctx.session);
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';
      const isDirector = ctx.session.user.globalRole === 'DIRECTOR';
      const isMember = u.memberships.some((m) => m.workingGroupId === target.workingGroupId);
      if (!isAdmin && !isDirector && !isMember) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const where = {
        ...(target.kind === 'standard'
          ? { standardId: target.standardId }
          : { documentId: target.documentId }),
        ...(input.status ? { status: input.status } : {}),
      };

      return ctx.db.standardSuggestion.findMany({
        where,
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
      targetInput.and(
        z.object({
          paragraphIndex: z.number().int().min(0),
          originalText: z.string().max(20_000),
          proposedText: z.string().max(20_000),
          operation: z.enum(['REPLACE', 'INSERT_AFTER', 'DELETE']).default('REPLACE'),
          rationale: z.string().max(1000).optional(),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      const target = await resolveTarget(ctx.db, input);
      if (!can(userCtx(ctx.session), 'comment:add', target.workingGroupId)) {
        // Reusing comment:add: any member of the WG can suggest.
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const created = await ctx.db.standardSuggestion.create({
        data: {
          ...(target.kind === 'standard'
            ? { standardId: target.standardId }
            : { documentId: target.documentId }),
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
        note:
          target.kind === 'standard'
            ? 'Запропоновано правку до тексту стандарту'
            : 'Запропоновано правку до документа',
      });
      // Notify WG leadership for both standard and document targets.
      // notifySuggestionNew picks the right parent (Standard vs Document
      // → Standard) and links to the appropriate tab.
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
        select: {
          standard: { select: { workingGroupId: true } },
          document: { select: { standard: { select: { workingGroupId: true } } } },
        },
      });
      const workingGroupId = sug.standard?.workingGroupId ?? sug.document?.standard.workingGroupId;
      if (!workingGroupId) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Suggestion has no parent' });
      }
      if (!can(userCtx(ctx.session), 'comment:add', workingGroupId)) {
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
        include: {
          standard: { select: { id: true, workingGroupId: true, bodyText: true } },
          document: {
            select: {
              id: true,
              bodyHtml: true,
              standard: { select: { workingGroupId: true } },
            },
          },
        },
      });
      const workingGroupId = sug.standard?.workingGroupId ?? sug.document?.standard.workingGroupId;
      const currentBody = sug.standard?.bodyText ?? sug.document?.bodyHtml ?? null;
      if (!workingGroupId) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Suggestion has no parent' });
      }
      if (!can(userCtx(ctx.session), 'standard:editMeta', workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (sug.status !== 'PENDING') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Правку вже опрацьовано' });
      }

      // Re-read current paragraphs. Strict index match is fragile — the
      // user is mid-conversation accepting suggestions while others may
      // have already touched the body, so we re-anchor by content:
      //   1. Try the stored paragraphIndex; if its text still matches,
      //      use that.
      //   2. Otherwise scan all paragraphs for one whose plain text
      //      equals the suggestion's originalText snapshot — use that
      //      index.
      //   3. If still not found, fall back gracefully:
      //      - DELETE  → the block is already gone; mark resolved.
      //      - REPLACE / INSERT_AFTER → append the proposed text at the
      //        end so the leader's intent (adding/replacing content)
      //        isn't lost just because numbering shifted.
      const stripTags = (s: string) =>
        s
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim();

      const paras = splitParagraphs(currentBody);
      const originalPlain = stripTags(sug.originalText);
      const proposedPlain = stripTags(sug.proposedText);
      let appliedIndex = sug.paragraphIndex;
      const direct = paras[appliedIndex];
      if (direct === undefined || stripTags(direct) !== originalPlain) {
        const found = paras.findIndex((p) => stripTags(p) === originalPlain);
        appliedIndex = found;
      }

      // Detect "already applied" — if the proposed text is already
      // present in the body (any block), a previous accept of an
      // identical suggestion most likely did this work. Mark the row
      // resolved without re-applying (which would duplicate the
      // content at the end).
      const alreadyApplied =
        appliedIndex < 0 &&
        sug.operation !== 'DELETE' &&
        proposedPlain.length > 0 &&
        paras.some((p) => stripTags(p) === proposedPlain);

      // Apply the operation
      const nextParas = [...paras];
      if (alreadyApplied) {
        // No-op — proposed content is already in the document.
      } else if (appliedIndex < 0) {
        // Original block isn't in the document any more.
        if (sug.operation === 'DELETE') {
          // Already deleted by an earlier action — nothing to do.
        } else if (sug.operation === 'INSERT_AFTER') {
          // INSERT_AFTER's intent is "add this content". Anchor is
          // gone, content isn't here yet → append to end.
          nextParas.push(sug.proposedText);
        } else {
          // REPLACE without a target and the proposed isn't here yet
          // — that's a genuine conflict. Tell the leader to re-review
          // rather than guessing where to put the new text.
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              `Оригінальний текст параграфа №${sug.paragraphIndex + 1} вже не знайдено в документі (хтось його змінив). ` +
              `Перегляньте правку та створіть нову, якщо потрібно.`,
          });
        }
      } else if (sug.operation === 'REPLACE') {
        nextParas[appliedIndex] = sug.proposedText;
      } else if (sug.operation === 'DELETE') {
        nextParas.splice(appliedIndex, 1);
      } else if (sug.operation === 'INSERT_AFTER') {
        nextParas.splice(appliedIndex + 1, 0, sug.proposedText);
      }
      const nextBody = joinParagraphs(nextParas.filter((p) => p.trim().length > 0));

      await ctx.db.$transaction([
        sug.standardId
          ? ctx.db.standard.update({
              where: { id: sug.standardId },
              data: {
                bodyText: nextBody,
                bodyUpdatedAt: new Date(),
                bodyUpdatedById: ctx.session.user.id,
              },
            })
          : ctx.db.document.update({
              where: { id: sug.documentId! },
              data: {
                bodyHtml: nextBody,
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
        include: {
          standard: { select: { workingGroupId: true } },
          document: { select: { standard: { select: { workingGroupId: true } } } },
        },
      });
      const workingGroupId = sug.standard?.workingGroupId ?? sug.document?.standard.workingGroupId;
      if (!workingGroupId) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Suggestion has no parent' });
      }
      if (!can(userCtx(ctx.session), 'standard:editMeta', workingGroupId)) {
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
  updateBody: protectedProcedure
    .input(targetInput.and(z.object({ bodyText: z.string().max(200_000) })))
    .mutation(async ({ ctx, input }) => {
      const target = await resolveTarget(ctx.db, input);
      if (!can(userCtx(ctx.session), 'standard:editMeta', target.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const before = { bodyText: target.body ?? '' };
      if (target.kind === 'standard') {
        const updated = await ctx.db.standard.update({
          where: { id: target.standardId },
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
          entityId: target.standardId,
          before,
          after: { bodyText: updated.bodyText ?? '' },
          note: 'Оновлено текст документа',
        });
        return updated;
      }
      const updated = await ctx.db.document.update({
        where: { id: target.documentId },
        data: {
          bodyHtml: input.bodyText,
          bodyUpdatedAt: new Date(),
          bodyUpdatedById: ctx.session.user.id,
        },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Document',
        entityId: target.documentId,
        before,
        after: { bodyText: updated.bodyHtml ?? '' },
        note: 'Оновлено текст документа',
      });
      return updated;
    }),

  // ── replaceBody: import-style atomic body swap ────────────────────────
  // Same permission as updateBody, but also drops every existing
  // suggestion on this target in a single transaction. Use this when
  // the body is being completely replaced (e.g. .docx import) —
  // leftover suggestions would point at paragraph indices that no
  // longer exist and produce confusing CONFLICT errors when the leader
  // tries to resolve them.
  replaceBody: protectedProcedure
    .input(targetInput.and(z.object({ bodyText: z.string().max(200_000) })))
    .mutation(async ({ ctx, input }) => {
      const target = await resolveTarget(ctx.db, input);
      if (!can(userCtx(ctx.session), 'standard:editMeta', target.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const before = { bodyText: target.body ?? '' };

      if (target.kind === 'standard') {
        // Wipe both suggestions AND inline comments — every anchor
        // (paragraphIndex + char offsets) referenced the OLD body and
        // is meaningless after the import. Leaving comments behind
        // would silently point at the wrong text (or no text at all).
        const [deletedSugg, deletedComments, updated] = await ctx.db.$transaction([
          ctx.db.standardSuggestion.deleteMany({ where: { standardId: target.standardId } }),
          ctx.db.inlineComment.deleteMany({ where: { standardId: target.standardId } }),
          ctx.db.standard.update({
            where: { id: target.standardId },
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
          entityId: target.standardId,
          before,
          after: { bodyText: updated.bodyText ?? '' },
          note:
            `Замінено текст документа (імпорт). Видалено правок: ${deletedSugg.count}, ` +
            `inline-коментарів: ${deletedComments.count}.`,
        });
        return {
          ...updated,
          droppedSuggestionCount: deletedSugg.count,
          droppedInlineCommentCount: deletedComments.count,
        };
      }

      const [deletedSugg, deletedComments, updated] = await ctx.db.$transaction([
        ctx.db.standardSuggestion.deleteMany({ where: { documentId: target.documentId } }),
        ctx.db.inlineComment.deleteMany({ where: { documentId: target.documentId } }),
        ctx.db.document.update({
          where: { id: target.documentId },
          data: {
            bodyHtml: input.bodyText,
            bodyUpdatedAt: new Date(),
            bodyUpdatedById: ctx.session.user.id,
          },
        }),
      ]);
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Document',
        entityId: target.documentId,
        before,
        after: { bodyText: updated.bodyHtml ?? '' },
        note:
          `Замінено текст документа (імпорт). Видалено правок: ${deletedSugg.count}, ` +
          `inline-коментарів: ${deletedComments.count}.`,
      });
      return {
        ...updated,
        droppedSuggestionCount: deletedSugg.count,
        droppedInlineCommentCount: deletedComments.count,
      };
    }),
});
