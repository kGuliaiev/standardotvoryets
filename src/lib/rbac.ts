import type { WorkingGroupRole, GlobalRole } from '@prisma/client';

interface UserContext {
  globalRole: GlobalRole;
  memberships: { workingGroupId: string; role: WorkingGroupRole }[];
}

/**
 * Runtime-registered override lookup. The cache lives in
 * `src/lib/permissionsCache.ts` which imports `@/server/db` —
 * importing that file directly from rbac.ts would drag Prisma into
 * the client bundle and either crash on load or silently break
 * `can()` for everyone. Instead the server bootstrap calls
 * `registerOverrideLookup(getOverride)` once (see trpc.ts), and
 * client `can()` calls simply skip the override step.
 */
let overrideLookup: ((role: string, action: string) => boolean | undefined) | null = null;
export function registerOverrideLookup(
  fn: ((role: string, action: string) => boolean | undefined) | null,
): void {
  overrideLookup = fn;
}

export function getUserRoleInGroup(
  user: UserContext,
  workingGroupId: string,
): WorkingGroupRole | null {
  if (user.globalRole === 'ADMIN') return 'LEADER'; // ADMIN gets leader-level in all groups
  const membership = user.memberships.find((m) => m.workingGroupId === workingGroupId);
  if (!membership) return null;
  // DIRECTOR sees everything in WGs they belong to (treated as LEADER for read, actual role for writes)
  return membership.role;
}

/** Returns true if user can see the working group at all */
export function canAccessGroup(user: UserContext, workingGroupId: string): boolean {
  if (user.globalRole === 'ADMIN') return true;
  // Center director oversees the whole institute → sees every working group.
  if (user.globalRole === 'DIRECTOR') return true;
  return user.memberships.some((m) => m.workingGroupId === workingGroupId);
}

/** Effective allow for a (role, action): DB override wins over the
 *  hardcoded default. On the client `overrideLookup` is null so we just
 *  use the hardcoded matrix; the server has the authoritative check. */
function effectiveAllowed(role: string, action: string): boolean {
  const override = overrideLookup?.(role, action);
  if (override !== undefined) return override;
  return PERMISSIONS[action]?.includes(role) ?? false;
}

export function can(user: UserContext, action: string, workingGroupId: string): boolean {
  if (user.globalRole === 'ADMIN') return true;
  // Center director (DIRECTOR) oversees ALL working groups — their rights are
  // NOT gated by membership. They read everything, plus whatever the
  // "Керівництво центру" column grants in /admin/permissions, applied across
  // every WG. (If they're also a member of a WG, their member-role rights
  // still apply below.) This is checked before the membership gate so the
  // column actually takes effect in groups they don't belong to.
  if (user.globalRole === 'DIRECTOR') {
    if (READ_ACTIONS.includes(action)) return true;
    if (effectiveAllowed('DIRECTOR', action)) return true;
  }
  const role = getUserRoleInGroup(user, workingGroupId);
  if (!role) return false;
  return effectiveAllowed(role, action);
}

/** Menu modules gated by the role matrix. Toggling one off hides that
 *  item from the sidebar for the affected role(s). Kept as a separate
 *  list so the sidebar and the "menuForMe" query share one source.
 *  Declared before ALL_ACTIONS because ALL_ACTIONS spreads it. */
export const MENU_ACTIONS = [
  'menu:dashboard',
  'menu:working-groups',
  'menu:standards',
  'menu:meetings',
  'menu:protocols',
  'menu:tasks',
  'menu:discussions',
  'menu:reports',
  'menu:notifications',
] as const;

/** Stable list of all (role, action) pairs the admin UI exposes as
 *  toggles. Order here drives the UI's row order. */
export const ALL_ACTIONS: readonly string[] = [
  'standard:create',
  'standard:changeStatus',
  'standard:editMeta',
  'standard:editBody',
  'document:upload',
  'document:setCurrent',
  'document:delete',
  'comment:add',
  'vote:open',
  'vote:cast',
  'meeting:create',
  'meeting:cancel',
  'meeting:uploadMinutes',
  'meeting:generateAiDraft',
  'meeting:deleteProtocol',
  'task:create',
  'task:editAny',
  'wg:invite',
  'wg:removeMember',
  ...MENU_ACTIONS,
];

/** Friendly Ukrainian labels for the admin permissions UI. Keep in
 *  sync with ALL_ACTIONS — anything missing here falls back to the raw
 *  action key. */
export const ACTION_LABELS: Record<string, { feature: string; label: string }> = {
  'standard:create': { feature: 'Стандарти', label: 'Створити стандарт' },
  'standard:changeStatus': { feature: 'Стандарти', label: 'Змінити статус' },
  'standard:editMeta': { feature: 'Стандарти', label: 'Редагувати картку' },
  // Grouped under "Документи" — this governs editing the document/standard
  // *body text*, alongside the other document permissions.
  'standard:editBody': { feature: 'Документи', label: 'Редагувати текст документа' },
  'document:upload': { feature: 'Документи', label: 'Завантажити / редагувати' },
  'document:setCurrent': { feature: 'Документи', label: 'Позначити актуальним' },
  'document:delete': { feature: 'Документи', label: 'Видалити документ' },
  'comment:add': { feature: 'Обговорення', label: 'Додати коментар' },
  'vote:open': { feature: 'Голосування', label: 'Відкрити голосування' },
  'vote:cast': { feature: 'Голосування', label: 'Проголосувати' },
  'meeting:create': { feature: 'Засідання', label: 'Створити засідання' },
  'meeting:cancel': { feature: 'Засідання', label: 'Скасувати' },
  'meeting:uploadMinutes': { feature: 'Засідання', label: 'Завантажити протокол' },
  'meeting:generateAiDraft': { feature: 'Засідання', label: 'Згенерувати протокол (ШІ)' },
  'meeting:deleteProtocol': { feature: 'Засідання', label: 'Видалити протокол' },
  'task:create': { feature: 'Доручення', label: 'Створити доручення' },
  'task:editAny': { feature: 'Доручення', label: 'Редагувати чужі' },
  'wg:invite': { feature: 'Робоча група', label: 'Запросити учасника' },
  'wg:removeMember': { feature: 'Робоча група', label: 'Видалити учасника' },
  'menu:dashboard': { feature: 'Меню', label: 'Дашборд' },
  'menu:working-groups': { feature: 'Меню', label: 'Робочі групи' },
  'menu:standards': { feature: 'Меню', label: 'Стандарти' },
  'menu:meetings': { feature: 'Меню', label: 'Засідання' },
  'menu:protocols': { feature: 'Меню', label: 'Протоколи' },
  'menu:tasks': { feature: 'Меню', label: 'Завдання' },
  'menu:discussions': { feature: 'Меню', label: 'Обговорення' },
  'menu:reports': { feature: 'Меню', label: 'Звіт' },
  'menu:notifications': { feature: 'Меню', label: 'Сповіщення' },
};

/** All assignable WG roles in the order the admin UI should show
 *  them. Kept here (not derived from Prisma) so we can pin the
 *  column order. */
export const ALL_WG_ROLES: readonly WorkingGroupRole[] = [
  'LEADER',
  'DEPUTY',
  'SECRETARY',
  'MEMBER',
];

/** Columns the admin permissions matrix shows: the WG roles plus the
 *  global center-director ("Керівництво центру") pseudo-role. Order
 *  here pins the column order. */
export const ALL_MATRIX_ROLES: readonly string[] = [...ALL_WG_ROLES, 'DIRECTOR'];

/** Hardcoded default — used by the admin UI to show the "fallback"
 *  state when no override exists. Accepts a plain string so it works
 *  for the DIRECTOR column too. */
export function defaultAllowed(role: string, action: string): boolean {
  return PERMISSIONS[action]?.includes(role) ?? false;
}

/** Which menu modules a set of roles may see, applying DB overrides.
 *  An item is visible if allowed for at least one of the roles; an
 *  empty role set (e.g. a user with no memberships) sees everything so
 *  the gate only ever *narrows* an explicitly-restricted menu.
 *  Server-only in effect: relies on the registered override lookup. */
export function menuVisibleForRoles(roles: readonly string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const action of MENU_ACTIONS) {
    out[action] = roles.length === 0 ? true : roles.some((r) => effectiveAllowed(r, action));
  }
  return out;
}

const READ_ACTIONS = [
  'standard:view',
  'document:view',
  'comment:view',
  'vote:view',
  'meeting:view',
  'task:view',
  'wg:view',
];

const LEADERS = ['LEADER', 'DEPUTY'] as const;
const STAFF = ['LEADER', 'DEPUTY', 'SECRETARY'] as const;
const VOTERS = ['LEADER', 'DEPUTY', 'MEMBER'] as const;
const ALL_MEMBERS = ['LEADER', 'DEPUTY', 'SECRETARY', 'MEMBER'] as const;
// Menu items default to visible for every role, including the center
// director — the gate only hides what an admin explicitly turns off.
const ALL_ROLES_INCL_DIRECTOR = ['LEADER', 'DEPUTY', 'SECRETARY', 'MEMBER', 'DIRECTOR'] as const;

export const PERMISSIONS: Record<string, readonly string[]> = {
  'standard:create': LEADERS,
  'standard:changeStatus': LEADERS,
  'standard:editMeta': STAFF,
  // Direct (no-approval) WYSIWYG editing of the document body. Default to
  // the same trio as editMeta; adjustable in /admin/permissions.
  'standard:editBody': STAFF,
  'standard:delete': [], // ADMIN only via globalRole check
  'document:upload': STAFF,
  'document:setCurrent': LEADERS,
  // Secretary keeps the document filing tidy day-to-day, so they're
  // trusted to remove stale uploads alongside the leadership pair.
  'document:delete': STAFF,
  'comment:add': ALL_MEMBERS,
  'vote:open': LEADERS,
  'vote:cast': VOTERS,
  'meeting:create': STAFF,
  'meeting:cancel': LEADERS,
  'meeting:uploadMinutes': STAFF,
  // ШІ-чернетка протоколу — за замовчуванням секретар + керівництво (як і
  // завантаження протоколу). Регулюється в /admin/permissions.
  'meeting:generateAiDraft': STAFF,
  // Destructive — default to the WG leader only; admins always; adjustable
  // in /admin/permissions.
  'meeting:deleteProtocol': ['LEADER'],
  'task:create': ALL_MEMBERS,
  'task:editAny': STAFF,
  'wg:invite': LEADERS,
  'wg:removeMember': ['LEADER'],
  'menu:dashboard': ALL_ROLES_INCL_DIRECTOR,
  'menu:working-groups': ALL_ROLES_INCL_DIRECTOR,
  'menu:standards': ALL_ROLES_INCL_DIRECTOR,
  'menu:meetings': ALL_ROLES_INCL_DIRECTOR,
  'menu:protocols': ALL_ROLES_INCL_DIRECTOR,
  'menu:tasks': ALL_ROLES_INCL_DIRECTOR,
  'menu:discussions': ALL_ROLES_INCL_DIRECTOR,
  'menu:reports': ALL_ROLES_INCL_DIRECTOR,
  'menu:notifications': ALL_ROLES_INCL_DIRECTOR,
};
