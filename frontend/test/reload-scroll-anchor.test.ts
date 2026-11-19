/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import {
  installFakeDom,
  jsonResponse,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';
import {
  firstFullyVisibleAnchor,
  loadScrollAnchor,
  scrollAnchorKey,
} from '../src/lib/scrollAnchor';
import type { ChatMessage } from '../src/types';

/**
 * P352 — a reload used to reopen the persisted conversation scrolled to
 * its tail, so the first thing on screen was the middle of the last reply
 * with the top bubble half-cut by the scrollport edge (measured live:
 * first AI bubble rect.top = −383 at 390×844). The restore now reopens at
 * the recorded anchor — the id of the first fully visible message saved
 * while the user scrolls — or pinned at the head when none exists.
 *
 * Mounted against the repo fake DOM like restore-scroll.test.ts, but with
 * real emulated geometry: .messages owns a scrollport, each .bubble-row
 * stacks at a fixed height, getBoundingClientRect reflects scrollTop, and
 * scrollIntoView honours block:'start' with the P352 scroll-margin-top so
 * rect assertions mean the same thing they do in the browser. Reloading
 * is unmount + remount against the same localStorage.
 */

const BUBBLE_PX = 234; // 3 rounds overflow the viewport at both sizes
const PAD = 16; // emulated .messages top/bottom padding
const SCROLL_MARGIN = 8; // P352 scroll-margin-top on .bubble-row

const VIEWPORTS = [
  { name: '390×844', listTop: 128, viewportPx: 616 },
  { name: '1440×900', listTop: 88, viewportPx: 680 },
];

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

interface Layout {
  sizeBox: (box: FakeElement) => void;
}

/** Give the fake DOM a layout engine: fixed-height bubble rows inside the
 *  .messages scrollport, rects that track scrollTop, and a scrollIntoView
 *  that honours block:'start'/'nearest' plus scroll-margin-top. */
function emulateLayout(listTop: number, viewportPx: number): Layout {
  const sizeBox = (box: FakeElement) => {
    const rows = box.querySelectorAll('[data-message-id]').length;
    box.scrollHeight = rows > 0 ? PAD + rows * BUBBLE_PX + PAD : 0;
    box.clientHeight = viewportPx;
  };

  vi.spyOn(FakeElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: FakeElement) {
      const box = this.closest('.messages');
      if (!box) return { ...ZERO_RECT };
      if (this === box) {
        return {
          x: 0,
          y: listTop,
          top: listTop,
          left: 0,
          right: 390,
          bottom: listTop + box.clientHeight,
          width: 390,
          height: box.clientHeight,
        };
      }
      if (this.hasAttribute('data-message-id')) {
        const rows = box.querySelectorAll('[data-message-id]');
        const index = Math.max(0, rows.indexOf(this));
        const top = listTop + PAD + index * BUBBLE_PX - box.scrollTop;
        return {
          x: 0,
          y: top,
          top,
          left: 0,
          right: 390,
          bottom: top + BUBBLE_PX,
          width: 390,
          height: BUBBLE_PX,
        };
      }
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
      // 'start'/'center'/'end' all align the row's margin edge — the
      // restore path only ever asks for 'start'.
      box.scrollTop = clamp(offset - SCROLL_MARGIN, 0, max);
    },
  );

  return { sizeBox };
}

describe('P352 · firstFullyVisibleAnchor selection', () => {
  const rows = (offsets: Array<[number, number]>) =>
    offsets.map(([top, bottom], i) => ({ id: `m${i}`, top, bottom }));

  it('returns the first row fully inside the viewport', () => {
    // m0 half-cut above, m1 fully visible, m2 fully visible, m3 cut below.
    expect(
      firstFullyVisibleAnchor(
        rows([
          [-40, 200],
          [210, 440],
          [450, 610],
          [620, 900],
        ]),
        0,
        616,
      ),
    ).toBe('m1');
  });

  it('falls back to the first row whose top edge is visible when nothing fits', () => {
    // m0 overflows below the fold but its top edge is on screen; m1 sits
    // entirely below the viewport so it must not win the anchor.
    expect(
      firstFullyVisibleAnchor(rows([[100, 800], [900, 1100]]), 0, 616),
    ).toBe('m0');
  });

  it('keeps the old anchor when no row top is on screen', () => {
    // A single bubble taller than the port shows only its middle: nothing
    // fully visible and no top edge either — no new anchor.
    expect(
      firstFullyVisibleAnchor(rows([[-50, 800]]), 0, 616),
    ).toBeNull();
  });

  it('returns null when every row sits above the viewport', () => {
    expect(
      firstFullyVisibleAnchor(rows([[-600, -400], [-300, -100]]), 0, 616),
    ).toBeNull();
  });
});

describe('P352 · reload restores the recorded reading anchor', () => {
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
        // GET /api/session/<id> ok → syncSessionWithBackend resolves on its
        // early-return path, ending the restore like a real reload.
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

  /** Park the scrollport at an absolute offset and fire the scroll event a
   *  real drag would — this is what records the reload anchor. */
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
    it(`reload from scrollTop=0 keeps the first .bubble-row fully visible (${vp.name})`, async () => {
      install();
      const { sizeBox } = emulateLayout(vp.listTop, vp.viewportPx);
      await mountApp();

      const list = qs('.messages')!;
      expect(list.querySelectorAll('[data-message-id]')).toHaveLength(6);
      // First mount, no anchor recorded: the restore never chased the tail.
      expect(list.scrollTop).toBe(0);
      sizeBox(list);

      // Park at the very top like the spec's first pass, then reload.
      await scrollListTo(0);
      expect(loadScrollAnchor('s-active')).toBe('a-m0');
      await unmountApp();
      await mountApp();

      const reloaded = qs('.messages')!;
      const rows = reloaded.querySelectorAll('.bubble-row');
      expect(rows).toHaveLength(6);
      const port = reloaded.getBoundingClientRect();
      const first = rows[0].getBoundingClientRect();
      expect(first.top).toBeGreaterThanOrEqual(port.top);
      // And it did not fall back to the tail.
      expect(reloaded.scrollTop).toBeLessThan(
        reloaded.scrollHeight - reloaded.clientHeight,
      );
      expect(
        dom.localStorage.getItem(scrollAnchorKey('s-active')),
      ).toBeTruthy();

      await unmountApp();
    });

    it(`reload from the tail leaves the first fully visible bubble uncut (${vp.name})`, async () => {
      install();
      const { sizeBox } = emulateLayout(vp.listTop, vp.viewportPx);
      await mountApp();

      const list = qs('.messages')!;
      sizeBox(list);
      // User read all the way to the tail before reloading.
      await scrollListTo(list.scrollHeight - list.clientHeight);
      const anchored = loadScrollAnchor('s-active');
      expect(anchored).not.toBeNull();
      expect(anchored).not.toBe('a-m0');
      await unmountApp();
      await mountApp();

      const reloaded = qs('.messages')!;
      const port = reloaded.getBoundingClientRect();
      const rows = reloaded.querySelectorAll('.bubble-row');
      expect(rows).toHaveLength(6);
      // The viewport's first fully visible bubble is not half-cut: its top
      // edge sits at or below the scrollport's top edge.
      const firstFullyVisible = rows.find((row) => {
        const r = row.getBoundingClientRect();
        return r.top >= port.top && r.bottom <= port.bottom;
      });
      expect(firstFullyVisible).toBeTruthy();
      // The recorded anchor row is back in view — that is the row the
      // restore scrolled to the top edge.
      expect(firstFullyVisible!.getAttribute('data-message-id')).toBe(
        anchored,
      );
      expect(
        firstFullyVisible!.getBoundingClientRect().top,
      ).toBeGreaterThanOrEqual(port.top);

      await unmountApp();
    });
  }
});
