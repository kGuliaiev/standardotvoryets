import { type NextAuthOptions, type DefaultSession } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import { db } from '@/server/db';

// ─── Type augmentations ───────────────────────────────────────────────────────

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string;
      globalRole: string;
      memberships: {
        workingGroupId: string;
        role: string;
        workingGroup: { code: string; color: string };
      }[];
    } & DefaultSession['user'];
  }
  interface User {
    globalRole: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    globalRole: string;
    memberships?: {
      workingGroupId: string;
      role: string;
      workingGroup: { code: string; color: string };
    }[];
  }
}

// ─── Auth options ─────────────────────────────────────────────────────────────

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db) as NextAuthOptions['adapter'],
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user) return null;

        const isPasswordValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isPasswordValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatarUrl,
          globalRole: user.globalRole,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.globalRole = user.globalRole;
      }
      // Cache globalRole + memberships in the token as a FALLBACK for when the
      // DB is unreachable in the `session` callback. Refreshed on sign-in, on
      // an explicit session.update(), or the first time the token lacks them.
      if (token.id && (Boolean(user) || trigger === 'update' || token.memberships === undefined)) {
        try {
          const [dbUser, memberships] = await Promise.all([
            db.user.findUnique({ where: { id: token.id }, select: { globalRole: true } }),
            db.workingGroupMember.findMany({
              where: { userId: token.id },
              select: {
                workingGroupId: true,
                role: true,
                workingGroup: { select: { code: true, color: true } },
              },
            }),
          ]);
          if (dbUser) token.globalRole = dbUser.globalRole;
          token.memberships = memberships;
        } catch (e) {
          const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
          console.warn('[auth.jwt] refresh failed (DB down?):', msg);
          token.memberships = token.memberships ?? [];
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (!token) return session;
      // Token values are the fallback (used if the DB read below fails).
      session.user.id = token.id;
      session.user.globalRole = token.globalRole;
      session.user.memberships = token.memberships ?? [];

      // Refresh globalRole + memberships from the DB so role/membership
      // changes take effect on the next page load (without forcing re-login).
      // This is safe now that the client no longer revalidates on focus (see
      // SessionWrapper) — the previous focus-refetch + DB-call combo was what
      // intermittently nulled the session and stripped rights. On a DB outage
      // we keep the token fallback above rather than wiping anything.
      try {
        const [dbUser, memberships] = await Promise.all([
          db.user.findUnique({ where: { id: token.id }, select: { globalRole: true } }),
          db.workingGroupMember.findMany({
            where: { userId: token.id },
            select: {
              workingGroupId: true,
              role: true,
              workingGroup: { select: { code: true, color: true } },
            },
          }),
        ]);
        if (dbUser) session.user.globalRole = dbUser.globalRole;
        session.user.memberships = memberships;
      } catch (e) {
        const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
        console.warn('[auth.session] refresh failed (DB down?):', msg);
      }
      return session;
    },
  },
};
