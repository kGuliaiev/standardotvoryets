/**
 * Convert TipTap HTML into a docx Document.
 *
 * We only handle the bounded TipTap schema used by the body editor:
 *   block:  p, h1, h2, h3, ul, ol, li, blockquote, pre, table/tr/td/th, hr
 *   inline: strong/b, em/i, u, s/strike, code, a, br
 *
 * Anything else is rendered as plain text. Tables flatten one level deep
 * (no nested tables) — that matches what TipTap's table extension produces.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  ExternalHyperlink,
  type IRunOptions,
  type ParagraphChild,
} from 'docx';
import { parse, type HTMLElement, type Node, NodeType } from 'node-html-parser';

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  /** Wrap the run in an ExternalHyperlink with this URL. */
  href?: string;
  /** Font family inherited from a surrounding <span style="font-family: …">. */
  font?: string;
  /** Font size in half-points (docx unit). 22 = 11pt. */
  size?: number;
  /** Hex color without leading #. */
  color?: string;
}

// Times New Roman is the standard for Ukrainian government documents
// and most Word templates the WG members start from. Used as the
// fallback font when an inline style doesn't override it.
const FONT = 'Times New Roman';
const BASE_SIZE = 24; // 12pt in half-points (Times reads slightly smaller than Arial at 11pt)
const BASE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } as const;
const TABLE_BORDERS = {
  top: BASE_BORDER,
  bottom: BASE_BORDER,
  left: BASE_BORDER,
  right: BASE_BORDER,
  insideHorizontal: BASE_BORDER,
  insideVertical: BASE_BORDER,
};

function isElement(n: Node): n is HTMLElement {
  return n.nodeType === NodeType.ELEMENT_NODE;
}

/**
 * Read `style="text-align: …"` off a block element and map it to docx
 * AlignmentType. Returns undefined when no alignment is set so we don't
 * stamp explicit "left" everywhere.
 */
function readAlignment(
  el: HTMLElement,
): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const style = el.getAttribute('style') ?? '';
  const m = /text-align\s*:\s*(left|center|right|justify)/i.exec(style);
  if (!m?.[1]) return undefined;
  switch (m[1].toLowerCase()) {
    case 'center':
      return AlignmentType.CENTER;
    case 'right':
      return AlignmentType.RIGHT;
    case 'justify':
      return AlignmentType.JUSTIFIED;
    default:
      return AlignmentType.LEFT;
  }
}

/** Read inline `style="font-family:…; font-size:…; color:…"` and turn it
 *  into RunStyle deltas that override the parent's inherited style.
 *  Anything else in `style` (text-align, etc.) is ignored here — those
 *  are paragraph-level and handled separately. */
function readSpanStyle(el: HTMLElement): Partial<RunStyle> {
  const out: Partial<RunStyle> = {};
  const style = el.getAttribute('style') ?? '';
  if (!style) return out;

  const fontMatch = /font-family\s*:\s*([^;]+)/i.exec(style);
  if (fontMatch?.[1]) {
    // CSS often quotes multi-word fonts: `'Times New Roman', Times, serif`.
    // docx takes one family name — strip quotes, take the first one.
    const firstSegment = fontMatch[1].split(',')[0] ?? '';
    const first = firstSegment.trim().replace(/^['"]/, '').replace(/['"]$/, '');
    if (first) out.font = first;
  }

  const sizeMatch = /font-size\s*:\s*([\d.]+)\s*(pt|px|em|rem)/i.exec(style);
  if (sizeMatch?.[1] && sizeMatch[2]) {
    const n = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toLowerCase();
    // docx run.size is in HALF-POINTS. 12pt → 24; 16px ≈ 12pt → 24.
    let halfPoints: number;
    if (unit === 'pt') halfPoints = Math.round(n * 2);
    else if (unit === 'px')
      halfPoints = Math.round((n * 3) / 2); // 1px ≈ 0.75pt
    else halfPoints = Math.round(n * 24); // em/rem relative to 12pt
    if (halfPoints > 0 && halfPoints < 200) out.size = halfPoints;
  }

  const colorMatch = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style);
  if (colorMatch?.[1]) {
    const c = colorMatch[1].trim();
    const hex = cssColorToHex(c);
    if (hex) out.color = hex;
  }

  return out;
}

/** Convert a CSS color literal to a 6-digit hex (no leading #). docx
 *  only accepts hex strings, so we drop rgb()/hsl()/named colors that
 *  we can't trivially map. */
function cssColorToHex(c: string): string | null {
  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (hex3?.[1] && hex3[2] && hex3[3]) {
    return (hex3[1] + hex3[1] + hex3[2] + hex3[2] + hex3[3] + hex3[3]).toUpperCase();
  }
  const hex6 = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex6?.[1]) return hex6[1].toUpperCase();
  const rgb = /^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(c);
  if (rgb?.[1] && rgb[2] && rgb[3]) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((n) =>
        Math.min(255, Math.max(0, parseInt(n, 10)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase();
  }
  return null;
}

/** Decode the small set of entities node-html-parser leaves in text nodes. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Walk inline children of a block element and emit docx TextRun /
 * ExternalHyperlink nodes. `style` carries marks accumulated from
 * surrounding tags so nested <strong><em>...</em></strong> works.
 */
function collectRuns(nodes: Node[], style: RunStyle = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes) {
    if (!isElement(n)) {
      const text = decodeEntities(n.rawText);
      if (text.length > 0) out.push(makeRun(text, style));
      continue;
    }
    const tag = n.tagName?.toLowerCase();
    switch (tag) {
      case 'br':
        out.push(new TextRun({ break: 1 }));
        break;
      case 'strong':
      case 'b':
        out.push(...collectRuns(n.childNodes, { ...style, bold: true }));
        break;
      case 'em':
      case 'i':
        out.push(...collectRuns(n.childNodes, { ...style, italics: true }));
        break;
      case 'u':
        out.push(...collectRuns(n.childNodes, { ...style, underline: true }));
        break;
      case 's':
      case 'strike':
      case 'del':
        out.push(...collectRuns(n.childNodes, { ...style, strike: true }));
        break;
      case 'code':
        out.push(...collectRuns(n.childNodes, { ...style, code: true }));
        break;
      case 'a': {
        const href = n.getAttribute('href') ?? '';
        // ExternalHyperlink can only contain TextRuns, not nested links.
        const inner = collectRuns(n.childNodes, { ...style, href });
        if (href) {
          out.push(
            new ExternalHyperlink({
              link: href,
              children: inner.filter((c): c is TextRun => c instanceof TextRun),
            }),
          );
        } else {
          out.push(...inner);
        }
        break;
      }
      case 'span': {
        // <span> is where TipTap's TextStyle/FontFamily/Color/FontSize
        // marks land in the serialised HTML. Read the inline style and
        // overlay it on the inherited run style.
        const inherited = readSpanStyle(n);
        out.push(...collectRuns(n.childNodes, { ...style, ...inherited }));
        break;
      }
      default:
        // Unknown inline — recurse to grab text content.
        out.push(...collectRuns(n.childNodes, style));
    }
  }
  return out;
}

function makeRun(text: string, style: RunStyle): TextRun {
  // IRunOptions fields are readonly, so we build the whole literal at once
  // rather than mutating after the fact.
  const opts: IRunOptions = {
    text,
    // Order: code mark > inline span font > document default.
    font: style.code ? '"JetBrains Mono"' : (style.font ?? FONT),
    size: style.size ?? BASE_SIZE,
    color: style.color,
    bold: style.bold ? true : undefined,
    italics: style.italics ? true : undefined,
    strike: style.strike ? true : undefined,
    underline: style.underline ? { type: 'single' } : undefined,
    shading: style.code ? { type: ShadingType.CLEAR, fill: 'F1F4F7', color: 'auto' } : undefined,
    style: style.href ? 'Hyperlink' : undefined,
  };
  return new TextRun(opts);
}

function blockParagraphsForList(
  list: HTMLElement,
  numberingRef: string,
  level: number,
): (Paragraph | Table)[] {
  const paragraphs: (Paragraph | Table)[] = [];
  for (const child of list.childNodes) {
    if (!isElement(child)) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'li') {
      // First, the li's own paragraph(s) — usually a single line of mixed
      // inline content; nested block tags inside <li> (e.g. <ul>) are
      // handled below.
      const inlineNodes: Node[] = [];
      const blockNodes: HTMLElement[] = [];
      for (const c of child.childNodes) {
        if (isElement(c) && /^(ul|ol|p|blockquote|pre|table)$/.test(c.tagName.toLowerCase())) {
          blockNodes.push(c);
        } else {
          inlineNodes.push(c);
        }
      }
      const inlineRuns = collectRuns(inlineNodes);
      if (inlineRuns.length > 0) {
        paragraphs.push(
          new Paragraph({
            numbering: { reference: numberingRef, level },
            children: inlineRuns,
          }),
        );
      }
      for (const b of blockNodes) {
        const t = b.tagName.toLowerCase();
        if (t === 'ul' || t === 'ol') {
          paragraphs.push(
            ...blockParagraphsForList(
              b,
              t === 'ol' ? `${numberingRef}-ord` : numberingRef,
              level + 1,
            ),
          );
        } else {
          paragraphs.push(...blockToParagraphs(b));
        }
      }
    } else if (tag === 'ul' || tag === 'ol') {
      paragraphs.push(...blockParagraphsForList(child, numberingRef, level + 1));
    }
  }
  return paragraphs;
}

function htmlTableToDocx(el: HTMLElement): Table {
  const rows: TableRow[] = [];
  const trs: HTMLElement[] = [];
  // Allow tables to be wrapped in <thead>/<tbody>/<tfoot> like real Word docs.
  for (const c of el.childNodes) {
    if (!isElement(c)) continue;
    const t = c.tagName.toLowerCase();
    if (t === 'tr') trs.push(c);
    else if (t === 'thead' || t === 'tbody' || t === 'tfoot') {
      for (const cc of c.childNodes) {
        if (isElement(cc) && cc.tagName.toLowerCase() === 'tr') trs.push(cc);
      }
    }
  }
  const colCount = Math.max(
    1,
    ...trs.map(
      (tr) =>
        tr.childNodes.filter((c) => isElement(c) && /^(td|th)$/.test(c.tagName.toLowerCase()))
          .length,
    ),
  );
  const contentWidthDxa = 9360; // US Letter content width
  const colWidth = Math.floor(contentWidthDxa / colCount);
  const columnWidths = Array.from({ length: colCount }, () => colWidth);

  for (const tr of trs) {
    const cells: TableCell[] = [];
    for (const c of tr.childNodes) {
      if (!isElement(c)) continue;
      const tag = c.tagName.toLowerCase();
      if (tag !== 'td' && tag !== 'th') continue;
      // Cell content: convert block-by-block recursively so nested
      // headings/lists inside a cell render correctly.
      const inner = elementChildrenToParagraphs(c);
      cells.push(
        new TableCell({
          borders: TABLE_BORDERS,
          width: { size: colWidth, type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          shading:
            tag === 'th' ? { fill: 'E8EEF7', type: ShadingType.CLEAR, color: 'auto' } : undefined,
          children: inner.length > 0 ? inner : [new Paragraph({ children: [new TextRun('')] })],
        }),
      );
    }
    if (cells.length > 0) rows.push(new TableRow({ children: cells }));
  }

  if (rows.length === 0) {
    rows.push(
      new TableRow({
        children: [
          new TableCell({
            borders: TABLE_BORDERS,
            width: { size: colWidth, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun('')] })],
          }),
        ],
      }),
    );
  }

  return new Table({
    width: { size: contentWidthDxa, type: WidthType.DXA },
    columnWidths,
    rows,
  });
}

function blockToParagraphs(el: HTMLElement): (Paragraph | Table)[] {
  const tag = el.tagName.toLowerCase();
  const alignment = readAlignment(el);
  switch (tag) {
    case 'h1':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment,
          spacing: { before: 240, after: 120 },
          children: collectRuns(el.childNodes, { bold: true }),
        }),
      ];
    case 'h2':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          alignment,
          spacing: { before: 200, after: 100 },
          children: collectRuns(el.childNodes, { bold: true }),
        }),
      ];
    case 'h3':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          alignment,
          spacing: { before: 160, after: 80 },
          children: collectRuns(el.childNodes, { bold: true }),
        }),
      ];
    case 'h4':
    case 'h5':
    case 'h6':
      return [
        new Paragraph({
          alignment,
          spacing: { before: 140, after: 70 },
          children: collectRuns(el.childNodes, { bold: true }),
        }),
      ];
    case 'p':
      return [
        new Paragraph({
          alignment,
          spacing: { after: 120 },
          children: collectRuns(el.childNodes),
        }),
      ];
    case 'blockquote':
      return [
        new Paragraph({
          indent: { left: 480 },
          spacing: { after: 120 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: '5A8DB8', space: 8 } },
          children: collectRuns(el.childNodes, { italics: true }),
        }),
      ];
    case 'pre': {
      // <pre><code>...</code></pre> → monospaced paragraph; preserve newlines
      const text = decodeEntities(el.text ?? '');
      const lines = text.split('\n');
      return lines.map(
        (line) =>
          new Paragraph({
            shading: { type: ShadingType.CLEAR, fill: 'F4F6F8', color: 'auto' },
            children: [new TextRun({ text: line, font: '"JetBrains Mono"', size: 20 })],
          }),
      );
    }
    case 'ul':
      return blockParagraphsForList(el, 'std-bullet', 0);
    case 'ol':
      return blockParagraphsForList(el, 'std-ord', 0);
    case 'hr':
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } },
          children: [],
        }),
      ];
    case 'table':
      // Word doesn't like two tables flush against each other or a table at
      // the very start of a doc — add a tiny spacer paragraph after.
      return [htmlTableToDocx(el), new Paragraph({ children: [], spacing: { after: 60 } })];
    default:
      // Unknown block — recurse into children, treat as paragraph.
      return [
        new Paragraph({
          spacing: { after: 120 },
          children: collectRuns(el.childNodes),
        }),
      ];
  }
}

function elementChildrenToParagraphs(el: HTMLElement): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  let inlineBuffer: Node[] = [];
  const flushInline = () => {
    if (inlineBuffer.length === 0) return;
    const runs = collectRuns(inlineBuffer);
    if (runs.length > 0) out.push(new Paragraph({ children: runs }));
    inlineBuffer = [];
  };

  for (const child of el.childNodes) {
    if (!isElement(child)) {
      if (child.rawText.trim().length > 0) inlineBuffer.push(child);
      continue;
    }
    const t = child.tagName.toLowerCase();
    if (/^(p|h[1-6]|ul|ol|blockquote|pre|table|hr)$/.test(t)) {
      flushInline();
      out.push(...blockToParagraphs(child));
    } else if (t === 'br') {
      flushInline();
    } else {
      inlineBuffer.push(child);
    }
  }
  flushInline();
  return out;
}

/**
 * Build a Document. Title is optional and rendered as a centred bold
 * header above the body so the exported file isn't anonymous.
 */
export function htmlBodyToDocx(html: string, title?: string): Document {
  const root = parse(html, { lowerCaseTagName: true });
  const body = elementChildrenToParagraphs(root);

  const heading: (Paragraph | Table)[] = title
    ? [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [new TextRun({ text: title, bold: true, size: 32, font: FONT })],
        }),
      ]
    : [];

  return new Document({
    creator: 'Стандартотворець',
    styles: {
      default: {
        document: { run: { font: FONT, size: BASE_SIZE } },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: FONT, size: 32, bold: true },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: FONT, size: 28, bold: true },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: FONT, size: 25, bold: true },
          paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'std-bullet',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: '◦',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 1440, hanging: 360 } } },
            },
            {
              level: 2,
              format: LevelFormat.BULLET,
              text: '▪',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 2160, hanging: 360 } } },
            },
          ],
        },
        {
          reference: 'std-ord',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
            {
              level: 1,
              format: LevelFormat.LOWER_LETTER,
              text: '%2)',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 1440, hanging: 360 } } },
            },
            {
              level: 2,
              format: LevelFormat.LOWER_ROMAN,
              text: '%3)',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 2160, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: [...heading, ...body],
      },
    ],
  });
}
