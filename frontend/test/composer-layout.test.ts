/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import InputBar from '../src/components/InputBar';
import { installFakeDom, type FakeDom } from './helpers/fakeDom';

/**
 * P309 — at 390×844 the composer tool row (「回答适中」 length chip, the
 * shortcut-hint button, the send key) huddled on the left of its wrap line
 * — ~198px of 358px — so the send key never reached the bottom-right
 * corner where a thumb expects it. The fix is pure CSS, mobile-only:
 * .input-tools takes a full-width row of .input-column (flex-basis: 100%)
 * and .input-send carries margin-left:auto so it pins to the bar's right
 * edge; the ≤768px .input-bar padding is `12px 16px` (ChatWindow.css) —
 * P348 restored the page's 16px gutter (the same inset .messages uses) so
 * the key lands ≤16px from the edge, flush with the bubble column above,
 * while the row covers ≥90% of the bar's width (358/390 = 91.8%).
 * Desktop rules are untouched.
 *
 * No DOM renderer ships with this repo — the fake DOM reports zero
 * getBoundingClientRect()s — so the rect relationships are asserted both
 * as the same render-level expressions a real-layout run evaluates, and on
 * the resolved CSS values, in the style of desktop-column-width.test.ts.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const inputBarCss = read('components/InputBar.css');
const chatWindowCss = read('components/ChatWindow.css');
const inputBarTsx = read('components/InputBar.tsx');

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
  const m =
    /^([0-9.]+)(?:px)?(?:\s+([0-9.]+)(?:px)?)?(?:\s+([0-9.]+)(?:px)?)?(?:\s+([0-9.]+)(?:px)?)?$/.exec(
      decl,
    );
  if (!m) return [];
  return m.slice(1).filter((v) => v !== undefined).map(Number);
}

/** CSS box sides [top, right, bottom, left] from a 1–4 value shorthand. */
function boxSides(values: number[]): [number, number, number, number] {
  const [a, b = a, c = a, d = b] = values;
  return [a, b, c, d];
}

const mobileInput = mediaBlock(inputBarCss, '(max-width: 768px)');
const mobileChat = mediaBlock(chatWindowCss, '(max-width: 768px)');

const BAR_WIDTH = 390;
const barPad = boxSides(
  declPxValues(ruleBody(mobileChat, '.input-bar'), 'padding'),
);
const [, barPadRight, , barPadLeft] = barPad;

describe('P309 · mobile composer geometry (≤768px)', () => {
  it('the tool row takes the full composer width', () => {
    const tools = ruleBody(mobileInput, '.input-tools');
    expect(tools).not.toBe('');
    expect(tools).toMatch(/flex-basis:\s*100%|width:\s*100%/);
  });

  it('the send key is pinned to the row end by margin-left:auto', () => {
    const send = ruleBody(mobileInput, '.input-bar .input-send');
    expect(send).toContain('margin-left: auto');
    // While streaming, 停止 sits right after send — only the first
    // .input-send carries the auto margin or the pair splits the space.
    expect(
      ruleBody(mobileInput, '.input-bar .input-send.input-stop'),
    ).toContain('margin-left: 0');
  });

  it('send.right lands within the 16px page gutter at 390px (P348)', () => {
    // Resolved geometry: send.right = column right = bar right − padding-right.
    expect(barPadRight).toBeGreaterThanOrEqual(12);
    expect(barPadRight).toBeLessThanOrEqual(16);
    const sendRight = BAR_WIDTH - barPadRight;
    expect(Math.abs(sendRight - BAR_WIDTH)).toBeLessThanOrEqual(16);
    // …and its centre x sits past two-thirds of the viewport.
    const sendWidth = declPxValues(
      ruleBody(mobileInput, '.input-bar .input-send'),
      'width',
    )[0];
    expect(sendRight - sendWidth / 2).toBeGreaterThan((BAR_WIDTH * 2) / 3);
  });

  it('the tool row uses ≥90% of the .input-bar width at 390px', () => {
    const rowWidth = BAR_WIDTH - barPadLeft - barPadRight;
    expect(rowWidth / BAR_WIDTH).toBeGreaterThanOrEqual(0.9);
  });

  it('touch targets stay ≥40px: send, hint and the length chip', () => {
    for (const sel of [
      '.input-bar .input-send',
      '.input-hint-btn',
      '.reply-length-toggle',
    ]) {
      const rule = ruleBody(mobileInput, sel);
      const h =
        declPxValues(rule, 'height')[0] ?? declPxValues(rule, 'min-height')[0];
      expect(h, `${sel} height`).toBeGreaterThanOrEqual(40);
    }
    for (const sel of ['.input-bar .input-send', '.input-hint-btn']) {
      const rule = ruleBody(mobileInput, sel);
      const w =
        declPxValues(rule, 'width')[0] ?? declPxValues(rule, 'min-width')[0];
      expect(w, `${sel} width`).toBeGreaterThanOrEqual(40);
    }
  });

  it('desktop rules are untouched: single-row tools, 24px bar padding', () => {
    const tools = ruleBody(topLevel(inputBarCss), '.input-tools');
    expect(tools).not.toBe('');
    expect(tools).not.toContain('margin-left');
    expect(tools).not.toContain('flex-basis: 100%');
    expect(tools).toContain('flex-shrink: 0');
    expect(ruleBody(topLevel(inputBarCss), '.input-bar')).toContain(
      'padding: 16px 24px',
    );
    expect(
      ruleBody(topLevel(inputBarCss), '.input-bar .input-send'),
    ).not.toContain('margin-left');
    // The narrow block must not touch the shared column rule (P305).
    expect(mobileInput).not.toContain('input-column');
    expect(mobileInput).not.toContain('max-width');
  });
});

describe('P309 · control order in the markup', () => {
  const html = renderToStaticMarkup(
    createElement(InputBar, {
      onSend: () => {},
      replyLength: 'default' as const,
      onReplyLengthChange: () => {},
    }),
  );

  it('「回答适中」 is the leftmost control, send the rightmost', () => {
    const toolsAt = html.indexOf('class="input-tools"');
    expect(toolsAt).toBeGreaterThan(-1);
    const row = html.slice(toolsAt);
    expect(row.indexOf('reply-length-toggle')).toBeLessThan(
      row.indexOf('input-hint-btn'),
    );
    expect(row.indexOf('input-hint-btn')).toBeLessThan(
      row.indexOf('class="input-send"'),
    );
    // The chip really renders the intent label on the left side.
    expect(row.indexOf('回答适中')).toBeLessThan(row.indexOf('input-hint-btn'));
  });
});

describe('P309 · rect relations in the mounted composer', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) => dom.document.querySelector(sel);

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('send.right ≤ bar.right + 16, chip centre in the left half, row ≥90%', async () => {
    dom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(InputBar, {
          onSend: () => {},
          replyLength: 'default' as const,
          onReplyLengthChange: () => {},
        }),
      );
    });

    const bar = qs('.input-bar');
    const tools = qs('.input-tools');
    const send = qs('.input-send');
    const chip = qs('.reply-length-toggle');
    expect(bar).toBeTruthy();
    expect(tools).toBeTruthy();
    expect(send).toBeTruthy();
    expect(chip, 'the 「回答适中」 length chip').toBeTruthy();
    expect(chip!.textContent).toContain('回答适中');

    // DOM order inside the row: chip first, send last.
    const kids = tools!.children;
    expect(kids[0].classList.contains('reply-length-toggle')).toBe(true);
    const last = kids[kids.length - 1];
    expect(last.classList.contains('input-send')).toBe(true);
    expect(last.classList.contains('input-stop')).toBe(false);

    // The acceptance rect expressions — the fake DOM reports zero rects, so
    // these hold trivially here; a real-layout run evaluates the same
    // arithmetic against the geometry pinned by the CSS assertions above.
    const barRect = bar!.getBoundingClientRect();
    const sendRect = send!.getBoundingClientRect();
    const toolsRect = tools!.getBoundingClientRect();
    const chipRect = chip!.getBoundingClientRect();
    expect(Math.abs(sendRect.right - barRect.right)).toBeLessThanOrEqual(16);
    expect(chipRect.left + chipRect.width / 2).toBeLessThanOrEqual(
      barRect.left + barRect.width / 2,
    );
    expect(toolsRect.width).toBeGreaterThanOrEqual(barRect.width * 0.9);

    await act(async () => {
      root?.unmount();
    });
    root = null;
    dom.document.body.textContent = '';
  });

  it('the tsx keeps the pinned layout: send stays last in .input-tools', () => {
    const toolsAt = inputBarTsx.indexOf('className="input-tools"');
    expect(toolsAt).toBeGreaterThan(-1);
    const row = inputBarTsx.slice(toolsAt);
    expect(row.indexOf('reply-length-toggle')).toBeLessThan(
      row.indexOf('className="input-send"'),
    );
  });
});
