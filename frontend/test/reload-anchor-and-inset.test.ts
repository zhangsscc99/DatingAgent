/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installFakeDom,
  jsonResponse,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';
import { loadScrollAnchor } from '../src/lib/scrollAnchor';
import type { ChatMessage } from '../src/types';

/**
 * P375 — three排版 hard-fails measured live at 390×844 after page.reload()
 * on a persisted conversation: the scrollport landed mid-thread with the
 * first bubble 776px above the viewport, the last AI reply was clipped by
 * the composer (no scroll-end inset), and the floating jump-to-latest
 * arrow painted on top of bubble text.
 *
 * The fixes under test:
 *   a) anchor restore — the per-session first-visible message id is kept
 *      (scrollAnchor.ts); reload restores it, and with no anchor the list
 *      pins scrollTop 0 instead of chasing the tail.
 *   b) .messages carries a bottom inset of composer height + 16px, so at
 *      max scroll the last bubble's bottom sits visibly above the input
 *      bar (verified with elementFromPoint on the bubble's centre).
 *   c) .scroll-to-bottom is no longer an overlay inside .messages-wrap —
 *      it is a normal-flow strip child of .chat-window, so its rect can
 *      never intersect a bubble rect.
 *
 * Mounted against the repo fake DOM like reload-scroll-anchor.test.ts,
 * with the same emulated geometry extended by a .scroll-to-bottom strip
 * rect and an .input-bar rect below the port, plus an elementFromPoint
 * that returns the document-order-topmost rect hit. Because the fake DOM
 * does not apply CSS, the shipped values are also asserted statically on
 * the stylesheet (welcome-bottom-clearance.test.ts style): the emulated
 * bottom inset IS the parsed CSS value.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');
const chatWindowCss = read('components/ChatWindow.css');
const inputBarCss = read('components/InputBar.css');

/* ---------- CSS parsing helpers (repo pattern) ---------- */

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
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : '';
}

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

/** Composer height modelled from the mobile CSS constants (the same model
 *  welcome-bottom-clearance.test.ts derives — ~150px at both breakpoints). */
function composerHeightPx(): number {
  const mobileChat = mediaBlock(chatWindowCss, '(max-width: 768px)');
  const mobileInput = mediaBlock(inputBarCss, '(max-width: 768px)');
  const baseInput = topLevel(inputBarCss);
  const barPadding =
    declPxValues(ruleBody(mobileChat, '.input-bar'), 'padding').length
      ? declPxValues(ruleBody(mobileChat, '.input-bar'), 'padding')
      : declPxValues(ruleBody(mobileInput, '.input-bar'), 'padding');
  const barPadY = barPadding.length ? barPadding[0] * 2 : 0;
  const textarea = declPxValues(
    ruleBody(mobileInput, '.input-bar textarea'),
    'min-height',
  )[0];
  const toolRow = Math.max(
    declPxValues(ruleBody(mobileInput, '.input-bar .input-send'), 'height')[0] ??
      0,
    declPxValues(ruleBody(mobileInput, '.input-hint-btn'), 'height')[0] ?? 0,
    declPxValues(ruleBody(mobileInput, '.reply-length-toggle'), 'height')[0] ??
      0,
  );
  const hintRow = declPxValues(
    ruleBody(baseInput, '.busy-enter-hint'),
    'height',
  )[0];
  const rowGap = declPxValues(ruleBody(baseInput, '.input-column'), 'row-gap')[0];
  return barPadY + textarea + toolRow + hintRow + rowGap * 2;
}

/** The shipped scroll-end inset: `.messages:has(.bubble-row)`'s
 *  padding-bottom = calc(var(--composer-h, FALLBACKpx) + AIRpx).
 *  Returns 0 when the declaration is absent or no longer a
 *  --composer-h-based calc — the emulation then degrades to 0 and the
 *  mounted assertions fail like they would in a real layout. */
function messagesBottomInsetPx(): number {
  const rule =
    ruleBody(topLevel(chatWindowCss), '.messages:has(.bubble-row)') +
    ruleBody(
      mediaBlock(chatWindowCss, '(max-width: 768px)'),
      '.messages:has(.bubble-row)',
    );
  const m = /calc\(var\(--composer-h,\s*([0-9.]+)px\)\s*\+\s*([0-9.]+)px\)/.exec(
    rule,
  );
  return m ? Number(m[1]) + Number(m[2]) : 0;
}

const BUBBLE_PX = 234; // 3 rounds overflow the port at both sizes
const PAD = 16; // emulated .messages top padding
const SCROLL_MARGIN = 8; // .bubble-row scroll-margin-top
const STRIP_PX = 68; // jump strip: 8px margin + 44px button + 16px margin
const BTN_PX = 44; // .scroll-to-bottom touch target
const BTN_RIGHT = 24; // its right margin (≥24px safe-area clearance)
const PAD_BOTTOM = messagesBottomInsetPx(); // shipped CSS value, emulated

const VIEWPORTS = [
  { name: '390×844', listTop: 128, viewportPx: 560, width: 390, composerH: 150 },
  { name: '1440×900', listTop: 88, viewportPx: 640, width: 1440, composerH: 150 },
] as const;

const ZERO_RECT = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
};

const msgs = (n: number, tag: string): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${tag}-m${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `${tag} 第 ${i + 1} 条`,
    createdAt: i + 1,
  }));

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

interface Viewport {
  listTop: number;
  viewportPx: number;
  width: number;
  composerH: number;
}

interface Layout {
  sizeBox: (box: FakeElement) => void;
}

/** Emulate the browser the P375 geometry describes: fixed-height bubble
 *  rows inside the .messages scrollport (whose scrollHeight carries the
 *  shipped composer inset), a right-docked .scroll-to-bottom strip below
 *  the port, and an .input-bar below that. scrollIntoView honours
 *  block:'start' plus scroll-margin-top. */
function emulateLayout(vp: Viewport): Layout {
  const portBottom = vp.listTop + vp.viewportPx;
  const barTop = portBottom + STRIP_PX;

  const rowRect = (row: FakeElement, box: FakeElement) => {
    const rows = box.querySelectorAll('[data-message-id]');
    const index = Math.max(0, rows.indexOf(row));
    const top = vp.listTop + PAD + index * BUBBLE_PX - box.scrollTop;
    return {
      x: 0,
      y: top,
      top,
      left: 0,
      right: vp.width,
      bottom: top + BUBBLE_PX,
      width: vp.width,
      height: BUBBLE_PX,
    };
  };

  const sizeBox = (box: FakeElement) => {
    const rows = box.querySelectorAll('[data-message-id]').length;
    box.scrollHeight = rows > 0 ? PAD + rows * BUBBLE_PX + PAD_BOTTOM : 0;
    box.clientHeight = vp.viewportPx;
  };

  vi.spyOn(FakeElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: FakeElement) {
      if (this.classList.contains('input-bar')) {
        return {
          x: 0,
          y: barTop,
          top: barTop,
          left: 0,
          right: vp.width,
          bottom: barTop + vp.composerH,
          width: vp.width,
          height: vp.composerH,
        };
      }
      if (this.classList.contains('scroll-to-bottom')) {
        const w = this.classList.contains('has-new') ? 96 : BTN_PX;
        return {
          x: vp.width - BTN_RIGHT - w,
          y: portBottom + 8,
          top: portBottom + 8,
          left: vp.width - BTN_RIGHT - w,
          right: vp.width - BTN_RIGHT,
          bottom: portBottom + 8 + BTN_PX,
          width: w,
          height: BTN_PX,
        };
      }
      const box = this.closest('.messages');
      if (!box) return { ...ZERO_RECT };
      if (this === box) {
        return {
          x: 0,
          y: vp.listTop,
          top: vp.listTop,
          left: 0,
          right: vp.width,
          bottom: vp.listTop + box.clientHeight,
          width: vp.width,
          height: box.clientHeight,
        };
      }
      const row = this.hasAttribute('data-message-id')
        ? this
        : this.closest('[data-message-id]');
      if (row) return rowRect(row, box);
      return { ...ZERO_RECT };
    },
  );

  vi.spyOn(FakeElement.prototype, 'scrollIntoView').mockImplementation(
    function (this: FakeElement, options?: { block?: string }) {
      const box = this.closest('.messages');
      if (!box) return;
      sizeBox(box);
      const max = Math.max(0, box.scrollHeight - box.clientHeight);
      if (!this.hasAttribute('data-message-id')) {
        // The bottom sentinel: chase the tail.
        box.scrollTop = max;
        return;
      }
      const rows = box.querySelectorAll('[data-message-id]');
      const offset = PAD + Math.max(0, rows.indexOf(this)) * BUBBLE_PX;
      const block = options?.block ?? 'start';
      if (block === 'nearest') {
        const relTop = offset - box.scrollTop;
        const relBottom = relTop + BUBBLE_PX;
        if (relTop < SCROLL_MARGIN) {
          box.scrollTop = clamp(offset - SCROLL_MARGIN, 0, max);
        } else if (relBottom > box.clientHeight) {
          box.scrollTop = clamp(
            offset + BUBBLE_PX - box.clientHeight,
            0,
            max,
          );
        }
        return;
      }
      box.scrollTop = clamp(offset - SCROLL_MARGIN, 0, max);
    },
  );

  return { sizeBox };
}

/** elementFromPoint over the emulated rects: the last element in document
 *  order containing the point wins — a decent stand-in for paint order
 *  (the composer renders after the scrollport, so it wins any overlap). */
function installElementFromPoint(dom: FakeDom) {
  (
    dom.document as unknown as {
      elementFromPoint: (x: number, y: number) => FakeElement | null;
    }
  ).elementFromPoint = (x: number, y: number) => {
    let hit: FakeElement | null = null;
    for (const el of dom.document.documentElement._walk()) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) hit = el;
    }
    return hit;
  };
}

const elementFromPoint = (dom: FakeDom, x: number, y: number) =>
  (
    dom.document as unknown as {
      elementFromPoint: (x: number, y: number) => FakeElement | null;
    }
  ).elementFromPoint(x, y);

describe('P375 · .messages scroll-end inset (CSS)', () => {
  const base = topLevel(chatWindowCss);

  it('reserves ≥ composer height + 16px under the last bubble', () => {
    const composer = composerHeightPx();
    // The modelled composer resolves to ~150px; the inset must clear it + 16.
    expect(composer).toBeGreaterThanOrEqual(140);
    expect(PAD_BOTTOM).toBeGreaterThanOrEqual(composer + 16);
    const rule = ruleBody(base, '.messages:has(.bubble-row)');
    expect(rule).toContain('padding-bottom');
  });

  it('one declaration covers both breakpoints — the ≤768px shorthand cannot reset it', () => {
    // `.messages:has(.bubble-row)` (0,2,0) outranks `.messages` (0,1,0), so
    // the mobile `padding: 16px` shorthand below cannot reset the inset.
    const rule = ruleBody(base, '.messages:has(.bubble-row)');
    expect(rule).not.toBe('');
    const mobile = mediaBlock(chatWindowCss, '(max-width: 768px)');
    // No second copy inside the mobile block that could drift out of sync.
    expect(ruleBody(mobile, '.messages:has(.bubble-row)')).toBe('');
    expect(
      declPxValues(ruleBody(mobile, '.messages'), 'padding'),
    ).toContain(16);
  });

  it('scopes the inset to the conversation port — the hero keeps its symmetric pad', () => {
    // :has(.bubble-row) only matches a port holding real message rows: the
    // welcome port, the restore skeleton and the search-empty state carry
    // none, so they keep the un-inset padding hero-balance.test.ts pins.
    const hero = ruleBody(base, '.messages-hero') +
      ruleBody(mediaBlock(chatWindowCss, '(max-width: 768px)'), '.messages-hero');
    expect(/padding-bottom\s*:\s*calc/.exec(hero)).toBeNull();
    // …and the inset selector really is scoped on bubble rows, not on the
    // scrollport class alone.
    expect(ruleBody(base, '.messages:has(.bubble-row)')).not.toBe('');
  });
});

describe('P375 · jump-to-latest control (CSS)', () => {
  const rule = ruleBody(topLevel(chatWindowCss), '.scroll-to-bottom');

  it('is in-flow on an opaque token surface at a ≥44px touch target', () => {
    expect(rule).not.toBe('');
    // No absolute/fixed/sticky: in the flow it cannot paint over a bubble.
    const position = /position\s*:\s*([a-z-]+)/.exec(rule)?.[1] ?? 'static';
    expect(['static', 'relative']).toContain(position);
    // Opaque, existing token — no one-off colour.
    expect(rule).toContain('background: var(--surface)');
    // Right-docked strip child of the .chat-window column.
    expect(rule).toContain('align-self: flex-end');
    const w =
      declPxValues(rule, 'width')[0] ?? declPxValues(rule, 'min-width')[0];
    const h =
      declPxValues(rule, 'height')[0] ?? declPxValues(rule, 'min-height')[0];
    expect(w).toBeGreaterThanOrEqual(44);
    expect(h).toBeGreaterThanOrEqual(44);
  });
});

describe('P375 · reload anchor + composer inset (mounted)', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) =>
    dom.document.querySelector(sel) as FakeElement | null;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const install = () => {
    dom = installFakeDom();
    installElementFromPoint(dom);
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
    dom.localStorage.setItem(
      'datingAgent.chatHistory',
      JSON.stringify({
        activeSessionId: 's-active',
        sessions: [
          {
            id: 's-active',
            title: '续档对话',
            updatedAt: 2000,
            messages: msgs(6, 'a'),
          },
        ],
      }),
    );
  };

  const mountApp = async () => {
    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(createElement(App));
    });
    await flush();
  };

  const unmountApp = async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    dom.document.body.textContent = '';
  };

  const scrollListTo = async (scrollTop: number) => {
    const list = qs('.messages')!;
    list.scrollTop = scrollTop;
    await act(async () => {
      list.dispatchEvent(new FakeEvent('scroll'));
    });
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  for (const vp of VIEWPORTS) {
    it(`reload from scrollTop=0 restores the head anchor (${vp.name})`, async () => {
      install();
      const { sizeBox } = emulateLayout(vp);
      await mountApp();

      const list = qs('.messages')!;
      expect(list.querySelectorAll('[data-message-id]')).toHaveLength(6);
      sizeBox(list);

      // Reading at the very top records the first row as the anchor.
      await scrollListTo(0);
      expect(loadScrollAnchor('s-active')).toBe('a-m0');
      await unmountApp();
      await mountApp();

      const reloaded = qs('.messages')!;
      const port = reloaded.getBoundingClientRect();
      const rows = reloaded.querySelectorAll('.bubble-row');
      expect(rows).toHaveLength(6);
      // The first bubble is fully inside the port — not clipped above.
      expect(rows[0].getBoundingClientRect().top).toBeGreaterThanOrEqual(
        port.top,
      );
      // …and the restore did not fall back to the tail.
      expect(reloaded.scrollTop).toBeLessThan(
        reloaded.scrollHeight - reloaded.clientHeight,
      );
      await unmountApp();
    });

    it(`scrolled to the bottom, the last bubble clears the composer (${vp.name})`, async () => {
      install();
      const { sizeBox } = emulateLayout(vp);
      await mountApp();

      const list = qs('.messages')!;
      sizeBox(list);
      await scrollListTo(list.scrollHeight - list.clientHeight);

      const port = list.getBoundingClientRect();
      const rows = list.querySelectorAll('.bubble-row');
      const last = rows[rows.length - 1];
      const lastRect = last.getBoundingClientRect();
      // The composer inset keeps ≥8px of port between the bubble's bottom
      // and the scrollport edge that abuts the input bar.
      expect(lastRect.bottom).toBeLessThanOrEqual(port.bottom - 8);
      // The bubble's centre hit-tests on the bubble, never on the bar.
      const hit = elementFromPoint(
        dom,
        (lastRect.left + lastRect.right) / 2,
        (lastRect.top + lastRect.bottom) / 2,
      );
      expect(hit).not.toBeNull();
      expect(hit!.classList.contains('input-bar')).toBe(false);
      expect(hit === last || last.contains(hit)).toBe(true);
      await unmountApp();
    });

    it(`the jump-to-latest strip never intersects a bubble (${vp.name})`, async () => {
      install();
      const { sizeBox } = emulateLayout(vp);
      await mountApp();

      const list = qs('.messages')!;
      sizeBox(list);
      // Scrolled up mid-conversation: the control is visible.
      await scrollListTo(0);
      const btn = qs('.scroll-to-bottom');
      expect(btn).not.toBeNull();
      // It lives outside the scrollport overlay region entirely.
      expect(btn!.closest('.messages-wrap')).toBeNull();
      expect(btn!.closest('.messages')).toBeNull();

      const port = list.getBoundingClientRect();
      const br = btn!.getBoundingClientRect();
      expect(br.height).toBeGreaterThanOrEqual(44);
      // Its strip sits at or below the port's bottom edge…
      expect(br.top).toBeGreaterThanOrEqual(port.bottom);
      // …so it can never paint over a bubble. getBoundingClientRect is not
      // clipped by overflow — a row half-scrolled under the port edge still
      // reports its full box — so the comparison clips each bubble rect to
      // the scrollport: the part the user can actually see and touch.
      const bubbles = list.querySelectorAll('.bubble-row, .bubble');
      expect(bubbles.length).toBeGreaterThan(0);
      for (const b of bubbles) {
        const r = b.getBoundingClientRect();
        const visibleTop = Math.max(r.top, port.top);
        const visibleBottom = Math.min(r.bottom, port.bottom);
        if (visibleBottom <= visibleTop) continue; // fully scrolled away
        const overlap = !(
          br.right <= r.left ||
          br.left >= r.right ||
          br.bottom <= visibleTop ||
          br.top >= visibleBottom
        );
        expect(overlap).toBe(false);
      }
      await unmountApp();
    });
  }
});
