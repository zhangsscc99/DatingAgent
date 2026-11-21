import { describe, expect, it } from 'vitest';
import {
  parseRateLimit,
  rateLimitHint,
  rateLimitWarning,
  RATE_LIMIT_WARN_THRESHOLD,
  type HeaderReader,
} from '../src/lib/rateLimitStatus';

/** Case-insensitive Headers-like shim for tests. */
const headers = (pairs: Record<string, string>): HeaderReader => ({
  get: (name) => pairs[name.toLowerCase()] ?? null,
});

/** P421: budgets carry observedAt — pin one instant for deterministic reads. */
const NOW = 1_800_000_000_000;

describe('P07 · parseRateLimit', () => {
  it('parses a normal limit/remaining pair', () => {
    const budget = parseRateLimit(
      headers({ 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '27' }),
      NOW,
    );
    expect(budget).toEqual({ remaining: 27, limit: 30, observedAt: NOW });
  });

  it('accepts a real Headers object', () => {
    const h = new Headers({
      'X-RateLimit-Limit': '30',
      'X-RateLimit-Remaining': '4',
    });
    expect(parseRateLimit(h, NOW)).toEqual({ remaining: 4, limit: 30, observedAt: NOW });
  });

  it('returns null when headers are absent or the pair is missing', () => {
    expect(parseRateLimit(null)).toBeNull();
    expect(parseRateLimit(undefined)).toBeNull();
    expect(parseRateLimit(headers({}))).toBeNull();
    expect(parseRateLimit(headers({ 'x-ratelimit-limit': '30' }))).toBeNull();
  });

  it('rejects non-numeric or negative values', () => {
    expect(
      parseRateLimit(headers({ 'x-ratelimit-limit': 'soon', 'x-ratelimit-remaining': '3' })),
    ).toBeNull();
    expect(
      parseRateLimit(headers({ 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '-1' })),
    ).toBeNull();
    expect(
      parseRateLimit(headers({ 'x-ratelimit-limit': '0', 'x-ratelimit-remaining': '0' })),
    ).toBeNull();
  });

  it('keeps zero remaining as a valid (exhausted) budget', () => {
    expect(
      parseRateLimit(headers({ 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '0' }), NOW),
    ).toEqual({ remaining: 0, limit: 30, observedAt: NOW });
  });
});

describe('P07 · rateLimitWarning / rateLimitHint', () => {
  it('warns at or below the threshold', () => {
    expect(rateLimitWarning({ remaining: RATE_LIMIT_WARN_THRESHOLD, limit: 30, observedAt: NOW })).toBe(true);
    expect(rateLimitWarning({ remaining: RATE_LIMIT_WARN_THRESHOLD + 1, limit: 30, observedAt: NOW })).toBe(false);
    expect(rateLimitWarning({ remaining: 0, limit: 30, observedAt: NOW })).toBe(true);
  });

  it('stays silent while the minute is comfortable, speaks when it is nearly spent', () => {
    expect(rateLimitHint({ remaining: 27, limit: 30, observedAt: NOW }, NOW)).toBeNull();
    expect(rateLimitHint({ remaining: 4, limit: 30, observedAt: NOW }, NOW)).toBe(
      '这一分钟快到上限了，稍等几秒再问',
    );
  });
});
