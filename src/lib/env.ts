import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(16),
  NEXTAUTH_URL: z.string().url(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string(),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  REDIS_URL: z.string().url(),
  EMAIL_FROM: z.string().email(),
  RESEND_API_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_APP_NAME: z.string().default('Стандартотворець'),
});

export const env = envSchema.parse(process.env);

export type Env = z.infer<typeof envSchema>;
