import { describe, expect, it } from 'vitest';
import {
  formatRateLimit,
  parseRateLimit,
  rateLimitWarning,
  RATE_LIMIT_WARN_THRESHOLD,
  type HeaderReader,
} from '../src/lib/rateLimitStatus';

/** Case-insensitive Headers-like shim for tests. */
const headers = (pairs: Record<string, string>): HeaderReader => ({
  get: (name) => pairs[name.toLowerCase()] ?? null,
});

describe('P07 · parseRateLimit', () => {
  it('parses a normal limit/remaining pair', () => {
    const budget = parseRateLimit(
      headers({ 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '27' }),
    );
    expect(budget).toEqual({ remaining: 27, limit: 30 });
  });

  it('accepts a real Headers object', () => {
    const h = new Headers({
      'X-RateLimit-Limit': '30',
      'X-RateLimit-Remaining': '4',
    });
    expect(parseRateLimit(h)).toEqual({ remaining: 4, limit: 30 });
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
      parseRateLimit(headers({ 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '0' })),
    ).toEqual({ remaining: 0, limit: 30 });
  });
});

describe('P07 · rateLimitWarning / formatRateLimit', () => {
  it('warns at or below the threshold', () => {
    expect(rateLimitWarning({ remaining: RATE_LIMIT_WARN_THRESHOLD, limit: 30 })).toBe(true);
    expect(rateLimitWarning({ remaining: RATE_LIMIT_WARN_THRESHOLD + 1, limit: 30 })).toBe(false);
    expect(rateLimitWarning({ remaining: 0, limit: 30 })).toBe(true);
  });

  it('formats the indicator label', () => {
    expect(formatRateLimit({ remaining: 27, limit: 30 })).toBe('本分钟还可提问 27 次');
  });
});
