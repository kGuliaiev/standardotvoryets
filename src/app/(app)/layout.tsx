import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/server/auth';
import { Shell } from '@/components/layout/Shell';
import { TRPCProvider } from '@/lib/trpc/provider';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  return (
    <TRPCProvider>
      <Shell session={session}>{children}</Shell>
    </TRPCProvider>
  );
}
