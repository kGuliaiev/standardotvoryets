import { PrismaClient, type MilitaryRank, type Organization } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

const NEW_MEMBERS = [
  {
    name: 'Віталій КАЧУР',
    email: 'vitalii.kachur@dssszzi.ua',
    rank: 'COLONEL' as MilitaryRank,
    position: 'заступник директора ДДК Адміністрації Держспецзв’язку (за згодою)',
    organization: 'ADM_DSSZZI' as Organization,
  },
  {
    name: 'Володимир СІВАК',
    email: 'volodymyr.sivak@dssszzi.ua',
    rank: 'COLONEL' as MilitaryRank,
    position: 'начальник 3 управління ДДК Адміністрації Держспецзв’язку (за згодою)',
    organization: 'ADM_DSSZZI' as Organization,
  },
  {
    name: 'Борис РОЗУМНИЙ',
    email: 'borys.rozumnyi@dssszzi.ua',
    rank: 'COLONEL' as MilitaryRank,
    position:
      'заступник начальника управління — начальник 1 відділу 3 управління ДДК Адміністрації Держспецзв’язку (за згодою)',
    organization: 'ADM_DSSZZI' as Organization,
  },
  {
    name: 'Віталій ЗАЙКІН',
    email: 'vitalii.zaikin@dssszzi.ua',
    rank: 'COLONEL' as MilitaryRank,
    position: 'начальник 2 відділу 3 управління ДДК Адміністрації Держспецзв’язку (за згодою)',
    organization: 'ADM_DSSZZI' as Organization,
  },
  {
    name: 'Дмитро БОРОВКОВ',
    email: 'dmytro.borovkov@dssszzi.ua',
    rank: 'SENIOR_LIEUTENANT' as MilitaryRank,
    position:
      'інженер ІІ категорії за рахунок посади старшого інженера 2 відділу 7 дослідно-випробувального центру протидії технічним розвідкам ДержНДІ технологій кібербезпеки',
    organization: 'DERZH_NDI' as Organization,
  },
];

async function main() {
  const wg = await db.workingGroup.findFirst({ where: { code: 'РГ №4' } });
  if (!wg) throw new Error('WG "РГ №4" not found');

  // Grab any existing ADMIN user id — needed to attribute the ActivityLog
  // rows (userId is a required FK). No admin present in this DB? — just
  // omit the audit entries.
  const admin = await db.user.findFirst({ where: { globalRole: 'ADMIN' } });
  const adminId = admin?.id ?? null;

  const password = await bcrypt.hash('User123!', 10);

  const summary: {
    createdUsers: { name: string; email: string; id: string }[];
    addedMembers: { name: string; id: string }[];
    skipped: { name: string; reason: string }[];
  } = { createdUsers: [], addedMembers: [], skipped: [] };

  for (const m of NEW_MEMBERS) {
    const existing = await db.user.findUnique({ where: { email: m.email } });
    let user = existing;
    if (!user) {
      user = await db.user.create({
        data: {
          name: m.name,
          email: m.email,
          passwordHash: password,
          rank: m.rank,
          position: m.position,
          organization: m.organization,
          globalRole: 'USER',
          isActive: true,
        },
      });
      summary.createdUsers.push({ name: user.name, email: user.email, id: user.id });
      if (adminId) {
        await db.activityLog.create({
          data: {
            userId: adminId,
            action: 'CREATE',
            entity: 'User',
            entityId: user.id,
            after: { name: user.name, email: user.email, rank: user.rank },
            note: `Створено користувача за наказом ДержНДІ від 16.06.2026 (зміни до наказу №32)`,
          },
        });
      }
    }

    const alreadyMember = await db.workingGroupMember.findUnique({
      where: { workingGroupId_userId: { workingGroupId: wg.id, userId: user.id } },
    });
    if (alreadyMember) {
      summary.skipped.push({
        name: user.name,
        reason: `already member (role ${alreadyMember.role})`,
      });
      continue;
    }

    await db.workingGroupMember.create({
      data: { workingGroupId: wg.id, userId: user.id, role: 'MEMBER' },
    });
    summary.addedMembers.push({ name: user.name, id: user.id });
    if (adminId) {
      await db.activityLog.create({
        data: {
          userId: adminId,
          action: 'CREATE',
          entity: 'WorkingGroupMember',
          entityId: user.id,
          after: { workingGroup: wg.code, role: 'MEMBER', user: user.name },
          note: `Додано до ${wg.code} як MEMBER — наказ ДержНДІ від 16.06.2026 (зміни до наказу №32)`,
        },
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
