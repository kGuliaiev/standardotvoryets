import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
(async () => {
  const wg = await db.workingGroup.findFirst({
    where: { OR: [{ code: 'РГ №4' }, { code: 'РГ №4 ' }, { code: { contains: '№4' } }] },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              rank: true,
              position: true,
              isActive: true,
            },
          },
        },
        orderBy: { role: 'asc' },
      },
    },
  });
  console.log(JSON.stringify(wg, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
