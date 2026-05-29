import { describe, it, expect } from 'vitest';
import {
  isPlainTextBody,
  migratePlainTextToHtml,
  normalizeBodyHtml,
  splitHtmlBlocks,
} from '@/lib/standardBody';

describe('isPlainTextBody', () => {
  it('treats null / empty as not-plain-text', () => {
    expect(isPlainTextBody(null)).toBe(false);
    expect(isPlainTextBody(undefined)).toBe(false);
    expect(isPlainTextBody('')).toBe(false);
    expect(isPlainTextBody('   ')).toBe(false);
  });

  it('detects HTML bodies as not plain text', () => {
    expect(isPlainTextBody('<p>hi</p>')).toBe(false);
    expect(isPlainTextBody('  <h1>X</h1>')).toBe(false);
  });

  it('detects raw paragraphs as plain text', () => {
    expect(isPlainTextBody('Just some text')).toBe(true);
    expect(isPlainTextBody('Перший абзац.\n\nДругий абзац.')).toBe(true);
  });
});

describe('migratePlainTextToHtml', () => {
  it('wraps single paragraph in <p>', () => {
    expect(migratePlainTextToHtml('Hello')).toBe('<p>Hello</p>');
  });

  it('splits on blank lines into multiple <p>', () => {
    const out = migratePlainTextToHtml('First\n\nSecond');
    expect(out).toBe('<p>First</p><p>Second</p>');
  });

  it('preserves single line breaks as <br>', () => {
    const out = migratePlainTextToHtml('Line A\nLine B');
    expect(out).toBe('<p>Line A<br>Line B</p>');
  });

  it('escapes HTML-special characters (XSS hardening)', () => {
    const out = migratePlainTextToHtml('<script>alert(1)</script> & "quotes"');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&amp;');
  });

  it('skips blank-only paragraphs', () => {
    expect(migratePlainTextToHtml('\n\n  \n\nHi')).toBe('<p>Hi</p>');
  });
});

describe('normalizeBodyHtml', () => {
  it('returns "" for null/undefined/empty', () => {
    expect(normalizeBodyHtml(null)).toBe('');
    expect(normalizeBodyHtml(undefined)).toBe('');
    expect(normalizeBodyHtml('')).toBe('');
  });
  it('passes HTML through unchanged', () => {
    expect(normalizeBodyHtml('<p>hi</p>')).toBe('<p>hi</p>');
  });
  it('converts plain text to HTML', () => {
    expect(normalizeBodyHtml('hi')).toBe('<p>hi</p>');
  });
});

describe('splitHtmlBlocks (SSR/regex fallback path)', () => {
  // happy-dom IS available in Vitest config so the DOMParser branch runs.
  // These cases still exercise the public contract.
  it('returns [] for empty', () => {
    expect(splitHtmlBlocks('')).toEqual([]);
    expect(splitHtmlBlocks(null as unknown as string)).toEqual([]);
  });

  it('splits a multi-paragraph document into top-level blocks', () => {
    const out = splitHtmlBlocks('<p>One</p><p>Two</p><h2>Three</h2>');
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(/<p>One<\/p>/);
    expect(out[1]).toMatch(/<p>Two<\/p>/);
    expect(out[2]).toMatch(/<h2>Three<\/h2>/);
  });

  it('does not split inside nested elements', () => {
    const out = splitHtmlBlocks('<ul><li>a</li><li>b</li></ul><p>after</p>');
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('<ul>');
    expect(out[0]).toContain('</ul>');
    expect(out[1]).toMatch(/<p>after<\/p>/);
  });
});
