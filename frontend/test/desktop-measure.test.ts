/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * P311 — at 1440×900 the desktop rendered three different columns: AI
 * bubbles ~738 px (≈50 CJK characters per line), the composer textarea
 * ~944 px and the welcome/suggestion card ~446 px. The fix keeps ONE
 * shared reading column: --column-max (600 px) is declared only inside
 * the (min-width: 769px) :root block, so it caps .messages > *, the
 * .input-column wrapper and — via var(--column-max, 520px) — .welcome.
 * The composer tool row wraps under the textarea at ≥769px so the field
 * itself spans the column, and .bubble.assistant carries a hard 680 px
 * ceiling. Under the mobile breakpoint the token is undefined, so every
 * reference falls back to its pre-column value and 390×844 is unchanged.
 *
 * No layout engine ships with this repo, so widths are resolved from the
 * declared CSS values — the same style as desktop-column-width.test.ts.
 * The arithmetic stated here:
 *
 *   column        = --column-max                          = 600 px
 *   bubble outer  = min(column − avatar − row gap, cap)
 *                 = min(600 − 32 − 10, 680)               = 558 px
 *   bubble text   = outer − 2·16 padding − 2·1 border      = 524 px
 *   CJK per line  = ⌊text / font-size⌋ = ⌊524 / 14⌋         = 37 ≤ 40
 *   textarea      = .input-column width (tools wrapped)    = 600 px
 *   welcome outer = var(--column-max, 520px) on desktop    = 600 px
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const indexCss = read('index.css');
const chatWindowCss = read('components/ChatWindow.css');
const inputBarCss = read('components/InputBar.css');
const bubbleCss = read('components/MessageBubble.css');

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

const DESKTOP_QUERY = '(min-width: 769px)';
// InputBar.css holds an earlier `(min-width: 769px) and (max-width: 955px)`
// band, so the unadorned desktop block is located by its trailing ` {`.
const inputDesktopBlock = inputBarCss.slice(
  inputBarCss.indexOf('@media (min-width: 769px) {'),
);

const columnMaxRaw = /--column-max:\s*([0-9.]+)px/.exec(indexCss)?.[1];
const columnMax = columnMaxRaw ? parseFloat(columnMaxRaw) : null;

const messageColumn = resolvePx(
  maxWidthDecl(ruleBody(topLevel(chatWindowCss), '.messages > *')) ?? '',
  indexCss,
);
const composerColumn = resolvePx(
  maxWidthDecl(ruleBody(topLevel(inputBarCss), '.input-column')) ?? '',
  indexCss,
);
const welcomeColumn = resolvePx(
  maxWidthDecl(ruleBody(topLevel(chatWindowCss), '.welcome')) ?? '',
  indexCss,
);

// Assistant-bubble geometry: the declared hard cap and the space the
// shared column leaves inside .bubble-row (row width − avatar − gap).
const avatarPx = pxDecl(ruleBody(bubbleCss, '.avatar'), 'width') ?? 0;
const rowGapPx = pxDecl(ruleBody(bubbleCss, '.bubble-row'), 'gap') ?? 0;
const assistantCapDecl =
  maxWidthDecl(ruleBody(bubbleCss, '.bubble.assistant')) ?? '';
const assistantCapPx = /([0-9.]+)px/.exec(assistantCapDecl)?.[1];
const bubbleOuterPx = Math.min(
  (columnMax ?? 0) - avatarPx - rowGapPx,
  assistantCapPx ? parseFloat(assistantCapPx) : Infinity,
);

describe('P311 · one desktop reading column', () => {
  it('declares --column-max for the desktop breakpoint only', () => {
    expect(columnMax).not.toBeNull();
    // A reading column: wide enough for prose, narrow enough that the
    // CJK assertions below stay honest.
    expect(columnMax!).toBeGreaterThanOrEqual(480);
    expect(columnMax!).toBeLessThanOrEqual(680);
    const desktop = mediaBlock(indexCss, DESKTOP_QUERY);
    expect(ruleBody(desktop, ':root')).toContain('--column-max');
    // No px value at top level → undefined <769px → mobile unchanged.
    expect(topLevel(indexCss)).not.toMatch(/--column-max:\s*[0-9.]+px/);
  });

  it('caps the AI bubble at ≤680 px', () => {
    // .bubble.assistant declares the explicit ceiling…
    expect(assistantCapDecl).toMatch(/min\(100%,\s*([0-9.]+)px\)/);
    expect(parseFloat(assistantCapPx!)).toBeLessThanOrEqual(680);
    // …and the geometry inside the column honours it too:
    // 600 − 32 avatar − 10 gap = 558.
    expect(bubbleOuterPx).toBeLessThanOrEqual(680);
    expect(bubbleOuterPx).toBeGreaterThan(0);
  });

  it('aligns the message column and the textarea to within 8 px', () => {
    expect(messageColumn).toBe(columnMax);
    expect(composerColumn).toBe(columnMax);
    expect(Math.abs(messageColumn! - composerColumn!)).toBeLessThanOrEqual(8);
    // The textarea resolves to the full column: .input-field owns row 1
    // (flex:1) because .input-tools wraps to a full row ≥769px, and the
    // textarea fills the field (flex:1).
    expect(ruleBody(topLevel(inputBarCss), '.input-field')).toContain(
      'flex: 1',
    );
    expect(ruleBody(topLevel(inputBarCss), '.input-bar textarea')).toContain(
      'flex: 1',
    );
    const tools = ruleBody(inputDesktopBlock, '.input-tools');
    expect(tools).toMatch(/flex-basis:\s*100%|width:\s*100%/);
    // …so textarea.width = .input-column.width = column → delta 0.
    expect(Math.abs(composerColumn! - messageColumn!)).toBeLessThanOrEqual(8);
  });

  it('puts the welcome/suggestion card on the same column (±8 px)', () => {
    const decl = maxWidthDecl(ruleBody(topLevel(chatWindowCss), '.welcome'))!;
    // var(--column-max, 520px): the token at ≥769px, the old card below.
    expect(decl).toContain('var(--column-max');
    expect(decl).toContain('520px');
    expect(welcomeColumn).not.toBeNull();
    expect(Math.abs(welcomeColumn! - messageColumn!)).toBeLessThanOrEqual(8);
  });

  it('keeps the CJK characters-per-line median ≤40 in the AI bubble', () => {
    // One CJK glyph advances ≈1em; the bubble renders body text at its
    // declared 14px. Text box = outer − 2·16 padding − 2·1 border.
    const fontSize = pxDecl(ruleBody(bubbleCss, '.bubble'), 'font-size')!;
    expect(fontSize).toBe(14);
    const padSide = pxDecl(
      ruleBody(bubbleCss, '.bubble'),
      'padding',
    ); // shorthand — read sides below
    const padDecl = /padding:\s*([0-9.]+)px\s+([0-9.]+)px/.exec(
      ruleBody(bubbleCss, '.bubble'),
    );
    const padX = padDecl ? parseFloat(padDecl[2]) : (padSide ?? 0);
    const borderPx =
      pxDecl(ruleBody(bubbleCss, '.bubble.assistant'), 'border') ?? 0;
    const textWidth = bubbleOuterPx - 2 * padX - 2 * borderPx;
    // 558 − 32 − 2 = 524 → ⌊524/14⌋ = 37.
    const charsPerLine = Math.floor(textWidth / fontSize);
    expect(charsPerLine).toBeLessThanOrEqual(40);
    // Robustness: even the whole bubble box over the font size stays ≤40.
    expect(Math.floor(bubbleOuterPx / fontSize)).toBeLessThanOrEqual(40);
  });

  it('leaves user bubbles right-aligned and the mobile rules untouched', () => {
    const userRow = ruleBody(bubbleCss, '.bubble-row.user');
    expect(userRow).toContain('align-self: flex-end');
    expect(userRow).toContain('flex-direction: row-reverse');
    // .bubble keeps its plain 100% cap — only .assistant got the ceiling.
    expect(maxWidthDecl(ruleBody(bubbleCss, '.bubble'))).toBe('100%');
    // The ≤768px blocks carry no column reference — same layout as before.
    expect(mediaBlock(chatWindowCss, '(max-width: 768px)')).not.toContain(
      'column-max',
    );
    expect(mediaBlock(inputBarCss, '(max-width: 768px)')).not.toContain(
      'column-max',
    );
  });
});
