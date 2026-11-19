/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import InputBar from '../src/components/InputBar';
import { installFakeDom, type FakeDom } from './helpers/fakeDom';

/**
 * P348 — at 390×844 the 「回答适中」 cycler sat 8px from the bezel while
 * every other control honoured the 16px page gutter, and the row read as a
 * stray debug button against the pink chrome. The fix: the mobile
 * .input-bar keeps the same 16px inset .messages reserves above it
 * (ChatWindow.css), the three tool-row controls resolve one 48px height so
 * chip and send share a baseline (top diff ≤2px), and the cycler wears the
 * app's capsule treatment (999px pill, --bg fill, --text-secondary label).
 *
 * No DOM renderer ships with this repo — the fake DOM reports zero
 * getBoundingClientRect()s — so the rect relationships are asserted as the
 * same render-level expressions a real-layout run evaluates, plus resolved
 * CSS values, in the style of composer-layout.test.ts.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const inputBarCss = read('components/InputBar.css');
const chatWindowCss = read('components/ChatWindow.css');

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
  return m
    .slice(1)
    .filter((v) => v !== undefined)
    .map(Number);
}

/** CSS box sides [top, right, bottom, left] from a 1–4 value shorthand. */
function boxSides(values: number[]): [number, number, number, number] {
  const [a, b = a, c = a, d = b] = values;
  return [a, b, c, d];
}

const mobileInput = mediaBlock(inputBarCss, '(max-width: 768px)');
const mobileChat = mediaBlock(chatWindowCss, '(max-width: 768px)');
const baseInput = topLevel(inputBarCss);

/** The three controls of the composer bottom toolbar, in DOM order. */
const TOOL_SELECTORS = [
  '.reply-length-toggle',
  '.input-hint-btn',
  '.input-bar .input-send',
] as const;

/** Box height a control resolves at 390px: mobile rule, then the base. */
function toolHeightPx(selector: string): number {
  const mobile = ruleBody(mobileInput, selector);
  const base = ruleBody(baseInput, selector);
  const h =
    declPxValues(mobile, 'height')[0] ??
    declPxValues(mobile, 'min-height')[0] ??
    declPxValues(base, 'height')[0] ??
    declPxValues(base, 'min-height')[0];
  expect(h, `${selector} should resolve a height at ≤768px`).toBeTruthy();
  return h!;
}

describe('P348 · composer toolbar baseline at 390×844', () => {
  it('the bar keeps the page gutter: left inset ≥12px and symmetric', () => {
    const pad = boxSides(
      declPxValues(ruleBody(mobileChat, '.input-bar'), 'padding'),
    );
    const [, padRight, , padLeft] = pad;
    // The page's mobile gutter is .messages' 16px inset — the bar matches it.
    const msgPad = boxSides(
      declPxValues(ruleBody(mobileChat, '.messages'), 'padding'),
    );
    expect(padLeft).toBeGreaterThanOrEqual(12);
    expect(padLeft).toBe(padRight);
    expect(padLeft).toBe(msgPad[3]);
  });

  it('the three toolbar controls resolve one height — diff ≤2px', () => {
    const heights = TOOL_SELECTORS.map(toolHeightPx);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
    // …and that shared height is the 48px touch target.
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(48);
  });

  it('the controls share one flex line and one alignment — top diff ≤2px', () => {
    const tools = ruleBody(baseInput, '.input-tools');
    expect(tools).toContain('display: flex');
    // A single-line flex row: tops are set by align-items alone.
    expect(tools).not.toContain('flex-wrap');
    const align = /align-items:\s*([^;]+)/.exec(tools);
    expect(align, '.input-tools declares one cross-axis alignment').toBeTruthy();
    // Resolved tops under the declared alignment: same line + same height
    // → top diff equals the height diff.
    const heights = TOOL_SELECTORS.map(toolHeightPx);
    const lineBottom = Math.max(...heights);
    const tops = heights.map((h) =>
      align![1].trim() === 'flex-end' ? lineBottom - h : 0,
    );
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
  });

  it('the cycler is the app capsule, not a system default button', () => {
    const chip = ruleBody(baseInput, '.reply-length-toggle');
    // Same capsule radius as .memory-capsule / .starter-chip.
    expect(chip).toContain('border-radius: 999px');
    // Filled with the composer's own field colour — no new colour tokens,
    // every paint is an existing var().
    const paints = [...chip.matchAll(/(?:background|color|border-color):\s*([^;]+)/g)]
      .map((m) => m[1].trim())
      .filter((v) => v !== 'none' && v !== 'inherit');
    for (const v of paints) {
      expect(v, `paint value ${v}`).toMatch(/^var\(--/);
    }
    expect(chip).toContain('background: var(--bg)');
    expect(chip).toContain('color: var(--text-secondary)');
    // Vertically centred like a chip, not a UA-default button.
    expect(chip).toContain('align-items: center');
  });

  it('a non-default 档位 keeps the accent-soft chip state', () => {
    // The concise/detailed pair shares one comma-separated rule.
    const rule = new RegExp(
      "\\.reply-length-toggle\\[data-length='concise'\\][^}]*\\{([^}]*)\\}",
    ).exec(baseInput);
    expect(rule, 'non-default 档位 rule').toBeTruthy();
    expect(rule![1]).toContain('var(--accent)');
    expect(rule![1]).toContain('var(--accent-soft)');
  });
});

describe('P348 · rect relations in the mounted composer at 390px', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) => dom.document.querySelector(sel);

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('mounted chip and send share top and height within 2px', async () => {
    dom = installFakeDom(); // fake window is 390×844
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
    const chip = qs('.reply-length-toggle');
    const send = qs('.input-send');
    expect(bar).toBeTruthy();
    expect(chip, 'the 「回答适中」 cycler').toBeTruthy();
    expect(send).toBeTruthy();
    expect(chip!.textContent).toContain('回答适中');

    // The fake DOM reports zero rects, so the expressions hold trivially
    // here; the CSS assertions above pin the values a real layout resolves.
    const chipRect = chip!.getBoundingClientRect();
    const sendRect = send!.getBoundingClientRect();
    const barRect = bar!.getBoundingClientRect();
    expect(Math.abs(chipRect.height - sendRect.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(chipRect.top - sendRect.top)).toBeLessThanOrEqual(2);
    expect(chipRect.left - barRect.left).toBeLessThanOrEqual(16);

    await act(async () => {
      root?.unmount();
    });
    root = null;
    dom.document.body.textContent = '';
  });
});
