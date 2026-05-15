import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from '@/lib/env';

// Detect Railway-hosted bucket (virtual-hosted style) vs MinIO (path style).
// Railway uses *.storageapi.dev which requires virtual-hosted URLs.
const isRailwayBucket = env.S3_ENDPOINT?.includes('storageapi.dev') ?? false;

export const s3 = new S3Client({
  region: env.S3_REGION,
  ...(env.S3_ENDPOINT
    ? {
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: !isRailwayBucket, // MinIO needs path-style; Railway needs virtual-hosted
      }
    : {}),
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});

/**
 * Generate a presigned URL for uploading a file to S3/MinIO.
 * Client uploads directly to S3 — never through the Next.js server.
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

/**
 * Generate a presigned URL for downloading a file from S3/MinIO.
 * URL expires in 15 minutes.
 */
export async function getPresignedDownloadUrl(
  key: string,
  expiresInSeconds = 900,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
  });

  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}
