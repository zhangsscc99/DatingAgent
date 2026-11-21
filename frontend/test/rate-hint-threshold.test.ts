/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rateLimitHint, rateLimitWarning } from '../src/lib/rateLimitStatus';

/**
 * P256 — every assistant turn used to hang a 「本分钟还可提问 N 次」 countdown
 * over the composer (29 → 28 → 27), and the same chip showed on a clean
 * welcome screen where nothing had been asked yet — while after a refresh it
 * vanished entirely. A shrinking number only created run-out anxiety. The
 * contract now: nothing while the minute is comfortable (≥ 10 left), one
 * human sentence below 10, and the real recovery time once exhausted.
 */

/** P421: budgets carry observedAt — pin one instant for deterministic reads. */
const NOW = 1_800_000_000_000;

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const inputBarTsx = readFileSync(join(SRC, 'components', 'InputBar.tsx'), 'utf8');

describe('P256 · comfortable budget renders nothing', () => {
  it.each([10, 27, 60])('remaining %i yields no visible hint', (remaining) => {
    expect(rateLimitHint({ remaining, limit: 30, observedAt: NOW }, NOW)).toBeNull();
  });
});

describe('P256 · a nearly-spent minute gets a sentence, not a meter', () => {
  it.each([9, 1])('remaining %i warns in human language', (remaining) => {
    const hint = rateLimitHint({ remaining, limit: 30, observedAt: NOW }, NOW);
    expect(hint).toBe('这一分钟快到上限了，稍等几秒再问');
    expect(hint).not.toContain('次');
    expect(hint).not.toContain('还可提问');
    expect(hint).not.toMatch(/\d/); // never a bare digit count
  });

  it('keeps the low-budget warning colour rule', () => {
    expect(rateLimitWarning({ remaining: 1, limit: 30, observedAt: NOW })).toBe(true);
    expect(rateLimitWarning({ remaining: 9, limit: 30, observedAt: NOW })).toBe(false);
  });
});

describe('P256 · an exhausted window sets the expectation', () => {
  it('names the real Retry-After recovery time', () => {
    const hint = rateLimitHint(
      { remaining: 0, limit: 30, retryAfterSec: 45, observedAt: NOW },
      NOW,
    );
    expect(hint).toContain('45');
    expect(hint).toContain('秒');
    expect(hint).not.toContain('次');
    expect(hint).not.toBe('本分钟还可提问 0 次');
    expect(hint).not.toBe('本分钟额度已用完，45 秒后可再问');
  });

  it('still yields a sentence when no retry window is known', () => {
    const hint = rateLimitHint({ remaining: 0, limit: 30, observedAt: NOW }, NOW);
    expect(hint).toBe('这一分钟到上限了，稍等一下再问');
    expect(hint).not.toContain('次');
    expect(hint).not.toMatch(/\d/);
  });
});

describe('P256 · the composer no longer carries the meter', () => {
  it('renders the chip only while a hint exists', () => {
    expect(inputBarTsx).toContain('{rateHint !== null && (');
  });

  it('contains no countdown copy anywhere in the composer', () => {
    expect(inputBarTsx).not.toContain('还可提问');
    expect(inputBarTsx).not.toContain('formatRateLimit');
    expect(inputBarTsx).not.toContain('rateLimitDim');
  });
});
