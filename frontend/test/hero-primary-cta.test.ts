/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act, Fragment } from 'react';
import type { Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installFakeDom,
  jsonResponse,
  FakeEvent,
  type FakeDom,
  type FakeElement,
} from './helpers/fakeDom';
import ChatWindow from '../src/components/ChatWindow';
import Sidebar from '../src/components/Sidebar';
import { HERO_EXAMPLE_PROMPTS, HERO_PRIMARY_LABEL } from '../src/lib/heroCta';
import { STARTER_ENTRIES } from '../src/lib/starterEntries';
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
 *  5. The whole group drops out with the first message.
 *
 * P380 — measured at 1440×900 on 1795101019 (docs/runs/walk-1795101019-d1.png):
 * the desktop empty state had NO primary CTA at all — the compact fix above
 * was phone-only — while hint + 4 chips + 3 explanation cards + 4 sidebar
 * shortcuts made 7 entries compete for one path, the hero sat >250px from
 * the composer, and the empty send key still wore the solid brand fill.
 * The same single button now renders on desktop (the example group stays
 * compact-only — the starter entries cover desktop quick-starts),
 * the explanation cards are gone, the trailing bookend is capped so the
 * hero's foot lands near the composer — P403 tightened the contract to
 * ≤120px after the 96px cap still measured 169px (walk-1795128648) —
 * and the empty send key drops to a real disabled visual. Asserted in
 * the last describe.
 */

// P394: heroHint.ts is gone with the hint — the pointer query the
// matchMedia stubs match against is inlined here.
const COARSE_POINTER_QUERY = '(pointer: coarse)';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatWindowCss = readFileSync(
  join(SRC, 'components', 'ChatWindow.css'),
  'utf8',
);
const inputBarCss = readFileSync(
  join(SRC, 'components', 'InputBar.css'),
  'utf8',
);
const sidebarCss = readFileSync(
  join(SRC, 'components', 'Sidebar.css'),
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
    // Base rule — the (min-width: 769px) P380 override lives earlier in
    // the file, so the whole-file lookup would resolve it first.
    const primary = ruleBody(topLevel(chatWindowCss), '.hero-cta-primary');
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

  it('the group drops out with the first message; the desktop shares the same button (P380)', async () => {
    await mount([{ id: 'u1', role: 'user', content: '在吗', createdAt: 1 }]);
    expect(qs('[data-testid="hero-primary-cta"]')).toBeNull();
    expect(qsa('.hero-cta-card')).toHaveLength(0);
    await unmount();

    // 1440×900: P380 mounts the same primary button — the example card
    // group stays compact-only; P394 moved the starter capsules into the
    // sidebar's 快捷入口, so the hero keeps no capsule copy.
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
    const cta = qs('[data-testid="hero-primary-cta"]');
    expect(cta).not.toBeNull();
    expect(cta!.tagName).toBe('BUTTON');
    expect(qsa('.hero-cta-card')).toHaveLength(0);
    expect(qsa('.starter-chip')).toHaveLength(0);
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

/**
 * P380 — the desktop edition of the same contract, measured at 1440×900
 * on 1795101019 (docs/runs/walk-1795101019-d1.png): no hero-primary-cta
 * at all, hint + 4 chips + 3 explanation cards + 4 sidebar shortcuts
 * competing, a >250px gap between the empty state and the composer, and
 * a brand-solid send key while the input was empty.
 *
 * Contract asserted here (the backlog's verify clause):
 *  1. At 1440×900 `[data-testid=hero-primary-cta]` mounts — the SAME
 *     button element as the phone layout — inside .welcome/.hero with
 *     top < 700 and a stylesheet-guaranteed ≥44×44 box; clicking it
 *     focuses #chat-input and sends nothing.
 *  2. First-screen "start a conversation" primary candidates —
 *     clickable, ≥44×44, brand background or brand border — number ≤2.
 *     The three explanation cards are gone (the starter chips stay as
 *     the neutral secondary entries).
 *  3. The hero's foot lands ≤120px above the composer (P403) — resolved
 *     from the capped trailing bookend, the row gaps, the scrollport pad
 *     and the bar's own border + top padding.
 *  4. Empty input: `.input-send` resolves a disabled visual that is NOT
 *     the brand fill (neutral + dimmed + not-allowed cursor) and carries
 *     the disabled attribute; typing restores the enabled brand key.
 *  5. The same key assertions re-run at 390×844 — no phone regression.
 *
 * The fake DOM reports zero rects/computed styles, so geometry and
 * colours are pinned as the same render-level expressions a real-layout
 * run evaluates plus the resolved CSS constants (the established harness
 * convention in this file and hero-single-cta.test.ts).
 */
describe('P380 · the same primary CTA leads the desktop empty state (1440×900)', () => {
  const DESKTOP_W = 1440;
  const DESKTOP_H = 900;
  /** The hero foot must land within this of the composer top (P403). */
  const MAX_HERO_TO_COMPOSER = 120;

  const desktopChat = mediaBlock(chatWindowCss, '(min-width: 769px)');

  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);

  const mount = async (
    widthPx: number,
    onSend: (text: string) => void = () => {},
  ) => {
    dom = installFakeDom();
    // Width-driven stub: the hero branches only on (max-width: 768px);
    // the pointer query resolves false on every mount here.
    const mq = mediaQueryFor(false, widthPx <= 768);
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

  const type = async (el: FakeElement | null | undefined, value: string) => {
    if (!el) throw new Error('input target missing');
    el.value = value;
    await act(async () => {
      el.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    });
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  /** A control the user can actually reach: not disabled, not tabbed out,
   *  not inside an sr-only live region. */
  function isFocusable(el: FakeElement): boolean {
    if (el.disabled) return false;
    if (el.getAttribute('tabindex') === '-1') return false;
    if (el.closest('.sr-only')) return false;
    return true;
  }

  /** Inside the first screen at scrollTop = 0 (see the harness note). */
  function inFirstViewport(el: FakeElement, height: number): boolean {
    const r = el.getBoundingClientRect();
    return r.top < height && r.bottom >= 0;
  }

  /** Every resting-state declaration body that could paint `el` — the
   *  same resolution style hero-single-cta.test.ts uses. */
  function chromeRules(el: FakeElement): string {
    const bodies: string[] = [];
    const css = `${chatWindowCss}\n${inputBarCss}`;
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selText = m[1];
      if (selText.includes('@')) continue;
      for (const part of selText.split(',')) {
        const compound = part.trim().split(/[\s>+~]+/).pop() ?? '';
        const resting = compound.replace(
          /:{1,2}[a-zA-Z-]+(?:\([^)]*\))?/g,
          '',
        );
        if (resting && el.matches(resting)) bodies.push(m[2]);
      }
    }
    return bodies.join('\n');
  }

  function firstPx(rule: string, prop: string): number {
    const m = new RegExp(`${prop}\\s*:\\s*([0-9.]+)px`).exec(rule);
    return m ? Number(m[1]) : 0;
  }

  /** A "primary candidate" per the verify clause: a clickable element
   *  whose resolved box reaches the 44px floor on both axes. */
  function isLargeCandidate(el: FakeElement): boolean {
    const rules = chromeRules(el);
    const h = firstPx(rules, 'min-height') || firstPx(rules, 'height');
    const w = /(?:^|;)\s*width\s*:\s*100%/.test(rules)
      ? 44
      : firstPx(rules, 'min-width') || firstPx(rules, 'width');
    return h >= 44 && w >= 44;
  }

  /** Brand chrome = resting background or border painted var(--accent)
   *  exactly (accent-soft/-glow tints do not match). */
  function hasBrandChrome(el: FakeElement): boolean {
    const rules = chromeRules(el);
    return (
      /background(?:-color)?\s*:[^;]*var\(--accent\)/.test(rules) ||
      /border(?:-[a-z-]*)?\s*:[^;]*var\(--accent\)/.test(rules)
    );
  }

  it('1440×900: mounts the same hero-primary-cta — real button, in the first viewport, ≥44×44', async () => {
    await mount(DESKTOP_W);
    const cta = qs('[data-testid="hero-primary-cta"]');
    expect(cta).not.toBeNull();
    // The exact same element the phone layout renders: one button, one
    // shared implementation — the example group stays compact-only.
    expect(cta!.tagName).toBe('BUTTON');
    expect(cta!.getAttribute('type')).toBe('button');
    expect(cta!.textContent).toBe(HERO_PRIMARY_LABEL);
    expect(cta!.textContent).toBe('说说你的情况');
    expect(cta!.closest('.welcome')).not.toBeNull();
    expect(cta!.closest('.hero')).not.toBeNull();
    const rect = cta!.getBoundingClientRect();
    expect(rect.top).toBeLessThan(700);
    expect(rect.top).toBeLessThan(DESKTOP_H);
    expect(cta!.disabled).toBe(false);
    expect(cta!.hasAttribute('data-primary-cta')).toBe(false);
    await unmount();

    // The ≥44×44 guarantee resolves from the stylesheet: the shared
    // min-height floor plus the desktop min-width override.
    const primary = ruleBody(topLevel(chatWindowCss), '.hero-cta-primary');
    expect(declPxValues(primary, 'min-height')[0]).toBeGreaterThanOrEqual(44);
    expect(primary).toContain('background: var(--accent)');
    const deskRule = ruleBody(desktopChat, '.hero-cta-primary');
    expect(deskRule).not.toBe('');
    expect(declPxValues(deskRule, 'min-width')[0]).toBeGreaterThanOrEqual(44);
  });

  it('1440×900: clicking it focuses #chat-input and sends nothing', async () => {
    const sent: string[] = [];
    await mount(DESKTOP_W, (text) => sent.push(text));
    const cta = qs('[data-testid="hero-primary-cta"]')!;
    await act(async () => {
      cta.dispatchEvent(
        new FakeEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(dom.document.activeElement?.id).toBe('chat-input');
    expect(sent).toEqual([]);
    expect((qs('#chat-input') as FakeElement).value).toBe('');
    await unmount();
  });

  it('1440×900: ≤2 brand-chrome ≥44×44 primary entries; the explanation cards are gone', async () => {
    await mount(DESKTOP_W);
    const candidates = qsa('button, a[href], [role="button"], [role="link"]')
      .filter((el) => isFocusable(el) && inFirstViewport(el, DESKTOP_H))
      .filter(isLargeCandidate);
    const branded = candidates.filter(hasBrandChrome);
    expect(
      branded.length,
      `brand-chrome candidates: ${branded
        .map((el) => `${el.className}:${el.textContent.trim()}`)
        .join(' | ')}`,
    ).toBeLessThanOrEqual(2);
    expect(branded.length).toBeGreaterThanOrEqual(1);
    expect(branded[0].getAttribute('data-testid')).toBe('hero-primary-cta');
    // The entry-point consolidation: the three explanation cards are
    // removed; P394 moved the starter capsules to the sidebar's 快捷入口
    // too — the hero's centre is now ONE input path (primary button →
    // composer) with no capsule copy at all.
    expect(qsa('.feature')).toHaveLength(0);
    expect(qsa('.starter-chip')).toHaveLength(0);
    expect(qsa('.starter-chips')).toHaveLength(0);
    await unmount();
  });

  it('1440×900: the hero foot resolves ≤120px above the composer (P403)', () => {
    // Model: .welcome bottom → textarea top = row gap to the scroll
    // sentinel + gap to the capped ::after spacer + the spacer itself +
    // the scrollport's bottom padding + the bar's border-top and top
    // padding. The P305 bookends used to split the free space evenly,
    // leaving >250px; the 96px cap still measured 169px at 1440×900
    // (walk-1795128648: hero bottom 594 → textarea top 763) — P403
    // tightens the spacer so the resolved path lands inside 120px.
    const afterRule = ruleBody(desktopChat, '.messages-hero::after');
    expect(afterRule).not.toBe('');
    const basis = /flex\s*:\s*0\s+1\s+([0-9.]+)px/.exec(afterRule)?.[1];
    expect(basis, '::after keeps a capped basis').toBeTruthy();
    const rowGap = declPxValues(
      ruleBody(topLevel(chatWindowCss), '.messages'),
      'gap',
    )[0];
    const pad = declPxValues(
      ruleBody(topLevel(chatWindowCss), '.messages'),
      'padding',
    );
    const bar = ruleBody(topLevel(inputBarCss), '.input-bar');
    const barPadTop = declPxValues(bar, 'padding')[0];
    const barBorder = firstPx(bar, 'border-top');
    expect(rowGap).toBeGreaterThan(0);
    expect(pad[0]).toBeGreaterThan(0);
    const gap =
      Number(basis) + rowGap * 2 + pad[0] + barPadTop + barBorder;
    expect(gap).toBeLessThanOrEqual(MAX_HERO_TO_COMPOSER);
  });

  it('empty input: .input-send is disabled + neutral, not the brand fill — typing restores it', async () => {
    await mount(DESKTOP_W);
    const send = qs('.input-send')!;
    // The real disabled state: the attribute is set while the box is
    // empty, so the action is blocked at the control.
    expect(send.disabled).toBe(true);
    expect(send.getAttribute('disabled')).not.toBeNull();

    // …and a real disabled VISUAL: the resolved disabled fill is the
    // neutral surface-hover, not the brand solid, dimmed below full
    // opacity, with the not-allowed cursor.
    const disabledRule = ruleBody(inputBarCss, '.input-bar .input-send:disabled');
    expect(disabledRule).not.toBe('');
    expect(disabledRule).not.toContain('var(--accent');
    expect(disabledRule).toContain('background: var(--surface-hover)');
    expect(disabledRule).toContain('color: var(--text-muted)');
    expect(disabledRule).toContain('cursor: not-allowed');
    const opacity = /opacity\s*:\s*([0-9.]+)/.exec(disabledRule)?.[1];
    expect(opacity).toBeTruthy();
    expect(Number(opacity)).toBeLessThan(1);

    // Typing flips the control back to the enabled brand key — a
    // different resolved background than the disabled rule.
    await type(qs('#chat-input'), '她两天没回我了');
    expect(send.disabled).toBe(false);
    const enabledRule = ruleBody(
      topLevel(inputBarCss),
      '.input-bar .input-send',
    );
    expect(enabledRule).toContain('background: var(--accent)');
    expect(enabledRule).toContain('color: var(--on-accent)');
    await unmount();
  });

  it('390×844 regression: same button, same disabled send, ≤2 brand primaries', async () => {
    await mount(VIEWPORT_W);
    const cta = qs('[data-testid="hero-primary-cta"]')!;
    expect(cta).not.toBeNull();
    expect(cta.tagName).toBe('BUTTON');
    expect(cta.getBoundingClientRect().top).toBeLessThan(MAX_CTA_TOP);
    // The phone keeps its secondary example group; the chips stay text.
    expect(qsa('.hero-cta-card')).toHaveLength(HERO_EXAMPLE_PROMPTS.length);
    expect(qsa('.starter-chip')).toHaveLength(0);
    expect(qs('.welcome-hint')).toBeNull();
    expect(qsa('.feature')).toHaveLength(0);
    const candidates = qsa('button, a[href], [role="button"], [role="link"]')
      .filter((el) => isFocusable(el) && inFirstViewport(el, VIEWPORT_H))
      .filter(isLargeCandidate);
    const branded = candidates.filter(hasBrandChrome);
    expect(branded.length).toBeLessThanOrEqual(2);
    expect(branded[0].getAttribute('data-testid')).toBe('hero-primary-cta');
    // Same disabled-visual contract on the empty send key.
    expect(qs('.input-send')!.disabled).toBe(true);
    await unmount();
  });
});

/**
 * P394 — measured at 1440×900 (docs/runs/walk-1795115528-d1.png, re-flagged
 * walk-1795122630): every starter name rendered TWICE — the sidebar's
 * 快捷入口 rows plus the centre .starter-chip capsules — and the hero's
 * foot still sat ~290px above the composer while the
 * 「在下方输入框写下你的情况」copy named a target off-screen.
 *
 * Contract asserted here (the backlog's verify clause):
 *  1. At 1440×900 each of the four STARTER_ENTRIES names resolves exactly
 *     ONE visible entry — the centre capsules are gone entirely, so the
 *     aside's 快捷入口 rows own the names at every width (the P388
 *     direction reversed: the desktop keeps the WORKING entries in the
 *     sidebar and the hero converges on one input path).
 *  2. The hero's foot lands ≤120px above the composer — the P380 bookend
 *     model, retightened by P403 and still without the hint strip that
 *     padded the last 24px.
 *  3. The off-screen-pointing copy is removed — no .welcome-hint element
 *     and no 「在下方输入框」 text anywhere in the tree.
 *  4. At 390×844 each name resolves ZERO visible entries — P413 removed
 *     the non-interactive pills (a lookalike duplicate of the example
 *     cards); the closed drawer is aria-hidden + inert in the DOM and
 *     visibility:hidden in the stylesheet, and its rows stay the
 *     phone's tappable starter path once opened.
 *
 * Same fake-DOM convention as above: the "visible-hit" count is the
 * render-level expression a real :visible query evaluates.
 */
describe('P394 · one visible entry per starter name; P403 hero foot ≤120px above composer', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);

  /** The real first screen: the aside plus the empty ChatWindow. The
   *  mobile case mounts the drawer CLOSED — the state a 390×844
   *  walkthrough measures. */
  const mountScreen = async (widthPx: number, mobile: boolean) => {
    dom = installFakeDom();
    // Width-aware stub: the sidebar's ≥769px gate (min-width) and the
    // hero's ≤768px gate (max-width) both resolve against `widthPx`.
    const mq = (q: string) => {
      const maxW = /max-width:\s*(\d+)px/.exec(q);
      const minW = /min-width:\s*(\d+)px/.exec(q);
      const matches =
        q === COARSE_POINTER_QUERY
          ? mobile
          : (maxW || minW) !== null &&
            (maxW ? widthPx <= Number(maxW[1]) : true) &&
            (minW ? widthPx >= Number(minW[1]) : true);
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
    (dom.window as Record<string, unknown>).matchMedia = mq;
    vi.stubGlobal('matchMedia', mq);
    const { createRoot } = await import('react-dom/client');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(
          Fragment,
          null,
          createElement(Sidebar, {
            tools: [],
            isMobile: mobile,
            open: false,
            onQuickPrompt: () => {},
            onNewChat: () => {},
          }),
          createElement(ChatWindow, {
            messages: [] as ChatMessage[],
            loading: false,
            onSend: () => {},
            onSetupProfile: () => {},
          }),
        ),
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

  /** Elements a :visible-style count can hit for a starter name:
   *  interactive entries plus the compact pills, minus anything parked
   *  inside an inert / aria-hidden / sr-only subtree (the closed drawer
   *  carries all of them plus `visibility:hidden` in the sheet). */
  const visibleHits = (label: string) =>
    qsa('button, a[href], [role="button"], .starter-pill').filter(
      (el) =>
        !el.closest('[inert]') &&
        !el.closest('[aria-hidden="true"]') &&
        !el.closest('.sr-only') &&
        (el.textContent.trim().includes(label) ||
          (el.getAttribute('aria-label') ?? '').includes(label)),
    );

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('1440×900: each starter name resolves exactly ONE visible entry — the sidebar rows own the copy', async () => {
    await mountScreen(1440, false);
    // The duplicated surface is gone from the DOM entirely — real
    // conditional rendering, not a hidden element a :visible query
    // could still trip over. The capsules left the hero; the aside's
    // 快捷入口 rows are the single copy on desktop now.
    expect(qsa('.starter-chip')).toHaveLength(0);
    expect(qsa('.starter-chips')).toHaveLength(0);
    expect(qs('[aria-label="快捷入口"]')).not.toBeNull();
    expect(qsa('.quick-btn')).toHaveLength(STARTER_ENTRIES.length);
    for (const entry of STARTER_ENTRIES) {
      const hits = visibleHits(entry.label);
      expect(
        hits.length,
        `${entry.label} hits: ${hits.map((el) => el.className).join(' | ')}`,
      ).toBe(1);
      expect(hits[0].classList.contains('quick-btn')).toBe(true);
    }
    await unmount();
  });

  it('1440×900: hero bottom → composer top resolves ≤120px — margins pinned, spacer retightened, no hint strip', () => {
    // The measured ~290px gap came from `.welcome`'s `margin: auto`
    // resolving on the column-flex scrollport's MAIN axis plus the
    // 24px .welcome-hint strip parked above the composer. The vertical
    // pair stays pinned to 0, ::before owns all the free space, and the
    // hint is gone — the foot→textarea distance is the sentinel gaps +
    // the capped ::after + the scrollpad + the bar's border/pad. P403:
    // the 96px cap still left a measured 169px band, so the spacer's
    // basis is retightened until the resolved path lands ≤120px.
    const welcomeRule = ruleBody(topLevel(chatWindowCss), '.welcome');
    expect(welcomeRule).toContain('margin-top: 0');
    expect(welcomeRule).toContain('margin-bottom: 0');
    const afterRule = ruleBody(
      mediaBlock(chatWindowCss, '(min-width: 769px)'),
      '.messages-hero::after',
    );
    const basis = /flex\s*:\s*0\s+1\s+([0-9.]+)px/.exec(afterRule)?.[1];
    expect(basis, '::after keeps a capped basis').toBeTruthy();
    const rowGap = declPxValues(
      ruleBody(topLevel(chatWindowCss), '.messages'),
      'gap',
    )[0];
    const pad = declPxValues(
      ruleBody(topLevel(chatWindowCss), '.messages'),
      'padding',
    );
    const bar = ruleBody(topLevel(inputBarCss), '.input-bar');
    const barGap =
      declPxValues(bar, 'padding')[0] +
      Number(/border-top\s*:\s*([0-9.]+)px/.exec(bar)?.[1] ?? 0);
    expect(
      Number(basis) + rowGap * 2 + pad[0] + barGap,
    ).toBeLessThanOrEqual(120);
  });

  it('the「在下方输入框…」copy is gone — nothing on the first screen points off-screen', async () => {
    await mountScreen(1440, false);
    // No hint element and none of the off-screen-pointing sentence —
    // the hero sits inside the composer path now, so the signpost is
    // redundant at best.
    expect(qs('.welcome-hint')).toBeNull();
    const offenders = dom.document.documentElement
      ._walk()
      .filter(
        (el) =>
          el.children.length === 0 &&
          el.textContent.includes('在下方输入框'),
      );
    expect(offenders).toHaveLength(0);
    await unmount();
  });

  it('390×844: each starter name resolves ZERO visible entries — the pills are gone (P413); the closed drawer contributes nothing', async () => {
    await mountScreen(390, true);
    // P413: the non-interactive pill row duplicated the example cards'
    // job on the same screen, so it no longer mounts at ≤768px — the
    // four names have no visible entry on the phone first screen now.
    expect(qs('.starter-chips-line')).toBeNull();
    expect(qsa('.starter-pill')).toHaveLength(0);
    for (const entry of STARTER_ENTRIES) {
      const hits = visibleHits(entry.label);
      expect(
        hits.length,
        `${entry.label} hits: ${hits.map((el) => el.className).join(' | ')}`,
      ).toBe(0);
    }
    // Why the drawer rows can't be counted: closed ⇒ aria-hidden + inert
    // in the DOM and visibility:hidden + off-canvas in the stylesheet.
    // The rows still mount for when the drawer opens — with the pills
    // gone the drawer stays the phone's only tappable starter path.
    const aside = qs('.sidebar')!;
    expect(aside.getAttribute('aria-hidden')).toBe('true');
    expect(aside.hasAttribute('inert')).toBe(true);
    expect(qsa('.quick-btn')).toHaveLength(STARTER_ENTRIES.length);
    const drawerRule = ruleBody(
      mediaBlock(sidebarCss, '(max-width: 768px)'),
      '.sidebar.sidebar-drawer',
    );
    expect(drawerRule).toContain('visibility: hidden');
    await unmount();
  });

  it('390×844: the hero fills the scrollport — its foot sits one mobile pad above the composer', () => {
    // .messages-hero > .welcome is flex:1 0 auto, so the block's bottom
    // edge is the scrollport's content bottom; composer top = port edge
    // + the port's bottom padding — 16px, far inside the budget.
    const heroRule = ruleBody(mobileChat, '.messages-hero > .welcome');
    expect(heroRule).toContain('flex: 1 0 auto');
    const pad = declPxValues(ruleBody(mobileChat, '.messages'), 'padding');
    expect(pad[pad.length - 1]).toBeLessThanOrEqual(160);
  });
});

/**
 * P413 — measured at 390×844 on 1795138181 (docs/runs/walk-1795138181-m1.png):
 * EIGHT simultaneous "start a chat" entries crowded the phone first
 * screen — the primary CTA「说说你的情况」 + 3 example cards + 4
 * 「也可以直接问」pills + the composer. Vision: 「入口不唯一…多入口竞争」.
 * The four pills were a non-interactive lookalike of the example cards —
 * same job, second visual group — so they no longer mount at ≤768px.
 * What remains: ONE primary entry (the focus-only CTA), ONE secondary
 * group (the send-on-tap example cards), and the composer.
 *
 * Contract asserted here (the backlog's verify clause):
 *  1. Visible elements able to trigger a send number ≤5 — the example
 *     card buttons, chip buttons and the composer/send path count; the
 *     hero CTA only focuses #chat-input, so it does NOT count.
 *  2. At most ONE of the two secondary groups has visible items:
 *     `[class*=example-card]` vs `[class*=chip]` — after the dedupe the
 *     chip group is empty on the phone first screen.
 *
 * The real first screen mounts like the P394 describe: the aside with a
 * CLOSED mobile drawer plus the empty ChatWindow — the state a 390×844
 * walkthrough measures. The fake DOM reports zero rects, so "visible" is
 * the same render-level expression used above: mounted and not parked
 * inside an inert / aria-hidden / sr-only subtree.
 */
describe('P413 · phone first screen: ≤5 send entries, one secondary group', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);

  const mountScreen = async () => {
    dom = installFakeDom();
    const mq = (q: string) => {
      const maxW = /max-width:\s*(\d+)px/.exec(q);
      const minW = /min-width:\s*(\d+)px/.exec(q);
      const matches =
        q === COARSE_POINTER_QUERY ||
        ((maxW || minW) !== null &&
          (maxW ? VIEWPORT_W <= Number(maxW[1]) : true) &&
          (minW ? VIEWPORT_W >= Number(minW[1]) : true));
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
    (dom.window as Record<string, unknown>).matchMedia = mq;
    vi.stubGlobal('matchMedia', mq);
    const { createRoot } = await import('react-dom/client');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(
          Fragment,
          null,
          createElement(Sidebar, {
            tools: [],
            isMobile: true,
            open: false,
            onQuickPrompt: () => {},
            onNewChat: () => {},
          }),
          createElement(ChatWindow, {
            messages: [] as ChatMessage[],
            loading: false,
            onSend: () => {},
            onSetupProfile: () => {},
          }),
        ),
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

  /** The :visible-style count — mounted and not inside an inert /
   *  aria-hidden / sr-only subtree (the closed drawer parks its rows
   *  under all of them plus visibility:hidden in the sheet). */
  const visible = (el: FakeElement) =>
    !el.closest('[inert]') &&
    !el.closest('[aria-hidden="true"]') &&
    !el.closest('.sr-only');

  const allElements = () =>
    (dom.document.documentElement as FakeElement)._walk();
  /** The spec's `[class*=x]` substring matcher — the fake DOM has no
   *  attribute-substring selector, so the same predicate runs by hand
   *  (the error-surface.test.ts convention). */
  const classHits = (needle: string) =>
    allElements().filter((e) => e.className.includes(needle));
  /** Buttons that ARE chips or live inside a `[class*=chip]` container. */
  const chipButtons = () =>
    allElements().filter((e) => {
      if (e.tagName !== 'BUTTON') return false;
      for (let n: FakeElement | null = e; n; n = n.parentElement) {
        if (n.className.includes('chip')) return true;
      }
      return false;
    });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('390×844: visible send-triggering elements number ≤5', async () => {
    await mountScreen();
    // The composer/send path counts as its controls: the textarea (Enter
    // sends) and the send key. The hero primary CTA only focuses
    // #chat-input — it sends nothing — so it is deliberately NOT in the
    // counted list.
    const sendTriggers = [
      ...qsa('button.hero-cta-card'),
      ...chipButtons(),
      ...qsa('#chat-input'),
      ...qsa('button.input-send'),
    ].filter(visible);
    expect(
      sendTriggers.length,
      `send entries: ${sendTriggers
        .map((el) => `${el.className}:${el.textContent.trim()}`)
        .join(' | ')}`,
    ).toBeLessThanOrEqual(5);
    // The measured shape: three example cards + the composer pair, and
    // the focus-only primary still mounts beside them (not counted).
    expect(qsa('button.hero-cta-card').filter(visible)).toHaveLength(3);
    expect(qs('[data-testid="hero-primary-cta"]')).not.toBeNull();
    await unmount();
  });

  it('390×844: at most ONE secondary group has visible items — example cards stay, chips are gone', async () => {
    await mountScreen();
    const exampleGroup = classHits('example-card').filter(visible);
    const chipGroup = classHits('chip').filter(visible);
    // The dedupe contract: never both groups on the same first screen.
    expect(
      Math.min(exampleGroup.length, chipGroup.length),
      `example-card ${exampleGroup.length} vs chip ${chipGroup.length}: ` +
        `${[...exampleGroup, ...chipGroup]
          .map((el) => el.className)
          .join(' | ')}`,
    ).toBe(0);
    // …and concretely: the example cards are the surviving group, the
    //「也可以直接问」pills (and any chip chrome) mount nothing at ≤768px.
    expect(exampleGroup).toHaveLength(HERO_EXAMPLE_PROMPTS.length);
    expect(chipGroup).toHaveLength(0);
    await unmount();
  });
});

/**
 * P415 — measured at 1440×900 on 1795138181 (docs/runs/walk-1795138181-d1.png):
 * the header subtitle「先听你说完，再给具体建议」and the hero line
 * 「懂分寸的恋爱顾问：先听你说完，再给一句能直接照着用的建议。」repeated
 * the SAME promise twice on one screen, and the leading bookend ate all
 * the free space so the hero hugged the composer — vision: 「留白很大…
 * 视觉重心偏下」「品牌名和副标题语义也重复」.
 *
 * Contract asserted here (the backlog's verify clause):
 *  1. At 1440×900「先听你说完」appears exactly ONCE in the rendered
 *     visible text of header + hero — the header keeps the brand
 *     wordmark only, the hero keeps the single copy.
 *  2. The hero's vertical centre lands in the 45–55% viewport band.
 *     The fake DOM resolves no rects, so the assertion is the same
 *     stylesheet contract the layout now uses: inside (min-width:
 *     769px) the .welcome box grows to fill the scrollport and centres
 *     its own content (justify-content: center) while BOTH bookends
 *     keep capped bases — 64px leading, 40px trailing — so the block
 *     centre sits a touch below port centre (≈46–48% of 900px for the
 *     measured header/composer heights), never the old ~63%.
 *  3. The phone model is untouched — those rules live inside the
 *     desktop media block; the ≤768px describes above still pin it.
 */
describe('P415 · one promise on the first screen; hero centred 45–55%', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;

  /** Occurrences of `text` inside visible text nodes under `rootEl` —
   *  counts each text node once (textContent on parents would
   *  double-count) and skips inert / aria-hidden / sr-only subtrees. */
  const visibleTextHits = (rootEl: FakeElement, text: string) => {
    let hits = 0;
    const hidden = (el: FakeElement) =>
      el.closest('[inert]') !== null ||
      el.closest('[aria-hidden="true"]') !== null ||
      el.closest('.sr-only') !== null;
    for (const el of [rootEl, ...rootEl._walk()]) {
      if (hidden(el)) continue;
      for (const node of el.childNodes) {
        if (node.nodeType === 3) {
          hits += (node.nodeValue.match(new RegExp(text, 'g')) ?? []).length;
        }
      }
    }
    return hits;
  };

  const mountApp = async () => {
    dom = installFakeDom();
    (dom.window as Record<string, unknown>).innerWidth = 1440;
    (dom.window as Record<string, unknown>).innerHeight = 900;
    // Desktop stub: every width query resolves against 1440px and the
    // pointer is fine — the same width-aware shape as the P394 harness.
    const mq = (q: string) => {
      const maxW = /max-width:\s*(\d+)px/.exec(q);
      const minW = /min-width:\s*(\d+)px/.exec(q);
      const matches =
        q === COARSE_POINTER_QUERY
          ? false
          : (maxW || minW) !== null &&
            (maxW ? 1440 <= Number(maxW[1]) : true) &&
            (minW ? 1440 >= Number(minW[1]) : true);
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
    (dom.window as Record<string, unknown>).matchMedia = mq;
    vi.stubGlobal('matchMedia', mq);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url =
          typeof input === 'string'
            ? input
            : String((input as { url?: string })?.url);
        if (url === '/api/tools') return jsonResponse({ tools: [] });
        if (url === '/api/health') {
          return jsonResponse({
            status: 'ok',
            llmConfigured: true,
            llmModel: 'qwen3.8-flash',
          });
        }
        return jsonResponse({ ok: true });
      }),
    );
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');
    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(createElement(App));
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const unmountApp = async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    dom.document.body.textContent = '';
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('1440×900: 「先听你说完」resolves exactly once across the header + hero visible text', async () => {
    await mountApp();
    const header = qs('.header');
    const hero = qs('.hero');
    expect(header).not.toBeNull();
    expect(hero).not.toBeNull();
    // The header keeps the brand wordmark only — no subtitle node at all.
    expect(header!.querySelector('.subtitle')).toBeNull();
    const headerHits = visibleTextHits(header!, '先听你说完');
    const heroHits = visibleTextHits(hero!, '先听你说完');
    expect(headerHits).toBe(0);
    expect(heroHits).toBe(1);
    expect(headerHits + heroHits).toBe(1);
    await unmountApp();
  });

  it('the desktop hero fills the scrollport and centres its content — both bookends capped', () => {
    const desktop = mediaBlock(chatWindowCss, '(min-width: 769px)');
    // The box grows to fill the port and centres its own content — the
    // centring rule a getBoundingClientRect can't express in the fake DOM.
    // The rule selects the .hero state marker (P337's alias on the same
    // .welcome element) — a plain-.welcome rule in the desktop block is
    // banned by the P307 clearance contract.
    const heroRule = ruleBody(desktop, '.messages-hero > .hero');
    expect(heroRule).toContain('flex: 1 0 auto');
    expect(heroRule).toContain('justify-content: center');
    // Both spacers keep capped bases; the leading cap outgrows the
    // trailing 40px by ≤56px so the block centre lands only a touch below
    // port centre — inside the 45–55% viewport band, never the old ~63%.
    const beforeBasis = Number(
      /flex\s*:\s*0\s+1\s+([0-9.]+)px/.exec(
        ruleBody(desktop, '.messages-hero::before'),
      )?.[1],
    );
    const afterBasis = Number(
      /flex\s*:\s*0\s+1\s+([0-9.]+)px/.exec(
        ruleBody(desktop, '.messages-hero::after'),
      )?.[1],
    );
    expect(beforeBasis).toBeGreaterThan(0);
    expect(afterBasis).toBeGreaterThan(0);
    expect(beforeBasis - afterBasis).toBeLessThanOrEqual(56);
    // The phone layout keeps its own fill model — the ≤768px
    // .messages-hero > .welcome still distributes via auto margins,
    // never the desktop centring rule.
    expect(
      ruleBody(mobileChat, '.messages-hero > .welcome'),
    ).not.toContain('justify-content: center');
  });
});
