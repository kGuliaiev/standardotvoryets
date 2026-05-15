import type { WorkingGroupRole, GlobalRole } from '@prisma/client';

type UserContext = {
  globalRole: GlobalRole;
  memberships: Array<{ workingGroupId: string; role: WorkingGroupRole }>;
};

export function getUserRoleInGroup(
  user: UserContext,
  workingGroupId: string,
): WorkingGroupRole | null {
  if (user.globalRole === 'ADMIN') return 'LEADER'; // ADMIN gets leader-level in all groups
  return user.memberships.find((m) => m.workingGroupId === workingGroupId)?.role ?? null;
}

export function can(user: UserContext, action: string, workingGroupId: string): boolean {
  const role = getUserRoleInGroup(user, workingGroupId);
  if (!role) return false;
  return (PERMISSIONS[action]?.includes(role) ?? false) || user.globalRole === 'ADMIN';
}

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
