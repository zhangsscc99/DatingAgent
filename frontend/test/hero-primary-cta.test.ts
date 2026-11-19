/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act, Fragment } from 'react';
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
 * hero's foot lands ≤160px from the composer, and the empty send key
 * drops to a real disabled visual. Asserted in the last describe.
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
 *  3. The hero's foot lands ≤160px above the composer — resolved from
 *     the capped trailing bookend, the row gaps and the scrollport pad.
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
  /** The hero foot must land within this of the composer top. */
  const MAX_HERO_TO_COMPOSER = 160;

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

  it('1440×900: the hero foot resolves ≤160px above the composer', () => {
    // Model: .welcome bottom → composer top = row gap to the scroll
    // sentinel + gap to the capped ::after spacer + the spacer itself +
    // the scrollport's bottom padding. The P305 bookends used to split
    // the free space evenly, leaving >250px — the cap closes it.
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
    expect(rowGap).toBeGreaterThan(0);
    expect(pad[0]).toBeGreaterThan(0);
    const gap = Number(basis) + rowGap * 2 + pad[0];
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
 *  2. The hero's foot lands ≤160px above the composer — the P380 bookend
 *     model, now without the hint strip that padded the last 24px.
 *  3. The off-screen-pointing copy is removed — no .welcome-hint element
 *     and no 「在下方输入框」 text anywhere in the tree.
 *  4. At 390×844 each name still resolves exactly one visible entry —
 *     the non-interactive pills; the closed drawer is aria-hidden +
 *     inert in the DOM and visibility:hidden in the stylesheet.
 *
 * Same fake-DOM convention as above: the "visible-hit" count is the
 * render-level expression a real :visible query evaluates.
 */
describe('P394 · one visible entry per starter name; hero foot ≤160px above composer', () => {
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

  it('1440×900: hero bottom → composer top resolves ≤160px — margins pinned, spacer capped, no hint strip', () => {
    // The measured ~290px gap came from `.welcome`'s `margin: auto`
    // resolving on the column-flex scrollport's MAIN axis plus the
    // 24px .welcome-hint strip parked above the composer. The vertical
    // pair stays pinned to 0, ::before owns all the free space, and the
    // hint is gone — the foot→bar distance is just the sentinel gaps +
    // the capped ::after + the scrollpad.
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
    expect(Number(basis) + rowGap * 2 + pad[0]).toBeLessThanOrEqual(160);
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

  it('390×844: each starter name still resolves exactly ONE visible entry — the pills; the closed drawer contributes nothing', async () => {
    await mountScreen(390, true);
    for (const entry of STARTER_ENTRIES) {
      const hits = visibleHits(entry.label);
      expect(
        hits.length,
        `${entry.label} hits: ${hits.map((el) => el.className).join(' | ')}`,
      ).toBe(1);
      expect(hits[0].classList.contains('starter-pill')).toBe(true);
    }
    // Why the drawer rows can't be counted: closed ⇒ aria-hidden + inert
    // in the DOM and visibility:hidden + off-canvas in the stylesheet.
    // The rows still mount for when the drawer opens — the pills are
    // non-interactive, so the drawer stays the phone's tappable path.
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
