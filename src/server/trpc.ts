import { initTRPC, TRPCError } from '@trpc/server';
import { type NextRequest } from 'next/server';
import superjson from 'superjson';
import { ZodError } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth';
import { db } from '@/server/db';

// ─── Context ─────────────────────────────────────────────────────────────────

interface CreateContextOptions {
  req: NextRequest;
}

export const createTRPCContext = async (opts: CreateContextOptions) => {
  const session = await getServerSession(authOptions);

  return {
    db,
    session,
    req: opts.req,
  };
};

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;

// ─── tRPC init ───────────────────────────────────────────────────────────────

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

// ─── Middleware ───────────────────────────────────────────────────────────────

const enforceUserIsAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      session: { ...ctx.session, user: ctx.session.user },
    },
  });
});

// ─── Procedures ──────────────────────────────────────────────────────────────

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(enforceUserIsAuthed);
