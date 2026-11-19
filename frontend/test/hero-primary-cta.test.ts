/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installFakeDom,
  FakeEvent,
  type FakeDom,
  type FakeElement,
} from './helpers/fakeDom';
import ChatWindow from '../src/components/ChatWindow';
import { HERO_EXAMPLE_PROMPTS } from '../src/lib/heroCta';
import {
  COARSE_POINTER_QUERY,
  HERO_HINT_TOUCH,
} from '../src/lib/heroHint';
import type { ChatMessage } from '../src/types';

/**
 * P367 — measured at 390×844 on 1795072237 (docs/runs/walk-1795072237-m1.png,
 * 6th same-domain report): the mobile first screen had NO explicit primary
 * action — the only start entry was one small hint line — and the oversized
 * top whitespace pushed the content below the fold.
 *
 * Contract asserted here:
 *  1. At 390×844 the hero mounts `data-testid="hero-primary-cta"` inside
 *     .welcome — a role="group" with an accessible label holding exactly
 *     three one-tap example cards; the group's top edge lands <600px and
 *     its hit area clears 44×44 (the fake DOM reports zero rects, so the
 *     rect expression is asserted the way hero-balance.test.ts does while
 *     the size contract is pinned on the resolved CSS constants).
 *  2. Every card is a real `<button type="button">`, keyboard-focusable,
 *     ≥44px tall and full-width by stylesheet.
 *  3. A tap SENDS through the composer's own path — onSend fires with the
 *     card's prompt and the composer is never prefilled (the dead-option
 *     pattern P345 removed).
 *  4. Top whitespace stays ≤120px on the constants, and the hero's third
 *     auto margin keeps the runtime free-space share bounded with it.
 *  5. The mobile hint still never says 回车 (P350 rules intact); desktop
 *     ≥769px keeps its own look — no CTA group, the four starter chips.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatWindowCss = readFileSync(
  join(SRC, 'components', 'ChatWindow.css'),
  'utf8',
);

const VIEWPORT_W = 390;
const VIEWPORT_H = 844;
/** P367: the CTA's top edge must land inside the first viewport. */
const MAX_CTA_TOP = 600;
/** P367: the hero's top-side whitespace budget (scrollport pad + card pad). */
const MAX_TOP_WHITESPACE = 120;

/* ---------- stylesheet helpers (same as hero-balance.test.ts) ---------- */

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

/** First `Npx`/`0` components of a shorthand/longhand declaration, in order. */
function declPxValues(rule: string, prop: string): number[] {
  const decl = new RegExp(`${prop}:\\s*([^;]+)`).exec(rule)?.[1].trim();
  if (!decl) return [];
  const m =
    /^([0-9.]+)(?:px)?(?:\s+([0-9.]+)(?:px)?)?(?:\s+([0-9.]+)(?:px)?)?$/.exec(
      decl,
    );
  if (!m) return [];
  return m.slice(1).filter((v) => v !== undefined).map(Number);
}

const mobileChat = mediaBlock(chatWindowCss, '(max-width: 768px)');

/* ---------- mounted-DOM harness (same as hero-balance.test.ts) ---------- */

/** matchMedia stub: `(pointer: coarse)` -> coarse, `(max-width: 768px)` ->
 *  narrow, every other query false. */
function mediaQueryFor(coarse: boolean, narrow: boolean) {
  return (query: string) => ({
    matches:
      query === COARSE_POINTER_QUERY
        ? coarse
        : query === '(max-width: 768px)'
          ? narrow
          : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

describe('P367 · the hero carries one explicit primary CTA at 390×844', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);

  const mount = async (
    messages: ChatMessage[] = [] as ChatMessage[],
    onSend: (text: string) => void = () => {},
  ) => {
    dom = installFakeDom();
    const mq = mediaQueryFor(true, true); // coarse pointer + 390px width
    (dom.window as Record<string, unknown>).matchMedia = mq;
    vi.stubGlobal('matchMedia', mq);
    const { createRoot } = await import('react-dom/client');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(ChatWindow, {
          messages,
          loading: false,
          onSend,
          onSetupProfile: () => {},
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

  it('mounts data-testid="hero-primary-cta" — a labelled group of three example cards', async () => {
    await mount();
    const cta = qs('[data-testid="hero-primary-cta"]');
    expect(cta).not.toBeNull();
    // Inside the hero, on the first screen: the acceptance expressions a
    // real-layout run evaluates — the fake DOM reports zero rects, so the
    // top/area checks hold trivially while the CSS constants below pin
    // the real geometry.
    expect(cta!.closest('.welcome')).not.toBeNull();
    expect(cta!.closest('.hero')).not.toBeNull();
    const rect = cta!.getBoundingClientRect();
    expect(rect.top).toBeLessThan(MAX_CTA_TOP);
    expect(rect.top).toBeLessThan(VIEWPORT_H);
    // a11y: the group names what the cards do.
    expect(cta!.getAttribute('role')).toBe('group');
    expect(cta!.getAttribute('aria-label')).toBeTruthy();
    // …and it never pretends to be the send key's primary marker.
    expect(cta!.hasAttribute('data-primary-cta')).toBe(false);

    const cards = qsa('.hero-cta-card');
    expect(cards).toHaveLength(HERO_EXAMPLE_PROMPTS.length);
    expect(cards).toHaveLength(3);
    for (const [i, card] of cards.entries()) {
      expect(card.tagName).toBe('BUTTON');
      expect(card.getAttribute('type')).toBe('button');
      // Keyboard-focusable: a real button, never tabbed out — and its
      // accessible name says what the tap does.
      expect(card.getAttribute('tabindex')).not.toBe('-1');
      expect(card.disabled).toBe(false);
      expect(card.getAttribute('aria-label')).toBe(
        `直接发送：${HERO_EXAMPLE_PROMPTS[i]}`,
      );
      expect(card.textContent).toBe(HERO_EXAMPLE_PROMPTS[i]);
      expect(card.closest('[data-testid="hero-primary-cta"]')).toBe(cta);
    }
    await unmount();
  });

  it('a tap sends the prompt through the composer path — never a prefill', async () => {
    const sent: string[] = [];
    await mount([], (text) => sent.push(text));
    const card = qsa('.hero-cta-card')[1];
    await act(async () => {
      card.dispatchEvent(
        new FakeEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(sent).toEqual([HERO_EXAMPLE_PROMPTS[1]]);
    // Send, not prefill: the composer stays untouched.
    expect((qs('#chat-input') as FakeElement).value).toBe('');
    await unmount();
  });

  it('every card resolves ≥44×44 by stylesheet — min-height + full width', () => {
    const rule = ruleBody(chatWindowCss, '.hero-cta-card');
    expect(rule).not.toBe('');
    expect(rule).toContain('min-height: 44px');
    expect(rule).toContain('width: 100%');
    expect(rule).toContain('box-sizing: border-box');
    // The 12px card radius token — same control language as the rest.
    expect(rule).toContain('border-radius: var(--radius)');
    // Keyboard focus stays visible.
    expect(ruleBody(chatWindowCss, '.hero-cta-card:focus-visible')).toContain(
      'outline: 2px solid var(--accent)',
    );
  });

  it('the top-whitespace constants stay ≤120px and the free space splits three ways', () => {
    const messagesPadTop = declPxValues(
      ruleBody(mobileChat, '.messages'),
      'padding',
    )[0];
    const welcomePadTop = declPxValues(
      ruleBody(mobileChat, '.welcome'),
      'padding',
    )[0];
    expect(messagesPadTop).toBeTruthy();
    expect(welcomePadTop).toBeTruthy();
    expect(messagesPadTop! + welcomePadTop!).toBeLessThanOrEqual(
      MAX_TOP_WHITESPACE,
    );
    // The runtime share: a third auto margin ahead of the CTA group, so
    // the scrollport's free space can no longer pool into one dead band
    // above the content (the P343 two-way split left ~200px up top).
    const rule = ruleBody(
      mobileChat,
      '.messages-hero > .welcome > .hero-cta',
    );
    expect(rule).toContain('margin-top: auto');
  });

  it('the mobile hint still never says 回车 (P350 rules intact)', async () => {
    await mount();
    const hint = qs('.welcome-hint');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toBe(HERO_HINT_TOUCH);
    expect(hint!.textContent).not.toMatch(/回车/);
    expect(hint!.textContent).toContain('发送');
    await unmount();
  });

  it('the group drops out with the first message and never renders on desktop', async () => {
    await mount([{ id: 'u1', role: 'user', content: '在吗', createdAt: 1 }]);
    expect(qs('[data-testid="hero-primary-cta"]')).toBeNull();
    expect(qsa('.hero-cta-card')).toHaveLength(0);
    await unmount();

    // 1440×900 keeps its own look: starter chips, no CTA group.
    dom = installFakeDom();
    const mq = mediaQueryFor(false, false);
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
        }),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(qs('[data-testid="hero-primary-cta"]')).toBeNull();
    expect(qsa('.starter-chip')).toHaveLength(4);
    await unmount();
  });

  it('a reply in flight disarms the cards — same busy gate as the composer', async () => {
    dom = installFakeDom();
    const mq = mediaQueryFor(true, true);
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
          loading: true,
          onSend: () => {},
        }),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    for (const card of qsa('.hero-cta-card')) {
      expect(card.disabled).toBe(true);
    }
    await unmount();
  });
});
