/**
 * Convert an uploaded .docx into HTML compatible with the TipTap schema
 * used by the document body editor.
 *
 * Why a dedicated endpoint (not a tRPC mutation):
 *   - tRPC's transport layer wraps everything in JSON, so binary uploads
 *     need to be base64'd or chunked. A plain multipart route is simpler
 *     and matches the pattern already used by /api/standards/[id]/documents.
 *
 * Why convert-only (no DB write):
 *   - The client already has a `suggestion.updateBody` mutation that
 *     does the permission check, writes the body, and logs activity.
 *     Keeping this endpoint as a pure converter avoids duplicating that
 *     code path and lets us show a preview / let the user tweak before
 *     committing if we ever want that.
 *
 * Conversion: mammoth maps DOCX semantics to clean HTML tags
 *   (h1-h6, p, ul/ol/li, strong, em, u, a, table/tr/td/th, blockquote, pre).
 *   That set is a strict subset of what our TipTap schema accepts, so the
 *   editor renders it without surprises. Images and footnotes are dropped
 *   to keep the body lightweight; we can revisit if users ask for them.
 *
 * Permission: same as bulk body edit — only roles with `standard:editMeta`
 * may import (LEADER / DEPUTY / SECRETARY / ADMIN).
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/server/auth';
import { db } from '@/server/db';
import { can } from '@/lib/rbac';
import { docxBufferToHtml } from '@/lib/docxToHtml';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// .docx is a zipped XML bundle — even very large documents rarely exceed
// 10 MB once compressed. Cap defensively to avoid OOMing the worker.
const MAX_BYTES = 15 * 1024 * 1024;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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
  if (!can(userCtx, 'standard:editMeta', standard.workingGroupId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Файл порожній' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Файл понад 15 МБ' }, { status: 400 });
  }
  // Some OSes / browsers don't reliably set the docx MIME, so also accept
  // a missing/octet-stream type as long as the filename looks right.
  const looksLikeDocx = file.name.toLowerCase().endsWith('.docx');
  if (!looksLikeDocx && file.type !== DOCX_MIME) {
    return NextResponse.json(
      { error: 'Підтримуються лише файли .docx (Microsoft Word 2007+)' },
      { status: 400 },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Shared converter — keeps alignment / headings / lists / inline marks
  // intact. See src/lib/docxToHtml.ts for the style-map plumbing.
  let html: string;
  let warnings: string[] = [];
  try {
    const result = await docxBufferToHtml(buffer);
    html = result.html;
    warnings = result.warnings;
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Не вдалося конвертувати документ',
        detail: e instanceof Error ? e.message : 'unknown',
      },
      { status: 422 },
    );
  }

  if (!html.trim()) {
    return NextResponse.json({ error: 'Документ не містить тексту' }, { status: 422 });
  }

  return NextResponse.json({
    html,
    warnings: warnings.slice(0, 10),
    filename: file.name,
    sizeBytes: buffer.length,
  });
}
