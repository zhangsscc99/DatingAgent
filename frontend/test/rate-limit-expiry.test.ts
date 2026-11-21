/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  effectiveBudget,
  parseRateLimit,
  rateLimitHint,
  rateLimitSecondsLeft,
  type HeaderReader,
  type RateLimitBudget,
} from '../src/lib/rateLimitStatus';

/**
 * P421 — before this, `RateLimitBudget` was a header snapshot with no clock:
 * a 429 chip froze on 「约 12 秒后可以再问」 forever and the low-budget
 * sentence outlived the minute window it described. Now `observedAt` stamps
 * every budget, `effectiveBudget` expires it, `rateLimitSecondsLeft` feeds
 * the live count into the copy, and InputBar ticks once a second so a stale
 * chip can never stay on screen.
 */

const headers = (pairs: Record<string, string>): HeaderReader => ({
  get: (name) => pairs[name.toLowerCase()] ?? null,
});

/** Fixed observation instant so every assertion below is deterministic. */
const T0 = 1_800_000_000_000;

const exhausted: RateLimitBudget = {
  remaining: 0,
  limit: 30,
  retryAfterSec: 12,
  observedAt: T0,
};

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const rateLimitTs = readFileSync(join(SRC, 'lib', 'rateLimitStatus.ts'), 'utf8');
const inputBarTsx = readFileSync(join(SRC, 'components', 'InputBar.tsx'), 'utf8');

describe('P421 · parseRateLimit stamps the observation instant', () => {
  it('carries the injected now as observedAt', () => {
    expect(
      parseRateLimit(
        headers({ 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '27' }),
        T0,
      ),
    ).toEqual({ remaining: 27, limit: 30, observedAt: T0 });
    expect(
      parseRateLimit(
        headers({
          'x-ratelimit-limit': '30',
          'x-ratelimit-remaining': '0',
          'retry-after': '12',
        }),
        T0,
      ),
    ).toEqual({ remaining: 0, limit: 30, retryAfterSec: 12, observedAt: T0 });
  });

  it('defaults to Date.now() so existing callers stay unchanged', () => {
    const before = Date.now();
    const budget = parseRateLimit(
      headers({ 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '9' }),
    );
    const after = Date.now();
    expect(budget).not.toBeNull();
    expect(budget!.observedAt).toBeGreaterThanOrEqual(before);
    expect(budget!.observedAt).toBeLessThanOrEqual(after);
  });
});

describe('P421 · effectiveBudget expires the window it describes', () => {
  it('returns the budget unchanged while its window is fresh', () => {
    const budget: RateLimitBudget = { remaining: 5, limit: 30, observedAt: T0 };
    expect(effectiveBudget(budget, T0 + 1000)).toEqual(budget);
    expect(effectiveBudget(budget, T0 + 59_999)).toEqual(budget);
  });

  it('expires a 429 budget at observedAt + retryAfterSec', () => {
    expect(effectiveBudget(exhausted, T0 + 11_000)).toEqual(exhausted);
    expect(effectiveBudget(exhausted, T0 + 12_000)).toBeNull();
    expect(effectiveBudget(exhausted, T0 + 600_000)).toBeNull();
  });

  it('expires a live-budget snapshot after the 60 s server window', () => {
    const budget: RateLimitBudget = { remaining: 7, limit: 30, observedAt: T0 };
    expect(effectiveBudget(budget, T0 + 60_000)).toBeNull();
  });

  it('falls back to a 60 s window when a 429 carries no Retry-After', () => {
    const noRetry: RateLimitBudget = { remaining: 0, limit: 30, observedAt: T0 };
    expect(effectiveBudget(noRetry, T0 + 59_999)).toEqual(noRetry);
    expect(effectiveBudget(noRetry, T0 + 60_000)).toBeNull();
  });
});

describe('P421 · rateLimitSecondsLeft counts down, never below zero', () => {
  it('reports ceil of the real milliseconds left', () => {
    expect(rateLimitSecondsLeft(exhausted, T0 + 800)).toBe(12); // 11.2 s remain
    expect(rateLimitSecondsLeft(exhausted, T0 + 11_000)).toBe(1); // 1 s remains
    expect(rateLimitSecondsLeft(exhausted, T0 + 12_000)).toBe(0); // expired
    expect(rateLimitSecondsLeft(exhausted, T0 + 999_999)).toBe(0);
  });
});

describe('P421 · the hint can never show a fossil number', () => {
  it('states the live seconds left at the observation instant', () => {
    const hint = rateLimitHint(exhausted, T0);
    expect(hint).toContain('12');
    expect(hint).toContain('秒');
    expect(hint).toContain('到上限了');
  });

  it('counts down instead of freezing on the first reading', () => {
    expect(rateLimitHint(exhausted, T0 + 5_000)).toContain('7');
    expect(rateLimitHint(exhausted, T0 + 11_500)).toContain('1');
  });

  it('renders nothing at all once the retry window has reopened', () => {
    expect(rateLimitHint(exhausted, T0 + 12_000)).toBeNull();
    expect(rateLimitHint(exhausted, T0 + 60_000)).toBeNull();
  });

  it('expires a low-budget warning when its minute is over', () => {
    const low: RateLimitBudget = { remaining: 3, limit: 30, observedAt: T0 };
    expect(rateLimitHint(low, T0)).toBe('这一分钟快到上限了，稍等几秒再问');
    expect(rateLimitHint(low, T0 + 60_000)).toBeNull();
    expect(rateLimitHint(low, T0 + 3_600_000)).toBeNull();
  });

  it('keeps the no-Retry-After exhausted sentence while its 60 s window lives', () => {
    const noRetry: RateLimitBudget = { remaining: 0, limit: 30, observedAt: T0 };
    expect(rateLimitHint(noRetry, T0 + 30_000)).toBe(
      '这一分钟到上限了，稍等一下再问',
    );
    expect(rateLimitHint(noRetry, T0 + 60_000)).toBeNull();
  });
});

describe('P421 · the expiry contract is structural, not incidental', () => {
  it('makes observedAt a required RateLimitBudget field', () => {
    const iface = rateLimitTs.slice(
      rateLimitTs.indexOf('interface RateLimitBudget'),
      rateLimitTs.indexOf('}', rateLimitTs.indexOf('interface RateLimitBudget')),
    );
    expect(iface).toContain('observedAt: number');
    expect(iface).not.toContain('observedAt?');
  });

  it('routes the stored snapshot through effectiveBudget in the composer', () => {
    expect(inputBarTsx).toContain('effectiveBudget(rateLimit');
    expect(inputBarTsx).toContain('setInterval');
  });
});
