import { PrismaClient, GlobalRole, WorkingGroupRole, StandardStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── Admin user ──────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('Admin123!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@test.ua' },
    update: {},
    create: {
      email: 'admin@test.ua',
      name: 'Адміністратор',
      passwordHash: adminHash,
      globalRole: GlobalRole.ADMIN,
    },
  });
  console.log('✅ Admin user:', admin.email);

  // ── Extra users ─────────────────────────────────────────────────────
  const userHash = await bcrypt.hash('User123!', 12);

  const olena = await prisma.user.upsert({
    where: { email: 'olena.kovalenko@test.ua' },
    update: {},
    create: {
      email: 'olena.kovalenko@test.ua',
      name: 'Олена Коваленко',
      passwordHash: userHash,
    },
  });

  const mykola = await prisma.user.upsert({
    where: { email: 'mykola.petrenko@test.ua' },
    update: {},
    create: {
      email: 'mykola.petrenko@test.ua',
      name: 'Микола Петренко',
      passwordHash: userHash,
    },
  });

  const iryna = await prisma.user.upsert({
    where: { email: 'iryna.savchenko@test.ua' },
    update: {},
    create: {
      email: 'iryna.savchenko@test.ua',
      name: 'Ірина Савченко',
      passwordHash: userHash,
    },
  });

  const dmytro = await prisma.user.upsert({
    where: { email: 'dmytro.bondarenko@test.ua' },
    update: {},
    create: {
      email: 'dmytro.bondarenko@test.ua',
      name: 'Дмитро Бондаренко',
      passwordHash: userHash,
    },
  });

  const natalia = await prisma.user.upsert({
    where: { email: 'natalia.moroz@test.ua' },
    update: {},
    create: {
      email: 'natalia.moroz@test.ua',
      name: 'Наталія Мороз',
      passwordHash: userHash,
    },
  });

  const vasyl = await prisma.user.upsert({
    where: { email: 'vasyl.shevchenko@test.ua' },
    update: {},
    create: {
      email: 'vasyl.shevchenko@test.ua',
      name: 'Василь Шевченко',
      passwordHash: userHash,
    },
  });

  console.log('✅ Users created');

  // ── Working Groups ───────────────────────────────────────────────────
  const wg8 = await prisma.workingGroup.upsert({
    where: { code: 'РГ №8' },
    update: {},
    create: {
      code: 'РГ №8',
      name: 'Управління якістю та стандартизація',
      description: 'Робоча група з розробки стандартів управління якістю',
      color: '#1A56DB',
    },
  });

  const wg4 = await prisma.workingGroup.upsert({
    where: { code: 'РГ №4' },
    update: {},
    create: {
      code: 'РГ №4',
      name: 'Інформаційні технології та безпека',
      description: 'Розробка стандартів у сфері ІТ та кібербезпеки',
      color: '#6D28D9',
    },
  });

  const wg12 = await prisma.workingGroup.upsert({
    where: { code: 'РГ №12' },
    update: {},
    create: {
      code: 'РГ №12',
      name: 'Будівництво та архітектура',
      description: 'Стандарти у сфері будівництва та проектування',
      color: '#059669',
    },
  });

  console.log('✅ Working groups created');

  // ── Members for РГ №8 ────────────────────────────────────────────────
  await prisma.workingGroupMember.upsert({
    where: { workingGroupId_userId: { workingGroupId: wg8.id, userId: olena.id } },
    update: {},
    create: { workingGroupId: wg8.id, userId: olena.id, role: WorkingGroupRole.LEADER },
  });
  await prisma.workingGroupMember.upsert({
    where: { workingGroupId_userId: { workingGroupId: wg8.id, userId: mykola.id } },
    update: {},
    create: { workingGroupId: wg8.id, userId: mykola.id, role: WorkingGroupRole.SECRETARY },
  });
  await prisma.workingGroupMember.upsert({
    where: { workingGroupId_userId: { workingGroupId: wg8.id, userId: iryna.id } },
    update: {},
    create: { workingGroupId: wg8.id, userId: iryna.id, role: WorkingGroupRole.MEMBER },
  });

  // ── Members for РГ №4 ────────────────────────────────────────────────
  await prisma.workingGroupMember.upsert({
    where: { workingGroupId_userId: { workingGroupId: wg4.id, userId: dmytro.id } },
    update: {},
    create: { workingGroupId: wg4.id, userId: dmytro.id, role: WorkingGroupRole.LEADER },
  });
  await prisma.workingGroupMember.upsert({
    where: { workingGroupId_userId: { workingGroupId: wg4.id, userId: natalia.id } },
    update: {},
    create: { workingGroupId: wg4.id, userId: natalia.id, role: WorkingGroupRole.DEPUTY },
  });

  // ── Members for РГ №12 ───────────────────────────────────────────────
  await prisma.workingGroupMember.upsert({
    where: { workingGroupId_userId: { workingGroupId: wg12.id, userId: vasyl.id } },
    update: {},
    create: { workingGroupId: wg12.id, userId: vasyl.id, role: WorkingGroupRole.LEADER },
  });
  await prisma.workingGroupMember.upsert({
    where: { workingGroupId_userId: { workingGroupId: wg12.id, userId: iryna.id } },
    update: {},
    create: { workingGroupId: wg12.id, userId: iryna.id, role: WorkingGroupRole.MEMBER },
  });

  console.log('✅ Members assigned');

  // ── Standards for РГ №8 ──────────────────────────────────────────────
  await prisma.standard.upsert({
    where: { workingGroupId_code: { workingGroupId: wg8.id, code: 'ДСТУ 7.1' } },
    update: {},
    create: {
      workingGroupId: wg8.id,
      code: 'ДСТУ 7.1',
      title: 'Вимоги до документації систем управління якістю',
      description: 'Стандарт встановлює вимоги до документації систем управління якістю підприємств',
      status: StandardStatus.DRAFT,
      isoAnalog: 'ISO 9001:2015',
      category: 'Управління якістю',
      responsibleId: olena.id,
      progress: 35,
    },
  });

  await prisma.standard.upsert({
    where: { workingGroupId_code: { workingGroupId: wg8.id, code: 'ДСТУ 4.5' } },
    update: {},
    create: {
      workingGroupId: wg8.id,
      code: 'ДСТУ 4.5',
      title: 'Методи аудиту систем управління якістю',
      status: StandardStatus.IN_REVIEW,
      isoAnalog: 'ISO 19011:2018',
      category: 'Управління якістю',
      responsibleId: olena.id,
      progress: 70,
    },
  });

  // ── Standards for РГ №4 ──────────────────────────────────────────────
  await prisma.standard.upsert({
    where: { workingGroupId_code: { workingGroupId: wg4.id, code: 'ДСТУ 3.2' } },
    update: {},
    create: {
      workingGroupId: wg4.id,
      code: 'ДСТУ 3.2',
      title: 'Вимоги до інформаційної безпеки критичної інфраструктури',
      status: StandardStatus.DRAFT,
      isoAnalog: 'ISO/IEC 27001:2022',
      category: 'Інформаційна безпека',
      responsibleId: dmytro.id,
      progress: 20,
    },
  });

  await prisma.standard.upsert({
    where: { workingGroupId_code: { workingGroupId: wg4.id, code: 'ДСТУ 5.1' } },
    update: {},
    create: {
      workingGroupId: wg4.id,
      code: 'ДСТУ 5.1',
      title: 'Класифікація та кодування програмного забезпечення',
      status: StandardStatus.DRAFT,
      category: 'Програмне забезпечення',
      responsibleId: natalia.id,
      progress: 10,
    },
  });

  // ── Standards for РГ №12 ─────────────────────────────────────────────
  await prisma.standard.upsert({
    where: { workingGroupId_code: { workingGroupId: wg12.id, code: 'ДСТУ Б 2.3' } },
    update: {},
    create: {
      workingGroupId: wg12.id,
      code: 'ДСТУ Б 2.3',
      title: 'Конструкції будинків і споруд. Загальні вимоги',
      status: StandardStatus.DRAFT,
      category: 'Будівельні конструкції',
      responsibleId: vasyl.id,
      progress: 15,
    },
  });

  await prisma.standard.upsert({
    where: { workingGroupId_code: { workingGroupId: wg12.id, code: 'ДСТУ Б В.2.7' } },
    update: {},
    create: {
      workingGroupId: wg12.id,
      code: 'ДСТУ Б В.2.7',
      title: 'Будівельні матеріали. Класифікація та методи випробувань',
      status: StandardStatus.IN_REVIEW,
      category: 'Будівельні матеріали',
      responsibleId: vasyl.id,
      progress: 55,
    },
  });

  console.log('✅ Standards created');
  console.log('');
  console.log('🎉 Seed complete!');
  console.log('');
  console.log('Test credentials:');
  console.log('  admin@test.ua         / Admin123!  (ADMIN)');
  console.log('  olena.kovalenko@test.ua / User123! (LEADER РГ №8)');
  console.log('  mykola.petrenko@test.ua / User123! (SECRETARY РГ №8)');
  console.log('  dmytro.bondarenko@test.ua / User123! (LEADER РГ №4)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
