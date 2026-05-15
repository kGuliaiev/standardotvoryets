import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import bcrypt from 'bcryptjs';
import { addDays } from 'date-fns';

export const userRouter = createTRPCRouter({
  // ── me ──────────────────────────────────────────────────────────────
  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        globalRole: true,
        avatarUrl: true,
        createdAt: true,
        memberships: {
          select: {
            role: true,
            joinedAt: true,
            workingGroup: {
              select: { id: true, code: true, name: true, color: true },
            },
          },
        },
      },
    });
    return user;
  }),

  // ── updateProfile ────────────────────────────────────────────────────
  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(100).optional(),
        avatarUrl: z.string().url().optional().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: input,
        select: { id: true, name: true, avatarUrl: true },
      });
    }),

  // ── list (ADMIN / DIRECTOR) ──────────────────────────────────────────
  list: protectedProcedure.query(async ({ ctx }) => {
    const { globalRole, memberships } = ctx.session.user;
    const isAdmin = globalRole === 'ADMIN';
    const isDirector = globalRole === 'DIRECTOR';
    if (!isAdmin && !isDirector) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    // DIRECTOR only sees users in their WGs
    const memberGroupIds = memberships?.map((m) => m.workingGroupId) ?? [];
    return ctx.db.user.findMany({
      where: isAdmin
        ? undefined
        : {
            memberships: { some: { workingGroupId: { in: memberGroupIds } } },
          },
      select: {
        id: true,
        email: true,
        name: true,
        globalRole: true,
        avatarUrl: true,
        createdAt: true,
        memberships: {
          select: {
            role: true,
            workingGroup: { select: { id: true, code: true, color: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }),

  // ── invite ───────────────────────────────────────────────────────────
  invite: protectedProcedure
    .input(
      z.object({
        email: z.string().email(),
        workingGroupId: z.string().cuid(),
        role: z.enum(['LEADER', 'DEPUTY', 'SECRETARY', 'MEMBER', 'GUEST']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.session.user;

      if (
        !can(
          {
            globalRole: user.globalRole as GlobalRole,
            memberships: (user.memberships ?? []) as {
              workingGroupId: string;
              role: WorkingGroupRole;
            }[],
          },
          'wg:invite',
          input.workingGroupId,
        )
      ) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      // Check if user already exists in the group
      const existing = await ctx.db.user.findUnique({
        where: { email: input.email },
        select: {
          memberships: {
            where: { workingGroupId: input.workingGroupId },
          },
        },
      });

      if (existing?.memberships.length) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Цей користувач вже є членом робочої групи',
        });
      }

      const token = await ctx.db.inviteToken.create({
        data: {
          email: input.email,
          workingGroupId: input.workingGroupId,
          role: input.role,
          expiresAt: addDays(new Date(), 7),
        },
      });

      // TODO: Enqueue email job in TASK-006
      // await emailQueue.add('INVITE_EMAIL', { token: token.token, email: input.email });

      return { token: token.token };
    }),

  // ── acceptInvite ─────────────────────────────────────────────────────
  acceptInvite: protectedProcedure
    .input(
      z.object({
        token: z.string(),
        name: z.string().min(2).max(100).optional(),
        password: z.string().min(8).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const inviteToken = await ctx.db.inviteToken.findUnique({
        where: { token: input.token },
      });

      if (!inviteToken) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Запрошення не знайдено' });
      }
      if (inviteToken.usedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Запрошення вже використане' });
      }
      if (inviteToken.expiresAt < new Date()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Термін дії запрошення вичерпано' });
      }

      // Create or find user
      let userId = ctx.session.user.id;

      // If accepting with new credentials (new user)
      if (input.name && input.password) {
        const existingUser = await ctx.db.user.findUnique({
          where: { email: inviteToken.email },
        });

        if (!existingUser) {
          const passwordHash = await bcrypt.hash(input.password, 12);
          const newUser = await ctx.db.user.create({
            data: {
              email: inviteToken.email,
              name: input.name,
              passwordHash,
            },
          });
          userId = newUser.id;
        } else {
          userId = existingUser.id;
        }
      }

      // Create membership
      await ctx.db.workingGroupMember.upsert({
        where: {
          workingGroupId_userId: {
            workingGroupId: inviteToken.workingGroupId,
            userId,
          },
        },
        create: {
          workingGroupId: inviteToken.workingGroupId,
          userId,
          role: inviteToken.role,
        },
        update: { role: inviteToken.role },
      });

      // Mark token as used
      await ctx.db.inviteToken.update({
        where: { id: inviteToken.id },
        data: { usedAt: new Date() },
      });

      return { success: true };
    }),

  // ── changeGlobalRole (ADMIN only) ────────────────────────────────────
  changeGlobalRole: protectedProcedure
    .input(
      z.object({
        userId: z.string().cuid(),
        globalRole: z.enum(['ADMIN', 'DIRECTOR', 'USER']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.globalRole !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      return ctx.db.user.update({
        where: { id: input.userId },
        data: { globalRole: input.globalRole },
        select: { id: true, globalRole: true },
      });
    }),

  // ── setActive (ADMIN only) ───────────────────────────────────────────
  setActive: protectedProcedure
    .input(z.object({ userId: z.string().cuid(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.globalRole !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Не можна деактивувати себе' });
      }
      return ctx.db.user.update({
        where: { id: input.userId },
        data: { isActive: input.isActive },
      });
    }),
});
