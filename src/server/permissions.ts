/**
 * Centralized read-permission helpers.
 *
 * Per наказ №32 / зміни — secretaries can view all working groups
 * (including ones they're not directly a member of) so they can
 * coordinate work across the institute. ADMIN and DIRECTOR also see all.
 */

interface SessionUserLite {
  globalRole: string;
  memberships?: { workingGroupId: string; role: string }[];
}

export function seesAllWorkingGroups(user: SessionUserLite): boolean {
  if (user.globalRole === 'ADMIN' || user.globalRole === 'DIRECTOR') return true;
  return (user.memberships ?? []).some((m) => m.role === 'SECRETARY');
}

export function memberGroupIds(user: SessionUserLite): string[] {
  return (user.memberships ?? []).map((m) => m.workingGroupId);
}
