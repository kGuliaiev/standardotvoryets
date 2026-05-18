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

ARG NODE_VERSION=20-alpine

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
# pg_dump (postgresql-client) is required by the in-process backup job.
# gzip is preinstalled on alpine.
RUN apk add --no-cache postgresql-client
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
