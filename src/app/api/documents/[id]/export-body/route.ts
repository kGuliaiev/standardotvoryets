/**
 * Stream a Document's collaboratively-edited body (TipTap HTML) as a
 * .docx download. Mirror of /api/standards/[id]/export-body but for
 * the per-document editor flow.
 *
 * Permission: any user with read access to the parent standard's
 * working group can download.
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

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const doc = await db.document.findUnique({
    where: { id: params.id },
    select: {
      filename: true,
      bodyHtml: true,
      allowEdits: true,
      standard: { select: { workingGroupId: true, code: true, title: true } },
    },
  });
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

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
    userCtx.memberships.some((m) => m.workingGroupId === doc.standard.workingGroupId);
  if (!canRead) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!doc.allowEdits || !doc.bodyHtml) {
    return NextResponse.json({ error: 'Документ не має тіла для редагування' }, { status: 422 });
  }

  const html = normalizeBodyHtml(doc.bodyHtml);
  if (!html.trim()) {
    return NextResponse.json({ error: 'Текст документа порожній' }, { status: 422 });
  }

  const headerTitle = doc.filename.replace(/\.[^.]+$/, ''); // drop extension
  const built = htmlBodyToDocx(html, headerTitle);
  const buffer = await Packer.toBuffer(built);

  const filenameBase = slugify(headerTitle) || 'document';
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
