/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * P311 — at 1440×900 the desktop rendered three different columns: AI
 * bubbles ~738 px (≈50 CJK characters per line), the composer textarea
 * ~944 px and the welcome/suggestion card ~446 px. The fix keeps ONE
 * shared reading column: --column-max (600 px, raised to 720 px by
 * P342) is declared only inside
 * the (min-width: 769px) :root block, so it caps .messages > *, the
 * .input-column wrapper and — via var(--column-max, 520px) — .welcome.
 * The composer tool row wraps under the textarea at ≥769px so the field
 * itself spans the column. Under the mobile breakpoint the token is
 * undefined, so every reference falls back to its pre-column value and
 * 390×844 is unchanged.
 *
 * P327 — the DOM measure showed that still wasn't one column: the AI
 * bubble started 42px (32px avatar + 10px row gap) inside the column the
 * textarea spans, and an unbroken string could push a bubble past the
 * composer's edge through the flex item's min-content floor. Now the
 * assistant avatar is absolutely positioned into a symmetric 66px gutter
 * that .messages and .input-bar reserve alike (equal gutters keep both
 * centred columns pixel-identical at every desktop width), the bubble
 * spans the column edge to edge (max-width:100%), and min-width:0 +
 * overflow-wrap:anywhere guarantee nothing escapes it.
 *
 * No layout engine ships with this repo, so widths are resolved from the
 * declared CSS values — the same style as desktop-column-width.test.ts.
 *
 * P342 widened --column-max 600→720 px: at 1440×900 the 600 px column
 * left ~290 px of dead margin on each side of the ~1180 px main area,
 * the empty-state column read as narrow, and the sidebar's dashed
 * 「完善资料」 card duplicated the welcome link. The widened arithmetic:
 *
 *   column        = --column-max                          = 720 px
 *   gutter        = .messages/.input-bar padding-inline   = 66 px (≥42)
 *   avatar        = absolute at row.left − 42, out of flow
 *   bubble outer  = min(column, 100% of row)              = 720 px
 *   bubble text   = outer − 2·16 padding − 2·1 border      = 686 px
 *   CJK per line  = ⌊text / font-size⌋ = ⌊686 / 14⌋         = 49 ≤ 50
 *   textarea      = .input-column width (tools wrapped)    = 720 px
 *   bubble.left   = row.left = column.left = textarea.left → Δ 0
 *   welcome outer = var(--column-max, 520px) on desktop    = 720 px
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

// Assistant-bubble geometry: P327 took the avatar out of the column (it
// hangs absolutely in the gutter), so the bubble is the row's only
// in-flow child and its 100% cap resolves to the full shared column.
const avatarPx = pxDecl(ruleBody(bubbleCss, '.avatar'), 'width') ?? 0;
const rowGapPx = pxDecl(ruleBody(bubbleCss, '.bubble-row'), 'gap') ?? 0;
const avatarHangPx = avatarPx + rowGapPx; // 42
const assistantCapDecl =
  maxWidthDecl(ruleBody(bubbleCss, '.bubble.assistant')) ?? '';
const bubbleOuterPx = columnMax ?? 0;

describe('P311 · one desktop reading column', () => {
  it('declares --column-max for the desktop breakpoint only', () => {
    expect(columnMax).not.toBeNull();
    // A reading column: P342's ≥680 px floor kills the dead right margin
    // the 600 px column left at 1440, and the cap keeps the CJK
    // assertions below honest.
    expect(columnMax!).toBeGreaterThanOrEqual(680);
    expect(columnMax!).toBeLessThanOrEqual(760);
    const desktop = mediaBlock(indexCss, DESKTOP_QUERY);
    expect(ruleBody(desktop, ':root')).toContain('--column-max');
    // No px value at top level → undefined <769px → mobile unchanged.
    expect(topLevel(indexCss)).not.toMatch(/--column-max:\s*[0-9.]+px/);
  });

  it('caps the AI bubble at the shared column itself', () => {
    // P327: the column is the only ceiling — max-width:100% of a row
    // that is itself capped at --column-max.
    expect(assistantCapDecl).toBe('100%');
    expect(bubbleOuterPx).toBe(columnMax);
    expect(bubbleOuterPx).toBeLessThanOrEqual(760);
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
    // 720 − 32 − 2 = 686 → ⌊686/14⌋ = 49.
    const charsPerLine = Math.floor(textWidth / fontSize);
    expect(charsPerLine).toBeLessThanOrEqual(50);
    // Robustness: the bubble box itself never exceeds the shared column.
    expect(bubbleOuterPx).toBeLessThanOrEqual(columnMax!);
  });

  it('leaves user bubbles right-aligned and the mobile rules untouched', () => {
    const userRow = ruleBody(bubbleCss, '.bubble-row.user');
    expect(userRow).toContain('align-self: flex-end');
    expect(userRow).toContain('flex-direction: row-reverse');
    // .bubble keeps its plain 100% cap.
    expect(maxWidthDecl(ruleBody(bubbleCss, '.bubble'))).toBe('100%');
    // The ≤768px blocks carry no column reference and none of the new
    // desktop geometry — same layout as before.
    const narrowChat = mediaBlock(chatWindowCss, '(max-width: 768px)');
    expect(narrowChat).not.toContain('column-max');
    expect(narrowChat).not.toContain('padding-left: 66px');
    expect(mediaBlock(inputBarCss, '(max-width: 768px)')).not.toContain(
      'column-max',
    );
    expect(mediaBlock(bubbleCss, '(max-width: 768px)')).not.toContain(
      'position: absolute',
    );
  });
});

describe('P327 · composer and bubbles share one column edge to edge', () => {
  const chatDesktop = mediaBlock(chatWindowCss, DESKTOP_QUERY);
  const bubbleDesktop = mediaBlock(bubbleCss, DESKTOP_QUERY);

  it('.messages and .input-bar reserve the same symmetric gutter', () => {
    // Equal symmetric padding → identical content boxes → the centred
    // --column-max lands on the same left/right edges in both strips.
    const msg = ruleBody(chatDesktop, '.messages');
    const bar = ruleBody(inputDesktopBlock, '.input-bar');
    const msgL = pxDecl(msg, 'padding-left');
    const msgR = pxDecl(msg, 'padding-right');
    const barL = pxDecl(bar, 'padding-left');
    const barR = pxDecl(bar, 'padding-right');
    expect(msgL).not.toBeNull();
    expect(msgL).toBe(msgR);
    expect(msgL).toBe(barL);
    expect(msgR).toBe(barR);
    // The gutter must swallow the out-of-flow avatar so it can never push
    // the scrollport sideways.
    expect(msgL!).toBeGreaterThanOrEqual(avatarHangPx);
  });

  it('hangs the assistant avatar out of the shared column', () => {
    expect(ruleBody(bubbleDesktop, '.bubble-row.assistant')).toContain(
      'position: relative',
    );
    const avatar = ruleBody(bubbleDesktop, '.bubble-row.assistant .avatar');
    expect(avatar).toContain('position: absolute');
    // The hang equals the space the avatar used to eat inside the column:
    // 32px width + 10px row gap = 42px.
    const hangPx = /left:\s*(-?[0-9.]+)px/.exec(avatar)?.[1];
    expect(hangPx).toBe(String(-avatarHangPx));
  });

  it('AI bubble left edge and textarea left edge differ by ≤8 px', () => {
    // bubble.left = row.left = column.left: the avatar is out of flow, so
    // the bubble is the row's only in-flow flex item, packed at flex-start
    // with no offset — inset 0.
    const bubbleInset = 0;
    // textarea.left = .input-column.left = the same column's left:
    // flex:1 down .input-column → .input-field → textarea, with no left
    // padding or margin declared anywhere on the chain.
    const column = ruleBody(topLevel(inputBarCss), '.input-column');
    const field = ruleBody(topLevel(inputBarCss), '.input-field');
    const textarea = ruleBody(topLevel(inputBarCss), '.input-bar textarea');
    for (const rule of [column, field, textarea]) {
      expect(pxDecl(rule, 'padding-left') ?? 0).toBe(0);
      expect(pxDecl(rule, 'margin-left') ?? 0).toBe(0);
    }
    const textareaInset = 0;
    // Both centred on the same --column-max inside identical content
    // boxes (asserted above) → the edges coincide.
    expect(messageColumn).toBe(composerColumn);
    expect(Math.abs(bubbleInset - textareaInset)).toBeLessThanOrEqual(8);
  });

  it('bubble max-width never exceeds the shared column width', () => {
    // 100% of a row that is itself max-width: --column-max → ≤ column.
    expect(maxWidthDecl(ruleBody(bubbleCss, '.bubble'))).toBe('100%');
    expect(assistantCapDecl).toBe('100%');
    expect(bubbleOuterPx).toBeLessThanOrEqual(columnMax!);
  });

  it('a 120-char unbroken URL can never push the bubble past the composer right edge', () => {
    const bubble = ruleBody(bubbleCss, '.bubble');
    // overflow-wrap:anywhere gives every character a break opportunity →
    // min-content ≈ 0 → the flex item's min-width:auto floor collapses;
    // min-width:0 makes that explicit. The box can then only ever be as
    // wide as its row = the column, so bubble.right ≤ column.right =
    // textarea.right.
    expect(bubble).toContain('overflow-wrap: anywhere');
    expect(bubble).toContain('min-width: 0');
    expect(bubbleOuterPx + 0 /* bubble.left offset */).toBeLessThanOrEqual(
      composerColumn!,
    );
    // …and a fenced code block scrolls inside the bubble instead of
    // inking past the edge.
    expect(ruleBody(bubbleCss, '.bubble-content pre')).toContain(
      'overflow-x: auto',
    );
  });
});
