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
      // Cache WG memberships IN THE TOKEN — refreshed on sign-in, on an
      // explicit session.update(), or once if the token has none yet. The
      // `session` callback below then needs NO database access, so the
      // /api/auth/session revalidation (run by the client on focus/mount) is
      // a pure JWT decode. Previously memberships were loaded in `session` on
      // every revalidation; a DB hiccup could hang that request, the client
      // session would resolve to null, and the user lost all rights (admins
      // included, since globalRole then read as undefined). On a DB failure
      // here we keep the last-known memberships rather than wiping them.
      if (token.id && (Boolean(user) || trigger === 'update' || token.memberships === undefined)) {
        try {
          token.memberships = await db.workingGroupMember.findMany({
            where: { userId: token.id },
            select: {
              workingGroupId: true,
              role: true,
              workingGroup: { select: { code: true, color: true } },
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
          console.warn('[auth.jwt] memberships load failed (DB down?):', msg);
          token.memberships = token.memberships ?? [];
        }
      }
      return token;
    },
    session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.globalRole = token.globalRole;
        session.user.memberships = token.memberships ?? [];
      }
      return session;
    },
  },
};
