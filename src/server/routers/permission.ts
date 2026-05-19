import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { WorkingGroupRole } from '@prisma/client';
import { createTRPCRouter, protectedProcedure } from '@/server/trpc';
import { logActivity } from '@/server/audit';
import { ALL_ACTIONS, ALL_WG_ROLES, ACTION_LABELS, defaultAllowed } from '@/lib/rbac';
import { refresh } from '@/lib/permissionsCache';

/**
 * Admin-facing router for the per-(role, action) permission matrix.
 *
 * `list` returns the full grid the admin UI renders: every role × every
 * action with the *effective* state (override if present, else the
 * hardcoded default). `update` upserts a single cell — or deletes the
 * row when the value matches the hardcoded default, to keep the table
 * sparse.
 *
 * After every write we kick the in-memory cache via `refresh()` so the
 * next `can()` call reads the new value without waiting for a redeploy
 * or a periodic poll.
 */

const wgRoleEnum = z.nativeEnum(WorkingGroupRole);

export const permissionRouter = createTRPCRouter({
  // Returns the full role × action matrix plus the metadata the UI
  // needs to render labels and grouping.
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.session.user.globalRole !== 'ADMIN') {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    const overrides = await ctx.db.rolePermission.findMany();
    const overrideMap = new Map<string, boolean>(
      overrides.map((o) => [`${o.role}:${o.action}`, o.allowed]),
    );

    const rows = ALL_ACTIONS.map((action) => {
      const meta = ACTION_LABELS[action] ?? { feature: 'Інше', label: action };
      const cells = ALL_WG_ROLES.map((role) => {
        const key = `${role}:${action}`;
        const override = overrideMap.get(key);
        const fallback = defaultAllowed(role, action);
        return {
          role,
          allowed: override ?? fallback,
          overridden: override !== undefined,
          defaultAllowed: fallback,
        };
      });
      return { action, feature: meta.feature, label: meta.label, cells };
    });

    return { roles: ALL_WG_ROLES, rows };
  }),

  // Upsert a single (role, action, allowed) cell. If the requested
  // value matches the hardcoded default we delete the row instead so
  // the override table stays minimal.
  update: protectedProcedure
    .input(
      z.object({
        role: wgRoleEnum,
        action: z.enum(ALL_ACTIONS as readonly [string, ...string[]]),
        allowed: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.user.globalRole !== 'ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const { role, action, allowed } = input;
      const fallback = defaultAllowed(role, action);

      if (allowed === fallback) {
        // Matches the hardcoded default — drop any override row.
        await ctx.db.rolePermission
          .delete({ where: { role_action: { role, action } } })
          .catch(() => undefined);
      } else {
        await ctx.db.rolePermission.upsert({
          where: { role_action: { role, action } },
          create: { role, action, allowed },
          update: { allowed },
        });
      }

      await refresh();

      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'RolePermission',
        entityId: `${role}:${action}`,
        before: { allowed: !allowed },
        after: { allowed, role, action },
      });

      return { ok: true };
    }),

  // Wipe all overrides — restores the hardcoded defaults.
  resetAll: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.session.user.globalRole !== 'ADMIN') {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    const deleted = await ctx.db.rolePermission.deleteMany();
    await refresh();
    await logActivity(ctx.db, {
      userId: ctx.session.user.id,
      action: 'DELETE',
      entity: 'RolePermission',
      entityId: 'ALL',
      before: { count: deleted.count },
      after: {},
    });
    return { ok: true, deleted: deleted.count };
  }),
});
