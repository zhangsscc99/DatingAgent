/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  formatRateLimit,
  parseRateLimit,
  rateLimitDim,
  rateLimitWarning,
  type HeaderReader,
} from '../src/lib/rateLimitStatus';

/**
 * P190 — the old 「剩余请求 29/30」 chip was jargon: nothing said the window was
 * a minute or when it reset. The copy must name the window and unit, the
 * tooltip/aria must explain the per-minute reset, and a Retry-After window
 * must surface its countdown. These tests lock the copy at the pure-function
 * level plus source-level checks on the chip markup (no DOM renderer here).
 */

const headers = (pairs: Record<string, string>): HeaderReader => ({
  get: (name) => pairs[name.toLowerCase()] ?? null,
});

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const inputBarTsx = readFileSync(join(SRC, 'components', 'InputBar.tsx'), 'utf8');
const inputBarCss = readFileSync(join(SRC, 'components', 'InputBar.css'), 'utf8');

describe('P190 · chip copy is self-explanatory', () => {
  it('names the window and the unit', () => {
    const copy = formatRateLimit({ remaining: 29, limit: 30 });
    expect(copy).toBe('本分钟还可提问 29 次');
    expect(copy).toContain('本分钟');
    expect(copy).toContain('次');
  });

  it('shows the countdown while a Retry-After window is active', () => {
    const copy = formatRateLimit({ remaining: 0, limit: 30, retryAfterSec: 42 });
    expect(copy).toContain('额度已用完');
    expect(copy).toContain('42 秒');
    expect(copy).not.toBe(formatRateLimit({ remaining: 0, limit: 30 }));
  });

  it('keeps the plain copy when retry-after is absent or irrelevant', () => {
    expect(formatRateLimit({ remaining: 0, limit: 30 })).toBe('本分钟还可提问 0 次');
    // A stray retry-after on a non-exhausted budget must not lie.
    expect(formatRateLimit({ remaining: 12, limit: 30, retryAfterSec: 5 })).toBe(
      '本分钟还可提问 12 次',
    );
  });
});

describe('P190 · warn/dim tiers', () => {
  it('warns only at low budget (≤ 5)', () => {
    expect(rateLimitWarning({ remaining: 5, limit: 30 })).toBe(true);
    expect(rateLimitWarning({ remaining: 6, limit: 30 })).toBe(false);
    expect(rateLimitWarning({ remaining: 30, limit: 30 })).toBe(false);
  });

  it('dims only above 10 remaining, and never when warning', () => {
    expect(rateLimitDim({ remaining: 11, limit: 30 })).toBe(true);
    expect(rateLimitDim({ remaining: 10, limit: 30 })).toBe(false);
    expect(rateLimitDim({ remaining: 3, limit: 30 })).toBe(false);
  });
});

describe('P190 · retry-after parsing stays tolerant', () => {
  it('attaches retryAfterSec when the header is a valid count', () => {
    const budget = parseRateLimit(
      headers({
        'x-ratelimit-limit': '30',
        'x-ratelimit-remaining': '0',
        'retry-after': '42',
      }),
    );
    expect(budget).toEqual({ remaining: 0, limit: 30, retryAfterSec: 42 });
  });

  it('ignores a garbage retry-after without sinking the budget', () => {
    const budget = parseRateLimit(
      headers({
        'x-ratelimit-limit': '30',
        'x-ratelimit-remaining': '7',
        'retry-after': 'soon-ish',
      }),
    );
    expect(budget).toEqual({ remaining: 7, limit: 30 });
  });

  it('still returns null when the required pair is missing or garbage', () => {
    expect(parseRateLimit(headers({ 'retry-after': '42' }))).toBeNull();
    expect(
      parseRateLimit(
        headers({
          'x-ratelimit-limit': 'lots',
          'x-ratelimit-remaining': '3',
          'retry-after': '42',
        }),
      ),
    ).toBeNull();
  });
});

describe('P190 · chip markup explains itself', () => {
  it('renders nothing when the budget is unknown', () => {
    expect(inputBarTsx).toContain('{rateLimit !== null && (');
  });

  it('mentions the per-minute reset in title and aria-label', () => {
    const chipStart = inputBarTsx.indexOf('{rateLimit !== null && (');
    const chipEnd = inputBarTsx.indexOf('</span>', chipStart);
    const chip = inputBarTsx.slice(chipStart, chipEnd);
    expect(chip).toContain('每分钟重置');
    expect(chip).toContain('title={`每分钟最多提问 ${rateLimit.limit} 次，每分钟重置`}');
    expect(chip).toContain('aria-label={`${formatRateLimit(rateLimit)}，每分钟重置`}');
  });

  it('applies warn only via rateLimitWarning and dim via rateLimitDim', () => {
    expect(inputBarTsx).toContain("rateLimitWarning(rateLimit) ? 'warn' : ''");
    expect(inputBarTsx).toContain("rateLimitDim(rateLimit) ? 'dim' : ''");
  });

  it('keeps the chip on one line so a 390px viewport never wraps it', () => {
    const blockStart = inputBarCss.indexOf('.rate-limit-indicator {');
    const block = inputBarCss.slice(blockStart, inputBarCss.indexOf('}', blockStart));
    expect(block).toContain('white-space: nowrap');
    expect(block).toContain('overflow: hidden');
    expect(block).toContain('max-width:');
  });
});
