/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMPOSER_PLACEHOLDER_FULL,
  COMPOSER_PLACEHOLDER_NARROW,
  MIDWIDTH2_COMPOSER_MAX_WIDTH,
  MIDWIDTH2_COMPOSER_QUERY,
  MIDWIDTH_COMPOSER_MAX_WIDTH,
  MIDWIDTH_COMPOSER_MIN_HEIGHT,
  MIDWIDTH_COMPOSER_QUERY,
  NARROW_COMPOSER_MAX_WIDTH,
  SIDEBAR_WRAP_COMPOSER_MAX_WIDTH,
  SIDEBAR_WRAP_COMPOSER_QUERY,
  composerMinHeightPx,
  composerPlaceholder,
} from '../src/lib/composerPlaceholder';

/**
 * P195 — browser-measured on the live build: at 432 px and 500 px the full
 * placeholder needs an 84 px scrollHeight inside a 60 px textarea, so the
 * last line is clipped; 390 px (short copy), 600 px and 768 px are fine.
 * The fix grows the textarea via a min-height media query for the 431–599
 * px band only. jsdom has no layout engine, so these tests assert the
 * pure min-height/copy helpers plus source-level checks on the CSS.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const inputBarCss = readFileSync(
  join(SRC, 'components', 'InputBar.css'),
  'utf8',
);
const inputBarTsx = readFileSync(
  join(SRC, 'components', 'InputBar.tsx'),
  'utf8',
);

describe('P195 · mid-width composer placeholder clipping', () => {
  it('grows the composer inside the 431–599 px band', () => {
    expect(composerMinHeightPx(390)).toBe(48);
    expect(composerMinHeightPx(430)).toBe(48);
    expect(composerMinHeightPx(431)).toBe(MIDWIDTH_COMPOSER_MIN_HEIGHT);
    expect(composerMinHeightPx(432)).toBe(MIDWIDTH_COMPOSER_MIN_HEIGHT);
    expect(composerMinHeightPx(500)).toBe(MIDWIDTH_COMPOSER_MIN_HEIGHT);
    expect(composerMinHeightPx(599)).toBe(MIDWIDTH_COMPOSER_MIN_HEIGHT);
    expect(composerMinHeightPx(768)).toBe(48);
    expect(composerMinHeightPx(1440)).toBe(44);
  });

  it('the taller box fits the measured three-line scrollHeight', () => {
    // Measured scrollHeight at 432/500 px was 84; border-box min-height of
    // 88 leaves an 86 px clientHeight (two 1 px borders) — the placeholder
    // shows in full instead of losing its last line.
    expect(MIDWIDTH_COMPOSER_MIN_HEIGHT).toBe(88);
    expect(MIDWIDTH_COMPOSER_MIN_HEIGHT - 2).toBeGreaterThanOrEqual(84);
  });

  it('the media query matches the band constants', () => {
    expect(MIDWIDTH_COMPOSER_MAX_WIDTH).toBe(599);
    expect(NARROW_COMPOSER_MAX_WIDTH).toBe(430);
    expect(MIDWIDTH_COMPOSER_QUERY).toBe(
      '(min-width: 431px) and (max-width: 599px)',
    );
  });

  it('the CSS grows only the textarea inside the band', () => {
    expect(inputBarCss).toContain(
      '@media (min-width: 431px) and (max-width: 599px)',
    );
    const band = inputBarCss.slice(
      inputBarCss.indexOf('@media (min-width: 431px) and (max-width: 599px)'),
    );
    expect(band).toContain('.input-bar textarea');
    expect(band).toContain('min-height: 88px');
    // The band rule must come after the ≤768 px block so it overrides the
    // 48 px mobile min-height.
    expect(inputBarCss.indexOf('@media (max-width: 768px)')).toBeLessThan(
      inputBarCss.indexOf('@media (min-width: 431px) and (max-width: 599px)'),
    );
    // Send button is untouched by the band.
    expect(band).not.toContain('.input-send');
  });

  it('placeholder copy still swaps only at ≤430 px', () => {
    expect(composerPlaceholder(390)).toBe(COMPOSER_PLACEHOLDER_NARROW);
    expect(composerPlaceholder(432)).toBe(COMPOSER_PLACEHOLDER_FULL);
    expect(composerPlaceholder(500)).toBe(COMPOSER_PLACEHOLDER_FULL);
    expect(composerPlaceholder(600)).toBe(COMPOSER_PLACEHOLDER_FULL);
    expect(composerPlaceholder(768)).toBe(COMPOSER_PLACEHOLDER_FULL);
  });

  it('the textarea, aria-label and send behaviour are unchanged', () => {
    expect(inputBarTsx).toContain('aria-label={COMPOSER_PLACEHOLDER_FULL}');
    expect(inputBarTsx).toContain('enterKeyHint="send"');
    expect(inputBarTsx).toContain('if (!shouldSubmitOnEnter(e)) return;');
  });
});

/**
 * P241 — live re-measure at 2026-11-17: the clip continues past the
 * 431–599 px band. At 600–695 px the tool row still squeezes the textarea
 * (scrollHeight 72 vs clientHeight 48); at 769–955 px the persistent
 * sidebar squeezes it to ~250–425 px (66 vs 45). Both bands now reuse the
 * 88 px min-height, while 696–768 px and ≥956 px keep the base height
 * because the placeholder fits on one line there.
 */
describe('P241 · composer placeholder wrap bands beyond 599 px', () => {
  it('returns the tall height inside both newly measured wrap bands', () => {
    // 600–695 px continuation band (same layout as 431–599, tool row inline).
    for (const width of [600, 640, 680, 695]) {
      expect(composerMinHeightPx(width)).toBe(MIDWIDTH_COMPOSER_MIN_HEIGHT);
    }
    // 769–955 px sidebar-squeeze band.
    for (const width of [769, 780, 880, 950, 955]) {
      expect(composerMinHeightPx(width)).toBe(MIDWIDTH_COMPOSER_MIN_HEIGHT);
    }
  });

  it('keeps the base height where the placeholder fits on one line', () => {
    expect(composerMinHeightPx(696)).toBe(48);
    expect(composerMinHeightPx(700)).toBe(48);
    expect(composerMinHeightPx(768)).toBe(48);
    expect(composerMinHeightPx(956)).toBe(44);
    expect(composerMinHeightPx(1100)).toBe(44);
    expect(composerMinHeightPx(1440)).toBe(44);
  });

  it('the media queries match the band constants', () => {
    expect(MIDWIDTH2_COMPOSER_MAX_WIDTH).toBe(695);
    expect(MIDWIDTH2_COMPOSER_QUERY).toBe(
      '(min-width: 600px) and (max-width: 695px)',
    );
    expect(SIDEBAR_WRAP_COMPOSER_MAX_WIDTH).toBe(955);
    expect(SIDEBAR_WRAP_COMPOSER_QUERY).toBe(
      '(min-width: 769px) and (max-width: 955px)',
    );
  });

  it('the CSS grows only the textarea inside each new band', () => {
    for (const query of [
      '@media (min-width: 600px) and (max-width: 695px)',
      '@media (min-width: 769px) and (max-width: 955px)',
    ]) {
      expect(inputBarCss).toContain(query);
      const start = inputBarCss.indexOf(query);
      const next = inputBarCss.indexOf('@media', start + 1);
      const band = inputBarCss.slice(start, next === -1 ? undefined : next);
      expect(band).toContain('.input-bar textarea');
      expect(band).toContain('min-height: 88px');
      // The composer tool row is untouched by the band.
      expect(band).not.toContain('.input-send');
      expect(band).not.toContain('.input-tools');
      expect(band).not.toContain('.reply-length-toggle');
      // The band rules come after the ≤768 px block so they override the
      // 48 px mobile min-height (600–695 px band).
      expect(inputBarCss.indexOf('@media (max-width: 768px)')).toBeLessThan(
        start,
      );
    }
  });

  it('placeholder copy tiers are untouched by the new bands', () => {
    expect(composerPlaceholder(390)).toBe(COMPOSER_PLACEHOLDER_NARROW);
    for (const width of [431, 600, 680, 780, 880, 950, 1440]) {
      expect(composerPlaceholder(width)).toBe(COMPOSER_PLACEHOLDER_FULL);
    }
  });
});
