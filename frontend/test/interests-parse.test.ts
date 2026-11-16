/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { formatInterests, parseInterests } from '../src/lib/interests';

/**
 * P191 — the onboarding field used to demand comma syntax, so "徒步 摄影 烹饪"
 * silently became ONE interest. parseInterests must accept commas (half- and
 * full-width), 顿号, semicolons, slashes and any whitespace, while
 * formatInterests is the single formatter for round-tripping stored arrays
 * back into the input field.
 */

const THREE = ['徒步', '摄影', '烹饪'];

describe('P191 · separator tolerance', () => {
  it.each([
    ['徒步 摄影 烹饪', 'plain spaces', THREE],
    ['徒步　摄影　烹饪', 'full-width spaces', THREE],
    ['徒步\t摄影\n烹饪', 'tabs and newlines', THREE],
    ['徒步,摄影,烹饪', 'half-width commas', THREE],
    ['徒步，摄影，烹饪', 'full-width commas', THREE],
    ['徒步、摄影、烹饪', '顿号', THREE],
    ['徒步;摄影;烹饪', 'half-width semicolons', THREE],
    ['徒步；摄影；烹饪', 'full-width semicolons', THREE],
    ['徒步/摄影/烹饪', 'slashes', THREE],
    ['徒步, 摄影、 烹饪\n读书', 'mixed separators', [...THREE, '读书']],
  ])('splits %s (%s)', (raw, _label, expected) => {
    expect(parseInterests(raw)).toEqual(expected);
  });
});

describe('P191 · cleanup rules', () => {
  it('trims chunks and drops empty segments', () => {
    expect(parseInterests(' 徒步 , , 摄影 ,, ')).toEqual(['徒步', '摄影']);
    expect(parseInterests(',、;；/ \n')).toEqual([]);
  });

  it('de-duplicates exact matches, keeping the first occurrence and order', () => {
    expect(parseInterests('徒步,摄影,徒步,烹饪,摄影')).toEqual(THREE);
    expect(parseInterests('a b a b c')).toEqual(['a', 'b', 'c']);
  });

  it('truncates each item to 20 characters', () => {
    const long = '一二三四五六七八九十一二三四五六七八九十超出的字';
    expect(parseInterests(long)).toEqual(['一二三四五六七八九十一二三四五六七八九十']);
    expect(parseInterests(`abc,${long}`)[1]).toHaveLength(20);
  });

  it('caps the list at 12 items', () => {
    const raw = Array.from({ length: 15 }, (_, i) => `兴趣${i}`).join(',');
    const parsed = parseInterests(raw);
    expect(parsed).toHaveLength(12);
    expect(parsed[11]).toBe('兴趣11');
  });
});

describe('P191 · degenerate input', () => {
  it('returns [] for empty, whitespace-only, null and undefined', () => {
    expect(parseInterests('')).toEqual([]);
    expect(parseInterests('   ')).toEqual([]);
    expect(parseInterests('　\n\t')).toEqual([]);
    expect(parseInterests(null)).toEqual([]);
    expect(parseInterests(undefined)).toEqual([]);
  });
});

describe('P191 · legacy parity', () => {
  it('matches the old split logic for comma input', () => {
    const legacy = (raw: string) =>
      raw
        .split(/[,，、\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
    for (const raw of ['徒步,摄影', '徒步，摄影、烹饪', 'a,b,,c\n']) {
      expect(parseInterests(raw)).toEqual(legacy(raw));
    }
  });
});

describe('P191 · formatInterests round-trip', () => {
  it('joins with 、 and returns empty string for empty/missing lists', () => {
    expect(formatInterests(THREE)).toBe('徒步、摄影、烹饪');
    expect(formatInterests([])).toBe('');
    expect(formatInterests(null)).toBe('');
    expect(formatInterests(undefined)).toBe('');
  });

  it('re-parses a formatted list to the same array', () => {
    expect(parseInterests(formatInterests(THREE))).toEqual(THREE);
  });
});
