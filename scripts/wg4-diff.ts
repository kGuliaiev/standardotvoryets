import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

const surnames = ['КАЧУР', 'СІВАК', 'РОЗУМНИЙ', 'ЗАЙКІН', 'БОРОВКОВ'];

(async () => {
  for (const s of surnames) {
    const users = await db.user.findMany({
      where: { name: { contains: s, mode: 'insensitive' } },
      select: {
        id: true,
        name: true,
        email: true,
        rank: true,
        position: true,
        organization: true,
        isActive: true,
        memberships: {
          select: { role: true, workingGroup: { select: { code: true } } },
        },
      },
    });
    console.log(`\n=== ${s} ===`);
    if (users.length === 0) console.log('  NOT FOUND');
    else users.forEach((u) => console.log('  ', JSON.stringify(u)));
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
