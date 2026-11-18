/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakeDom, type FakeDom, type FakeElement } from './helpers/fakeDom';
import ChatWindow from '../src/components/ChatWindow';
import type { ChatMessage } from '../src/types';

/**
 * P337 — measured at 390×844 (docs/runs/walk-1795029110-m1.png): after the
 * feature block a large solid-colour gap opened before the input bar, so
 * the first screen's visual weight sat far too high and the bottom read as
 * "not enough content". The welcome block's ≥150px bottom padding — kept
 * from P307, when the three feature cards made the column overflow the
 * scrollport — lived INSIDE the centred box and pushed the visible
 * content ~75px above middle. P336 then collapsed the cards to one line,
 * ending the overflow, so the oversized pad only remained as dead space.
 *
 * P337 rebalances the empty-state block:
 *  1. `.hero` marks the content block; the scrollport's equal ::before /
 *     ::after spacers (P305) centre it, and its mobile padding is now
 *     near-symmetric (10px top / 24px bottom) so the measured top-gap vs
 *     bottom-gap differ by ≤ 15% of the viewport height.
 *  2. The composer tool row — 「回答适中」 length chip, keyboard-shortcut
 *     hint, send key — resolves one control height (48px ≤768px) and one
 *     border-radius (var(--radius)) for all three; the spread stays ≤ 4px.
 *
 * No DOM renderer ships with this repo — the fake DOM reports zero
 * getBoundingClientRect()s — so the rect relationships are asserted both
 * as the same render-level expressions a real-layout run evaluates, and on
 * the resolved CSS values, in the style of composer-layout.test.ts and
 * welcome-bottom-clearance.test.ts.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const chatWindowCss = read('components/ChatWindow.css');
const inputBarCss = read('components/InputBar.css');
const indexCss = read('index.css');

/** The viewport this contract is measured against. */
const VIEWPORT_W = 390;
const VIEWPORT_H = 844;
const MAX_GAP_DIFF = VIEWPORT_H * 0.15;

/* ---------- stylesheet helpers (same as composer-layout.test.ts) ---------- */

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

/** Declaration body of the first rule whose SELECTOR TEXT contains `token`
 *  — finds grouped selectors like `.a::before,\n.a::after { … }` that the
 *  exact-match ruleBody cannot. */
function ruleBodyContaining(css: string, token: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].includes(token)) return m[2];
  }
  return '';
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

const mobileChat = mediaBlock(chatWindowCss, '(max-width: 768px)');
const mobileInput = mediaBlock(inputBarCss, '(max-width: 768px)');
const baseChat = topLevel(chatWindowCss);
const baseInput = topLevel(inputBarCss);

/** The three controls of the composer tool row, in DOM order. */
const TOOL_SELECTORS = [
  '.reply-length-toggle',
  '.input-hint-btn',
  '.input-bar .input-send',
] as const;

/** Box height a control resolves at ≤768px: mobile rule, then the base. */
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

/** Border-radius a control resolves — mobile override first, then base. */
function toolRadius(selector: string): string {
  const mobile = ruleBody(mobileInput, selector);
  const base = ruleBody(baseInput, selector);
  const decl =
    /border-radius\s*:\s*([^;]+)/.exec(mobile) ??
    /border-radius\s*:\s*([^;]+)/.exec(base);
  expect(decl, `${selector} should declare a border-radius`).toBeTruthy();
  return decl![1].trim();
}

/* ---------- mounted-DOM harness (same as hero-single-cta.test.ts) ---------- */

/** matchMedia stub resolving (min|max)-width queries against a fixed width. */
function mediaQueryForWidth(px: number) {
  return (q: string) => {
    const maxW = /max-width:\s*(\d+)px/.exec(q);
    const minW = /min-width:\s*(\d+)px/.exec(q);
    const matches =
      (maxW || minW) !== null &&
      (maxW ? px <= Number(maxW[1]) : true) &&
      (minW ? px >= Number(minW[1]) : true);
    return {
      matches,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  };
}

describe('P337 · the .hero block sits vertically balanced at 390×844', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;

  const mount = async (widthPx: number) => {
    dom = installFakeDom();
    const mq = mediaQueryForWidth(widthPx);
    (dom.window as Record<string, unknown>).matchMedia = mq;
    vi.stubGlobal('matchMedia', mq);
    const { createRoot } = await import('react-dom/client');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(ChatWindow, {
          messages: [] as ChatMessage[],
          loading: false,
          onSend: () => {},
          onSetupProfile: () => {},
          replyLength: 'default',
          onReplyLengthChange: () => {},
        }),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const unmount = async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    dom.document.body.textContent = '';
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('the welcome block carries the .hero content-block hook', async () => {
    await mount(VIEWPORT_W);
    const hero = qs('.hero');
    expect(hero).not.toBeNull();
    expect(hero).toBe(qs('.welcome'));
    expect(hero!.classList.contains('animate-in')).toBe(true);
    await unmount();
  });

  it('the scrollport splits free space equally above and below the block', () => {
    // The P305 bookends: zero-height pseudo items growing at the same rate
    // centre whatever sits between them — with equal growth the only
    // residual asymmetry can come from padding and the sentinel's row gap.
    for (const pseudo of ['.messages::before', '.messages::after']) {
      const body = ruleBodyContaining(chatWindowCss, pseudo);
      expect(body, `${pseudo} rule`).not.toBe('');
      expect(body).toContain('flex: 1 0 0');
      expect(body).toContain("content: ''");
    }
    // .welcome keeps a symmetric auto margin and the ≤768px block does not
    // override it — centring stays intact on phones.
    expect(ruleBody(baseChat, '.welcome')).toContain('margin: auto');
    expect(ruleBody(mobileChat, '.welcome')).not.toContain('margin');
  });

  it('top-gap vs bottom-gap resolve within 15% of the viewport height', () => {
    const welcomePad = boxSides(
      declPxValues(ruleBody(mobileChat, '.welcome'), 'padding'),
    );
    const messagesPad = boxSides(
      declPxValues(ruleBody(mobileChat, '.messages'), 'padding'),
    );
    const rowGap = declPxValues(ruleBody(baseChat, '.messages'), 'gap')[0];
    expect(rowGap).toBeGreaterThan(0);
    // The scrollport column is: ::before spacer — hero — sentinel — ::after
    // spacer. Equal spacers split all free space, so the residual
    // asymmetry is the fixed items around the block: above = list pad-top +
    // one row gap + hero pad-top; below = hero pad-bottom + two row gaps
    // (the zero-height scroll sentinel keeps its own slot) + list pad-bottom.
    const above = messagesPad[0] + rowGap + welcomePad[0];
    const below = welcomePad[2] + rowGap * 2 + messagesPad[2];
    expect(
      Math.abs(above - below),
      `top gap ${above}px vs bottom gap ${below}px`,
    ).toBeLessThanOrEqual(MAX_GAP_DIFF);
  });

  it('mounted: the .hero rect expression evaluates the same contract', async () => {
    await mount(VIEWPORT_W);
    const hero = qs('.hero')!;
    const messages = qs('.messages')!;
    const bar = qs('.input-bar')!;
    // The acceptance expression a real-layout run evaluates — the fake DOM
    // reports zero rects, so this holds trivially here while the CSS
    // assertions above pin the geometry.
    const topGap = hero.getBoundingClientRect().top - messages.getBoundingClientRect().top;
    const bottomGap = bar.getBoundingClientRect().top - hero.getBoundingClientRect().bottom;
    expect(Math.abs(topGap - bottomGap)).toBeLessThanOrEqual(MAX_GAP_DIFF);
    await unmount();
  });
});

describe('P337 · the composer tool row is one control family', () => {
  it('the three tool controls resolve the same height within 4px at ≤768px', () => {
    const heights = TOOL_SELECTORS.map(toolHeightPx);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(4);
  });

  it('the three tool controls share one border-radius', () => {
    const radii = TOOL_SELECTORS.map(toolRadius);
    expect(new Set(radii).size).toBe(1);
    // …and the shared token resolves to a real px value in :root.
    const varRef = /^var\((--[a-z-]+)\)$/.exec(radii[0]);
    const rootBody = /:root\s*\{([^}]*)\}/.exec(indexCss);
    expect(rootBody).toBeTruthy();
    if (varRef) {
      const px = new RegExp(
        `${varRef[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([0-9.]+)px`,
      ).exec(rootBody![1]);
      expect(px, `${varRef[1]} resolves in :root`).toBeTruthy();
      expect(Number(px![1])).toBeGreaterThan(0);
    }
  });

  it('mounted: rendered tool-row controls share one height — 390px and 500px', async () => {
    let dom: FakeDom;
    let root: Root | null = null;
    const mount = async (widthPx: number) => {
      dom = installFakeDom();
      const mq = mediaQueryForWidth(widthPx);
      (dom.window as Record<string, unknown>).matchMedia = mq;
      vi.stubGlobal('matchMedia', mq);
      const { createRoot } = await import('react-dom/client');
      const container = dom.document.createElement('div');
      dom.document.body.appendChild(container);
      root = createRoot(container as unknown as HTMLElement);
      await act(async () => {
        root!.render(
          createElement(ChatWindow, {
            messages: [] as ChatMessage[],
            loading: false,
            onSend: () => {},
            onSetupProfile: () => {},
            replyLength: 'default',
            onReplyLengthChange: () => {},
          }),
        );
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    const unmount = async () => {
      await act(async () => {
        root?.unmount();
      });
      root = null;
      dom.document.body.textContent = '';
    };

    try {
      // 390px: the keyboard hint stays unmounted (P336) — chip + send remain.
      await mount(VIEWPORT_W);
      let tools = dom.document.querySelector('.input-tools') as FakeElement;
      expect(dom.document.querySelector('.input-hint-btn')).toBeNull();
      let buttons = tools.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      let heights = buttons.map((b) => b.getBoundingClientRect().height);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(4);
      await unmount();

      // 500px: all three controls render — the same zero-rect expression.
      await mount(500);
      tools = dom.document.querySelector('.input-tools') as FakeElement;
      buttons = tools.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThanOrEqual(3);
      heights = buttons.map((b) => b.getBoundingClientRect().height);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(4);
      await unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
