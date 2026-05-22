import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth';
import { landingPathForUser } from '@/server/landing';

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');
  // Land on the first section the user may actually see (skips «Дашборд» if
  // it's hidden for their role in /admin/permissions).
  redirect(await landingPathForUser(session.user));
}
