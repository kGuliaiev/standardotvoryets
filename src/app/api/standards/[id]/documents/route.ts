/**
 * Server-side proxy upload for documents.
 *
 * Why proxy instead of direct browser→S3 presigned upload:
 *   - Direct upload requires the bucket to have permissive CORS rules
 *     for the app origin. T3/Railway storage and most managed S3
 *     buckets don't set this by default, leading to "Failed to fetch"
 *     errors that look like client bugs.
 *   - Proxy uses the existing same-origin auth (NextAuth cookie) so
 *     no extra config needed. Bandwidth penalty is negligible for
 *     documents capped at 25MB.
 *
 * Flow:
 *   POST /api/standards/[id]/documents  (multipart/form-data)
 *     fields: file, type, version, isCurrent, note?
 *   → stream file to S3
 *   → create Document row
 *   → return { id, filename, ... }
 *
 * Permission: any user with document:upload on the standard's WG.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { authOptions } from '@/server/auth';
import { db } from '@/server/db';
import { s3 } from '@/server/s3';
import { env } from '@/lib/env';
import { can } from '@/lib/rbac';
import { logActivity } from '@/server/audit';
import { docxBufferToHtml } from '@/lib/docxToHtml';
import type { GlobalRole, WorkingGroupRole, DocumentType } from '@prisma/client';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Allow larger uploads (default Next.js body limit on routes is fine here
// because we read as FormData, not JSON). Cap at 25 MB to match the modal.
export const maxDuration = 60;

const ALLOWED_TYPES: DocumentType[] = [
  'DRAFT_STANDARD',
  'TECH_SPEC',
  'FEEDBACK',
  'MEETING_MINUTES',
  'AGENDA',
  'ATTACHMENT',
  'FINAL',
];

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const standard = await db.standard.findUnique({
    where: { id: params.id },
    select: { workingGroupId: true },
  });
  if (!standard) {
    return NextResponse.json({ error: 'Standard not found' }, { status: 404 });
  }

  const userCtx = {
    globalRole: session.user.globalRole as GlobalRole,
    memberships: (session.user.memberships ?? []) as {
      workingGroupId: string;
      role: WorkingGroupRole;
    }[],
  };
  if (!can(userCtx, 'document:upload', standard.workingGroupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = form.get('file');
  const type = form.get('type');
  const version = form.get('version');
  const isCurrentRaw = form.get('isCurrent');
  const note = form.get('note');
  const allowEditsRaw = form.get('allowEdits');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Файл порожній' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Файл понад 25 МБ' }, { status: 400 });
  }
  if (typeof type !== 'string' || !ALLOWED_TYPES.includes(type as DocumentType)) {
    return NextResponse.json({ error: 'Невідомий тип документа' }, { status: 400 });
  }
  if (typeof version !== 'string' || version.trim().length === 0) {
    return NextResponse.json({ error: 'Введіть версію' }, { status: 400 });
  }
  const isCurrent = isCurrentRaw === 'true' || isCurrentRaw === '1';
  const allowEditsRequested = allowEditsRaw === 'true' || allowEditsRaw === '1';
  const noteStr = typeof note === 'string' && note.trim().length > 0 ? note.trim() : undefined;

  // Convert .docx → HTML for collaborative editing if the uploader
  // ticked the box. Anything else (PDF, XLSX, ODT) can't be inlined as
  // TipTap content, so we ignore the flag and tell mammoth to skip.
  // Uses the same shared converter as the standalone import-body
  // endpoint, so headings/lists/alignment all round-trip identically.
  const isDocx = file.name.toLowerCase().endsWith('.docx') || file.type === DOCX_MIME;
  const shouldExtractBody = allowEditsRequested && isDocx;
  let bodyHtml: string | null = null;
  if (shouldExtractBody) {
    try {
      const ab = await file.arrayBuffer();
      const buf = Buffer.from(ab);
      const result = await docxBufferToHtml(buf);
      bodyHtml = result.html.trim().length > 0 ? result.html : null;
    } catch {
      // If the conversion fails, keep allowEdits flag false rather than
      // refuse the upload — the file itself is still useful as a
      // download-only attachment.
      bodyHtml = null;
    }
  }
  const allowEdits = shouldExtractBody && Boolean(bodyHtml);

  const safeName = file.name.replace(/[^\w.\-(),Ѐ-ӿ]+/g, '_');
  const s3Key = `standards/${params.id}/${Date.now()}-${safeName}`;

  // Stream file to S3
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: s3Key,
        Body: buffer,
        ContentType: file.type || 'application/octet-stream',
        ContentLength: buffer.length,
      }),
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: 'S3 upload failed',
        detail: e instanceof Error ? e.message : 'unknown',
      },
      { status: 502 },
    );
  }

  // If marking as current, unset any previous current
  if (isCurrent) {
    await db.document.updateMany({
      where: { standardId: params.id, isCurrent: true },
      data: { isCurrent: false },
    });
  }

  const created = await db.document.create({
    data: {
      standardId: params.id,
      uploadedById: session.user.id,
      type: type as DocumentType,
      filename: file.name,
      s3Key,
      sizeBytes: buffer.length,
      version: version.trim(),
      note: noteStr,
      isCurrent,
      allowEdits,
      bodyHtml,
      bodyUpdatedAt: allowEdits ? new Date() : null,
      bodyUpdatedById: allowEdits ? session.user.id : null,
    },
  });

  await logActivity(db, {
    userId: session.user.id,
    action: 'CREATE',
    entity: 'Document',
    entityId: created.id,
    after: created,
    note: `Завантажено документ: ${created.filename}`,
  });

  return NextResponse.json(created);
}
