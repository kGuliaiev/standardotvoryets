# syntax=docker/dockerfile:1.6
#
# Standardotvorets — production container, deploy-anywhere.
#
# Stages:
#   1. deps    — install pnpm + node_modules
#   2. build   — `pnpm prisma generate` + `pnpm build`
#   3. runner  — minimal runtime with pg_dump (for in-process backups)
#
# Build & run locally:
#   docker build -t standardotvorets .
#   docker run --rm -p 3000:3000 --env-file .env standardotvorets
#
# Deploy: works on Railway (auto-detects Dockerfile), Fly.io, Render,
# Coolify, Dokku, plain Docker host, Kubernetes. Just provide the env
# vars from .env.example.
#
# Why Debian-slim and not Alpine? Prisma's prebuilt query engines
# expect glibc + a known libssl. Alpine 3.20+ ships only libssl 3.x,
# but Prisma 5.x defaults to looking for libssl 1.1, which leads to
# noisy warnings and `Error loading shared library libssl.so.1.1`
# during `next build` page-data collection. Debian bookworm-slim has
# libssl3 + glibc out of the box and Just Works.

ARG NODE_VERSION=20-bookworm-slim

# ── deps ────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── build ───────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ── runner ──────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
# postgresql-client provides pg_dump for the in-process backup job.
# Debian-slim images don't have it preinstalled.
# Add the official PostgreSQL apt repo so pg_dump matches the production
# server's major version. Railway's managed Postgres is currently 18.x;
# pg_dump 17 or lower aborts with "server version mismatch" against a
# newer server. Update this when migrating to a different PG major.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-18 \
  && apt-get purge -y --auto-remove curl gnupg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Copy minimum runtime files
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
COPY --from=build /app/next.config.mjs ./
COPY --from=build /app/tsconfig.json ./

EXPOSE 3000

# Start command: apply schema, then start the server.
# `prisma db push --accept-data-loss` is idempotent and additive when
# schema only grows; switch to `prisma migrate deploy` once you adopt
# migrations.
CMD ["sh", "-c", "pnpm prisma db push --accept-data-loss && pnpm prisma:seed && pnpm start"]
