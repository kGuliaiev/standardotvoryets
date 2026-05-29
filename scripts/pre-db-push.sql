-- ─────────────────────────────────────────────────────────────────────
-- Pre-`prisma db push` enum migration. Runs on every Railway boot
-- (via scripts/pre-db-push.sh), idempotent, safe to re-run.
--
-- Why this script exists:
--   `prisma db push --accept-data-loss` will DROP enum values that no
--   longer appear in schema.prisma. Postgres refuses to drop an enum
--   value while any row still uses it (or even silently keeps it on
--   some versions). We migrate the affected rows here FIRST, then let
--   Prisma do its drop/recreate.
--
-- Changes covered:
--   1. DocumentType.DRAFT_STANDARD → STANDARD (rename; preserves rows)
--   2. DocumentType.FINAL → ATTACHMENT (semantic loss; file preserved)
--
-- Each statement is its own implicit transaction (psql autocommit), so
-- the new enum value committed in step 1 is visible to step 2.
-- ─────────────────────────────────────────────────────────────────────

-- 1. Add the new STANDARD value if it isn't already there. IF NOT EXISTS
--    on ALTER TYPE ADD VALUE requires PG 9.6+; Railway is on 18.x so we
--    are well above the floor.
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'STANDARD';

-- 2. Migrate rows. `type::text` works around the case where the new
--    value isn't yet visible in this session's enum cache — comparing as
--    text bypasses the enum coercion.
UPDATE documents SET type = 'STANDARD' WHERE type::text = 'DRAFT_STANDARD';
UPDATE documents SET type = 'ATTACHMENT' WHERE type::text = 'FINAL';
