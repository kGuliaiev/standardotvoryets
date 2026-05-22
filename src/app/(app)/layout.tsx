import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/server/auth';
import { Shell } from '@/components/layout/Shell';
import { TRPCProvider } from '@/lib/trpc/provider';
import { SessionWrapper } from '@/components/providers/SessionWrapper';
import { menuVisForUser } from '@/server/landing';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  // Resolve menu visibility server-side and hand it to the Sidebar as its
  // query initial data, so the menu is correct on the first paint (no
  // full-menu → role-menu flicker while permission.menuForMe loads).
  const initialMenuVis = await menuVisForUser(session.user);

  return (
    <SessionWrapper session={session}>
      <TRPCProvider>
        <Shell session={session} initialMenuVis={initialMenuVis}>
          {children}
        </Shell>
      </TRPCProvider>
    </SessionWrapper>
  );
}
