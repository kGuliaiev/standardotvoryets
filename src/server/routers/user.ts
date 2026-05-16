import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { can } from '@/lib/rbac';
import { logActivity } from '@/server/audit';
import { sendEmail, templateInvite } from '@/server/email';
import { env } from '@/lib/env';
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
        phone: true,
        rank: true,
        position: true,
        organization: true,
        globalRole: true,
        avatarUrl: true,
        notifyEmail: true,
        notifyInApp: true,
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
        email: z.string().email().optional(),
        phone: z.string().max(40).optional().nullable(),
        avatarUrl: z.string().url().optional().nullable(),
        notifyEmail: z.boolean().optional(),
        notifyInApp: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // If email is changing, ensure it's not already taken
      if (input.email) {
        const taken = await ctx.db.user.findFirst({
          where: { email: input.email, NOT: { id: ctx.session.user.id } },
          select: { id: true },
        });
        if (taken) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Цей email вже використовується' });
        }
      }
      const before = await ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: {
          name: true,
          email: true,
          phone: true,
          avatarUrl: true,
          notifyEmail: true,
          notifyInApp: true,
        },
      });
      const updated = await ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: input,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          avatarUrl: true,
          notifyEmail: true,
          notifyInApp: true,
        },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'User',
        entityId: ctx.session.user.id,
        before,
        after: updated,
        note: 'Оновлено профіль',
      });
      return updated;
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
        isActive: true,
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

      // Send invite email (no-op if RESEND_API_KEY unset)
      const wg = await ctx.db.workingGroup.findUniqueOrThrow({
        where: { id: input.workingGroupId },
        select: { name: true },
      });
      const inviter = await ctx.db.user.findUniqueOrThrow({
        where: { id: ctx.session.user.id },
        select: { name: true },
      });
      const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/invite/${token.token}`;
      const emailResult = await sendEmail({
        to: input.email,
        subject: `Запрошення до робочої групи "${wg.name}"`,
        html: templateInvite({
          inviteUrl,
          workingGroupName: wg.name,
          inviterName: inviter.name,
        }),
      });

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'CREATE',
        entity: 'Invite',
        entityId: token.id,
        after: {
          email: input.email,
          workingGroupId: input.workingGroupId,
          role: input.role,
        },
        note: `Запрошено ${input.email} як ${input.role} до ${wg.name}`,
      });

      return { token: token.token, inviteUrl, emailSent: emailResult.sent };
    }),

  // ── getInvite (public read — for /invite/[token] page) ───────────────
  getInvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ ctx, input }) => {
      const t = await ctx.db.inviteToken.findUnique({
        where: { token: input.token },
        include: {
          workingGroup: { select: { id: true, code: true, name: true, color: true } },
        },
      });
      if (!t) return null;
      return {
        email: t.email,
        role: t.role,
        workingGroup: t.workingGroup,
        expiresAt: t.expiresAt,
        used: !!t.usedAt,
      };
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

      await logActivity(ctx.db, {
        userId,
        action: 'UPDATE',
        entity: 'Invite',
        entityId: inviteToken.id,
        after: { usedAt: new Date(), workingGroupId: inviteToken.workingGroupId },
        note: `Запрошення прийнято; додано до групи ${inviteToken.workingGroupId} як ${inviteToken.role}`,
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
      const before = await ctx.db.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { globalRole: true },
      });
      const updated = await ctx.db.user.update({
        where: { id: input.userId },
        data: { globalRole: input.globalRole },
        select: { id: true, globalRole: true },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'User',
        entityId: input.userId,
        before: { globalRole: before.globalRole },
        after: { globalRole: input.globalRole },
      });
      return updated;
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
      const updated = await ctx.db.user.update({
        where: { id: input.userId },
        data: { isActive: input.isActive },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: input.isActive ? 'RESTORE' : 'ARCHIVE',
        entity: 'User',
        entityId: input.userId,
        before: { isActive: !input.isActive },
        after: { isActive: input.isActive },
        note: input.isActive ? 'Активовано' : 'Деактивовано',
      });
      return updated;
    }),
});
