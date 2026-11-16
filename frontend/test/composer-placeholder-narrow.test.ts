/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMPOSER_PLACEHOLDER_FULL,
  COMPOSER_PLACEHOLDER_NARROW,
  NARROW_COMPOSER_MAX_WIDTH,
  NARROW_COMPOSER_QUERY,
  composerPlaceholder,
} from '../src/lib/composerPlaceholder';

/**
 * P193 — at 390×844 the composer textarea measured 50 px high while the full
 * placeholder needed 96 px (3 wrapped lines), so the hint was clipped
 * mid-line. The fix swaps in a short placeholder at ≤430 px while the
 * aria-label keeps the full description at every width. These tests lock the
 * copy at the pure-function level plus source-level checks on the markup
 * (no DOM renderer in this repo).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const inputBarTsx = readFileSync(join(SRC, 'components', 'InputBar.tsx'), 'utf8');

describe('P193 · narrow-viewport composer placeholder', () => {
  it('uses the short placeholder at and below 430 px', () => {
    expect(composerPlaceholder(390)).toBe(COMPOSER_PLACEHOLDER_NARROW);
    expect(composerPlaceholder(NARROW_COMPOSER_MAX_WIDTH)).toBe(
      COMPOSER_PLACEHOLDER_NARROW,
    );
    expect(composerPlaceholder(320)).toBe(COMPOSER_PLACEHOLDER_NARROW);
  });

  it('keeps the full original placeholder on wide viewports', () => {
    expect(composerPlaceholder(NARROW_COMPOSER_MAX_WIDTH + 1)).toBe(
      COMPOSER_PLACEHOLDER_FULL,
    );
    expect(composerPlaceholder(1440)).toBe(COMPOSER_PLACEHOLDER_FULL);
    expect(COMPOSER_PLACEHOLDER_FULL).toBe(
      '描述你的问题，例如：对方说「在干嘛」，我该怎么回？',
    );
  });

  it('the media query matches the px breakpoint constant', () => {
    expect(NARROW_COMPOSER_QUERY).toBe('(max-width: 430px)');
  });

  it('aria-label carries the full description at both widths', () => {
    // One constant feeds aria-label regardless of viewport width, so the
    // description is identical at 390 px and 1440 px.
    expect(inputBarTsx).toContain('aria-label={COMPOSER_PLACEHOLDER_FULL}');
    expect(COMPOSER_PLACEHOLDER_FULL).toContain('描述你的问题');
    const ariaLine = inputBarTsx
      .split('\n')
      .find((line) => line.includes('aria-label={COMPOSER_PLACEHOLDER_FULL}'));
    expect(ariaLine).toBeDefined();
    expect(ariaLine).not.toContain('narrowViewport');
  });

  it('the textarea placeholder branches on the narrow-viewport state', () => {
    expect(inputBarTsx).toContain('isNarrowComposerViewport');
    expect(inputBarTsx).toContain('window.matchMedia(NARROW_COMPOSER_QUERY)');
    expect(inputBarTsx).toContain(
      'narrowViewport ? COMPOSER_PLACEHOLDER_NARROW : COMPOSER_PLACEHOLDER_FULL',
    );
  });

  it('does not disturb enterKeyHint or the send behaviour', () => {
    expect(inputBarTsx).toContain('enterKeyHint="send"');
    expect(inputBarTsx).toContain('if (!shouldSubmitOnEnter(e)) return;');
  });
});
