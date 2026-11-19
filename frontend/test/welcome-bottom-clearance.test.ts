/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * P307 — at 390×844 the welcome column overflows `.messages` by ~69px
 * (measured scrollHeight 695 / clientHeight 626) and the third feature
 * card「约会前把安排想清楚」lands flush on the composer, so the first screen
 * reads as half-loaded. The fix lives in the ≤768px block of ChatWindow.css:
 * the welcome block's top-side rhythm is tightened (~40px of lift) and its
 * padding-bottom is raised to at least the composer's own height, so the
 * last card is fully visible at first paint and — whenever the column still
 * overflows — scrolling to the end leaves it clear of the input bar.
 *
 * P337 — P336 collapsed the three feature cards into one quiet line, so the
 * column no longer overflows at 390×844 and the composer-height pad lost
 * its job: inside the centred block it pushed the visible content ~75px
 * above middle and left a dead gap above the composer. The pad is now a
 * modest near-symmetric one (24px) — the equal .messages bookends centre
 * the block; the tightened top rhythm and the desktop rules below are
 * unchanged.
 *
 * No DOM renderer ships with this repo, so the geometry is asserted on the
 * resolved CSS values in the style of desktop-column-width.test.ts /
 * sidebar-390-overflow.test.ts: the composer height is derived from the
 * InputBar.css constants, and the welcome padding now stays well under it.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const chatWindowCss = read('components/ChatWindow.css');
const inputBarCss = read('components/InputBar.css');

/** Slice the body of `@media <query> { … }` with brace matching. */
function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media ${query}`);
  if (start < 0) return '';
  const openBrace = css.indexOf('{', start);
  let depth = 0;
  for (let i = openBrace; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(openBrace + 1, i);
    }
  }
  return '';
}

/** Strip every @media block so only top-level rules remain. */
function topLevel(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at < 0) return out + css.slice(i);
    out += css.slice(i, at);
    const openBrace = css.indexOf('{', at);
    let depth = 0;
    let j = openBrace;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    i = j + 1;
  }
  return out;
}

/** Declaration body of `selector { … }` — exact selector match. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : '';
}

/** First `Npx`/`0` components of a shorthand/longhand declaration, in order. */
function declPxValues(rule: string, prop: string): number[] {
  const decl = new RegExp(`${prop}:\\s*([^;]+)`).exec(rule)?.[1].trim();
  if (!decl) return [];
  const m = /^([0-9.]+)(?:px)?(?:\s+([0-9.]+)(?:px)?)?(?:\s+([0-9.]+)(?:px)?)?(?:\s+([0-9.]+)(?:px)?)?$/.exec(
    decl,
  );
  if (!m) return [];
  return m.slice(1).filter((v) => v !== undefined).map(Number);
}

/** Bottom component of a `padding` shorthand (CSS 1–4 value rules). */
function paddingBottomPx(rule: string): number | null {
  const longhand = declPxValues(rule, 'padding-bottom');
  if (longhand.length === 1) return longhand[0];
  const values = declPxValues(rule, 'padding');
  if (values.length === 0) return null;
  // 1 value → all sides; 2 → v h; 3 → t h b; 4 → t r b l.
  return values[values.length >= 3 ? 2 : 0];
}

/** Top component of a `margin`/`padding` shorthand. */
function boxTopPx(rule: string, prop: string): number | null {
  const values = declPxValues(rule, prop);
  return values.length ? values[0] : null;
}

const mobileChat = mediaBlock(chatWindowCss, '(max-width: 768px)');
const mobileInput = mediaBlock(inputBarCss, '(max-width: 768px)');

/**
 * Composer height modelled from the mobile CSS constants: .input-bar
 * padding (top+bottom) + one textarea row + one tool row + the fixed
 * busy-enter-hint row + the column row-gaps between them.
 */
function composerHeightPx(): number {
  // The mobile .input-bar padding lives in ChatWindow.css's ≤768px block.
  const barPadding =
    declPxValues(ruleBody(mobileChat, '.input-bar'), 'padding').length
      ? declPxValues(ruleBody(mobileChat, '.input-bar'), 'padding')
      : declPxValues(ruleBody(mobileInput, '.input-bar'), 'padding');
  const barPadY = barPadding.length ? barPadding[0] * 2 : 0;
  const textarea = declPxValues(
    ruleBody(mobileInput, '.input-bar textarea'),
    'min-height',
  )[0];
  const toolRow = Math.max(
    declPxValues(ruleBody(mobileInput, '.input-bar .input-send'), 'height')[0] ?? 0,
    declPxValues(ruleBody(mobileInput, '.input-hint-btn'), 'height')[0] ?? 0,
    declPxValues(ruleBody(mobileInput, '.reply-length-toggle'), 'height')[0] ?? 0,
  );
  const hintRow = declPxValues(
    ruleBody(topLevel(inputBarCss), '.busy-enter-hint'),
    'height',
  )[0];
  const rowGap = declPxValues(
    ruleBody(topLevel(inputBarCss), '.input-column'),
    'row-gap',
  )[0];
  return barPadY + textarea + toolRow + hintRow + rowGap * 2;
}

describe('P307 · welcome bottom clearance (≤768px)', () => {
  it('keeps a modest scroll-end air gap — the composer-height pad is gone (P337)', () => {
    const welcome = ruleBody(mobileChat, '.welcome');
    expect(welcome).not.toBe('');
    const padBottom = paddingBottomPx(welcome);
    expect(padBottom).not.toBeNull();
    // Derived from InputBar.css: ~150px at ≤768px (measured 153px live).
    // P337: the pad no longer needs to swallow the composer — the overflow
    // it guarded is gone — it only leaves breathing room at scroll end:
    // no less than the pad-top, and well under the composer's own height.
    expect(composerHeightPx()).toBeGreaterThanOrEqual(140);
    const padTop = boxTopPx(welcome, 'padding')!;
    expect(padBottom!).toBeGreaterThanOrEqual(padTop);
    expect(padBottom!).toBeLessThanOrEqual(composerHeightPx() / 2);
  });

  it('lifts the whole welcome block so the third card clears the composer at first paint', () => {
    // The measured overflow at 390×844 was ~69px with the card bottom ~3px
    // above the composer — the fix must reclaim ≥ ~40px of top-side rhythm
    // so the last card sits visibly clear instead of flush on the input bar.
    const welcome = ruleBody(mobileChat, '.welcome');
    const padTop = boxTopPx(welcome, 'padding');
    expect(padTop).not.toBeNull();
    expect(padTop!).toBeLessThanOrEqual(12); // was 24

    const subtitleMargin = declPxValues(
      ruleBody(mobileChat, '.welcome > p'),
      'margin-bottom',
    )[0];
    expect(subtitleMargin).toBeLessThanOrEqual(14); // was 20

    const ctaMargin = declPxValues(
      ruleBody(mobileChat, '.welcome-cta'),
      'margin-bottom',
    )[0];
    expect(ctaMargin).toBeLessThanOrEqual(18); // was 28

    const chipsMargin = declPxValues(
      ruleBody(mobileChat, '.starter-chips'),
      'margin',
    );
    expect(chipsMargin.length).toBeGreaterThan(0);
    expect(chipsMargin[0]).toBeLessThanOrEqual(10); // was 16 top
    expect(chipsMargin[chipsMargin.length >= 3 ? 2 : 0]).toBeLessThanOrEqual(6); // was 8 bottom

    // P380: the .welcome-features card grid is gone at every width —
    // the deepest content element on mobile is now the .hero-cta group,
    // whose internal gap stays inside the same tightened budget.
    const heroGap = declPxValues(
      ruleBody(topLevel(chatWindowCss), '.hero-cta'),
      'gap',
    )[0];
    expect(heroGap).toBeLessThanOrEqual(12); // was .welcome-features 16, ×2 gaps
  });

  it('keeps the ≥69px measured overflow covered: lift + padding ≥ the clip', () => {
    // First paint shows the top of the scroll content; the last feature
    // card is the deepest content element, so its clearance equals
    // (scrollport bottom − card bottom) = composer top − card bottom.
    // The tightened rhythm moves the card up while the padding only extends
    // the scrollable tail — assert the combined headroom beats the measured
    // ~69px overflow with margin to spare.
    const padTop = boxTopPx(ruleBody(mobileChat, '.welcome'), 'padding')!;
    const subMargin = declPxValues(
      ruleBody(mobileChat, '.welcome > p'),
      'margin-bottom',
    )[0]!;
    const ctaMargin = declPxValues(
      ruleBody(mobileChat, '.welcome-cta'),
      'margin-bottom',
    )[0]!;
    const chipsTop = declPxValues(
      ruleBody(mobileChat, '.starter-chips'),
      'margin',
    )[0]!;
    // P380: .welcome-features is gone — the .hero-cta group is the
    // deepest hero element now, so its internal gap stands in for the
    // card-grid term.
    const gap = declPxValues(
      ruleBody(topLevel(chatWindowCss), '.hero-cta'),
      'gap',
    )[0]!;
    const lift =
      24 - padTop +
      (20 - subMargin) +
      (28 - ctaMargin) +
      (16 - chipsTop) +
      (16 - gap) * 2;
    expect(lift).toBeGreaterThanOrEqual(40);
  });

  it('does not disturb the desktop welcome padding or centred look', () => {
    const desktop = ruleBody(topLevel(chatWindowCss), '.welcome');
    expect(desktop).toContain('margin: auto');
    expect(desktop).toContain('padding: 40px 20px');
    // The oversized bottom padding must stay inside the ≤768px block —
    // the P305 bookends keep centring the card on 1440×900.
    expect(paddingBottomPx(desktop)).toBeLessThanOrEqual(40);
    const desktopBlock = mediaBlock(chatWindowCss, '(min-width: 769px)');
    expect(desktopBlock).not.toContain('.welcome');
  });
});
