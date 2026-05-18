/**
 * Helpers for the Standard.bodyText field.
 *
 * Storage format: HTML emitted by TipTap. Each top-level child of the
 * editor is a "block" — a paragraph, heading, list, blockquote, code
 * block, or table. Suggestions reference blocks by their index (the
 * order they appear in the document body).
 *
 * Backward compatibility: pre-rich-text data was plain text split by
 * blank lines. `migratePlainTextToHtml` converts that to HTML so the
 * UI never has to handle both formats — once a body is read, it's
 * always HTML downstream.
 */

const PLAIN_TEXT_HINT = /^\s*(?!<)[\s\S]/;

/** Returns true when the stored body looks like plain text, not HTML. */
export function isPlainTextBody(body: string | null | undefined): boolean {
  if (!body) return false;
  const trimmed = body.trim();
  if (!trimmed) return false;
  // If the first non-whitespace char isn't `<`, treat it as plain text.
  return PLAIN_TEXT_HINT.test(trimmed) && !trimmed.startsWith('<');
}

/** Escape inline characters that have special meaning in HTML. */
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Convert plain-text body (paragraphs split by blank lines) to HTML. */
export function migratePlainTextToHtml(body: string): string {
  const paras = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return paras.map((p) => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/** Normalize whatever is in storage to clean HTML. */
export function normalizeBodyHtml(body: string | null | undefined): string {
  if (!body) return '';
  return isPlainTextBody(body) ? migratePlainTextToHtml(body) : body;
}

/**
 * Split an HTML body into its top-level "blocks" preserving full tags.
 * Used to (a) render each block separately so suggestions can be anchored,
 * (b) compute the originalText snapshot when creating a suggestion,
 * (c) reassemble the document after accepting a REPLACE / DELETE /
 *     INSERT_AFTER operation.
 *
 * Implementation is browser-friendly (no JSDOM dependency): we walk the
 * string once, tracking tag depth, and split on transitions back to the
 * root level.
 */
export function splitHtmlBlocks(html: string): string[] {
  const normalized = normalizeBodyHtml(html);
  if (!normalized) return [];

  // Use the browser's DOMParser when available; fall back to a tag-scan
  // parser for the very rare SSR path (e.g. server-side rendering of
  // initial markup).
  if (typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(`<div>${normalized}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return [];
    return Array.from(root.children).map((el) => el.outerHTML);
  }

  // Fallback: split on closing tags of known block elements at depth 0.
  // This is intentionally conservative — works for the limited TipTap
  // schema we expose (p, h1-h3, ul, ol, blockquote, pre, table).
  const blocks: string[] = [];
  let depth = 0;
  let buffer = '';
  const re = /<\/?(\w+)[^>]*>/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    const isClosing = m[0].startsWith('</');
    const tag = (m[1] ?? '').toLowerCase();
    buffer += normalized.slice(lastIndex, re.lastIndex);
    lastIndex = re.lastIndex;
    if (isClosing) {
      depth--;
      if (depth === 0) {
        blocks.push(buffer);
        buffer = '';
      }
    } else if (!m[0].endsWith('/>')) {
      // self-closing tags (<br/>, <img/>) don't change depth
      depth++;
      // unwrap top-level void tags so they don't lock depth
      if (tag === 'br' || tag === 'img' || tag === 'hr') depth--;
    }
  }
  if (buffer.trim()) blocks.push(buffer);
  return blocks.filter((b) => b.trim().length > 0);
}

/** Reassemble blocks into a single HTML string. */
export function joinHtmlBlocks(blocks: string[]): string {
  return blocks.join('');
}

/** Strip tags for previews / search / plain-text contexts. */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  if (typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent ?? '';
  }
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
