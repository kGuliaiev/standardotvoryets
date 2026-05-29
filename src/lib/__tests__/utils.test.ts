import { describe, it, expect } from 'vitest';
import { cn, formatBytes, formatDate, formatDateTime, getInitials } from '@/lib/utils';

describe('cn (Tailwind class merge)', () => {
  it('joins strings and removes falsy', () => {
    expect(cn('a', false, 'b', null, undefined, 'c')).toBe('a b c');
  });
  it('lets later utilities override earlier conflicting ones (twMerge)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm text-base')).toBe('text-base');
  });
  it('handles arrays/objects per clsx', () => {
    expect(cn(['a', { b: true, c: false }])).toBe('a b');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 Б'],
    [512, '512 Б'],
    [1024, '1 КБ'],
    [1536, '1.5 КБ'],
    [1048576, '1 МБ'],
    [1073741824, '1 ГБ'],
  ])('formats %i bytes as "%s"', (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
});

describe('formatDate / formatDateTime', () => {
  it('formats ISO string as DD.MM.YYYY (uk-UA)', () => {
    expect(formatDate('2026-01-05T12:00:00Z')).toMatch(/^05\.01\.2026$/);
  });
  it('formats Date as DD.MM.YYYY', () => {
    expect(formatDate(new Date('2026-12-31T00:00:00Z'))).toMatch(/^31\.12\.2026$/);
  });
  it('formatDateTime includes HH:MM', () => {
    const out = formatDateTime('2026-05-27T09:42:00Z');
    expect(out).toMatch(/^27\.05\.2026, \d{2}:\d{2}$/);
  });
});

describe('getInitials', () => {
  it('returns first letters of each word, uppercased, max 2', () => {
    expect(getInitials('Анатолій Голішевський')).toBe('АГ');
    expect(getInitials('Adm In Test')).toBe('AI');
    expect(getInitials('Solo')).toBe('S');
  });
  it('returns empty for empty input', () => {
    expect(getInitials('')).toBe('');
  });
});
