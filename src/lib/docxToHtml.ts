/**
 * Convert an uploaded .docx buffer into TipTap-compatible HTML.
 *
 * mammoth's default style map covers the common semantic cases
 * (headings, lists, bold/italic, links, tables) but drops *direct*
 * paragraph formatting — most notably paragraph alignment, which Word
 * stores as a property rather than as a named style. We work around
 * that with two helpers:
 *
 *   1. transformDocument rewrites each paragraph's styleName to embed
 *      an alignment suffix (`__align-center` / `__align-right` /
 *      `__align-justify`) whenever the source paragraph has a
 *      non-default alignment.
 *   2. Supplemental styleMap rules match those synthetic names and
 *      emit elements with a marker class (`ta-center` etc).
 *
 * After mammoth returns, a small post-process pass swaps the marker
 * classes for inline `style="text-align: …"`, which is what TipTap's
 * TextAlign extension reads on render and what our htmlToDocx exporter
 * reads on round-trip.
 *
 * Images embedded in the source are stripped — the body editor is
 * meant for prose, and embedded image attachments belong in the
 * Documents tab proper.
 */

import mammoth from 'mammoth';

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

interface MammothParagraph {
  alignment?: string | null;
  styleName?: string | null;
}
type MammothTransformFn = (element: MammothParagraph) => MammothParagraph;
interface MammothTransforms {
  paragraph: (fn: MammothTransformFn) => MammothTransformFn;
}

// One-time setup of the transform + style map; they're pure data so we
// can build them at module load.
const mammothTransforms = (mammoth as unknown as { transforms: MammothTransforms }).transforms;
const transformDocument = mammothTransforms.paragraph((paragraph) => {
  const target = alignSuffix(paragraph.alignment);
  if (!target) return paragraph;
  const base = paragraph.styleName ?? '';
  return { ...paragraph, styleName: base ? `${base}__align-${target}` : `__align-${target}` };
});

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

export interface ConvertResult {
  html: string;
  warnings: string[];
}

/**
 * Convert a .docx file buffer to HTML using the shared style map.
 * Returns an empty string when the document has no extractable text;
 * callers decide whether to treat that as an error.
 */
export async function docxBufferToHtml(buffer: Buffer): Promise<ConvertResult> {
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      ignoreEmptyParagraphs: false,
      transformDocument,
      styleMap: alignmentStyleMap,
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
    },
  );

  const html = result.value
    .replace(/\sclass="ta-center"/g, ' style="text-align: center"')
    .replace(/\sclass="ta-right"/g, ' style="text-align: right"')
    .replace(/\sclass="ta-justify"/g, ' style="text-align: justify"');

  return {
    html,
    warnings: result.messages.map((m) => m.message),
  };
}
