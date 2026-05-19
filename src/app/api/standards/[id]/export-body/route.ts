/**
 * Stream the standard's body (TipTap HTML) as a .docx download.
 *
 * Permission: any user with read access to the standard's working group.
 * (If you can view it in the app, you can export it. Tighter rules would
 * encourage screenshots, which defeats the purpose.)
 *
 * Filename: built from `code` (e.g. ВСТ 01.043.001) + a slugified title
 * so the user gets a meaningful name out of the browser save dialog.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Packer } from 'docx';
import { authOptions } from '@/server/auth';
import { db } from '@/server/db';
import { normalizeBodyHtml } from '@/lib/standardBody';
import { htmlBodyToDocx } from '@/lib/htmlToDocx';
import type { GlobalRole, WorkingGroupRole } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9а-яА-ЯіїєґІЇЄҐ\s.-]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const standard = await db.standard.findUnique({
    where: { id: params.id },
    select: {
      workingGroupId: true,
      title: true,
      code: true,
      bodyText: true,
    },
  });
  if (!standard) {
    return NextResponse.json({ error: 'Standard not found' }, { status: 404 });
  }

  // Read access: ADMIN, DIRECTOR, or any member of the standard's WG.
  const userCtx = {
    globalRole: session.user.globalRole as GlobalRole,
    memberships: (session.user.memberships ?? []) as {
      workingGroupId: string;
      role: WorkingGroupRole;
    }[],
  };
  const canRead =
    userCtx.globalRole === 'ADMIN' ||
    userCtx.globalRole === 'DIRECTOR' ||
    userCtx.memberships.some((m) => m.workingGroupId === standard.workingGroupId);
  if (!canRead) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // When ?documentId=… is present we export THAT document's bodyHtml
  // instead of the standard body. Used by the documents tab to let
  // users download a .docx generated from an editor-only document
  // (one that was created empty, no S3 object behind it).
  const url = new URL(req.url);
  const documentId = url.searchParams.get('documentId');
  const customFilename = url.searchParams.get('filename');

  let html: string;
  let headerTitle: string;
  let filenameBase: string;

  if (documentId) {
    const doc = await db.document.findUnique({
      where: { id: documentId },
      select: { standardId: true, filename: true, bodyHtml: true },
    });
    if (doc?.standardId !== params.id) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    html = normalizeBodyHtml(doc.bodyHtml);
    headerTitle = doc.filename.replace(/\.docx$/i, '');
    filenameBase = slugify(customFilename ?? headerTitle) || 'document';
  } else {
    html = normalizeBodyHtml(standard.bodyText);
    headerTitle = standard.code ? `${standard.code} ${standard.title}`.trim() : standard.title;
    filenameBase = slugify(headerTitle) || 'standard';
  }

  if (!html.trim()) {
    return NextResponse.json({ error: 'Текст документа порожній' }, { status: 422 });
  }

  const doc = htmlBodyToDocx(html, headerTitle);
  const buffer = await Packer.toBuffer(doc);
  // RFC 5987 filename* lets us safely send Cyrillic characters.
  const dispositionAscii = `${filenameBase.replace(/[^\x20-\x7E]/g, '_')}.docx`;
  const dispositionUtf8 = encodeURIComponent(`${filenameBase}.docx`);

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${dispositionAscii}"; filename*=UTF-8''${dispositionUtf8}`,
      'Cache-Control': 'no-store',
    },
  });
}
