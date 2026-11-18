/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installFakeDom,
  FakeElement,
  type FakeDom,
} from './helpers/fakeDom';
import ChatWindow from '../src/components/ChatWindow';
import type { ChatMessage } from '../src/types';

/**
 * P325 — at 390×844 the 「记得你提到：…」 capsule strip read as a floating
 * overlay and the first AI card's top edge (avatar + first text line)
 * looked clipped beneath it (walk-1795013454-m2.png). The strip now owns
 * an unmistakable slot at ≤768px: an opaque --surface band with the
 * divider kept, margin locked at 0, more room under the pill — still a
 * real block in the .chat-window column (never absolute/fixed), so no
 * scroll offset can slide a message beneath it, and scroll targets keep
 * scroll-margin-top of air below the band.
 *
 * Layout-honesty note, same as drawer-overlay.test.ts: this fake-DOM
 * harness (and jsdom alike) computes no layout — getBoundingClientRect()
 * returns zeros, so the verify bullet's pixel assertion
 * (capsuleRect.bottom <= firstMessageRect.top at scrollTop 0) is NOT
 * exercised here. It is covered structurally instead — a sibling block
 * before .messages-wrap can never overlap the scrollport, and the
 * ≤768px rules are parsed from the CSS source — plus the live smoke
 * screenshot at 390×844.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatWindowCss = readFileSync(join(SRC, 'components', 'ChatWindow.css'), 'utf8');

const noop = () => {};

/** P296 fixture: real turns, no stored profile, two lexicon facts. */
const factTurns: ChatMessage[] = [
  { id: 'u1', role: 'user', content: '我昨晚没睡好，一直在想怎么回她' },
  { id: 'a1', role: 'assistant', content: '先接住自己，再来想措辞。' },
  { id: 'u2', role: 'user', content: '周末本来想约她去看展' },
  { id: 'a2', role: 'assistant', content: '这个安排很轻，适合开口。' },
];

function stubStorage(entries: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(entries));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

function renderChat(extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(ChatWindow, {
      messages: factTurns,
      loading: false,
      onSend: noop,
      profile: null,
      ...extra,
    }),
  );
}

/* ---------- CSS helpers (same style as P308/P324 tests) ---------- */

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

function ruleBody(css: string, selector: string): string {
  const re = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
    'g',
  );
  return [...css.matchAll(re)].map((m) => m[1]).join('\n');
}

function declPxValues(rule: string, prop: string): number[] {
  const decl = new RegExp(`${prop}:\\s*([^;]+)`).exec(rule)?.[1].trim();
  if (!decl) return [];
  const m =
    /^(-?[0-9.]+)(?:px)?(?:\s+(-?[0-9.]+)(?:px)?)?(?:\s+(-?[0-9.]+)(?:px)?)?(?:\s+(-?[0-9.]+)(?:px)?)?$/.exec(
      decl,
    );
  if (!m) return [];
  return m
    .slice(1)
    .filter((v) => v !== undefined)
    .map(Number);
}

/** Top component of a `padding` shorthand (CSS 1–4 value rules). */
function paddingTopPx(rule: string): number | null {
  const longhand = declPxValues(rule, 'padding-top');
  if (longhand.length === 1) return longhand[0];
  const values = declPxValues(rule, 'padding');
  return values.length === 0 ? null : values[0];
}

/** Bottom component of a `padding` shorthand (CSS 1–4 value rules). */
function paddingBottomPx(rule: string): number | null {
  const longhand = declPxValues(rule, 'padding-bottom');
  if (longhand.length === 1) return longhand[0];
  const values = declPxValues(rule, 'padding');
  if (values.length === 0) return null;
  return values[values.length >= 3 ? 2 : 0];
}

/* ---------- structural guarantees on the CSS ---------- */

describe('P325 · the capsule strip owns a non-overlapping slot at ≤768px', () => {
  const base = topLevel(chatWindowCss);
  const mobile = mediaBlock(chatWindowCss, '(max-width: 768px)');

  it('is never absolutely positioned — at no width may it float over .messages-wrap', () => {
    for (const [name, body] of [
      ['base', ruleBody(base, '.memory-receipt')],
      ['mobile', ruleBody(mobile, '.memory-receipt')],
    ] as const) {
      expect(body, `${name} .memory-receipt rule`).not.toBe('');
      const position = /position\s*:\s*([a-z-]+)/.exec(body)?.[1] ?? 'static';
      // A real block (static) or paint-order-only relative. Sticky would
      // pin it over scrolled content — the chosen mechanism keeps it out
      // of the scroll column entirely, so it is not allowed either.
      expect(
        ['static', 'relative'],
        `${name} .memory-receipt position`,
      ).toContain(position);
    }
    // No margin that could pull the scrollport up over the strip.
    const margin = /margin-bottom\s*:\s*([^;]+);/.exec(
      ruleBody(mobile, '.memory-receipt'),
    );
    expect(margin?.[1].trim()).toBe('0');
  });

  it('reserves real clearance: opaque band + ≥8px under the pill + ≥8px list padding-top', () => {
    const receipt = ruleBody(mobile, '.memory-receipt');
    // An opaque surface band so scrolled text can never bleed through and
    // the strip no longer merges with the first card.
    expect(receipt).toContain('background: var(--surface)');
    // Room under the 44px pill itself.
    const bottomPad = paddingBottomPx(receipt);
    expect(bottomPad).not.toBeNull();
    expect(bottomPad!).toBeGreaterThanOrEqual(8);
    // …plus the scrollport's own top padding, never collapsed or negative,
    // so at scrollTop 0 the gap capsule.bottom → firstMessage.top > 0.
    const listTop = paddingTopPx(ruleBody(mobile, '.messages'));
    expect(listTop).not.toBeNull();
    expect(listTop!).toBeGreaterThanOrEqual(8);
    // And rows scrolled to (search match, regenerate) keep air under the
    // strip instead of landing flush on the divider.
    const margin = declPxValues(ruleBody(mobile, '.messages > *'), 'scroll-margin-top');
    expect(margin).toHaveLength(1);
    expect(margin[0]).toBeGreaterThanOrEqual(8);
  });

  it('leaves the desktop layout untouched — no sticky, no extra padding ≥769px', () => {
    const receipt = ruleBody(base, '.memory-receipt');
    expect(receipt).not.toContain('position: sticky');
    expect(receipt).not.toContain('position: absolute');
    expect(receipt).not.toContain('position: fixed');
    // The scrollport's desktop padding stays the 24px it always was.
    const desktopPad = declPxValues(ruleBody(base, '.messages'), 'padding');
    expect(desktopPad[0]).toBe(24);
  });
});

describe('P325 · markup ordering — capsule precedes the scrollport', () => {
  it('renders .memory-receipt as a sibling before .messages-wrap, messages inside it', () => {
    stubStorage();
    const markup = renderChat();
    const receiptAt = markup.indexOf('memory-receipt');
    const wrapAt = markup.indexOf('messages-wrap');
    const messagesAt = markup.indexOf('class="messages"');
    const firstBubbleAt = markup.indexOf('bubble-row');
    expect(receiptAt).toBeGreaterThan(-1);
    expect(wrapAt).toBeGreaterThan(receiptAt);
    expect(messagesAt).toBeGreaterThan(wrapAt);
    expect(firstBubbleAt).toBeGreaterThan(messagesAt);
    // The receipt strip closes before the scrollport opens — a sibling
    // block, never a parent of the scroll column. Two closes: one ends
    // .memory-capsule-wrap, the next ends .memory-receipt itself.
    const capsuleWrapEnd = markup.indexOf(
      '</div>',
      markup.indexOf('memory-capsule-wrap'),
    );
    const stripEnd = markup.indexOf('</div>', capsuleWrapEnd + 1);
    expect(stripEnd).toBeGreaterThan(-1);
    expect(stripEnd).toBeLessThan(wrapAt);
  });
});

/* ---------- mounted behaviour at 390×844 on the fake DOM ---------- */

describe('P325 · mounted at 390×844', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  beforeAll(async () => {
    dom = installFakeDom(); // window.innerWidth === 390 — the mobile case
    const mq = (q: string) => ({
      matches: q === '(max-width: 768px)',
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    });
    (dom.window as Record<string, unknown>).matchMedia = mq;
    vi.stubGlobal('matchMedia', mq);

    const { createRoot } = await import('react-dom/client');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(ChatWindow, {
          messages: factTurns,
          loading: false,
          onSend: noop,
          profile: null,
          sessionId: 's-p325',
        }),
      );
    });
    await flush();
  });

  afterAll(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    root = null;
    vi.unstubAllGlobals();
  });

  it('receipt strip and scrollport are siblings — the first bubble is not inside the strip', () => {
    const receipt = qs('.memory-receipt');
    const wrap = qs('.messages-wrap');
    const messages = qs('.messages');
    const firstRow = qs('.bubble-row');
    expect(receipt).toBeTruthy();
    expect(wrap).toBeTruthy();
    expect(messages).toBeTruthy();
    expect(firstRow).toBeTruthy();
    // Same parent column, receipt ordered before the scrollport.
    expect(receipt!.parentNode).toBe(wrap!.parentNode);
    const siblings = (receipt!.parentNode as FakeElement).children;
    expect(siblings.indexOf(receipt!)).toBeLessThan(siblings.indexOf(wrap!));
    // No message node is a descendant of the strip.
    expect(firstRow!.closest('.memory-receipt')).toBeNull();
    expect(firstRow!.closest('.messages')).toBe(messages);
  });

  it('the strip carries no overlay styling and no hidden/faded state', () => {
    const receipt = qs('.memory-receipt') as FakeElement;
    // Nothing positioned inline; the only position it may take is the
    // ≤768px `relative` declared in the stylesheet — never absolute/fixed.
    expect(receipt.style.position ?? '').not.toMatch(/absolute|fixed/);
    // No faded/scroll-away state exists for a block strip: it is always
    // visible, so it must never be inert or hidden from AT/keyboard.
    expect(receipt.hasAttribute('inert')).toBe(false);
    expect(receipt.getAttribute('aria-hidden')).toBeNull();
    expect(receipt.style.visibility ?? '').not.toBe('hidden');
    expect(receipt.style.display ?? '').not.toBe('none');
    expect(receipt.className).not.toMatch(/faded|hidden|off/);
  });

  it('the first AI row renders completely — avatar and content both in the DOM', () => {
    // The structural half of "首条消息完整可见": the first AI row is a
    // full bubble-row with its avatar node and text, nothing trimmed.
    const firstRow = qs('.bubble-row.assistant') as FakeElement;
    expect(firstRow).toBeTruthy();
    expect(firstRow.querySelector('.avatar')).toBeTruthy();
    const content = firstRow.querySelector('.bubble-content');
    expect(content?.textContent).toContain('先接住自己');
    // Pixel-level "visible height === clientHeight" is not computable in
    // this harness — covered by the CSS assertions above + live smoke.
  });

  it('the capsule stays a normally focusable button — reachable, never a trap', () => {
    const receipt = qs('.memory-receipt') as FakeElement;
    expect(receipt.getAttribute('role')).toBe('status');
    const capsule = qs('.memory-capsule') as FakeElement;
    expect(capsule.tagName).toBe('BUTTON');
    expect(capsule.getAttribute('aria-label')).toBe('管理记忆');
    // Focus invariant: with no faded state the button keeps its natural
    // tab order — no tabindex=-1, no inert ancestor.
    expect(capsule.getAttribute('tabindex')).toBeNull();
    capsule.focus();
    expect(dom.document.activeElement).toBe(capsule);
    // …and its expanded management list stays inside the strip, so it can
    // never be clipped by the scrollport either.
    expect(qsa('.memory-capsule')).toHaveLength(1);
  });
});
