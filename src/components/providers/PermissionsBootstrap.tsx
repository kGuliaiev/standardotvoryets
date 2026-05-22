'use client';

import { useMemo } from 'react';
import { trpc } from '@/lib/trpc/client';
import { registerOverrideLookup } from '@/lib/rbac';

/**
 * Wires the DB permission overrides into the CLIENT-side `can()`.
 *
 * `can()` reads (role, action) overrides through a registered lookup. The
 * server registers it (see trpc.ts), but on the client it's null by default,
 * so client-side gating falls back to the hardcoded PERMISSIONS defaults and
 * misses admin-configured grants — e.g. the «Керівництво центру» (DIRECTOR)
 * column that lets a center director manage protocols. This component fetches
 * the current user's overrides and registers a lookup so client `can()` is
 * override-aware.
 *
 * `initialOverrides` is computed server-side in the layout and seeded as the
 * query's initial data, so the lookup is correct on the very first render
 * (no flash of missing controls). Renders nothing.
 */
export function PermissionsBootstrap({
  initialOverrides,
}: {
  initialOverrides: Record<string, boolean>;
}) {
  const { data } = trpc.permission.myOverrides.useQuery(undefined, {
    initialData: initialOverrides,
    staleTime: 60_000,
  });

  // Register synchronously during render so components rendered after this one
  // (Sidebar, page content) see overrides on their first `can()` call.
  useMemo(() => {
    registerOverrideLookup((role, action) => data?.[`${role}:${action}`]);
  }, [data]);

  return null;
}
