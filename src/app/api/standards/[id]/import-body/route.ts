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
import mammoth from 'mammoth';
import { authOptions } from '@/server/auth';
import { db } from '@/server/db';
import { can } from '@/lib/rbac';
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

  // mammoth's default style map covers the common cases (headings, lists,
  // bold/italic, links, tables). We pass `ignoreEmptyParagraphs: false`
  // so empty paragraphs in the source still create separate TipTap blocks
  // — that preserves the author's visual rhythm.
  //
  // Paragraph alignment isn't in mammoth's default output (the library was
  // designed around semantic style maps, not direct formatting). The
  // workaround:
  //   1. `transformDocument` rewrites each paragraph's styleName to embed
  //      an alignment suffix when a non-default alignment is set.
  //   2. A supplemental styleMap matches those synthetic names and emits
  //      classes (`ta-center` / `ta-right` / `ta-justify`).
  //   3. A post-process pass converts those classes to inline
  //      `style="text-align: …"` so the TipTap renderer + .docx
  //      re-export both see it.
  const ALIGN_BY_KEY = {
    center: 'center',
    right: 'right',
    end: 'right',
    justify: 'justify',
    both: 'justify',
  } as const;
  type AlignKey = keyof typeof ALIGN_BY_KEY;
  type AlignTarget = (typeof ALIGN_BY_KEY)[AlignKey];

  function alignSuffix(a: string | null | undefined): AlignTarget | null {
    if (!a) return null;
    const key = a as AlignKey;
    return ALIGN_BY_KEY[key] ?? null;
  }

  // Mammoth's transforms helpers aren't in the .d.ts. Cast to the loose
  // shape its options expect (matching mammoth's own runtime signature).
  interface MammothParagraph {
    alignment?: string | null;
    styleName?: string | null;
  }
  type MammothTransformFn = (element: MammothParagraph) => MammothParagraph;
  interface MammothTransforms {
    paragraph: (fn: MammothTransformFn) => MammothTransformFn;
  }
  const mammothTransforms = (mammoth as unknown as { transforms: MammothTransforms }).transforms;
  const transformDocument = mammothTransforms.paragraph((paragraph) => {
    const target = alignSuffix(paragraph.alignment);
    if (!target) return paragraph;
    const base = paragraph.styleName ?? '';
    return { ...paragraph, styleName: base ? `${base}__align-${target}` : `__align-${target}` };
  });

  // Mappings for headings 1-6 + plain paragraphs, for each of the three
  // alignments we propagate. The `:fresh` suffix tells mammoth to start a
  // new HTML element instead of merging into a previous one.
  const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
  const alignmentStyleMap: string[] = [];
  for (const target of ['center', 'right', 'justify'] as const) {
    alignmentStyleMap.push(`p[style-name='__align-${target}'] => p.ta-${target}:fresh`);
    for (const lvl of HEADING_LEVELS) {
      alignmentStyleMap.push(
        `p[style-name='Heading ${lvl}__align-${target}'] => h${lvl}.ta-${target}:fresh`,
      );
    }
  }

  let html: string;
  let warnings: string[] = [];
  try {
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        ignoreEmptyParagraphs: false,
        transformDocument,
        styleMap: alignmentStyleMap,
        // Strip embedded images (the body is meant for text; images live
        // in the Documents tab). Returning empty src yields a tag-less
        // placeholder that ProseMirror will discard.
        convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
      },
    );
    html = result.value;
    // Convert the marker classes to inline styles the rest of the pipeline
    // already understands (TipTap's TextAlign extension reads `style`).
    html = html
      .replace(/\sclass="ta-center"/g, ' style="text-align: center"')
      .replace(/\sclass="ta-right"/g, ' style="text-align: right"')
      .replace(/\sclass="ta-justify"/g, ' style="text-align: justify"');
    warnings = result.messages.map((m) => m.message);
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
