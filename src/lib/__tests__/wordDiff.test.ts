import { describe, it, expect } from 'vitest';
import { wordDiff } from '@/lib/wordDiff';

describe('wordDiff', () => {
  it('returns all "eq" parts for identical strings', () => {
    const out = wordDiff('hello world', 'hello world');
    expect(out.every((p) => p.type === 'eq')).toBe(true);
    expect(out.map((p) => p.text).join('')).toBe('hello world');
  });

  it('marks added words as add', () => {
    const out = wordDiff('hello', 'hello world');
    const added = out.filter((p) => p.type === 'add').map((p) => p.text.trim());
    expect(added).toContain('world');
  });

  it('marks deleted words as del', () => {
    const out = wordDiff('hello world', 'hello');
    const deleted = out.filter((p) => p.type === 'del').map((p) => p.text.trim());
    expect(deleted).toContain('world');
  });

  it('keeps shared punctuation as eq', () => {
    const out = wordDiff('foo, bar.', 'foo, baz.');
    const eqText = out
      .filter((p) => p.type === 'eq')
      .map((p) => p.text)
      .join('');
    // both the comma and period survive
    expect(eqText).toContain(',');
    expect(eqText).toContain('.');
  });

  it('round-trips Cyrillic edits', () => {
    const out = wordDiff('Захист інформації 30 днів', 'Захист інформації 60 днів');
    const adds = out.filter((p) => p.type === 'add').map((p) => p.text);
    const dels = out.filter((p) => p.type === 'del').map((p) => p.text);
    expect(adds).toContain('60');
    expect(dels).toContain('30');
  });
});
