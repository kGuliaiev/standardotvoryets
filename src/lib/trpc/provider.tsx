'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink, loggerLink } from '@trpc/client';
import { useState } from 'react';
import superjson from 'superjson';
import { trpc } from './client';

function getBaseUrl() {
  if (typeof window !== 'undefined') return '';
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.RAILWAY_STATIC_URL) return `https://${process.env.RAILWAY_STATIC_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: (failureCount, error) => {
              // Don't retry on auth errors
              if (
                error instanceof Error &&
                (error.message.includes('UNAUTHORIZED') ||
                  error.message.includes('FORBIDDEN'))
              ) {
                return false;
              }
              return failureCount < 3;
            },
          },
        },
      }),
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        loggerLink({
          enabled: (opts) =>
            process.env.NODE_ENV === 'development' ||
            (opts.direction === 'down' && opts.result instanceof Error),
        }),
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
          headers() {
            return {
              'x-trpc-source': 'nextjs-react',
            };
          },
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
