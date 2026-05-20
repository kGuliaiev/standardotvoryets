import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, publicProcedure, protectedProcedure } from '@/server/trpc';
import { logActivity } from '@/server/audit';
import {
  createChallenge,
  consumeChallenge,
  verifySignature,
  identityKeys,
  isKepConfigured,
} from '@/server/kep';

/**
 * КЕП router — challenge issuance + profile binding. The actual login
 * verification lives in the NextAuth `kep` provider (it must run inside
 * the auth flow), but it reuses the same `@/server/kep` helpers.
 */
export const kepRouter = createTRPCRouter({
  // Is the КЕП feature configured on this deployment at all?
  isEnabled: publicProcedure.query(() => ({ enabled: isKepConfigured() })),

  // Pre-login nonce — public, because the user isn't authenticated yet.
  loginChallenge: publicProcedure.mutation(async () => {
    const nonce = await createChallenge('login');
    return { nonce };
  }),

  // Nonce for binding a key to the *current* user.
  bindChallenge: protectedProcedure.mutation(async ({ ctx }) => {
    const nonce = await createChallenge('bind', ctx.session.user.id);
    return { nonce };
  }),

  // Current binding state for the profile screen (no raw РНОКПП exposed).
  status: protectedProcedure.query(async ({ ctx }) => {
    const u = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { kepKeyId: true, kepBoundAt: true },
    });
    return {
      bound: Boolean(u?.kepBoundAt),
      boundAt: u?.kepBoundAt ?? null,
      keyIdLast4: u?.kepKeyId ? u.kepKeyId.slice(-4) : null,
    };
  }),

  // Bind the signed key to the current user.
  bind: protectedProcedure
    .input(z.object({ nonce: z.string().min(1), container: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const ch = await consumeChallenge(input.nonce, 'bind');
      if (ch.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Запит підпису належить іншому користувачу',
        });
      }

      let signer;
      try {
        signer = await verifySignature({
          containerBase64: input.container,
          expectedData: input.nonce,
        });
      } catch (e) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: e instanceof Error ? e.message : 'Не вдалося перевірити підпис',
        });
      }

      const { rnokppHash, keyId } = identityKeys(signer);
      // Reject if this identity already belongs to a different account.
      const clash = await ctx.db.user.findFirst({
        where: {
          id: { not: ctx.session.user.id },
          OR: [...(rnokppHash ? [{ kepRnokppHash: rnokppHash }] : []), { kepKeyId: keyId }],
        },
        select: { id: true },
      });
      if (clash) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Цей КЕП вже прив’язано до іншого облікового запису',
        });
      }

      await ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { kepRnokppHash: rnokppHash, kepKeyId: keyId, kepBoundAt: new Date() },
      });
      await logActivity(ctx.db, {
        userId: ctx.session.user.id,
        action: 'UPDATE',
        entity: 'User',
        entityId: ctx.session.user.id,
        after: { kep: 'bound' },
      });
      return { ok: true };
    }),

  // Remove the binding from the current user.
  unbind: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.user.update({
      where: { id: ctx.session.user.id },
      data: { kepRnokppHash: null, kepKeyId: null, kepBoundAt: null },
    });
    await logActivity(ctx.db, {
      userId: ctx.session.user.id,
      action: 'UPDATE',
      entity: 'User',
      entityId: ctx.session.user.id,
      after: { kep: 'unbound' },
    });
    return { ok: true };
  }),
});
