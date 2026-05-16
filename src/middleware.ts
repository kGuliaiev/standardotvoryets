import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;

    // Admin routes require ADMIN global role
    if (pathname.startsWith('/admin')) {
      const token = req.nextauth.token;
      if (token?.globalRole !== 'ADMIN') {
        return NextResponse.redirect(new URL('/dashboard', req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: '/login',
    },
  },
);

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - api/auth (NextAuth routes)
     * - api/health (health check)
     * - _next/static, _next/image, favicon.ico
     * - login, invite pages (public auth pages)
     */
    '/((?!api/auth|api/health|api/version|api/cron|_next/static|_next/image|favicon.ico|login|invite).*)',
  ],
};
