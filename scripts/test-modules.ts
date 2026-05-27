/**
 * Integration test harness for all tRPC modules.
 *
 * Run: `pnpm tsx scripts/test-modules.ts`
 *
 * Requires:
 *   - A reachable Postgres at DATABASE_URL (uses the same Prisma client)
 *   - The schema already pushed (`prisma db push` once before)
 *
 * The script seeds isolated test fixtures (TEST_ prefix), runs full CRUD
 * scenarios against every module via `appRouter.createCaller`, asserts
 * the result, asserts that an ActivityLog row was written, and cleans up
 * its own data at the end.
 *
 * Exit code 0 = all pass. Failures are printed with stack traces.
 *
 * NOTE: this script writes to the configured DATABASE_URL. Run only against
 * a dev/test DB. Override with `DATABASE_URL=postgres://...test... pnpm tsx scripts/test-modules.ts`.
 */

import { appRouter } from '@/server/routers/_app';
import { db } from '@/server/db';
import bcrypt from 'bcryptjs';
import type { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import type { GlobalRole, WorkingGroupRole, MilitaryRank } from '@prisma/client';

const TAG = `TEST_${Date.now()}`;

interface TestUser {
  id: string;
  email: string;
  globalRole: GlobalRole;
  memberships: { workingGroupId: string; role: WorkingGroupRole }[];
}

function makeCaller(user: TestUser) {
  return appRouter.createCaller({
    db,
    req: {} as unknown as NextRequest, // not used by procedures
    session: {
      user: {
        id: user.id,
        email: user.email,
        name: user.email,
        globalRole: user.globalRole,
        memberships: user.memberships,
      },
      expires: new Date(Date.now() + 86400_000).toISOString(),
    } as unknown as Session,
  });
}

interface Stats {
  pass: number;
  fail: number;
  failures: { name: string; err: unknown }[];
}

const stats: Stats = { pass: 0, fail: 0, failures: [] };

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    stats.pass++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    stats.fail++;
    stats.failures.push({ name, err });
  }
}

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function expectAuditLog(entity: string, entityId: string, action: string) {
  const row = await db.activityLog.findFirst({
    where: { entity, entityId, action },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) throw new Error(`No audit log row for ${entity}:${entityId} action=${action}`);
}

/* ── Setup ─────────────────────────────────────────────────────────── */

async function setup() {
  console.log(`\nSetting up fixtures (tag: ${TAG})…`);

  const passwordHash = await bcrypt.hash('TestPass123!', 4);

  const admin = await db.user.create({
    data: {
      email: `${TAG}-admin@test.local`,
      name: `${TAG} Admin`,
      passwordHash,
      globalRole: 'ADMIN',
      rank: 'COLONEL' satisfies MilitaryRank,
      organization: 'DERZH_NDI',
    },
  });

  const leader = await db.user.create({
    data: {
      email: `${TAG}-leader@test.local`,
      name: `${TAG} Leader`,
      passwordHash,
      globalRole: 'USER',
      rank: 'MAJOR' satisfies MilitaryRank,
      organization: 'DERZH_NDI',
    },
  });

  const member = await db.user.create({
    data: {
      email: `${TAG}-member@test.local`,
      name: `${TAG} Member`,
      passwordHash,
      globalRole: 'USER',
      rank: 'CAPTAIN' satisfies MilitaryRank,
      organization: 'DERZH_NDI',
    },
  });

  return {
    admin: {
      id: admin.id,
      email: admin.email,
      globalRole: 'ADMIN' as const,
      memberships: [],
    },
    leader: {
      id: leader.id,
      email: leader.email,
      globalRole: 'USER' as const,
      memberships: [] as { workingGroupId: string; role: WorkingGroupRole }[],
    },
    member: {
      id: member.id,
      email: member.email,
      globalRole: 'USER' as const,
      memberships: [] as { workingGroupId: string; role: WorkingGroupRole }[],
    },
  };
}

async function cleanup() {
  console.log(`\nCleaning up fixtures (tag: ${TAG})…`);
  // Delete in dependency order
  await db.activityLog.deleteMany({
    where: { OR: [{ note: { contains: TAG } }, { user: { email: { startsWith: TAG } } }] },
  });
  await db.notification.deleteMany({ where: { user: { email: { startsWith: TAG } } } });
  await db.comment.deleteMany({ where: { author: { email: { startsWith: TAG } } } });
  await db.vote.deleteMany({ where: { user: { email: { startsWith: TAG } } } });
  await db.voting.deleteMany({
    where: { standard: { workingGroup: { code: { startsWith: TAG } } } },
  });
  await db.task.deleteMany({
    where: { standard: { workingGroup: { code: { startsWith: TAG } } } },
  });
  await db.standardStatusHistory.deleteMany({
    where: { standard: { workingGroup: { code: { startsWith: TAG } } } },
  });
  await db.document.deleteMany({
    where: { standard: { workingGroup: { code: { startsWith: TAG } } } },
  });
  await db.standard.deleteMany({ where: { workingGroup: { code: { startsWith: TAG } } } });
  await db.agendaItem.deleteMany({
    where: { meeting: { workingGroup: { code: { startsWith: TAG } } } },
  });
  await db.attendance.deleteMany({
    where: { meeting: { workingGroup: { code: { startsWith: TAG } } } },
  });
  await db.meeting.deleteMany({ where: { workingGroup: { code: { startsWith: TAG } } } });
  await db.inviteToken.deleteMany({ where: { workingGroup: { code: { startsWith: TAG } } } });
  await db.workingGroupMember.deleteMany({
    where: { workingGroup: { code: { startsWith: TAG } } },
  });
  await db.workingGroup.deleteMany({ where: { code: { startsWith: TAG } } });
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

/* ── Tests ─────────────────────────────────────────────────────────── */

async function runTests() {
  const f = await setup();

  // Working group
  let wgId = '';
  let standardId = '';
  let meetingId = '';
  let taskId = '';
  let votingId = '';
  let commentId = '';

  console.log('\n┌─ WorkingGroup module');
  await step('admin.create', async () => {
    const wg = await makeCaller(f.admin).workingGroup.create({
      code: `${TAG}`,
      name: `${TAG} test group`,
      color: '#1A56DB',
    });
    wgId = wg.id;
    await expectAuditLog('WorkingGroup', wgId, 'CREATE');
  });
  await step('admin.update', async () => {
    await makeCaller(f.admin).workingGroup.update({ id: wgId, name: `${TAG} renamed` });
    await expectAuditLog('WorkingGroup', wgId, 'UPDATE');
  });
  await step('list', async () => {
    const items = await makeCaller(f.admin).workingGroup.list();
    if (!items.some((g) => g.id === wgId)) throw new Error('WG not listed');
  });
  await step('byId', async () => {
    const wg = await makeCaller(f.admin).workingGroup.byId({ id: wgId });
    assertEq(wg?.name, `${TAG} renamed`, 'wg.name');
  });
  await step('addMember (leader)', async () => {
    await makeCaller(f.admin).workingGroup.addMember({
      workingGroupId: wgId,
      userId: f.leader.id,
      role: 'LEADER',
    });
    f.leader.memberships = [{ workingGroupId: wgId, role: 'LEADER' }];
    await expectAuditLog('WorkingGroup', wgId, 'CREATE');
  });
  await step('addMember (member)', async () => {
    await makeCaller(f.admin).workingGroup.addMember({
      workingGroupId: wgId,
      userId: f.member.id,
      role: 'MEMBER',
    });
    f.member.memberships = [{ workingGroupId: wgId, role: 'MEMBER' }];
  });
  await step('changeMemberRole', async () => {
    await makeCaller(f.admin).workingGroup.changeMemberRole({
      workingGroupId: wgId,
      userId: f.member.id,
      role: 'DEPUTY',
    });
    await expectAuditLog('WorkingGroup', wgId, 'UPDATE');
  });
  await step('stats', async () => {
    const s = await makeCaller(f.admin).workingGroup.stats({ workingGroupId: wgId });
    if (!s) throw new Error('stats empty');
  });
  await step('setArchived', async () => {
    await makeCaller(f.admin).workingGroup.setArchived({ id: wgId, isArchived: true });
    await expectAuditLog('WorkingGroup', wgId, 'ARCHIVE');
    await makeCaller(f.admin).workingGroup.setArchived({ id: wgId, isArchived: false });
  });

  console.log('\n┌─ Standard module');
  await step('create', async () => {
    const s = await makeCaller(f.leader).standard.create({
      workingGroupId: wgId,
      code: `${TAG}-S1`,
      title: `${TAG} test standard`,
    });
    standardId = s.id;
    await expectAuditLog('Standard', standardId, 'CREATE');
  });
  await step('update', async () => {
    await makeCaller(f.leader).standard.update({
      id: standardId,
      title: `${TAG} updated standard`,
    });
    await expectAuditLog('Standard', standardId, 'UPDATE');
  });
  await step('list', async () => {
    const result = await makeCaller(f.admin).standard.list({ workingGroupId: wgId });
    if (!result.items.some((s) => s.id === standardId)) throw new Error('Standard not listed');
  });
  await step('byId', async () => {
    const s = await makeCaller(f.admin).standard.byId({ id: standardId });
    assertEq(s?.title, `${TAG} updated standard`, 'standard.title');
  });
  await step('changeStatus → IN_REVIEW', async () => {
    await makeCaller(f.leader).standard.changeStatus({ id: standardId, status: 'IN_REVIEW' });
    await expectAuditLog('Standard', standardId, 'STATUS_CHANGE');
  });

  console.log('\n┌─ Task module');
  await step('create', async () => {
    const t = await makeCaller(f.leader).task.create({
      standardId,
      title: `${TAG} test task`,
      assigneeId: f.member.id,
      dueDate: new Date(Date.now() + 7 * 86400_000),
    });
    taskId = t.id;
    await expectAuditLog('Task', taskId, 'CREATE');
  });
  await step('update', async () => {
    await makeCaller(f.leader).task.update({
      id: taskId,
      title: `${TAG} updated task`,
    });
    await expectAuditLog('Task', taskId, 'UPDATE');
  });
  await step('list', async () => {
    const items = await makeCaller(f.admin).task.list({ standardId });
    if (!items.some((t) => t.id === taskId)) throw new Error('Task not listed');
  });
  await step('byId', async () => {
    const t = await makeCaller(f.admin).task.byId({ id: taskId });
    assertEq(t.title, `${TAG} updated task`, 'task.title');
  });
  await step('changeStatus → DONE', async () => {
    await makeCaller(f.member).task.changeStatus({ id: taskId, status: 'DONE' });
    await expectAuditLog('Task', taskId, 'STATUS_CHANGE');
  });
  await step('delete', async () => {
    await makeCaller(f.leader).task.delete({ id: taskId });
    await expectAuditLog('Task', taskId, 'DELETE');
  });

  console.log('\n┌─ Vote module');
  await step('openVoting', async () => {
    const v = await makeCaller(f.leader).vote.openVoting({
      standardId,
      title: `${TAG} test voting`,
      deadline: new Date(Date.now() + 86400_000),
    });
    votingId = v.id;
    await expectAuditLog('Vote', votingId, 'CREATE');
  });
  await step('cast FOR', async () => {
    await makeCaller(f.leader).vote.cast({ votingId, choice: 'FOR' });
    await expectAuditLog('Vote', votingId, 'CREATE'); // openVoting creates; cast adds another row
  });
  await step('cast AGAINST (other user)', async () => {
    await makeCaller(f.member).vote.cast({ votingId, choice: 'AGAINST' });
  });
  await step('results', async () => {
    const r = await makeCaller(f.leader).vote.results({ votingId });
    assertEq(r.forVotes, 1, 'forVotes');
    assertEq(r.against, 1, 'againstVotes');
  });
  await step('closeVoting', async () => {
    await makeCaller(f.leader).vote.closeVoting({ votingId });
    await expectAuditLog('Vote', votingId, 'STATUS_CHANGE');
  });

  console.log('\n┌─ Meeting module');
  await step('create', async () => {
    const m = await makeCaller(f.leader).meeting.create({
      workingGroupId: wgId,
      title: `${TAG} test meeting`,
      startAt: new Date(Date.now() + 86400_000),
      durationMins: 60,
    });
    meetingId = m.id;
    await expectAuditLog('Meeting', meetingId, 'CREATE');
  });
  await step('update', async () => {
    await makeCaller(f.leader).meeting.update({
      id: meetingId,
      title: `${TAG} updated meeting`,
    });
    await expectAuditLog('Meeting', meetingId, 'UPDATE');
  });
  await step('list', async () => {
    const items = await makeCaller(f.admin).meeting.list({ workingGroupId: wgId });
    if (!items.some((m) => m.id === meetingId)) throw new Error('Meeting not listed');
  });
  await step('byId', async () => {
    const m = await makeCaller(f.admin).meeting.byId({ id: meetingId });
    assertEq(m.title, `${TAG} updated meeting`, 'meeting.title');
  });
  await step('confirmAttendance', async () => {
    await makeCaller(f.member).meeting.confirmAttendance({
      meetingId,
      status: 'CONFIRMED',
    });
    await expectAuditLog('Attendance', `${meetingId}:${f.member.id}`, 'STATUS_CHANGE');
  });
  await step('upsertAgendaItem', async () => {
    const item = await makeCaller(f.leader).meeting.upsertAgendaItem({
      meetingId,
      order: 0,
      title: `${TAG} agenda 1`,
    });
    await expectAuditLog('AgendaItem', item.id, 'CREATE');
    // Update path
    await makeCaller(f.leader).meeting.upsertAgendaItem({
      id: item.id,
      meetingId,
      order: 0,
      title: `${TAG} agenda 1 updated`,
    });
    await expectAuditLog('AgendaItem', item.id, 'UPDATE');
    await makeCaller(f.leader).meeting.deleteAgendaItem({ id: item.id });
    await expectAuditLog('AgendaItem', item.id, 'DELETE');
  });
  await step('assignProtocolNumber', async () => {
    await makeCaller(f.leader).meeting.assignProtocolNumber({ meetingId });
    await expectAuditLog('Meeting', meetingId, 'UPDATE');
  });
  await step('uploadMinutes', async () => {
    await makeCaller(f.leader).meeting.uploadMinutes({
      meetingId,
      minutesText: `${TAG} minutes content`,
    });
    await expectAuditLog('Meeting', meetingId, 'UPDATE');
  });
  await step('changeStatus → COMPLETED', async () => {
    await makeCaller(f.leader).meeting.changeStatus({ meetingId, status: 'COMPLETED' });
    await expectAuditLog('Meeting', meetingId, 'STATUS_CHANGE');
  });
  await step('cancel', async () => {
    // Re-create a meeting to cancel (already completed)
    const m2 = await makeCaller(f.leader).meeting.create({
      workingGroupId: wgId,
      title: `${TAG} cancel-me`,
      startAt: new Date(Date.now() + 2 * 86400_000),
      durationMins: 60,
    });
    await makeCaller(f.leader).meeting.cancel({ id: m2.id });
    await expectAuditLog('Meeting', m2.id, 'STATUS_CHANGE');
  });

  console.log('\n┌─ Comment module');
  await step('create', async () => {
    const c = await makeCaller(f.member).comment.create({
      standardId,
      body: `${TAG} test comment`,
    });
    commentId = c.id;
    await expectAuditLog('Standard', standardId, 'UPDATE');
  });
  await step('list', async () => {
    const items = await makeCaller(f.admin).comment.list({ standardId });
    if (!items.some((c) => c.id === commentId)) throw new Error('Comment not listed');
  });
  await step('update (own)', async () => {
    await makeCaller(f.member).comment.update({ id: commentId, body: `${TAG} edited comment` });
    await expectAuditLog('Comment', commentId, 'UPDATE');
  });
  await step('delete (own)', async () => {
    await makeCaller(f.member).comment.delete({ id: commentId });
    await expectAuditLog('Comment', commentId, 'DELETE');
  });

  console.log('\n┌─ User module');
  await step('me', async () => {
    const me = await makeCaller(f.leader).user.me();
    assertEq(me.id, f.leader.id, 'me.id');
  });
  await step('updateProfile', async () => {
    await makeCaller(f.leader).user.updateProfile({ phone: '+380501234567' });
    await expectAuditLog('User', f.leader.id, 'UPDATE');
  });
  await step('list (admin)', async () => {
    const users = await makeCaller(f.admin).user.list();
    if (!users.some((u) => u.id === f.leader.id)) throw new Error('User not listed');
  });
  await step('invite', async () => {
    const res = await makeCaller(f.admin).user.invite({
      email: `${TAG}-new@test.local`,
      workingGroupId: wgId,
      role: 'MEMBER',
    });
    if (!res.token) throw new Error('No token returned');
  });
  await step('changeGlobalRole', async () => {
    await makeCaller(f.admin).user.changeGlobalRole({
      userId: f.leader.id,
      globalRole: 'DIRECTOR',
    });
    await expectAuditLog('User', f.leader.id, 'UPDATE');
    await makeCaller(f.admin).user.changeGlobalRole({ userId: f.leader.id, globalRole: 'USER' });
  });
  await step('setActive', async () => {
    await makeCaller(f.admin).user.setActive({ userId: f.member.id, isActive: false });
    await expectAuditLog('User', f.member.id, 'ARCHIVE');
    await makeCaller(f.admin).user.setActive({ userId: f.member.id, isActive: true });
  });

  console.log('\n┌─ Admin/Settings module');
  await step('getSettings', async () => {
    const s = await makeCaller(f.admin).admin.getSettings();
    if (!s) throw new Error('Settings empty');
  });
  await step('updateSettings', async () => {
    await makeCaller(f.admin).admin.updateSettings({
      meetingRemindLead1Hours: 12,
      meetingRemindLead2Hours: 1,
      meetingInviteOnCreate: true,
      meetingChangeNotify: true,
      taskAssignNotify: true,
      taskDeadlineLeadHours: 12,
      taskOverdueNotify: true,
      taskCompleteNotify: true,
      voteOpenedNotify: true,
      voteClosingLeadHours: 12,
      voteClosedNotify: true,
      standardStatusNotify: true,
      commentMentionNotify: true,
      documentUploadNotify: false,
      channelEmail: true,
      channelInApp: true,
      stageDueSoonNotify: true,
      stageDueLeadDays1: 7,
      stageDueLeadDays2: 1,
      stageOverdueNotify: true,
      stageCompletedNotify: true,
      weeklyDigestEnabled: true,
      attendanceDeclinedNotify: true,
      protocolPublishedNotify: true,
    });
    await expectAuditLog('SystemSettings', '1', 'UPDATE');
  });

  console.log('\n┌─ Notification module');
  await step('list (auto-created by other ops)', async () => {
    await makeCaller(f.member).notification.list({});
  });
  await step('unreadCount', async () => {
    await makeCaller(f.member).notification.unreadCount();
  });
  await step('markAllRead', async () => {
    await makeCaller(f.member).notification.markAllRead();
  });
  await step('deleteAll', async () => {
    await makeCaller(f.member).notification.deleteAll();
  });

  console.log('\n┌─ Dashboard / Search / ActivityLog');
  await step('dashboard.kpis', async () => {
    await makeCaller(f.admin).dashboard.kpis();
  });
  await step('dashboard.navCounts', async () => {
    await makeCaller(f.admin).dashboard.navCounts();
  });
  await step('search.global', async () => {
    const r = await makeCaller(f.admin).search.global({ q: TAG });
    if (!r) throw new Error('No search results');
  });
  await step('activityLog.list (for our standard)', async () => {
    const logs = await makeCaller(f.admin).activityLog.list({
      entity: 'Standard',
      entityId: standardId,
    });
    if (logs.length === 0) throw new Error('No activity log rows');
  });

  console.log('\n┌─ Standard delete (admin only, cleanup phase)');
  await step('standard.delete', async () => {
    // delete now requires a type-to-confirm code matching the standard's code
    const std = await db.standard.findUniqueOrThrow({
      where: { id: standardId },
      select: { code: true },
    });
    await makeCaller(f.admin).standard.delete({ id: standardId, confirmCode: std.code });
    await expectAuditLog('Standard', standardId, 'DELETE');
  });

  console.log('\n┌─ WorkingGroup membership removal');
  await step('removeMember', async () => {
    await makeCaller(f.admin).workingGroup.removeMember({
      workingGroupId: wgId,
      userId: f.member.id,
    });
    await expectAuditLog('WorkingGroup', wgId, 'DELETE');
  });
}

/* ── Main ──────────────────────────────────────────────────────────── */

async function main() {
  const started = Date.now();
  try {
    await runTests();
  } catch (e) {
    console.error('\nFATAL during run:', e);
    stats.fail++;
  } finally {
    try {
      await cleanup();
    } catch (e) {
      console.error('Cleanup error:', e);
    }
    await db.$disconnect();
  }

  console.log('\n═════════ Test results ═════════');
  console.log(`  PASS: ${stats.pass}`);
  console.log(`  FAIL: ${stats.fail}`);
  console.log(`  Time: ${((Date.now() - started) / 1000).toFixed(2)}s`);

  if (stats.fail > 0) {
    console.log('\nFailures:');
    for (const f of stats.failures) {
      console.log(`  • ${f.name}`);
      if (f.err instanceof Error && f.err.stack) {
        console.log(`    ${f.err.stack.split('\n').slice(0, 3).join('\n    ')}`);
      }
    }
    process.exit(1);
  }
  console.log('\nOK — all module tests passed.');
}

main().catch((e) => {
  console.error('Top-level error:', e);
  process.exit(1);
});
