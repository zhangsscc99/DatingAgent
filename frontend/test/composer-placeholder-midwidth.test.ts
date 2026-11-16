/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMPOSER_PLACEHOLDER_FULL,
  COMPOSER_PLACEHOLDER_NARROW,
  MIDWIDTH_COMPOSER_MAX_WIDTH,
  MIDWIDTH_COMPOSER_MIN_HEIGHT,
  MIDWIDTH_COMPOSER_QUERY,
  NARROW_COMPOSER_MAX_WIDTH,
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
  it('grows the composer only inside the 431–599 px band', () => {
    expect(composerMinHeightPx(390)).toBe(48);
    expect(composerMinHeightPx(430)).toBe(48);
    expect(composerMinHeightPx(431)).toBe(MIDWIDTH_COMPOSER_MIN_HEIGHT);
    expect(composerMinHeightPx(432)).toBe(MIDWIDTH_COMPOSER_MIN_HEIGHT);
    expect(composerMinHeightPx(500)).toBe(MIDWIDTH_COMPOSER_MIN_HEIGHT);
    expect(composerMinHeightPx(599)).toBe(MIDWIDTH_COMPOSER_MIN_HEIGHT);
    expect(composerMinHeightPx(600)).toBe(48);
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
