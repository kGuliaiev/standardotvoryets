'use client';

import { SessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';

export function SessionWrapper({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  // The SSR session (from getServerSession) already carries globalRole +
  // memberships. We deliberately DISABLE the client revalidation:
  //   • refetchOnWindowFocus — Chrome fires focus/visibilitychange very
  //     aggressively; a transient empty/failed /api/auth/session response
  //     would null the client session and momentarily strip the user's
  //     rights (admins saw edit controls vanish after load). Safari fires
  //     these far less, which is why it appeared to "work" there.
  //   • refetchInterval — no background polling for the same reason.
  // The session is a stateless JWT, so the SSR snapshot is authoritative for
  // the page's lifetime; profile changes still refresh via update().
  return (
    <SessionProvider session={session} refetchOnWindowFocus={false} refetchInterval={0}>
      {children}
    </SessionProvider>
  );
}
