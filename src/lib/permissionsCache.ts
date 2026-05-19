/**
 * In-memory cache of (role, action) overrides loaded from the
 * `RolePermission` table. Lets `can()` stay synchronous (it's called
 * from every protected procedure) while still picking up admin-edits
 * without a redeploy.
 *
 * Lifecycle:
 *   - Loaded lazily on the first call to `ensureLoaded()` (typically
 *     hit by the tRPC middleware before any `can()` check).
 *   - `refresh()` is called after `permission.update` mutations to
 *     pull the new row into the cache. In a single-instance
 *     deployment this is enough; multi-instance setups would need
 *     LISTEN/NOTIFY or a short TTL, which we don't need yet.
 *
 * The cache holds `Map<"ROLE:action", allowed>`. Absent key → use the
 * hardcoded default from PERMISSIONS in rbac.ts.
 */

// Server-only: imports `@/server/db` (Prisma). Don't import this file
// from client components. rbac.ts deliberately depends on a
// runtime-registered lookup instead of importing this directly so
// the client bundle stays Prisma-free.
import { db } from '@/server/db';

let cache: Map<string, boolean> | null = null;
let loading: Promise<void> | null = null;

function key(role: string, action: string): string {
  return `${role}:${action}`;
}

async function load(): Promise<void> {
  try {
    const rows = await db.rolePermission.findMany();
    cache = new Map(rows.map((r) => [key(r.role, r.action), r.allowed]));
  } catch (err) {
    // If the table doesn't exist yet (schema not pushed), treat as
    // empty overrides so the hardcoded defaults still apply.
    console.warn('[permissionsCache] failed to load — using hardcoded defaults:', err);
    cache = new Map();
  }
}

/** Ensure the cache is populated. Idempotent; concurrent callers
 *  share the same load promise. */
export function ensureLoaded(): Promise<void> {
  if (cache) return Promise.resolve();
  if (loading) return loading;
  loading = load().finally(() => {
    loading = null;
  });
  return loading;
}

/** Synchronous override lookup. Returns undefined when no row
 *  exists — callers should fall back to the hardcoded default.
 *  Signature accepts `string` so it slots into `registerOverrideLookup`
 *  in rbac.ts without dragging the Prisma enum into the client. */
export function getOverride(role: string, action: string): boolean | undefined {
  return cache?.get(key(role, action));
}

/** Reload the cache from the database. Called after admin edits. */
export function refresh(): Promise<void> {
  cache = null;
  return ensureLoaded();
}

/** Read-through helper for the admin UI — returns the current effective
 *  state of every (role, action) pair: override if present, else null. */
export async function listOverrides(): Promise<Map<string, boolean>> {
  await ensureLoaded();
  return new Map(cache);
}
