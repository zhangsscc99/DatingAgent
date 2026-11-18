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
import type { ChatMessage } from '../src/types';

/**
 * P299 — after a reload the persisted conversation came back but the view
 * stayed at the top: the auto-scroll effect fired while `restoring` still
 * rendered the session skeleton in place of the bubbles, and the commit
 * that swapped the real messages in never re-ran it (its deps were only
 * [messages, loading]). Measured live: `.messages.scrollTop = 0` with
 * maxScroll = 817 and the last reply ~800 px below the fold. The effect now
 * waits out the restore and jumps to the tail on the commit that renders
 * the bubbles — for a boot restore and for a sidebar session switch alike.
 *
 * Mounted against the repo fake DOM (same harness as
 * header-brand-fit.test.ts). FakeElement.scrollIntoView is emulated
 * faithfully: the sentinel sits below whatever .messages currently renders,
 * so scrolling it into view only moves the viewport when the content
 * overflows — the skeleton (200 px) does not, the restored bubbles do.
 */

const VIEWPORT_PX = 616; // .messages clientHeight measured at 390×844
const BUBBLE_PX = 234; // enough that 3 rounds overflow ~800 px, like the report
const SKELETON_PX = 200;

const msgs = (n: number, tag: string): ChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${tag}-m${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `${tag} 第 ${i + 1} 条`,
    createdAt: i + 1,
  }));

/** Emulate the browser: scrollIntoView on the bottom sentinel pins the
 * .messages viewport at its max scroll offset whenever the rendered content
 * overflows it. */
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

describe('P299 · a restored/switched session lands on the newest reply', () => {
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
        // GET /api/session/<id> answering ok lets syncSessionWithBackend
        // resolve on its early-return path, ending the restore.
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
          {
            id: 's-other',
            title: '另一段对话',
            updatedAt: 1000,
            messages: msgs(4, 'b'),
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

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('lands on the newest reply after a persisted session is restored', async () => {
    install();
    const scroll = emulateScrollIntoView();
    await mountApp();

    const list = qs('.messages');
    expect(list).not.toBeNull();
    // The skeleton is gone and the restored bubbles are committed …
    expect(list!.querySelectorAll('[data-message-id]')).toHaveLength(6);
    // …and the list ends at the bottom: scrollTop === scrollHeight − clientHeight.
    const maxScroll = list!.scrollHeight - list!.clientHeight;
    expect(maxScroll).toBeGreaterThan(0);
    expect(scroll).toHaveBeenCalled();
    expect(Math.abs(list!.scrollTop - maxScroll)).toBeLessThanOrEqual(4);

    await unmountApp();
  });

  it('scrolls to the tail when a history session is switched in the sidebar', async () => {
    install();
    emulateScrollIntoView();
    await mountApp();

    const list = qs('.messages')!;
    expect(list.querySelectorAll('[data-message-id]')).toHaveLength(6);

    const other = qsa('.recent-chat-item').find(
      (b) => !b.classList.contains('active'),
    );
    expect(other).not.toBeUndefined();
    await act(async () => {
      other!.dispatchEvent(
        new FakeEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    await flush();

    expect(list.querySelectorAll('[data-message-id]')).toHaveLength(4);
    const maxScroll = list.scrollHeight - list.clientHeight;
    expect(maxScroll).toBeGreaterThan(0);
    expect(Math.abs(list.scrollTop - maxScroll)).toBeLessThanOrEqual(4);

    await unmountApp();
  });
});
