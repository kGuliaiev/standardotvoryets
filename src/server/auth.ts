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
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.globalRole = user.globalRole;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id;
        session.user.globalRole = token.globalRole;

        // Load memberships for RBAC. Wrapped in try/catch so a DB
        // outage doesn't throw a JWT_SESSION_ERROR (which floods the
        // logs with a full Prisma stack on every page load and breaks
        // the session). During an outage we degrade gracefully:
        // return the session with empty memberships; the next refresh
        // re-populates them once the DB is back.
        try {
          const memberships = await db.workingGroupMember.findMany({
            where: { userId: token.id },
            select: {
              workingGroupId: true,
              role: true,
              workingGroup: { select: { code: true, color: true } },
            },
          });
          session.user.memberships = memberships;
        } catch (e) {
          const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
          console.warn('[auth.session] memberships load failed (DB down?):', msg);
          session.user.memberships = [];
        }
      }
      return session;
    },
  },
};
