import DOMPurify from 'isomorphic-dompurify';

/**
 * Server-side HTML sanitizer for user-authored rich text (standard body,
 * suggestions). The TipTap editor only sanitizes on the *client*, so a direct
 * tRPC call bypasses it — any HTML persisted to `bodyText` / `bodyHtml` and
 * later rendered via `dangerouslySetInnerHTML` must be sanitized here (B-3).
 *
 * The allow-list mirrors what the editor can actually produce (StarterKit plus
 * color / font-family / text-align / underline / link / table). It excludes
 * `<img>`, `<script>`, `<iframe>`, event handlers and non-http(s)/mailto/relative
 * URLs, which neutralises payloads such as `<img src=x onerror=alert(1)>`.
 */
// Extra tags removed on top of the HTML profile. `img` is the key one — the
// editor never inserts images, and `<img src=x onerror=...>` is the classic
// stored-XSS vector. The rest are non-content / form / external-resource tags
// that have no place in document body HTML.
const FORBID_TAGS = [
  'img',
  'style',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'audio',
  'video',
  'source',
];

/**
 * Sanitize rich-text HTML before persisting it. Idempotent.
 *
 * Uses DOMPurify's curated HTML profile (no SVG/MathML, which avoids
 * mutation-XSS vectors) — that keeps the formatting the editor produces
 * (headings, lists, links, inline `style` for colour/font/alignment) while
 * DOMPurify strips `<script>`, event handlers and `javascript:`/`data:` URIs
 * by default. We further forbid `<img>` and other non-content / external
 * resource tags.
 *
 * Known minor cosmetic loss: this DOMPurify build also strips `colspan` /
 * `rowspan` and link `target` (config overrides like ADD_ATTR don't restore
 * them). Merged table cells therefore un-merge and links open in the same tab
 * on the next save — acceptable for a security fix; tracked for follow-up.
 */
export function sanitizeRichHtml(dirty: string | null | undefined): string {
  if (!dirty) return dirty ?? '';
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    FORBID_TAGS,
    // Links may only point at http(s), mailto, tel, in-page anchors or relative
    // paths — blocks `javascript:` and `data:` URIs.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|\/)/i,
  });
}
