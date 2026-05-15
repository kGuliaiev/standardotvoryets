import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/server/auth';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  // If already authenticated, redirect to dashboard
  if (session) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      {children}
    </div>
  );
}
