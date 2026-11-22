/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rateLimitTickerActive } from '../src/lib/rateLimitStatus';

/**
 * P422 — the P421 heartbeat that counts the chip down once a second was
 * mounted on `rateLimit === null`, and App never clears the budget, so the
 * interval ran for the rest of the page's life — including the common case
 * where the budget is comfortable and no chip is on screen at all. The
 * ticker now lives behind `rateLimitTickerActive`: it only runs while a
 * hint could actually render. These tests lock that contract at the
 * pure-function level plus source-level checks on the effect wiring (no
 * DOM renderer here).
 */

const NOW = 1_800_000_000_000;

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const inputBarTsx = readFileSync(join(SRC, 'components', 'InputBar.tsx'), 'utf8');

describe('P422 · the heartbeat only runs while a hint could render', () => {
  it('never ticks without a budget', () => {
    expect(rateLimitTickerActive(null, NOW)).toBe(false);
  });

  it('stays off while the budget is comfortable — nothing renders', () => {
    expect(
      rateLimitTickerActive({ remaining: 29, limit: 30, observedAt: NOW }, NOW),
    ).toBe(false);
    expect(
      rateLimitTickerActive({ remaining: 10, limit: 30, observedAt: NOW }, NOW),
    ).toBe(false);
  });

  it('ticks while a low budget is still inside its window', () => {
    const budget = { remaining: 3, limit: 30, observedAt: NOW };
    expect(rateLimitTickerActive(budget, NOW)).toBe(true);
    expect(rateLimitTickerActive(budget, NOW + 59_000)).toBe(true);
  });

  it('stops for good once the minute window has expired', () => {
    const budget = { remaining: 3, limit: 30, observedAt: NOW };
    expect(rateLimitTickerActive(budget, NOW + 60_000)).toBe(false);
  });

  it('follows the retry-after window on an exhausted budget', () => {
    const budget = {
      remaining: 0,
      limit: 30,
      retryAfterSec: 12,
      observedAt: NOW,
    };
    expect(rateLimitTickerActive(budget, NOW + 11_000)).toBe(true);
    expect(rateLimitTickerActive(budget, NOW + 12_000)).toBe(false);
  });
});

describe('P422 · InputBar wires the heartbeat to the predicate', () => {
  it('drives the interval from rateLimitTickerActive', () => {
    expect(inputBarTsx).toContain('rateLimitTickerActive');
    expect(inputBarTsx).toContain(
      'rateLimitTickerActive(rateLimit, rateLimitNow)',
    );
    expect(inputBarTsx).toContain('if (!tickerActive) return;');
  });

  it('keys the heartbeat effect on the predicate plus the budget primitives', () => {
    expect(inputBarTsx).toContain('tickerActive,');
    expect(inputBarTsx).toContain('rateLimit?.observedAt,');
    expect(inputBarTsx).toContain('rateLimit?.remaining,');
    expect(inputBarTsx).toContain('rateLimit?.retryAfterSec,');
  });

  it('no longer mounts the interval behind a rateLimit === null check', () => {
    expect(inputBarTsx).not.toContain('[rateLimit === null]');
    expect(inputBarTsx).not.toContain('if (rateLimit === null) return;');
  });

  it('resets the tick clock whenever a fresh budget snapshot lands', () => {
    expect(inputBarTsx).toMatch(
      /useEffect\(\(\) => \{\s*setRateLimitNow\(Date\.now\(\)\);?\s*\}, \[rateLimit\]\)/,
    );
  });
});
