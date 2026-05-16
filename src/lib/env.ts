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
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
