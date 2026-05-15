import type { WorkingGroupRole, GlobalRole } from '@prisma/client';

type UserContext = {
  globalRole: GlobalRole;
  memberships: { workingGroupId: string; role: WorkingGroupRole }[];
};

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
  'document:delete': LEADERS,
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
