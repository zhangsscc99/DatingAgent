/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * P391 — at 1440×900 the assistant bubble column resolved to ~686 px of
 * 14 px body text, i.e. ~49 CJK glyphs per line — above the comfortable
 * 36–42 the walkthrough measured (docs/PRODUCT-REVIEW.md Round 100,
 * walk-1795109419-d2.png). The fix narrows the shared reading column
 * (--column-max 720→660 px, still one token consumed by .messages > *,
 * .input-column and .welcome) and gives the desktop bubble body 16 px /
 * 1.7. Resolved arithmetic:
 *
 *   column        = --column-max (desktop :root only)     = 660 px
 *   bubble outer  = min(column, 100% of row)              = 660 px ≤ 680
 *   bubble text   = outer − 2·16 padding − 2·1 border      = 626 px
 *   CJK per line  = ⌊text / font-size⌋ = ⌊626 / 16⌋         = 39 ≤ 42
 *
 * No layout engine ships with this repo, so widths are resolved from the
 * declared CSS values — the same style as desktop-measure.test.ts. The
 * mobile breakpoint is untouched: --column-max stays declared only
 * inside the (min-width: 769px) :root block and the base .bubble rule
 * keeps 14 px / 1.65.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const indexCss = read('index.css');
const bubbleCss = read('components/MessageBubble.css');
const chatWindowCss = read('components/ChatWindow.css');
const inputBarCss = read('components/InputBar.css');

const DESKTOP_QUERY = '(min-width: 769px)';
const MOBILE_QUERY = '(max-width: 768px)';

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

/** Raw `max-width:` declaration text of a rule body. */
function maxWidthDecl(rule: string): string | null {
  return /max-width:\s*([^;]+)/.exec(rule)?.[1].trim() ?? null;
}

/**
 * Resolve a max-width declaration to px at the desktop breakpoint:
 * a `Npx` literal, `var(--name)` (followed to its px declaration in
 * `css`), or `var(--name, fallback)` (the fallback only if the variable
 * has no px declaration — mirroring the <769px undefined state).
 */
function resolvePx(decl: string, css: string): number | null {
  const text = decl.trim();
  const px = /^([0-9.]+)px$/.exec(text);
  if (px) return parseFloat(px[1]);
  const varRef = /^var\((--[\w-]+)\s*(?:,\s*([^()]+))?\)$/.exec(text);
  if (varRef) {
    const hit = new RegExp(
      `${varRef[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*([0-9.]+)px`,
    ).exec(css);
    if (hit) return parseFloat(hit[1]);
    return varRef[2] ? resolvePx(varRef[2], css) : null;
  }
  return null;
}

/** Numeric value of a simple `prop: Npx` declaration. */
function pxDecl(rule: string, prop: string): number | null {
  const m = new RegExp(`${prop}:\\s*([0-9.]+)px`).exec(rule);
  return m ? parseFloat(m[1]) : null;
}

const columnMax = (() => {
  const raw = /--column-max:\s*([0-9.]+)px/.exec(indexCss)?.[1];
  return raw ? parseFloat(raw) : null;
})();

const bubbleDesktop = mediaBlock(bubbleCss, DESKTOP_QUERY);
const bubbleBase = ruleBody(bubbleCss, '.bubble');

// The bubble is the assistant row's only in-flow child (avatar hangs in
// the gutter): its 100% cap resolves to the full shared column.
const bubbleOuterPx = columnMax ?? 0;
const padDecl = /padding:\s*([0-9.]+)px\s+([0-9.]+)px/.exec(bubbleBase);
const padX = padDecl ? parseFloat(padDecl[2]) : 0;
const borderPx =
  pxDecl(ruleBody(bubbleCss, '.bubble.assistant'), 'border') ?? 0;
const bubbleTextPx = bubbleOuterPx - 2 * padX - 2 * borderPx;

// Desktop body type: the ≥769px override wins over the base 14px rule.
const desktopFontPx =
  pxDecl(ruleBody(bubbleDesktop, '.bubble'), 'font-size') ??
  pxDecl(bubbleBase, 'font-size');

describe('P391 · desktop reading column holds ≤42 CJK per line', () => {
  it('caps the assistant bubble outer width at ≤680 px', () => {
    expect(columnMax).not.toBeNull();
    // The token still lives inside the (min-width: 769px) :root block.
    expect(
      ruleBody(mediaBlock(indexCss, DESKTOP_QUERY), ':root'),
    ).toContain('--column-max');
    // The assistant bubble spans the shared column edge to edge, so its
    // outer box IS the column.
    expect(maxWidthDecl(ruleBody(bubbleCss, '.bubble.assistant'))).toBe(
      '100%',
    );
    expect(bubbleOuterPx).toBe(columnMax);
    expect(bubbleOuterPx).toBeLessThanOrEqual(680);
    // …while staying wide enough to read as a column, not a strip.
    expect(bubbleOuterPx).toBeGreaterThanOrEqual(600);
  });

  it('resolves ≤42 CJK characters per rendered line', () => {
    expect(padX).toBe(16);
    expect(borderPx).toBe(1);
    expect(bubbleTextPx).toBe(626);
    expect(desktopFontPx).not.toBeNull();
    // One CJK glyph advances ≈1em: chars/line = ⌊text / font-size⌋.
    const charsPerLine = Math.floor(bubbleTextPx / desktopFontPx!);
    expect(charsPerLine).toBeLessThanOrEqual(42);
    expect(charsPerLine).toBeGreaterThanOrEqual(30);
  });

  it('keeps the desktop bubble body at 15–16 px with line-height 1.7', () => {
    expect(desktopFontPx!).toBeGreaterThanOrEqual(15);
    expect(desktopFontPx!).toBeLessThanOrEqual(16);
    const desktopRule = ruleBody(bubbleDesktop, '.bubble');
    expect(desktopRule).toMatch(/line-height:\s*1\.7\b/);
  });

  it('keeps the whole desktop column on the one shared token', () => {
    // Messages, composer and welcome card all resolve --column-max, so
    // narrowing the token narrows every edge identically.
    expect(
      resolvePx(
        maxWidthDecl(ruleBody(topLevel(chatWindowCss), '.messages > *')) ??
          '',
        indexCss,
      ),
    ).toBe(columnMax);
    expect(
      resolvePx(
        maxWidthDecl(ruleBody(topLevel(inputBarCss), '.input-column')) ??
          '',
        indexCss,
      ),
    ).toBe(columnMax);
    expect(
      resolvePx(
        maxWidthDecl(ruleBody(topLevel(chatWindowCss), '.welcome')) ?? '',
        indexCss,
      ),
    ).toBe(columnMax);
    expect(resolvePx(maxWidthDecl(ruleBody(bubbleCss, '.bubble-row')) ?? '', indexCss)).toBe(
      columnMax,
    );
  });

  it('leaves the ≤768 px layout on its pre-column values', () => {
    // No top-level px value → --column-max is undefined under the mobile
    // breakpoint and every var() reference keeps its fallback.
    expect(topLevel(indexCss)).not.toMatch(/--column-max:\s*[0-9.]+px/);
    // The mobile media blocks introduce neither the token nor the new
    // desktop typography — the base .bubble rule stays 14 px / 1.65.
    expect(mediaBlock(bubbleCss, MOBILE_QUERY)).not.toContain('column-max');
    expect(mediaBlock(bubbleCss, MOBILE_QUERY)).not.toContain(
      'font-size: 16px',
    );
    expect(pxDecl(bubbleBase, 'font-size')).toBe(14);
    expect(bubbleBase).toMatch(/line-height:\s*1\.65\b/);
  });
});
