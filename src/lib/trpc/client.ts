import { createTRPCReact } from '@trpc/react-query';
import { type inferRouterInputs, type inferRouterOutputs } from '@trpc/server';
import { type AppRouter } from '@/server/routers/_app';

export const trpc = createTRPCReact<AppRouter>();

/** Strongly-typed router outputs — use as RouterOutputs['suggestion']['list'][number]. */
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;
