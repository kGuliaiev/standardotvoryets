import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/server/auth';
import { Shell } from '@/components/layout/Shell';
import { TRPCProvider } from '@/lib/trpc/provider';
import { SessionWrapper } from '@/components/providers/SessionWrapper';
import { PermissionsBootstrap } from '@/components/providers/PermissionsBootstrap';
import { menuVisForUser, overridesForUser } from '@/server/landing';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  // Resolve menu visibility + permission overrides server-side. Both are
  // seeded into client queries so the first paint is already role-correct:
  //  • menu: no full-menu → role-menu flicker;
  //  • overrides: client-side can() applies DB grants (e.g. the «Керівництво
  //    центру» column) from the first render.
  const [initialMenuVis, initialOverrides] = await Promise.all([
    menuVisForUser(session.user),
    overridesForUser(session.user),
  ]);

  return (
    <SessionWrapper session={session}>
      <TRPCProvider>
        <PermissionsBootstrap initialOverrides={initialOverrides} />
        <Shell session={session} initialMenuVis={initialMenuVis}>
          {children}
        </Shell>
      </TRPCProvider>
    </SessionWrapper>
  );
}
