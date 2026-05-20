import { signOut } from 'next-auth/react';

/**
 * Full sign-out: wipe all client-side state (localStorage + sessionStorage —
 * cached filters, last-visit timestamps, draft data, etc.) and clear the
 * NextAuth session, then land on /login. The session is a stateless JWT, so
 * dropping the cookie via signOut is the authoritative server-side logout;
 * clearing storage guarantees no residual user data is left on the device.
 */
export async function fullLogout(): Promise<void> {
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // storage may be unavailable (private mode) — ignore and still sign out
  }
  await signOut({ callbackUrl: '/login' });
}
