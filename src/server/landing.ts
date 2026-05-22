import { menuVisibleForRoles, MENU_ACTIONS, registerOverrideLookup } from '@/lib/rbac';
import { ensureLoaded, getOverride } from '@/lib/permissionsCache';

// The landing redirect (root page) can render before any tRPC bootstrap runs,
// so make sure the DB override lookup is wired up here too. Idempotent — tRPC
// registers the same function.
registerOverrideLookup(getOverride);

// Menu action → route, in the order they appear in the sidebar. The landing
// page is the first menu item the user is actually allowed to see.
const MENU_ROUTES: Record<string, string> = {
  'menu:dashboard': '/dashboard',
  'menu:working-groups': '/working-groups',
  'menu:standards': '/standards',
  'menu:meetings': '/meetings',
  'menu:protocols': '/protocols',
  'menu:tasks': '/tasks',
  'menu:discussions': '/discussions',
  'menu:reports': '/reports',
};

/**
 * First section the user may land on after login. If an admin hid «Дашборд»
 * (or any earlier item) for the user's role in /admin/permissions, we skip to
 * the next visible section instead of dumping them on a hidden page.
 */
export async function landingPathForUser(user: {
  globalRole: string;
  memberships?: { role: string }[];
}): Promise<string> {
  // Admin always sees the full menu.
  if (user.globalRole === 'ADMIN') return '/dashboard';

  await ensureLoaded();
  const roles = new Set<string>((user.memberships ?? []).map((m) => m.role));
  if (user.globalRole === 'DIRECTOR') roles.add('DIRECTOR');

  const visible = menuVisibleForRoles(Array.from(roles));
  for (const action of MENU_ACTIONS) {
    const route = MENU_ROUTES[action];
    if (route && visible[action]) return route;
  }
  // Everything hidden (shouldn't happen) — fall back to the dashboard.
  return '/dashboard';
}

/**
 * Per-role menu visibility, computed server-side so the layout can seed it as
 * the Sidebar's query initialData. Without this the client renders the full
 * menu first (query still loading → nothing hidden), then collapses once
 * `permission.menuForMe` resolves — a visible flicker. Mirrors that procedure.
 */
export async function menuVisForUser(user: {
  globalRole: string;
  memberships?: { role: string }[];
}): Promise<Record<string, boolean>> {
  if (user.globalRole === 'ADMIN') {
    const all: Record<string, boolean> = {};
    for (const a of MENU_ACTIONS) all[a] = true;
    return all;
  }
  await ensureLoaded();
  const roles = new Set<string>((user.memberships ?? []).map((m) => m.role));
  if (user.globalRole === 'DIRECTOR') roles.add('DIRECTOR');
  return menuVisibleForRoles(Array.from(roles));
}
