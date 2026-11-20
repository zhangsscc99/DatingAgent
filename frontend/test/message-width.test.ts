/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * P404 — measured at 1440×900 (walk-1795128648, vision d2): the last AI
 * bubble's `p` resolved to a 626px-wide box at 16px ≈ 39 CJK chars per
 * line, over the ~35-char comfortable reading measure — a regression of
 * the P391 fix once --column-max settled at 660px. The repair keeps the
 * shared column token at 660px (composer and welcome-card edges unmoved)
 * and caps `.bubble.assistant` at a 600px outer box inside the same
 * (min-width: 769px) block, so the p box resolves to
 * 600 − 2·16 padding − 2·1 border = 566px → ⌊566/16⌋ = 35 chars/line.
 *
 * No layout engine ships with this repo — fakeDom's getBoundingClientRect
 * returns all-zero rects — so the run card's
 * `p.getBoundingClientRect().width` contract is pinned on the identical
 * resolved arithmetic the geometry suites (thread-measure,
 * desktop-measure) already use:
 *
 *   1440×900  p = min(column 660, cap 600) − 34       = 566 ≤ 580
 *   390×844   p = 390 − 2·16 pad − 32 avatar − 10 gap
 *                 − 34                                  = 282 ≤ 330
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const indexCss = read('index.css');
const chatWindowCss = read('components/ChatWindow.css');
const bubbleCss = read('components/MessageBubble.css');

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

const columnMax =
  parseFloat(/--column-max:\s*([0-9.]+)px/.exec(indexCss)?.[1] ?? '') || null;

const bubbleDesktop = mediaBlock(bubbleCss, DESKTOP_QUERY);
const assistantMeasureCap = resolvePx(
  maxWidthDecl(ruleBody(bubbleDesktop, '.bubble.assistant')) ?? '',
  indexCss,
);
const padDecl = /padding:\s*([0-9.]+)px\s+([0-9.]+)px/.exec(
  ruleBody(bubbleCss, '.bubble'),
);
const padX = padDecl ? parseFloat(padDecl[2]) : 0;
const borderPx =
  pxDecl(ruleBody(bubbleCss, '.bubble.assistant'), 'border') ?? 0;

// Desktop: the bubble is the assistant row's only in-flow child, so its
// outer box is min(the shared column, the P404 measure cap); the p box is
// the bubble's content box.
const desktopOuter = Math.min(
  columnMax ?? 0,
  assistantMeasureCap ?? columnMax ?? 0,
);
const desktopP = desktopOuter - 2 * padX - 2 * borderPx;
const desktopFontPx =
  pxDecl(ruleBody(bubbleDesktop, '.bubble'), 'font-size') ??
  pxDecl(ruleBody(bubbleCss, '.bubble'), 'font-size')!;

// Mobile: .messages keeps its 16px side pads, the avatar is in-flow
// (32px + 10px row gap) and the bubble keeps the base 100% cap.
const mobileSidePad = pxDecl(
  ruleBody(mediaBlock(chatWindowCss, MOBILE_QUERY), '.messages'),
  'padding',
)!;
const avatarW = pxDecl(ruleBody(bubbleCss, '.avatar'), 'width')!;
const rowGap = pxDecl(ruleBody(bubbleCss, '.bubble-row'), 'gap')!;
const mobileOuter = 390 - 2 * mobileSidePad - avatarW - rowGap;
const mobileP = mobileOuter - 2 * padX - 2 * borderPx;

describe('P404 · AI bubble p reading measure', () => {
  it('resolves ≤580px at 1440×900', () => {
    expect(columnMax).toBe(660);
    // The cap is a desktop-only override: the base rule still reads
    // max-width:100% so the ≤768px layout is byte-identical.
    expect(maxWidthDecl(ruleBody(bubbleCss, '.bubble.assistant'))).toBe(
      '100%',
    );
    expect(assistantMeasureCap).toBe(600);
    expect(desktopOuter).toBe(600);
    expect(desktopOuter).toBeLessThanOrEqual(columnMax!);
    // The run-card gate: the p box resolves to 566px ≤ 580px.
    expect(desktopP).toBe(566);
    expect(desktopP).toBeLessThanOrEqual(580);
    // …which is the comfortable ~35 CJK glyphs per line at 16px.
    expect(Math.floor(desktopP / desktopFontPx)).toBeLessThanOrEqual(35);
  });

  it('resolves ≤330px at 390×844 — the mobile geometry is untouched', () => {
    // 390 − 32 (.messages pads) − 42 (avatar + row gap) = 316px bubble
    // outer → p = 316 − 34 = 282px.
    expect(mobileP).toBe(282);
    expect(mobileP).toBeLessThanOrEqual(330);
    // The measure cap must not leak under the mobile breakpoint: no
    // assistant override inside the ≤768px block.
    expect(ruleBody(mediaBlock(bubbleCss, MOBILE_QUERY), '.bubble.assistant')).toBe(
      '',
    );
  });

  it('keeps user bubbles on the base 100% cap and right-aligned rows', () => {
    expect(maxWidthDecl(ruleBody(bubbleCss, '.bubble'))).toBe('100%');
    expect(maxWidthDecl(ruleBody(bubbleDesktop, '.bubble.user'))).toBeNull();
    const userRow = ruleBody(bubbleCss, '.bubble-row.user');
    expect(userRow).toContain('align-self: flex-end');
    expect(userRow).toContain('flex-direction: row-reverse');
  });
});
