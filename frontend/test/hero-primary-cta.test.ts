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
import { HERO_EXAMPLE_PROMPTS, HERO_PRIMARY_LABEL } from '../src/lib/heroCta';
import { COARSE_POINTER_QUERY } from '../src/lib/heroHint';
import type { ChatMessage } from '../src/types';

/**
 * P374 — measured at 390×844 on 1795090365 (docs/runs/walk-1795090365-m1.png,
 * 7th same-domain report): the P367 hero CTA was a 334×174 role="group" DIV
 * holding three equal-weight example cards under a 「点一条，直接发送」 lead —
 * tapping it fired a canned question and focus never reached the composer
 * (`document.activeElement.id === ""`). Four near-equal clickables competed
 * on the first screen.
 *
 * Contract asserted here:
 *  1. At 390×844 the hero mounts ONE real
 *     `<button data-testid="hero-primary-cta">说说你的情况</button>` inside
 *     .welcome/.hero — the single primary action.
 *  2. Its click focuses `#chat-input` and sends NOTHING: onSend never
 *     fires and the composer stays empty.
 *  3. The three example prompts live on as a secondary group — still real
 *     `<button>`s that send through the composer path — but with neutral
 *     chrome: no 「点一条，直接发送」 lead, no accent fill, no accent border.
 *  4. The primary resolves ≥44px tall and full-width by stylesheet; the
 *     group's free-space auto margin and the ≤120px top-whitespace
 *     constants stay.
 *  5. The whole group drops out with the first message and never renders
 *     on desktop ≥769px.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatWindowCss = readFileSync(
  join(SRC, 'components', 'ChatWindow.css'),
  'utf8',
);

const VIEWPORT_W = 390;
const VIEWPORT_H = 844;
/** The CTA's top edge must land inside the first viewport. */
const MAX_CTA_TOP = 600;
/** The hero's top-side whitespace budget (scrollport pad + card pad). */
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

describe('P374 · the compact hero has one real primary action at 390×844', () => {
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

  it('mounts data-testid="hero-primary-cta" — a real button, not a card group', async () => {
    await mount();
    const cta = qs('[data-testid="hero-primary-cta"]');
    expect(cta).not.toBeNull();
    expect(cta!.tagName).toBe('BUTTON');
    expect(cta!.getAttribute('type')).toBe('button');
    expect(cta!.textContent).toBe(HERO_PRIMARY_LABEL);
    expect(cta!.textContent).toBe('说说你的情况');
    // Inside the hero, on the first screen.
    expect(cta!.closest('.welcome')).not.toBeNull();
    expect(cta!.closest('.hero')).not.toBeNull();
    const rect = cta!.getBoundingClientRect();
    expect(rect.top).toBeLessThan(MAX_CTA_TOP);
    expect(rect.top).toBeLessThan(VIEWPORT_H);
    // Keyboard-focusable: a real button, never tabbed out.
    expect(cta!.getAttribute('tabindex')).not.toBe('-1');
    expect(cta!.disabled).toBe(false);
    // …and it never pretends to be the send key's primary marker.
    expect(cta!.hasAttribute('data-primary-cta')).toBe(false);
    await unmount();
  });

  it('clicking it focuses #chat-input and sends nothing', async () => {
    const sent: string[] = [];
    await mount([], (text) => sent.push(text));
    const cta = qs('[data-testid="hero-primary-cta"]')!;
    expect(dom.document.activeElement?.id ?? '').not.toBe('chat-input');
    await act(async () => {
      cta.dispatchEvent(
        new FakeEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(dom.document.activeElement?.id).toBe('chat-input');
    // No chat send is dispatched and the composer stays untouched.
    expect(sent).toEqual([]);
    expect((qs('#chat-input') as FakeElement).value).toBe('');
    await unmount();
  });

  it('the example prompts stay on as a secondary group that still sends', async () => {
    const sent: string[] = [];
    await mount([], (text) => sent.push(text));
    // No 「点一条，直接发送」 lead — the group names itself only via aria.
    expect(qs('.hero-cta-lead')).toBeNull();
    const group = qs('.hero-examples');
    expect(group).not.toBeNull();
    expect(group!.getAttribute('role')).toBe('group');
    expect(group!.getAttribute('aria-label')).toBeTruthy();

    const cards = qsa('.hero-cta-card');
    expect(cards).toHaveLength(HERO_EXAMPLE_PROMPTS.length);
    expect(cards).toHaveLength(3);
    for (const [i, card] of cards.entries()) {
      expect(card.tagName).toBe('BUTTON');
      expect(card.disabled).toBe(false);
      expect(card.getAttribute('aria-label')).toBe(
        `直接发送：${HERO_EXAMPLE_PROMPTS[i]}`,
      );
      expect(card.textContent).toBe(HERO_EXAMPLE_PROMPTS[i]);
    }
    // …and a tap still sends through the composer's own path — real work,
    // never a prefill (the dead-option pattern P345 removed).
    await act(async () => {
      cards[1].dispatchEvent(
        new FakeEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(sent).toEqual([HERO_EXAMPLE_PROMPTS[1]]);
    await unmount();
  });

  it('the primary resolves ≥44px and full-width; the secondary cards carry no accent chrome', () => {
    const primary = ruleBody(chatWindowCss, '.hero-cta-primary');
    expect(primary).not.toBe('');
    expect(primary).toContain('width: 100%');
    expect(primary).toContain('background: var(--accent)');
    expect(primary).toContain('color: var(--on-accent)');
    expect(primary).not.toContain('border: 1px');
    const minH = declPxValues(primary, 'min-height')[0];
    expect(minH).toBeGreaterThanOrEqual(44);
    expect(
      ruleBody(chatWindowCss, '.hero-cta-primary:focus-visible'),
    ).toContain('outline: 2px solid var(--accent)');

    // The secondary group: neutral border + surface fill + secondary ink —
    // no accent anywhere in the resting chrome (fill, border, or lead).
    const card = ruleBody(chatWindowCss, '.hero-cta-card');
    expect(card).not.toBe('');
    expect(card).toContain('min-height: 44px');
    expect(card).toContain('width: 100%');
    expect(card).toContain('border: 1px solid var(--border)');
    expect(card).not.toContain('var(--accent)');
    const hover = ruleBody(chatWindowCss, '.hero-cta-card:hover');
    expect(hover).not.toContain('var(--accent)');
    expect(ruleBody(chatWindowCss, '.hero-cta-card-icon')).toContain(
      'color: var(--text-muted)',
    );
    // The retired lead's chrome is gone with it.
    expect(ruleBody(chatWindowCss, '.hero-cta-lead')).toBe('');
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
    // above the content.
    const rule = ruleBody(
      mobileChat,
      '.messages-hero > .welcome > .hero-cta',
    );
    expect(rule).toContain('margin-top: auto');
  });

  it('the group drops out with the first message and never renders on desktop', async () => {
    await mount([{ id: 'u1', role: 'user', content: '在吗', createdAt: 1 }]);
    expect(qs('[data-testid="hero-primary-cta"]')).toBeNull();
    expect(qsa('.hero-cta-card')).toHaveLength(0);
    await unmount();

    // 1440×900 keeps its own look: starter chips, no hero CTA.
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
    expect(qsa('.hero-cta-card')).toHaveLength(0);
    expect(qsa('.starter-chip')).toHaveLength(4);
    await unmount();
  });

  it('a reply in flight disarms the hero controls — same busy gate as the composer', async () => {
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
    expect(qs('[data-testid="hero-primary-cta"]')!.disabled).toBe(true);
    for (const card of qsa('.hero-cta-card')) {
      expect(card.disabled).toBe(true);
    }
    await unmount();
  });
});
