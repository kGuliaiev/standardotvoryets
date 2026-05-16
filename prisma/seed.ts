/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  PrismaClient,
  GlobalRole,
  WorkingGroupRole,
  StandardStatus,
  MilitaryRank,
  Organization,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

interface SeedUser {
  email: string;
  name: string; // "Перше Прізвище"
  rank: MilitaryRank;
  position: string;
  organization: Organization;
  globalRole?: GlobalRole;
}

interface WGSeed {
  code: string;
  name: string;
  color: string;
  description?: string;
  leader: string; // email of leader
  deputy?: string;
  secretary: string;
  members: string[]; // emails of plain members
}

/* ─── Helpers ────────────────────────────────────────────────────────── */

const HASH_ROUNDS = 12;

function emailFrom(name: string) {
  // "Дмитро БОНДАРЕНКО" → "dmytro.bondarenko@dssszzi.ua"
  const map: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'h',
    ґ: 'g',
    д: 'd',
    е: 'e',
    є: 'ie',
    ж: 'zh',
    з: 'z',
    и: 'y',
    і: 'i',
    ї: 'i',
    й: 'i',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'kh',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'shch',
    ь: '',
    ю: 'iu',
    я: 'ia',
    "'": '',
    ' ': '.',
  };
  const slug = name
    .toLowerCase()
    .split('')
    .map((c) => map[c] ?? c)
    .join('')
    .replace(/\.+/g, '.');
  return `${slug}@dssszzi.ua`;
}

/* ─── Master user roster from наказ + зміни ─────────────────────────── */
// Format: name → seed user data
const USERS: SeedUser[] = [
  // Admin (system)
  {
    email: 'admin@test.ua',
    name: 'Адміністратор',
    rank: MilitaryRank.CIVILIAN,
    position: 'Адміністратор системи',
    organization: Organization.DERZH_NDI,
    globalRole: GlobalRole.ADMIN,
  },

  // РГ №1 (Криптографічний захист)
  {
    email: emailFrom('Дмитро БОНДАРЕНКО'),
    name: 'Дмитро БОНДАРЕНКО',
    rank: MilitaryRank.COLONEL,
    position: 'начальник 1 науково-дослідного центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Олександр ДИРДА'),
    name: 'Олександр ДИРДА',
    rank: MilitaryRank.COLONEL,
    position: 'начальник 6 центру тематичних досліджень',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Олексій ПОНОМАРЬОВ'),
    name: 'Олексій ПОНОМАРЬОВ',
    rank: MilitaryRank.LIEUTENANT,
    position: 'молодший науковий співробітник 1 наукового відділу 8 центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Олексій БЕЗСМЕРТНИЙ'),
    name: 'Олексій БЕЗСМЕРТНИЙ',
    rank: MilitaryRank.COLONEL,
    position: 'заступник начальника управління — начальник 1 відділу 3 управління ДЗІ',
    organization: Organization.ADM_DSSZZI,
  },
  {
    email: emailFrom('Михайло ТЕРЛЕЦЬКИЙ'),
    name: 'Михайло ТЕРЛЕЦЬКИЙ',
    rank: MilitaryRank.COLONEL,
    position: 'заступник начальника 6 центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Наталія ЛИСЕНКО'),
    name: 'Наталія ЛИСЕНКО',
    rank: MilitaryRank.COLONEL,
    position: 'начальник 3 науково-дослідного відділу 1 НДЦ',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Федір ІВАНОВ'),
    name: 'Федір ІВАНОВ',
    rank: MilitaryRank.COLONEL,
    position: 'начальник 1 науково-дослідного відділу 3 центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Микола СНІЖИНСЬКИЙ'),
    name: 'Микола СНІЖИНСЬКИЙ',
    rank: MilitaryRank.LIEUTENANT_COLONEL,
    position: 'заступник начальника 2 відділу 3 управління ДЗІ',
    organization: Organization.ADM_DSSZZI,
  },
  {
    email: emailFrom('Валерій ЖУКОВИЧ'),
    name: 'Валерій ЖУКОВИЧ',
    rank: MilitaryRank.LIEUTENANT_COLONEL,
    position: 'заступник начальника 2 відділу 6 центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Олена ШМЕТАН'),
    name: 'Олена ШМЕТАН',
    rank: MilitaryRank.LIEUTENANT_COLONEL,
    position: 'заступник начальника 3 відділу 6 центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Назар ЗАЇКА'),
    name: 'Назар ЗАЇКА',
    rank: MilitaryRank.SENIOR_LIEUTENANT,
    position: 'молодший науковий співробітник 2 НД відділу 1 НДЦ',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Євген СТАРОДУБ'),
    name: 'Євген СТАРОДУБ',
    rank: MilitaryRank.CIVILIAN,
    position: 'провідний інженер 1 НД відділу 3 центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Ярослав СТЕФАНИШИН'),
    name: 'Ярослав СТЕФАНИШИН',
    rank: MilitaryRank.CIVILIAN,
    position: 'науковий співробітник 3 НД відділу 1 НДЦ',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Ігор МАРТИНЮК'),
    name: 'Ігор МАРТИНЮК',
    rank: MilitaryRank.CIVILIAN,
    position: 'інженер І категорії 2 НД відділу 1 НДЦ',
    organization: Organization.DERZH_NDI,
  },

  // РГ №2 (Технічний захист) — за змінами
  {
    email: emailFrom('Сергій ЛИСЕНКО'),
    name: 'Сергій ЛИСЕНКО',
    rank: MilitaryRank.COLONEL,
    position: 'начальник 2 науково-дослідного центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Олександр ТКАЧЕНКО'),
    name: 'Олександр ТКАЧЕНКО',
    rank: MilitaryRank.COLONEL,
    position: 'заступник начальника центру — начальник 2 НД відділу 2 НДЦ',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Олексій ГАВРИЛЕНКО'),
    name: 'Олексій ГАВРИЛЕНКО',
    rank: MilitaryRank.COLONEL,
    position: 'заступник начальника управління — начальник 2 відділу 2 управління ДЗІ',
    organization: Organization.ADM_DSSZZI,
  },
  {
    email: emailFrom('Михайло РИБКА'),
    name: 'Михайло РИБКА',
    rank: MilitaryRank.COLONEL,
    position: 'заступник начальника управління — начальник 1 відділу 4 управління ДЗІ',
    organization: Organization.ADM_DSSZZI,
  },
  {
    email: emailFrom('Роман САГАЙДАК'),
    name: 'Роман САГАЙДАК',
    rank: MilitaryRank.COLONEL,
    position: 'заступник начальника 1 відділу 4 управління ДЗІ',
    organization: Organization.ADM_DSSZZI,
  },
  {
    email: emailFrom('Ігор НАВРОЦЬКИЙ'),
    name: 'Ігор НАВРОЦЬКИЙ',
    rank: MilitaryRank.COLONEL,
    position: 'заступник начальника 4 центру технічного захисту',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Руслан БОБРО'),
    name: 'Руслан БОБРО',
    rank: MilitaryRank.LIEUTENANT_COLONEL,
    position: 'заступник начальника 1 НД відділу 2 НДЦ',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Анатолій ГОЛІШЕВСЬКИЙ'),
    name: 'Анатолій ГОЛІШЕВСЬКИЙ',
    rank: MilitaryRank.LIEUTENANT_COLONEL,
    position: 'провідний науковий співробітник 1 НД відділу 2 НДЦ',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Олександр ДРОБКО'),
    name: 'Олександр ДРОБКО',
    rank: MilitaryRank.LIEUTENANT_COLONEL,
    position: 'заступник начальника 3 відділу 4 центру технічного захисту',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Максим КОЖИН'),
    name: 'Максим КОЖИН',
    rank: MilitaryRank.LIEUTENANT_COLONEL,
    position: 'старший конструктор 1 відділу 4 центру технічного захисту',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Юрій РОЗСОШАНСЬКИЙ'),
    name: 'Юрій РОЗСОШАНСЬКИЙ',
    rank: MilitaryRank.CAPTAIN,
    position: 'старший фахівець 2 відділу 4 центру технічного захисту',
    organization: Organization.DERZH_NDI,
  },

  // РГ №3 (Кіберзахист)
  {
    email: emailFrom('Максим КОМАРОВ'),
    name: 'Максим КОМАРОВ',
    rank: MilitaryRank.COLONEL,
    position: 'начальник 5 центру захисту інформації',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Олексій ВЕРХОВЕЦЬ'),
    name: 'Олексій ВЕРХОВЕЦЬ',
    rank: MilitaryRank.COLONEL,
    position: 'заступник начальника 5 центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Кирило ГУЛЯЄВ'),
    name: 'Кирило ГУЛЯЄВ',
    rank: MilitaryRank.CAPTAIN,
    position: 'старший науковий співробітник 1 наукового відділу 8 центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Віталій ГОЛЬНЄВ'),
    name: 'Віталій ГОЛЬНЄВ',
    rank: MilitaryRank.COLONEL,
    position: 'начальник 1 відділу 5 центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Олег РУЩАК'),
    name: 'Олег РУЩАК',
    rank: MilitaryRank.COLONEL,
    position: 'начальник 2 відділу 5 центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Ігор ПИСАНКО'),
    name: 'Ігор ПИСАНКО',
    rank: MilitaryRank.LIEUTENANT_COLONEL,
    position: 'начальник 3 відділу 5 центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Дмитро ЖАРУК'),
    name: 'Дмитро ЖАРУК',
    rank: MilitaryRank.MAJOR,
    position: 'начальник 3 відділу Департаменту кіберзахисту',
    organization: Organization.ADM_DSSZZI,
  },
  {
    email: emailFrom('Тетяна ГРИЩИШИНА'),
    name: 'Тетяна ГРИЩИШИНА',
    rank: MilitaryRank.MAJOR,
    position: 'заступник начальника 2 відділу Департаменту кіберзахисту',
    organization: Organization.ADM_DSSZZI,
  },

  // РГ №4 (Протидія технічним розвідкам)
  {
    email: emailFrom('Максим ІЩУК'),
    name: 'Максим ІЩУК',
    rank: MilitaryRank.COLONEL,
    position: 'начальник 7 ДВЦ протидії технічним розвідкам',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Сергій ГНАТЮК'),
    name: 'Сергій ГНАТЮК',
    rank: MilitaryRank.COLONEL,
    position: 'провідний науковий співробітник науково-дослідної лабораторії 7 ДВЦ',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Ірина КИРИЛЛОВА'),
    name: 'Ірина КИРИЛЛОВА',
    rank: MilitaryRank.COLONEL,
    position: 'заступник начальника управління — начальник 1 відділу 1 управління Департаменту ПТР',
    organization: Organization.ADM_DSSZZI,
  },
  {
    email: emailFrom('Юрій ЖУК'),
    name: 'Юрій ЖУК',
    rank: MilitaryRank.COLONEL,
    position: 'заступник начальника центру — начальник 1 відділу 7 ДВЦ',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Максим МАКСИМЕНКО'),
    name: 'Максим МАКСИМЕНКО',
    rank: MilitaryRank.LIEUTENANT_COLONEL,
    position: 'начальник 2 відділу 7 ДВЦ',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Вікторія ШИКЕР'),
    name: 'Вікторія ШИКЕР',
    rank: MilitaryRank.MAJOR,
    position: 'головний спеціаліст 1 відділу 1 управління Департаменту ПТР',
    organization: Organization.ADM_DSSZZI,
  },
  {
    email: emailFrom('Андрій БРОНЕВИЦЬКИЙ'),
    name: 'Андрій БРОНЕВИЦЬКИЙ',
    rank: MilitaryRank.CAPTAIN,
    position: 'начальник науково-дослідної лабораторії 7 ДВЦ',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Максим ПАЗЮК'),
    name: 'Максим ПАЗЮК',
    rank: MilitaryRank.SENIOR_LIEUTENANT,
    position: 'конструктор 1 відділу 7 ДВЦ',
    organization: Organization.DERZH_NDI,
  },

  // РГ №5 (Основоположні стандарти)
  {
    email: emailFrom('Роман ЦИРЕНЬ'),
    name: 'Роман ЦИРЕНЬ',
    rank: MilitaryRank.COLONEL,
    position: 'начальник 8 наукового центру галузевої стандартизації',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Тетяна МАСЛЕННИКОВА'),
    name: 'Тетяна МАСЛЕННИКОВА',
    rank: MilitaryRank.CAPTAIN,
    position: 'заступник начальника центру — начальник 1 наукового відділу 8 центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Олексій ЮДІН'),
    name: 'Олексій ЮДІН',
    rank: MilitaryRank.COLONEL,
    position: 'головний науковий співробітник 3 наукового відділу 8 центру',
    organization: Organization.DERZH_NDI,
  },
  {
    email: emailFrom('Оксана ПШЕНИЧНА'),
    name: 'Оксана ПШЕНИЧНА',
    rank: MilitaryRank.CAPTAIN,
    position: 'т.в.о. начальника відділу науково-технічної експертизи',
    organization: Organization.DERZH_NDI,
  },
];

const WORKING_GROUPS: WGSeed[] = [
  {
    code: 'РГ №1',
    name: 'Криптографічний захист інформації',
    description: 'Розроблення проєктів стандартів з криптографічного захисту інформації',
    color: '#1A56DB',
    leader: emailFrom('Дмитро БОНДАРЕНКО'),
    deputy: emailFrom('Олександр ДИРДА'),
    secretary: emailFrom('Олексій ПОНОМАРЬОВ'),
    members: [
      emailFrom('Олексій БЕЗСМЕРТНИЙ'),
      emailFrom('Михайло ТЕРЛЕЦЬКИЙ'),
      emailFrom('Наталія ЛИСЕНКО'),
      emailFrom('Федір ІВАНОВ'),
      emailFrom('Микола СНІЖИНСЬКИЙ'),
      emailFrom('Валерій ЖУКОВИЧ'),
      emailFrom('Олена ШМЕТАН'),
      emailFrom('Назар ЗАЇКА'),
      emailFrom('Євген СТАРОДУБ'),
      emailFrom('Ярослав СТЕФАНИШИН'),
      emailFrom('Ігор МАРТИНЮК'),
    ],
  },
  {
    code: 'РГ №2',
    name: 'Технічний захист інформації',
    description: 'Розроблення проєктів стандартів з технічного захисту інформації',
    color: '#6D28D9',
    leader: emailFrom('Сергій ЛИСЕНКО'),
    deputy: emailFrom('Олександр ТКАЧЕНКО'),
    secretary: emailFrom('Олексій ПОНОМАРЬОВ'),
    members: [
      emailFrom('Олексій ГАВРИЛЕНКО'),
      emailFrom('Михайло РИБКА'),
      emailFrom('Роман САГАЙДАК'),
      emailFrom('Ігор НАВРОЦЬКИЙ'),
      emailFrom('Михайло ТЕРЛЕЦЬКИЙ'),
      emailFrom('Руслан БОБРО'),
      emailFrom('Анатолій ГОЛІШЕВСЬКИЙ'),
      emailFrom('Валерій ЖУКОВИЧ'),
      emailFrom('Олександр ДРОБКО'),
      emailFrom('Максим КОЖИН'),
      emailFrom('Юрій РОЗСОШАНСЬКИЙ'),
    ],
  },
  {
    code: 'РГ №3',
    name: 'Кіберзахист',
    description: 'Розроблення проєктів стандартів з кіберзахисту',
    color: '#059669',
    leader: emailFrom('Максим КОМАРОВ'),
    deputy: emailFrom('Олексій ВЕРХОВЕЦЬ'),
    secretary: emailFrom('Кирило ГУЛЯЄВ'),
    members: [
      emailFrom('Віталій ГОЛЬНЄВ'),
      emailFrom('Олег РУЩАК'),
      emailFrom('Ігор ПИСАНКО'),
      emailFrom('Дмитро ЖАРУК'),
      emailFrom('Тетяна ГРИЩИШИНА'),
    ],
  },
  {
    code: 'РГ №4',
    name: 'Протидія технічним розвідкам',
    description: 'Розроблення проєктів стандартів з протидії технічним розвідкам',
    color: '#D97706',
    leader: emailFrom('Максим ІЩУК'),
    deputy: emailFrom('Сергій ГНАТЮК'),
    secretary: emailFrom('Кирило ГУЛЯЄВ'),
    members: [
      emailFrom('Ірина КИРИЛЛОВА'),
      emailFrom('Юрій ЖУК'),
      emailFrom('Максим МАКСИМЕНКО'),
      emailFrom('Вікторія ШИКЕР'),
      emailFrom('Андрій БРОНЕВИЦЬКИЙ'),
      emailFrom('Максим ПАЗЮК'),
    ],
  },
  {
    code: 'РГ №5',
    name: 'Основоположні стандарти',
    description: 'Розроблення основоположних стандартів',
    color: '#DC2626',
    leader: emailFrom('Роман ЦИРЕНЬ'),
    deputy: emailFrom('Тетяна МАСЛЕННИКОВА'),
    secretary: emailFrom('Олексій ПОНОМАРЬОВ'),
    members: [emailFrom('Олексій ЮДІН'), emailFrom('Оксана ПШЕНИЧНА'), emailFrom('Кирило ГУЛЯЄВ')],
  },
];

async function main() {
  console.log('🌱 Seeding database (per Наказ №32 від 23.03.2026 + зміни)…');

  /* ── Users ─────────────────────────────────────────────────────────── */
  const userPassword = await bcrypt.hash('User123!', HASH_ROUNDS);
  const adminPassword = await bcrypt.hash('Admin123!', HASH_ROUNDS);

  const usersById: Record<string, string> = {}; // email → user.id

  for (const u of USERS) {
    const isAdmin = u.globalRole === GlobalRole.ADMIN;
    const upserted = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        rank: u.rank,
        position: u.position,
        organization: u.organization,
        globalRole: u.globalRole ?? GlobalRole.USER,
      },
      create: {
        email: u.email,
        name: u.name,
        passwordHash: isAdmin ? adminPassword : userPassword,
        rank: u.rank,
        position: u.position,
        organization: u.organization,
        globalRole: u.globalRole ?? GlobalRole.USER,
      },
      select: { id: true, email: true },
    });
    usersById[upserted.email] = upserted.id;
  }
  console.log(`✅ ${Object.keys(usersById).length} users upserted`);

  /* ── Wipe stale memberships and standards ──────────────────────────── */
  // To replace the previous РГ #4/8/12 seed cleanly: remove all members and
  // any pending standards from groups that aren't in this list. Order is
  // critical — child rows must go before parents to avoid FK violations.
  // CRITICAL: wrap each delete in try/catch so a single FK error can't
  // abort the rest of the seed (specifically, can't block the WG
  // create/upsert loop below).
  const safeDelete = async <T>(label: string, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`⚠️  ${label} skipped: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  };

  const seedCodes = WORKING_GROUPS.map((w) => w.code);
  const staleGroups = await safeDelete('staleGroups.findMany', () =>
    prisma.workingGroup.findMany({
      where: { code: { notIn: seedCodes } },
      select: { id: true, code: true },
    }),
  );
  if (staleGroups?.length) {
    console.log('🧹 Removing stale WGs:', staleGroups.map((g) => g.code).join(', '));
    const wgIds = staleGroups.map((g) => g.id);
    const stdIds =
      (
        await safeDelete('stale standards lookup', () =>
          prisma.standard.findMany({
            where: { workingGroupId: { in: wgIds } },
            select: { id: true },
          }),
        )
      )?.map((s) => s.id) ?? [];
    const mtIds =
      (
        await safeDelete('stale meetings lookup', () =>
          prisma.meeting.findMany({
            where: { workingGroupId: { in: wgIds } },
            select: { id: true },
          }),
        )
      )?.map((m) => m.id) ?? [];

    if (stdIds.length) {
      const votingIds =
        (
          await safeDelete('stale votings lookup', () =>
            prisma.voting.findMany({
              where: { standardId: { in: stdIds } },
              select: { id: true },
            }),
          )
        )?.map((v) => v.id) ?? [];
      if (votingIds.length) {
        await safeDelete('vote.deleteMany', () =>
          prisma.vote.deleteMany({ where: { votingId: { in: votingIds } } }),
        );
        await safeDelete('voting.deleteMany', () =>
          prisma.voting.deleteMany({ where: { id: { in: votingIds } } }),
        );
      }
      await safeDelete('task.deleteMany', () =>
        prisma.task.deleteMany({ where: { standardId: { in: stdIds } } }),
      );
      await safeDelete('comment.deleteMany', () =>
        prisma.comment.deleteMany({ where: { standardId: { in: stdIds } } }),
      );
      await safeDelete('document.deleteMany', () =>
        prisma.document.deleteMany({ where: { standardId: { in: stdIds } } }),
      );
      await safeDelete('standardStatusHistory.deleteMany', () =>
        prisma.standardStatusHistory.deleteMany({ where: { standardId: { in: stdIds } } }),
      );
    }
    if (mtIds.length) {
      await safeDelete('agendaItem.deleteMany', () =>
        prisma.agendaItem.deleteMany({ where: { meetingId: { in: mtIds } } }),
      );
      await safeDelete('attendance.deleteMany', () =>
        prisma.attendance.deleteMany({ where: { meetingId: { in: mtIds } } }),
      );
    }
    await safeDelete('activityLog stale cleanup', () =>
      prisma.activityLog.deleteMany({
        where: {
          OR: [
            { entity: 'Standard', entityId: { in: stdIds } },
            { entity: 'Meeting', entityId: { in: mtIds } },
            { entity: 'WorkingGroup', entityId: { in: wgIds } },
          ],
        },
      }),
    );

    // Invite tokens reference WG directly with no cascade — clean before WG
    await safeDelete('inviteToken stale', () =>
      prisma.inviteToken.deleteMany({ where: { workingGroupId: { in: wgIds } } }),
    );
    await safeDelete('workingGroupMember stale', () =>
      prisma.workingGroupMember.deleteMany({ where: { workingGroupId: { in: wgIds } } }),
    );
    await safeDelete('standard stale', () =>
      prisma.standard.deleteMany({ where: { id: { in: stdIds } } }),
    );
    await safeDelete('meeting stale', () =>
      prisma.meeting.deleteMany({ where: { id: { in: mtIds } } }),
    );
    await safeDelete('workingGroup stale', () =>
      prisma.workingGroup.deleteMany({ where: { id: { in: wgIds } } }),
    );
    console.log(
      `🧹 Removed ${staleGroups.length} stale WG(s) with ${stdIds.length} standards, ${mtIds.length} meetings`,
    );
  }

  /* ── WGs + memberships ─────────────────────────────────────────────── */
  let wgOk = 0;
  let wgFail = 0;
  for (const wg of WORKING_GROUPS) {
    try {
      const upserted = await prisma.workingGroup.upsert({
        where: { code: wg.code },
        update: {
          name: wg.name,
          description: wg.description,
          color: wg.color,
          isArchived: false,
        },
        create: {
          code: wg.code,
          name: wg.name,
          description: wg.description,
          color: wg.color,
        },
      });

      // Wipe existing memberships to make seed authoritative
      await prisma.workingGroupMember.deleteMany({ where: { workingGroupId: upserted.id } });

      const seenUserIds = new Set<string>();
      const addMember = async (email: string, role: WorkingGroupRole) => {
        const uid = usersById[email];
        if (!uid) {
          console.warn(`⚠️ Missing user ${email} for ${wg.code}`);
          return;
        }
        if (seenUserIds.has(uid)) return; // can't have same person twice in one WG
        seenUserIds.add(uid);
        await prisma.workingGroupMember.create({
          data: { workingGroupId: upserted.id, userId: uid, role },
        });
      };

      await addMember(wg.leader, WorkingGroupRole.LEADER);
      if (wg.deputy) await addMember(wg.deputy, WorkingGroupRole.DEPUTY);
      await addMember(wg.secretary, WorkingGroupRole.SECRETARY);
      for (const m of wg.members) await addMember(m, WorkingGroupRole.MEMBER);

      console.log(`✅ ${wg.code}: ${seenUserIds.size} members`);
      wgOk++;
    } catch (e) {
      // Don't let one bad WG kill the whole seed — log and move on
      wgFail++;
      console.error(`❌ ${wg.code} failed:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`📊 WGs processed: ${wgOk} ok / ${wgFail} failed / ${WORKING_GROUPS.length} total`);

  /* ── Standards: Поетапний план виконання програми стандартизації 2026 ─ */
  // 12 standards from the approved plan. Items 10/11 use anonymized titles.
  // Dates are ALL 2026 per the plan header.
  const D = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d));
  interface PlanStd {
    code: string; // unique per WG
    wgCode: string;
    title: string;
    description?: string;
    techSpec: Date;
    draft: Date;
    feedback: Date;
    techReview: Date;
    final: Date;
  }
  const PLAN_STANDARDS: PlanStd[] = [
    {
      code: 'РГ1-РГ2-01',
      wgCode: 'РГ №1',
      title:
        'Захист інформації. Засоби криптографічного та технічного захисту інформації. Порядок експертних досліджень',
      description: 'Спільне з РГ №2 (технічний захист)',
      techSpec: D(5, 14),
      draft: D(6, 15),
      feedback: D(7, 31),
      techReview: D(8, 11),
      final: D(8, 31),
    },
    {
      code: 'РГ1-02',
      wgCode: 'РГ №1',
      title: 'Захист інформації. Засоби криптографічного захисту інформації. Загальні вимоги',
      techSpec: D(5, 14),
      draft: D(8, 14),
      feedback: D(9, 28),
      techReview: D(10, 12),
      final: D(10, 30),
    },
    {
      code: 'РГ1-03',
      wgCode: 'РГ №1',
      title:
        'Захист інформації. Засоби криптографічного захисту інформації. Вимоги до засобів криптографічного захисту службової інформації та інформації, що становить державну таємницю',
      techSpec: D(5, 14),
      draft: D(9, 16),
      feedback: D(10, 30),
      techReview: D(11, 13),
      final: D(11, 30),
    },
    {
      code: 'РГ2-04',
      wgCode: 'РГ №2',
      title:
        'Захист інформації. Технічний захист інформації. Класифікація методів аналізу програмного забезпечення за рівнем перевірки та методика оцінки рівня гарантій (рівня впевненості) відсутності недокументованих функцій у програмному забезпеченні',
      description: 'Підгрупа ТЗІ державних інформаційних ресурсів',
      techSpec: D(5, 14),
      draft: D(7, 15),
      feedback: D(8, 31),
      techReview: D(9, 11),
      final: D(9, 30),
    },
    {
      code: 'РГ2-05',
      wgCode: 'РГ №2',
      title:
        'Захист інформації. Технічний захист інформації. Порядок виконання вимог з безпеки в інформаційних, електронних комунікаційних, інформаційно-комунікаційних, технологічних системах',
      description: 'Підгрупа ТЗІ державних інформаційних ресурсів',
      techSpec: D(5, 14),
      draft: D(8, 14),
      feedback: D(9, 28),
      techReview: D(10, 12),
      final: D(10, 30),
    },
    {
      code: 'РГ2-06',
      wgCode: 'РГ №2',
      title:
        'Захист інформації. Технічний захист інформації. Захист інформації від витоку каналами побічних електромагнітних випромінювань та наведень',
      techSpec: D(6, 10),
      draft: D(8, 14),
      feedback: D(9, 28),
      techReview: D(10, 12),
      final: D(10, 30),
    },
    {
      code: 'РГ2-07',
      wgCode: 'РГ №2',
      title:
        'Захист інформації. Технічний захист інформації. Захист інформації щодо витоку мовної інформації акустоелектричними каналами',
      techSpec: D(6, 10),
      draft: D(8, 14),
      feedback: D(9, 28),
      techReview: D(10, 12),
      final: D(10, 30),
    },
    {
      code: 'РГ3-08',
      wgCode: 'РГ №3',
      title:
        'Модель зрілості організаційно-технічної спроможності команд реагування на кіберінциденти, кібератаки, кіберзагрози (CSIRT)',
      techSpec: D(5, 14),
      draft: D(7, 15),
      feedback: D(8, 31),
      techReview: D(9, 11),
      final: D(9, 30),
    },
    {
      code: 'РГ3-09',
      wgCode: 'РГ №3',
      title: 'Заходи з кіберзахисту. Загальні положення та настанови',
      techSpec: D(5, 14),
      draft: D(9, 16),
      feedback: D(10, 30),
      techReview: D(11, 13),
      final: D(11, 30),
    },
    // Items 10 and 11: anonymized per user request
    {
      code: 'РГ4-10',
      wgCode: 'РГ №4',
      title: 'Стандарт 1 РГ4',
      techSpec: D(5, 14),
      draft: D(7, 15),
      feedback: D(8, 31),
      techReview: D(9, 11),
      final: D(9, 30),
    },
    {
      code: 'РГ4-11',
      wgCode: 'РГ №4',
      title: 'Стандарт 2 РГ4',
      techSpec: D(5, 14),
      draft: D(8, 14),
      feedback: D(9, 28),
      techReview: D(10, 12),
      final: D(10, 30),
    },
    {
      code: 'РГ5-12',
      wgCode: 'РГ №5',
      title:
        'Стандартизація криптографічного та технічного захисту інформації, кіберзахисту, протидії технічним розвідкам. Процедури створення, діяльності та припинення діяльності робочих груп із стандартизації',
      description: 'У документі — РГ 9; в системі мапиться на РГ №5 (основоположні стандарти)',
      techSpec: D(5, 14),
      draft: D(8, 14),
      feedback: D(9, 28),
      techReview: D(10, 12),
      final: D(10, 30),
    },
  ];

  // Map wgCode -> id
  const wgById = await prisma.workingGroup.findMany({ select: { id: true, code: true } });
  const wgIdByCode = Object.fromEntries(wgById.map((w) => [w.code, w.id]));

  let stdOk = 0;
  let stdFail = 0;
  const today = new Date();
  for (const s of PLAN_STANDARDS) {
    try {
      const wgId = wgIdByCode[s.wgCode];
      if (!wgId) {
        console.warn(`⚠️ Skip ${s.code}: WG ${s.wgCode} not found`);
        stdFail++;
        continue;
      }
      // Determine current stage: first stage whose due date is in the future
      let stage:
        | 'TECH_SPEC'
        | 'DRAFTING'
        | 'FEEDBACK'
        | 'TECH_REVIEW'
        | 'FINALIZATION'
        | 'COMPLETED' = 'TECH_SPEC';
      if (today > s.final) stage = 'COMPLETED';
      else if (today > s.techReview) stage = 'FINALIZATION';
      else if (today > s.feedback) stage = 'TECH_REVIEW';
      else if (today > s.draft) stage = 'FEEDBACK';
      else if (today > s.techSpec) stage = 'DRAFTING';
      else stage = 'TECH_SPEC';

      await prisma.standard.upsert({
        where: { workingGroupId_code: { workingGroupId: wgId, code: s.code } },
        update: {
          title: s.title,
          description: s.description,
          deadline: s.final,
          techSpecDueDate: s.techSpec,
          draftDueDate: s.draft,
          feedbackDueDate: s.feedback,
          techReviewDueDate: s.techReview,
          finalDueDate: s.final,
          currentStage: stage,
        },
        create: {
          workingGroupId: wgId,
          code: s.code,
          title: s.title,
          description: s.description,
          deadline: s.final,
          techSpecDueDate: s.techSpec,
          draftDueDate: s.draft,
          feedbackDueDate: s.feedback,
          techReviewDueDate: s.techReview,
          finalDueDate: s.final,
          currentStage: stage,
          status: 'DRAFT',
        },
      });
      stdOk++;
    } catch (e) {
      stdFail++;
      console.error(`❌ Standard ${s.code} failed:`, e instanceof Error ? e.message : e);
    }
  }
  console.log(`📊 Standards processed: ${stdOk} ok / ${stdFail} failed`);

  console.log('🎉 Seed complete!');
  console.log('');
  console.log('Logins:');
  console.log('  admin@test.ua / Admin123!  (ADMIN)');
  console.log('  <prenom>.<nom>@dssszzi.ua / User123!  (all WG members)');
  console.log('  e.g. kyrylo.guliaiev@dssszzi.ua, dmytro.bondarenko@dssszzi.ua');
}

main()
  .catch((e) => {
    // CRITICAL: do NOT exit non-zero — that would abort Railway deploy and
    // leave the previous image serving. Better to log loudly and let the app
    // boot, then surface the issue via /api/version or logs.
    console.error('🚨 SEED FAILED (continuing so app can boot):', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
