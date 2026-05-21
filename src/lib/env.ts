import { z } from 'zod';

const envSchema = z.object({
  // ── REQUIRED ────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(16),
  NEXTAUTH_URL: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional().default('http://localhost:3000'),
  NEXT_PUBLIC_APP_NAME: z.string().default('Стандартотворець'),

  // ── S3 / MinIO — optional, file upload disabled if not set ───────────────
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('eu-central-1'),
  S3_BUCKET: z.string().default('standardotvoryets'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),

  // ── Redis / BullMQ — optional, background jobs disabled if not set ───────
  REDIS_URL: z.string().optional(),

  // ── Email — optional, notifications disabled if not set ─────────────────
  EMAIL_FROM: z.string().default('noreply@example.com'),
  RESEND_API_KEY: z.string().optional(),

  // ── Cron — shared secret guards /api/cron/* against public traffic ───────
  CRON_SECRET: z.string().optional(),

  // ── Anthropic (ШІ-чернетка протоколу) — optional. If ANTHROPIC_API_KEY is
  //    unset, the AI draft feature is disabled and the UI shows "не
  //    налаштовано". ANTHROPIC_MODEL overrides the default model (e.g. set it
  //    to claude-haiku-4-5 for a cheaper run). ───────────────────────────────
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-7'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * During `next build` Next.js loads every route module to collect page
 * data — that includes routes which import `env`. The build container
 * has no DATABASE_URL / NEXTAUTH_* set, so a strict parse() at module
 * load time crashes the build.
 *
 * Detect build phase and short-circuit with a permissive shim. At
 * runtime (NEXT_PHASE !== 'phase-production-build') we run the full
 * Zod parse and fail loudly if anything is missing.
 */
function loadEnv(): Env {
  // Next.js sets NEXT_PHASE=phase-production-build during `next build` —
  // before any route module gets loaded for page-data collection. The
  // build container has no real secrets, so we feed Zod placeholders
  // that only satisfy schema shape. At runtime NEXT_PHASE is not set
  // to that value, so the strict parse runs and fails loudly if any
  // required var is missing.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return envSchema.parse({
      DATABASE_URL: 'postgresql://build:build@localhost:5432/build',
      NEXTAUTH_SECRET: 'build-placeholder-secret-not-used-at-runtime',
      NEXTAUTH_URL: 'http://localhost:3000',
      ...process.env,
    });
  }
  return envSchema.parse(process.env);
}

export const env = loadEnv();
