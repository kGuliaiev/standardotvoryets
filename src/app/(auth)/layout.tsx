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
    // Theme-aware gradient. Root layout's bootstrap script already sets the
    // `dark` class on <html> from localStorage / prefers-color-scheme before
    // hydration, so the Tailwind dark: variants kick in immediately (D-1).
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-blue-50 via-white to-blue-50 dark:from-slate-900 dark:via-blue-950 dark:to-slate-900">
      {children}
    </div>
  );
}
