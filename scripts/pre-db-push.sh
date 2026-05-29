#!/usr/bin/env sh
# Idempotent pre-`prisma db push` migration. Called from the runner
# image CMD before `prisma db push` so that destructive enum changes
# (rename / drop) don't choke on existing rows.
#
# Exits 0 on success or skip; never blocks startup. On error, logs to
# stderr but still returns 0 — the subsequent `prisma db push` will
# surface schema issues clearly enough.
#
# Required env: DATABASE_URL (Railway provides automatically).

set -e

if [ -z "$DATABASE_URL" ]; then
  echo "[pre-db-push] DATABASE_URL not set — skipping" >&2
  exit 0
fi

# Skip on a fresh DB: if the DocumentType enum doesn't exist yet, the
# upcoming `prisma db push` will create it with the new values directly,
# no migration needed.
HAS_ENUM=$(psql "$DATABASE_URL" -tA -c "SELECT 1 FROM pg_type WHERE typname = 'DocumentType'" 2>/dev/null || echo "")
if [ -z "$HAS_ENUM" ]; then
  echo "[pre-db-push] DocumentType enum not present — fresh DB, skipping migration"
  exit 0
fi

echo "[pre-db-push] Migrating DocumentType enum values…"
# `|| true` swallows errors so a broken migration script can't keep the
# whole service offline. The bad state is loud in the logs.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/pre-db-push.sql || {
  echo "[pre-db-push] Migration script failed — proceeding anyway, see error above" >&2
  exit 0
}
echo "[pre-db-push] Done."
