import type { WorkingGroupRole, GlobalRole } from '@prisma/client';
import { getOverride } from '@/lib/permissionsCache';

interface UserContext {
  globalRole: GlobalRole;
  memberships: { workingGroupId: string; role: WorkingGroupRole }[];
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
  return user.memberships.some((m) => m.workingGroupId === workingGroupId);
}

export function can(user: UserContext, action: string, workingGroupId: string): boolean {
  if (user.globalRole === 'ADMIN') return true;
  const role = getUserRoleInGroup(user, workingGroupId);
  if (!role) return false;
  // DIRECTOR has full read access but follows normal role-based write permissions
  if (user.globalRole === 'DIRECTOR' && READ_ACTIONS.includes(action)) return true;
  // DB override wins over the hardcoded default — lets admins flip a
  // toggle in the UI without a redeploy.
  const override = getOverride(role, action);
  if (override !== undefined) return override;
  return PERMISSIONS[action]?.includes(role) ?? false;
}

/** Stable list of all (role, action) pairs the admin UI exposes as
 *  toggles. Order here drives the UI's row order. */
export const ALL_ACTIONS: readonly string[] = [
  'standard:create',
  'standard:changeStatus',
  'standard:editMeta',
  'document:upload',
  'document:setCurrent',
  'document:delete',
  'comment:add',
  'vote:open',
  'vote:cast',
  'meeting:create',
  'meeting:cancel',
  'meeting:uploadMinutes',
  'task:create',
  'task:editAny',
  'wg:invite',
  'wg:removeMember',
];

/** Friendly Ukrainian labels for the admin permissions UI. Keep in
 *  sync with ALL_ACTIONS — anything missing here falls back to the raw
 *  action key. */
export const ACTION_LABELS: Record<string, { feature: string; label: string }> = {
  'standard:create': { feature: 'Стандарти', label: 'Створити стандарт' },
  'standard:changeStatus': { feature: 'Стандарти', label: 'Змінити статус' },
  'standard:editMeta': { feature: 'Стандарти', label: 'Редагувати картку' },
  'document:upload': { feature: 'Документи', label: 'Завантажити / редагувати' },
  'document:setCurrent': { feature: 'Документи', label: 'Позначити актуальним' },
  'document:delete': { feature: 'Документи', label: 'Видалити документ' },
  'comment:add': { feature: 'Обговорення', label: 'Додати коментар' },
  'vote:open': { feature: 'Голосування', label: 'Відкрити голосування' },
  'vote:cast': { feature: 'Голосування', label: 'Проголосувати' },
  'meeting:create': { feature: 'Засідання', label: 'Створити засідання' },
  'meeting:cancel': { feature: 'Засідання', label: 'Скасувати' },
  'meeting:uploadMinutes': { feature: 'Засідання', label: 'Завантажити протокол' },
  'task:create': { feature: 'Доручення', label: 'Створити доручення' },
  'task:editAny': { feature: 'Доручення', label: 'Редагувати чужі' },
  'wg:invite': { feature: 'Робоча група', label: 'Запросити учасника' },
  'wg:removeMember': { feature: 'Робоча група', label: 'Видалити учасника' },
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

/** Hardcoded default — used by the admin UI to show the "fallback"
 *  state when no override exists. */
export function defaultAllowed(role: WorkingGroupRole, action: string): boolean {
  return PERMISSIONS[action]?.includes(role) ?? false;
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

export const PERMISSIONS: Record<string, readonly WorkingGroupRole[]> = {
  'standard:create': LEADERS,
  'standard:changeStatus': LEADERS,
  'standard:editMeta': STAFF,
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
  'task:create': ALL_MEMBERS,
  'task:editAny': STAFF,
  'wg:invite': LEADERS,
  'wg:removeMember': ['LEADER'],
};
