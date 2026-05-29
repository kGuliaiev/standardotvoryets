import { describe, it, expect } from 'vitest';
import { RANKS, RANK_OPTIONS, rankLabel, rankWeight } from '@/lib/ranks';

describe('ranks metadata', () => {
  it('every enum key has a label + tier (except CIVILIAN with blank label)', () => {
    for (const [key, info] of Object.entries(RANKS)) {
      expect(info.tier).toMatch(/civilian|junior|senior|general/);
      if (key !== 'CIVILIAN') expect(info.label.length).toBeGreaterThan(0);
    }
  });

  it('RANK_OPTIONS contains exactly the keys of RANKS', () => {
    expect(RANK_OPTIONS.map((o) => o.value).sort()).toEqual(Object.keys(RANKS).sort());
  });
});

describe('rankLabel', () => {
  it('returns "" for null/undefined', () => {
    expect(rankLabel(null)).toBe('');
    expect(rankLabel(undefined)).toBe('');
  });
  it('returns the Ukrainian label for known ranks', () => {
    expect(rankLabel('CAPTAIN')).toBe('капітан');
    expect(rankLabel('COLONEL')).toBe('полковник');
  });
});

describe('rankWeight (sort key)', () => {
  it('returns 0 for null/undefined', () => {
    expect(rankWeight(null)).toBe(0);
    expect(rankWeight(undefined)).toBe(0);
  });
  it('senior officers outrank junior officers', () => {
    expect(rankWeight('COLONEL')).toBeGreaterThan(rankWeight('CAPTAIN'));
    expect(rankWeight('LIEUTENANT_COLONEL')).toBeGreaterThan(rankWeight('SENIOR_LIEUTENANT'));
  });
  it('generals outrank colonels', () => {
    expect(rankWeight('GENERAL')).toBeGreaterThan(rankWeight('COLONEL'));
    expect(rankWeight('BRIGADIER_GENERAL')).toBeGreaterThan(rankWeight('COLONEL'));
  });
});
