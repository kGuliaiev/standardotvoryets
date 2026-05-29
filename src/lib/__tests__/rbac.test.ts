import { describe, it, expect } from 'vitest';
import { canAccessGroup, getUserRoleInGroup, can } from '@/lib/rbac';

const WG_A = 'wg-a';
const WG_B = 'wg-b';

const admin = {
  globalRole: 'ADMIN' as const,
  memberships: [],
};
const director = {
  globalRole: 'DIRECTOR' as const,
  memberships: [],
};
const leaderA = {
  globalRole: 'USER' as const,
  memberships: [{ workingGroupId: WG_A, role: 'LEADER' as const }],
};
const memberA = {
  globalRole: 'USER' as const,
  memberships: [{ workingGroupId: WG_A, role: 'MEMBER' as const }],
};
const outsider = {
  globalRole: 'USER' as const,
  memberships: [],
};

describe('canAccessGroup', () => {
  it('ADMIN sees every WG', () => {
    expect(canAccessGroup(admin, WG_A)).toBe(true);
    expect(canAccessGroup(admin, WG_B)).toBe(true);
  });
  it('DIRECTOR sees every WG (centre-wide oversight)', () => {
    expect(canAccessGroup(director, WG_A)).toBe(true);
    expect(canAccessGroup(director, WG_B)).toBe(true);
  });
  it('USER only sees groups they belong to', () => {
    expect(canAccessGroup(leaderA, WG_A)).toBe(true);
    expect(canAccessGroup(leaderA, WG_B)).toBe(false);
    expect(canAccessGroup(outsider, WG_A)).toBe(false);
  });
});

describe('getUserRoleInGroup', () => {
  it('ADMIN gets LEADER-level in every group', () => {
    expect(getUserRoleInGroup(admin, WG_B)).toBe('LEADER');
  });
  it('returns null when user has no membership', () => {
    expect(getUserRoleInGroup(outsider, WG_A)).toBe(null);
  });
  it('returns the literal membership role for plain USERs', () => {
    expect(getUserRoleInGroup(leaderA, WG_A)).toBe('LEADER');
    expect(getUserRoleInGroup(memberA, WG_A)).toBe('MEMBER');
    expect(getUserRoleInGroup(leaderA, WG_B)).toBe(null);
  });
});

describe('can() short-circuits', () => {
  it('ADMIN can do anything', () => {
    expect(can(admin, 'standard:delete', WG_A)).toBe(true);
    expect(can(admin, 'menu:reports', WG_B)).toBe(true);
    expect(can(admin, 'totally-made-up-action', 'wg-x')).toBe(true);
  });
  it('outsider USER cannot act on a WG they do not belong to', () => {
    expect(can(outsider, 'standard:create', WG_A)).toBe(false);
  });
});
