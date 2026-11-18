/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installFakeDom,
  ControlledSseStream,
  sseResponse,
  jsonResponse,
  sse,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';
import {
  AUTO_SCROLL_BOTTOM_THRESHOLD,
  shouldAutoScroll,
} from '../src/lib/autoScroll';
import type { ChatMessage } from '../src/types';

/**
 * P328 — while the user scrolls up to re-read history, every streaming delta
 * used to drag the view back to the tail (the [messages, loading, restoring]
 * effect called scrollIntoView unconditionally). The effect now consults
 * shouldAutoScroll: near the bottom or the user's own just-sent turn keeps
 * following; anything else leaves the viewport alone and arms the floating
 * jump button with a once-per-burst 「有新内容」 hint.
 *
 * Mounted against the repo fake DOM with the same emulated-scrollIntoView
 * spy as restore-scroll.test.ts — the sentinel jump pins .messages at its
 * max scroll offset, and a manual scrollTop write + scroll event emulates
 * the user reading upward.
 */

const VIEWPORT_PX = 616; // .messages clientHeight measured at 390×844
const BUBBLE_PX = 234; // 6 seeded rounds overflow the viewport by ~800 px
const SKELETON_PX = 200;

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const chatWindowTsx = readFileSync(
  join(SRC, 'components/ChatWindow.tsx'),
  'utf8',
);

const msgs = (n: number, tag: string): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${tag}-m${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `${tag} 第 ${i + 1} 条`,
    createdAt: i + 1,
  }));

/** Emulate the browser: scrollIntoView on the bottom sentinel pins the
 * .messages viewport at its max scroll offset whenever content overflows. */
function emulateScrollIntoView() {
  return vi
    .spyOn(FakeElement.prototype, 'scrollIntoView')
    .mockImplementation(function (this: FakeElement) {
      const box = this.closest('.messages');
      if (!box) return;
      const bubbles = box.querySelectorAll('[data-message-id]').length;
      box.scrollHeight = bubbles > 0 ? bubbles * BUBBLE_PX : SKELETON_PX;
      box.clientHeight = VIEWPORT_PX;
      box.scrollTop = Math.max(0, box.scrollHeight - box.clientHeight);
    });
}

describe('P328 · shouldAutoScroll thresholds', () => {
  it('follows the tail at the bottom edge and just inside the threshold', () => {
    expect(AUTO_SCROLL_BOTTOM_THRESHOLD).toBe(120);
    expect(
      shouldAutoScroll({ distanceFromBottom: 0, isOwnTurn: false }),
    ).toBe(true);
    expect(
      shouldAutoScroll({ distanceFromBottom: 119, isOwnTurn: false }),
    ).toBe(true);
    expect(
      shouldAutoScroll({
        distanceFromBottom: AUTO_SCROLL_BOTTOM_THRESHOLD,
        isOwnTurn: false,
      }),
    ).toBe(true);
  });

  it('refuses to chase the tail once the user is above the threshold', () => {
    expect(
      shouldAutoScroll({ distanceFromBottom: 121, isOwnTurn: false }),
    ).toBe(false);
    expect(
      shouldAutoScroll({ distanceFromBottom: 400, isOwnTurn: false }),
    ).toBe(false);
  });

  it('always follows the user’s own just-sent turn', () => {
    expect(
      shouldAutoScroll({ distanceFromBottom: 400, isOwnTurn: true }),
    ).toBe(true);
    expect(
      shouldAutoScroll({ distanceFromBottom: 0, isOwnTurn: true }),
    ).toBe(true);
  });

  it('treats Infinity/NaN distance as not-at-bottom unless it is an own turn', () => {
    expect(
      shouldAutoScroll({ distanceFromBottom: Infinity, isOwnTurn: false }),
    ).toBe(false);
    expect(
      shouldAutoScroll({ distanceFromBottom: NaN, isOwnTurn: false }),
    ).toBe(false);
    expect(
      shouldAutoScroll({ distanceFromBottom: NaN, isOwnTurn: true }),
    ).toBe(true);
  });
});

describe('P328 · new content never yanks a scrolled-up reader', () => {
  let dom: FakeDom;
  let streams: ControlledSseStream[];
  let root: Root;

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

  const type = async (text: string) => {
    const ta = qs('textarea') as FakeElement;
    ta.value = text;
    await act(async () => {
      ta.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    });
  };

  const click = async (el: FakeElement | null | undefined) => {
    if (!el) throw new Error('click target missing');
    await act(async () => {
      el.dispatchEvent(
        new FakeEvent('click', { bubbles: true, cancelable: true }),
      );
    });
  };

  const pushDelta = async (content: string) => {
    await act(async () => {
      streams[0].push(sse('delta', { content }));
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
  };

  /** The user drags .messages up to an absolute offset — the browser would
   *  fire a scroll event, so we do too. */
  const scrollListTo = async (scrollTop: number) => {
    const list = qs('.messages')!;
    list.scrollTop = scrollTop;
    await act(async () => {
      list.dispatchEvent(new FakeEvent('scroll'));
    });
  };

  // The fake DOM matches single-compound selectors only — scope by hand.
  const liveRegion = () =>
    qs('.messages-wrap')
      ?.querySelectorAll('[aria-live="polite"]')
      .find((el) => el.classList.contains('sr-only'));

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('keeps scrollTop put while deltas land above the fold, then jumps on click', async () => {
    dom = installFakeDom();
    streams = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url =
          typeof input === 'string'
            ? input
            : String((input as { url?: string })?.url);
        if (url === '/api/chat/stream') {
          const stream = new ControlledSseStream();
          streams.push(stream);
          return sseResponse(stream);
        }
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

    const scroll = emulateScrollIntoView();
    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(App));
    });
    await flush();

    const list = qs('.messages')!;
    // Restore lands on the newest reply — 6 bubbles overflow the viewport.
    expect(list.querySelectorAll('[data-message-id]')).toHaveLength(6);
    let maxScroll = list.scrollHeight - list.clientHeight;
    expect(maxScroll).toBeGreaterThan(0);
    expect(Math.abs(list.scrollTop - maxScroll)).toBeLessThanOrEqual(4);

    // Sending is an own turn — the view follows to the bottom even though
    // the send commits new bubbles.
    await type('她周末想去看展，我该怎么接话？');
    await click(qs('.input-send'));
    await flush();
    expect(streams).toHaveLength(1);
    maxScroll = list.scrollHeight - list.clientHeight;
    expect(Math.abs(list.scrollTop - maxScroll)).toBeLessThanOrEqual(4);

    // The user scrolls back up to re-read while the reply is streaming.
    await scrollListTo(0);
    expect(list.scrollTop).toBe(0);
    const callsBefore = scroll.mock.calls.length;

    // Every streaming delta used to scrollIntoView — now the view stays.
    await pushDelta('先接住她的邀请，');
    expect(list.scrollTop).toBe(0);
    await pushDelta('再顺着话题问一句。');
    expect(list.scrollTop).toBe(0);
    expect(scroll.mock.calls.length).toBe(callsBefore);

    // Instead the floating jump button appears wearing the new-content hint…
    const jumpBtn = qs('.scroll-to-bottom')!;
    expect(jumpBtn).not.toBeNull();
    expect(jumpBtn.classList.contains('has-new')).toBe(true);
    expect(jumpBtn.textContent).toContain('有新内容');
    expect(jumpBtn.getAttribute('aria-label')).toContain('有新内容');
    // …and the polite live region announced the burst (once — more deltas
    // below must not re-announce, guarded by a ref in the component).
    expect(liveRegion()?.textContent).toBe('有新内容');
    expect(chatWindowTsx).toContain('newBelowAnnouncedRef');

    // Clicking it jumps to the tail and disarms the hint.
    await click(jumpBtn);
    maxScroll = list.scrollHeight - list.clientHeight;
    expect(Math.abs(list.scrollTop - maxScroll)).toBeLessThanOrEqual(4);
    expect(qs('.scroll-to-bottom')?.classList.contains('has-new')).toBeFalsy();
    expect(qs('.scroll-to-bottom')?.textContent ?? '').not.toContain(
      '有新内容',
    );
    expect(liveRegion()?.textContent ?? '').toBe('');
  });
});
