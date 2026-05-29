import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { logActivity } from '@/server/audit';
import { seesAllWorkingGroups } from '@/server/permissions';
import {
  notifyMentioned,
  parseMentions,
  notifyCommentNew,
  notifyCommentReply,
} from '@/server/notify';
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

export const commentRouter = createTRPCRouter({
  // ── list (flat for a standard, then build tree on client) ──────────────
  list: protectedProcedure
    .input(z.object({ standardId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUniqueOrThrow({
        where: { id: input.standardId },
        select: { workingGroupId: true },
      });
      // View access matches the standard's other tabs: admins / center
      // director / secretaries see all groups; others need membership.
      const isMember = ctx.session.user.memberships?.some(
        (m) => m.workingGroupId === standard.workingGroupId,
      );
      if (!seesAllWorkingGroups(ctx.session.user) && !isMember) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return ctx.db.comment.findMany({
        where: { standardId: input.standardId },
        include: {
          author: { select: { id: true, name: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
    }),

  // ── create ─────────────────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        standardId: z.string().cuid(),
        body: z.string().min(1).max(5000),
        parentId: z.string().cuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const standard = await ctx.db.standard.findUniqueOrThrow({
        where: { id: input.standardId },
        select: { workingGroupId: true },
      });
      if (!can(userCtx(ctx.session), 'comment:add', standard.workingGroupId)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      // Validate parent belongs to same standard
      if (input.parentId) {
        const parent = await ctx.db.comment.findUnique({
          where: { id: input.parentId },
          select: { standardId: true, parentId: true },
        });
        if (parent?.standardId !== input.standardId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Невірний батьківський коментар' });
        }
        // Limit to 2 levels (root → reply); replies cannot have replies
        if (parent.parentId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Дозволено лише два рівні вкладеності',
          });
        }
      }

      const created = await ctx.db.comment.create({
        data: {
          standardId: input.standardId,
          authorId: ctx.session.user.id,
          body: input.body.trim(),
          parentId: input.parentId,
        },
        include: { author: { select: { id: true, name: true, avatarUrl: true } } },
      });

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'Standard',
        entityId: input.standardId,
        note: input.parentId
          ? `Додано відповідь на коментар`
          : `Додано коментар: "${input.body.slice(0, 80)}${input.body.length > 80 ? '…' : ''}"`,
      });

      const mentionedIds = parseMentions(created.body);
      if (mentionedIds.length > 0) {
        await notifyMentioned(ctx.db, created.id, mentionedIds, ctx.session.user.id);
      }
      // Notify the rest of the thread/standard about the new comment so it
      // surfaces in the in-app popup (~30s polling) and in /notifications.
      if (input.parentId) {
        await notifyCommentReply(ctx.db, created.id, ctx.session.user.id);
      } else {
        await notifyCommentNew(ctx.db, created.id, ctx.session.user.id);
      }

      return created;
    }),

  // ── update (own only) ──────────────────────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().cuid(),
        body: z.string().min(1).max(5000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const comment = await ctx.db.comment.findUniqueOrThrow({
        where: { id: input.id },
      });
      if (comment.authorId !== ctx.session.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const updated = await ctx.db.comment.update({
        where: { id: input.id },
        data: { body: input.body.trim() },
        include: { author: { select: { id: true, name: true, avatarUrl: true } } },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'Comment',
        entityId: input.id,
        before: { body: comment.body },
        after: { body: input.body.trim() },
      });
      return updated;
    }),

  // ── delete (own or LEADER of WG) ───────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const comment = await ctx.db.comment.findUniqueOrThrow({
        where: { id: input.id },
        include: { standard: { select: { workingGroupId: true } } },
      });
      const isAuthor = comment.authorId === ctx.session.user.id;
      const isAdmin = ctx.session.user.globalRole === 'ADMIN';
      const uctx = userCtx(ctx.session);
      const isLeader =
        uctx.memberships.find((m) => m.workingGroupId === comment.standard.workingGroupId)?.role ===
        'LEADER';
      if (!isAuthor && !isAdmin && !isLeader) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      // Cascade: delete replies first
      await ctx.db.comment.deleteMany({ where: { parentId: input.id } });
      const deleted = await ctx.db.comment.delete({ where: { id: input.id } });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'DELETE',
        entity: 'Comment',
        entityId: input.id,
        before: comment,
        note: 'Видалено коментар',
      });
      return deleted;
    }),

  // ── feedForUser: global comment feed across all WGs the user can access ─
  feedForUser: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(80) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 80;
      const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];
      const seesAll = seesAllWorkingGroups(ctx.session.user);

      return ctx.db.comment.findMany({
        where: seesAll ? {} : { standard: { workingGroupId: { in: memberGroupIds } } },
        include: {
          author: { select: { id: true, name: true, avatarUrl: true, rank: true } },
          // The comment this one replies to (if any) — shown as a quoted
          // context line in the feed.
          parent: {
            select: {
              body: true,
              createdAt: true,
              author: { select: { name: true } },
            },
          },
          standard: {
            select: {
              id: true,
              code: true,
              title: true,
              workingGroup: { select: { id: true, code: true, name: true, color: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }),

  // ── unreadCountForUser: count of comments newer than given timestamp ──
  unreadCountForUser: protectedProcedure
    .input(z.object({ since: z.date().nullable().optional() }).optional())
    .query(async ({ ctx, input }) => {
      // Before the first /discussions visit there's no reference point, so
      // fall back to a recent window (last 30 days). Returning 0 here meant
      // the sidebar badge never lit up for anyone who hadn't opened the page.
      const since = input?.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const memberGroupIds = ctx.session.user.memberships?.map((m) => m.workingGroupId) ?? [];
      const seesAll = seesAllWorkingGroups(ctx.session.user);
      const count = await ctx.db.comment.count({
        where: {
          createdAt: { gt: since },
          authorId: { not: ctx.session.user.id }, // own comments don't count as unread
          ...(seesAll ? {} : { standard: { workingGroupId: { in: memberGroupIds } } }),
        },
      });
      return { count };
    }),
});
