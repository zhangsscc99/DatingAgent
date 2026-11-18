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
import type { ChatMessage } from '../src/types';

/**
 * P343 — measured at 390×844 scrollTop=0 (docs/runs/walk-1795041074-m1.png):
 * the「完善资料」footnote's bottom sat at 484px while the composer top sat at
 * 760px — a 276px solid dead band between them — and the viewport carried
 * ten near-equal clickables (menu/theme/more, three starter chips, the
 * footnote, the length cycler, send). P336/P337 centred the block and cut
 * its weight, but the equal .messages bookends still split the free space
 * around a short block, so the band never closed.
 *
 * P343's contract:
 *  1. The hero no longer sits inside centred free space — `.messages`
 *     wears a `messages-hero` modifier while the welcome block is up: the
 *     bookends stop growing, the .welcome box takes the scrollport's full
 *     height as a flex column, the content centres itself above the block
 *     foot, and the「完善资料」footnote is pinned to the bottom by its own
 *     auto margin — its resolved distance to the composer top stays
 *     ≤ 96px.
 *  2. The first screen keeps exactly ONE obvious action: the composer's
 *     send key. The three starter chips demote to a single muted
 *     non-interactive hint line (text, not button-chrome), the「完善资料」
 *     entry becomes a footer-level role="link" span (outside the
 *     button/a[href]/[role=button] pool), and the reply-length cycler
 *     drops off the tool row while the composer is spotlighted at ≤768px.
 *     Visible `button, a[href], [role=button]` number ≤ 4 — in the real
 *     shell that's topbar menu/theme/more + send; inside ChatWindow the
 *     send key is the only one.
 *  3. Exactly one primary solid control renders — [data-primary-cta] on
 *     .input-send.
 *  4. Desktop (≥769px) is untouched: three tappable chips, three feature
 *     cards, the footnote as a real button.
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
/** P343: the hero's last visible element must land within this of the
 *  composer top — the P336/P337 dead band measured 276px. */
const MAX_BOTTOM_GAP = 96;

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

/** Inside the first screen: scrollTop = 0, so a rect is in view while its
 *  top edge sits above VIEWPORT_H and its bottom edge below 0. The fake
 *  DOM reports zero rects, which lands every mounted node "in view" —
 *  the render-level contract is therefore about what mounts at all. */
function inFirstViewport(el: FakeElement): boolean {
  const r = el.getBoundingClientRect();
  return r.top < VIEWPORT_H && r.bottom >= 0;
}

describe('P343 · the .hero fills the scrollport — no dead band at 390×844', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;

  const mount = async (
    widthPx: number,
    messages: ChatMessage[] = [] as ChatMessage[],
  ) => {
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
          messages,
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

  it('the scrollport wears .messages-hero only while the hero is up', async () => {
    await mount(VIEWPORT_W);
    const messages = qs('.messages')!;
    expect(messages.className.split(/\s+/)).toContain('messages-hero');
    const hero = qs('.hero');
    expect(hero).not.toBeNull();
    expect(hero).toBe(qs('.welcome'));
    expect(hero!.classList.contains('animate-in')).toBe(true);
    await unmount();

    // With a conversation the modifier drops and the bookend centring
    // (P305) keeps doing its job on short histories.
    await mount(VIEWPORT_W, [
      { id: 'u1', role: 'user', content: '在吗', createdAt: 1 },
    ] as ChatMessage[]);
    expect(qs('.hero')).toBeNull();
    expect(qs('.messages')!.className.split(/\s+/)).not.toContain(
      'messages-hero',
    );
    await unmount();
  });

  it('under .messages-hero the bookends stop growing and .welcome fills as a flex column', () => {
    for (const pseudo of [
      '.messages-hero::before',
      '.messages-hero::after',
    ]) {
      const body = ruleBodyContaining(mobileChat, pseudo);
      expect(body, `${pseudo} rule`).not.toBe('');
      expect(body).toContain('flex-grow: 0');
    }
    const hero = ruleBody(mobileChat, '.messages-hero > .welcome');
    expect(hero).not.toBe('');
    // The box takes the scrollport's full height…
    expect(hero).toMatch(/flex\s*:\s*1/);
    expect(hero).toContain('display: flex');
    expect(hero).toContain('flex-direction: column');
    // …and the vertical margins can no longer absorb free space (the P305
    // `margin: auto` centring would otherwise defeat the grow — the
    // override keeps only the horizontal centring).
    expect(hero).toContain('margin: 0 auto');
  });

  it('content centres above the block foot; the footnote pins to the bottom', () => {
    // First child gets an auto top margin → the content block centres in
    // the space above the footer; the footnote's own auto top margin
    // lands it at the bottom of the full-height .hero box.
    const first = ruleBody(
      mobileChat,
      '.messages-hero > .welcome > :first-child',
    );
    expect(first).toContain('margin-top: auto');
    const foot = ruleBody(
      mobileChat,
      '.messages-hero > .welcome > .welcome-cta',
    );
    expect(foot).toContain('margin-top: auto');
  });

  it('the resolved foot gap lands within 96px of the composer top', () => {
    // The footnote sits at the bottom of the hero's content box. From
    // there to the composer top: the hero's own padding-bottom, one row
    // gap to the scroll sentinel, one row gap to the dead ::after spacer,
    // and the scrollport's padding-bottom.
    const welcomePad = boxSides(
      declPxValues(ruleBody(mobileChat, '.welcome'), 'padding'),
    );
    const messagesPad = boxSides(
      declPxValues(ruleBody(mobileChat, '.messages'), 'padding'),
    );
    const rowGap = declPxValues(ruleBody(baseChat, '.messages'), 'gap')[0];
    expect(rowGap).toBeGreaterThan(0);
    const gap = welcomePad[2] + rowGap * 2 + messagesPad[2];
    expect(gap).toBeLessThanOrEqual(MAX_BOTTOM_GAP);
  });

  it('mounted: the hero last element is the footnote, within 96px of the composer top', async () => {
    await mount(VIEWPORT_W);
    const hero = qs('.hero')!;
    const last = hero.children[hero.children.length - 1];
    expect(last.classList.contains('welcome-cta')).toBe(true);
    const bar = qs('.input-bar')!;
    // The acceptance expression a real-layout run evaluates — the fake DOM
    // reports zero rects, so this holds trivially here while the CSS
    // assertions above pin the geometry.
    const gap =
      bar.getBoundingClientRect().top - last.getBoundingClientRect().bottom;
    expect(gap).toBeLessThanOrEqual(MAX_BOTTOM_GAP);
    await unmount();
  });
});

describe('P343 · the first screen keeps ≤4 clickables and one primary', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);

  const mount = async (
    widthPx: number,
    messages: ChatMessage[] = [] as ChatMessage[],
  ) => {
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
          messages,
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

  it('the three starter chips collapse into one muted non-interactive hint line', async () => {
    await mount(VIEWPORT_W);
    expect(qsa('.starter-chip')).toHaveLength(0);
    expect(qs('.starter-chips')).toBeNull();
    const line = qs('.starter-chips-line');
    expect(line).not.toBeNull();
    expect(line!.tagName).toBe('P');
    for (const label of ['资料优化', '聊天指导', '约会规划']) {
      expect(line!.textContent).toContain(label);
    }
    // Passive copy — not itself a control, and it wraps no control.
    expect(line!.querySelector('button, a[href], [role="button"]')).toBeNull();
    // Muted, single-line text — no button chrome.
    const rule = ruleBody(mobileChat, '.starter-chips-line');
    expect(rule).toContain('color: var(--text-muted)');
    expect(rule).not.toContain('var(--accent)');
    expect(rule).toContain('white-space: nowrap');
    expect(rule).not.toContain('border');
    await unmount();
  });

  it('the「完善资料」entry is a footer-level role="link" span — outside the button pool', async () => {
    await mount(VIEWPORT_W);
    const cta = qs('.welcome-cta');
    expect(cta).not.toBeNull();
    expect(cta!.tagName).toBe('SPAN');
    expect(cta!.getAttribute('role')).toBe('link');
    expect(cta!.getAttribute('tabindex')).toBe('0');
    expect(cta!.getAttribute('data-variant')).toBe('link');
    expect(cta!.textContent).toContain('完善资料');
    expect(cta!.matches('button, a[href], [role="button"]')).toBe(false);
    // Still the welcome block's last element — the foot of the hero.
    const welcome = qs('.welcome')!;
    expect(welcome.children[welcome.children.length - 1]).toBe(cta);
    // …and it still opens the dialog, by click and by Enter.
    await unmount();

    let opened = 0;
    dom = installFakeDom();
    const mq = mediaQueryForWidth(VIEWPORT_W);
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
          onSetupProfile: () => {
            opened += 1;
          },
          replyLength: 'default',
          onReplyLengthChange: () => {},
        }),
      );
      await Promise.resolve();
    });
    const link = qs('.welcome-cta')!;
    await act(async () => {
      link.dispatchEvent(
        new FakeEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(opened).toBe(1);
    await act(async () => {
      link.dispatchEvent(
        new FakeEvent('keydown', {
          bubbles: true,
          cancelable: true,
          props: { key: 'Enter' },
        }),
      );
    });
    expect(opened).toBe(2);
    await unmount();
  });

  it('visible `button, a[href], [role=button]` number ≤4 — the send key alone inside ChatWindow', async () => {
    await mount(VIEWPORT_W);
    const controls = qsa('button, a[href], [role=button]').filter((el) =>
      inFirstViewport(el),
    );
    const labels = controls.map(
      (el) => el.getAttribute('aria-label') ?? el.textContent.trim(),
    );
    // The real shell adds topbar menu/theme/more — inside ChatWindow the
    // send key is the only mounted control (chips are text, the footnote
    // is a role="link" span, the cycler and the kbd hint are gone).
    expect(
      controls.length,
      `first-screen controls: ${labels.join(' | ')}`,
    ).toBeLessThanOrEqual(4);
    expect(labels).toEqual(['发送消息']);
    expect(qs('.reply-length-toggle')).toBeNull();
    expect(qs('.input-hint-btn')).toBeNull();
    await unmount();
  });

  it('the length cycler returns with the first conversation — the gate is spotlight-bound', async () => {
    await mount(VIEWPORT_W, [
      { id: 'u1', role: 'user', content: '在吗', createdAt: 1 },
    ] as ChatMessage[]);
    expect(qs('.reply-length-toggle')).not.toBeNull();
    await unmount();
  });

  it('exactly one [data-primary-cta] renders — the composer send key keeps the only solid fill', async () => {
    await mount(VIEWPORT_W);
    const primaries = qsa('[data-primary-cta]');
    expect(primaries).toHaveLength(1);
    const send = primaries[0];
    expect(send.classList.contains('input-send')).toBe(true);
    expect(send.closest('.input-bar')).not.toBeNull();
    expect(qs('.welcome')!.querySelector('[data-primary-cta]')).toBeNull();
    await unmount();

    // Enabled and empty-disabled states share the one brand solid.
    for (const sel of [
      '.input-bar .input-send',
      '.input-bar .input-send:disabled',
    ]) {
      const rule = ruleBody(inputBarCss, sel);
      expect(rule, sel).toContain('background: var(--accent)');
      expect(rule, sel).toContain('color: var(--on-accent)');
    }
    // Nothing else on the hero wears the accent fill.
    for (const sel of [
      ".welcome-cta[data-variant='link']",
      '.starter-chips-line',
      '.welcome-feature-line',
    ]) {
      const rule = ruleBody(
        sel === '.starter-chips-line' ? mobileChat : chatWindowCss,
        sel,
      );
      expect(rule, sel).not.toBe('');
      expect(rule, sel).not.toContain('background: var(--accent)');
    }
  });
});

describe('P343 · desktop ≥769px keeps the full welcome block', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);

  it('1440-wide render: tappable chips, three cards and a real footnote button', async () => {
    dom = installFakeDom();
    const mq = mediaQueryForWidth(1440);
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

    expect(qsa('.starter-chip')).toHaveLength(3);
    expect(qs('.starter-chips-line')).toBeNull();
    const cta = qs('.welcome-cta');
    expect(cta).not.toBeNull();
    expect(cta!.tagName).toBe('BUTTON');
    expect(qsa('.feature')).toHaveLength(3);
    // The cycler is untouched on the desktop empty screen.
    expect(qs('.reply-length-toggle')).not.toBeNull();

    await act(async () => {
      root?.unmount();
    });
    root = null;
    dom.document.body.textContent = '';
  });

  it('the hero-fill rules stay inside the ≤768px block — desktop centring untouched', () => {
    // The P305 bookends still centre the card on desktop: the top-level
    // rule is intact and the overrides live only in the mobile block.
    for (const pseudo of ['.messages::before', '.messages::after']) {
      const body = ruleBodyContaining(baseChat, pseudo);
      expect(body, `${pseudo} rule`).not.toBe('');
      expect(body).toContain('flex: 1 0 0');
    }
    expect(ruleBody(baseChat, '.welcome')).toContain('margin: auto');
    expect(baseChat).not.toContain('messages-hero');
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
      // 390px empty: P343 leaves the send key alone in the row — the kbd
      // hint stays unmounted (P336) and the length cycler drops off while
      // the composer is spotlighted (P343).
      await mount(VIEWPORT_W);
      let tools = dom.document.querySelector('.input-tools') as FakeElement;
      expect(dom.document.querySelector('.input-hint-btn')).toBeNull();
      expect(dom.document.querySelector('.reply-length-toggle')).toBeNull();
      let buttons = tools.querySelectorAll('button');
      expect(buttons.length).toBe(1);
      let heights = buttons.map((b) => b.getBoundingClientRect().height);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(4);
      await unmount();

      // 500px empty: the length cycler is off (spotlight × ≤768) while the
      // shortcut hint renders again past the ≤430px narrow breakpoint —
      // chip + send remain one family.
      await mount(500);
      tools = dom.document.querySelector('.input-tools') as FakeElement;
      buttons = tools.querySelectorAll('button');
      expect(buttons.length).toBe(2);
      heights = buttons.map((b) => b.getBoundingClientRect().height);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(4);
      await unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
