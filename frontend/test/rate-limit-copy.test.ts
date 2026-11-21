/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseRateLimit,
  rateLimitHint,
  rateLimitWarning,
  type HeaderReader,
} from '../src/lib/rateLimitStatus';

/**
 * P190 named the window and unit on the old 「剩余请求 29/30」 chip; P256 went
 * further after a real walkthrough showed the 「本分钟还可提问 N 次」 countdown
 * only made the budget feel like it was running out. The meter is gone: a
 * comfortable minute renders nothing, a nearly-spent one gets a human
 * sentence, and an exhausted window states its recovery time. These tests
 * lock that contract at the pure-function level plus source-level checks on
 * the chip markup (no DOM renderer here).
 */

const headers = (pairs: Record<string, string>): HeaderReader => ({
  get: (name) => pairs[name.toLowerCase()] ?? null,
});

/** P421: budgets carry observedAt — pin one instant for deterministic reads. */
const NOW = 1_800_000_000_000;

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const inputBarTsx = readFileSync(join(SRC, 'components', 'InputBar.tsx'), 'utf8');
const inputBarCss = readFileSync(join(SRC, 'components', 'InputBar.css'), 'utf8');

describe('P190/P256 · the hint speaks only when the minute is nearly spent', () => {
  it('renders nothing while the budget is comfortable', () => {
    expect(rateLimitHint({ remaining: 29, limit: 30, observedAt: NOW }, NOW)).toBeNull();
    expect(rateLimitHint({ remaining: 10, limit: 30, observedAt: NOW }, NOW)).toBeNull();
  });

  it('reads as a human sentence below 10, never a count', () => {
    for (const remaining of [9, 5, 1]) {
      const hint = rateLimitHint({ remaining, limit: 30, observedAt: NOW }, NOW);
      expect(hint).not.toBeNull();
      expect(hint).not.toContain('次');
      expect(hint).not.toContain('还可提问');
      expect(hint).not.toMatch(/\d/);
    }
  });

  it('states the real recovery time while a Retry-After window is active', () => {
    const hint = rateLimitHint(
      { remaining: 0, limit: 30, retryAfterSec: 42, observedAt: NOW },
      NOW,
    );
    expect(hint).toContain('42');
    expect(hint).toContain('秒');
    expect(hint).not.toBe('本分钟还可提问 0 次');
    expect(hint).not.toBe(
      rateLimitHint({ remaining: 0, limit: 30, observedAt: NOW }, NOW),
    );
  });

  it('still speaks when exhausted without a retry window, and a stray '
    + 'retry-after on a healthy budget stays silent', () => {
    expect(rateLimitHint({ remaining: 0, limit: 30, observedAt: NOW }, NOW)).toBe(
      '这一分钟到上限了，稍等一下再问',
    );
    expect(
      rateLimitHint({ remaining: 12, limit: 30, retryAfterSec: 5, observedAt: NOW }, NOW),
    ).toBeNull();
  });
});

describe('P190/P256 · warn tier and visibility', () => {
  it('warns only at low budget (≤ 5)', () => {
    expect(rateLimitWarning({ remaining: 5, limit: 30, observedAt: NOW })).toBe(true);
    expect(rateLimitWarning({ remaining: 6, limit: 30, observedAt: NOW })).toBe(false);
    expect(rateLimitWarning({ remaining: 30, limit: 30, observedAt: NOW })).toBe(false);
  });

  it('visibility is all-or-nothing: ≥ 10 hidden, < 10 shown', () => {
    expect(rateLimitHint({ remaining: 11, limit: 30, observedAt: NOW }, NOW)).toBeNull();
    expect(rateLimitHint({ remaining: 10, limit: 30, observedAt: NOW }, NOW)).toBeNull();
    expect(rateLimitHint({ remaining: 9, limit: 30, observedAt: NOW }, NOW)).not.toBeNull();
    expect(rateLimitHint({ remaining: 3, limit: 30, observedAt: NOW }, NOW)).not.toBeNull();
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
      NOW,
    );
    expect(budget).toEqual({ remaining: 0, limit: 30, retryAfterSec: 42, observedAt: NOW });
  });

  it('ignores a garbage retry-after without sinking the budget', () => {
    const budget = parseRateLimit(
      headers({
        'x-ratelimit-limit': '30',
        'x-ratelimit-remaining': '7',
        'retry-after': 'soon-ish',
      }),
      NOW,
    );
    expect(budget).toEqual({ remaining: 7, limit: 30, observedAt: NOW });
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

describe('P256 · chip markup only exists while a hint is shown', () => {
  it('renders nothing at all when the hint is null', () => {
    expect(inputBarTsx).toContain('{rateHint !== null && (');
  });

  it('keeps the per-minute reset explanation on the visible chip', () => {
    const chipStart = inputBarTsx.indexOf('{rateHint !== null && (');
    const chipEnd = inputBarTsx.indexOf('</span>', chipStart);
    const chip = inputBarTsx.slice(chipStart, chipEnd);
    expect(chip).toContain('每分钟重置');
    expect(chip).toContain('title="每分钟重置"');
    expect(chip).toContain('aria-label={`${rateHint}，每分钟重置`}');
    expect(chip).toContain('{rateHint}');
  });

  it('applies warn via rateLimitWarning and drops the old meter machinery', () => {
    expect(inputBarTsx).toContain('rateLimitWarning(liveBudget)');
    expect(inputBarTsx).not.toContain('rateLimitDim');
    expect(inputBarTsx).not.toContain('formatRateLimit');
    expect(inputBarTsx).not.toContain('还可提问');
  });

  it('keeps the chip on one line so a 390px viewport never wraps it', () => {
    const blockStart = inputBarCss.indexOf('.rate-limit-indicator {');
    const block = inputBarCss.slice(blockStart, inputBarCss.indexOf('}', blockStart));
    expect(block).toContain('white-space: nowrap');
    expect(block).toContain('overflow: hidden');
    expect(block).toContain('max-width:');
  });
});
