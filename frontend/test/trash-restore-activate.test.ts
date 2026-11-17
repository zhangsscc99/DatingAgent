/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import {
  installFakeDom,
  jsonResponse,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';
import { loadChatState } from '../src/lib/chatStorage';
import { saveTrash } from '../src/lib/chatTrash';
import type { ChatMessage } from '../src/types';

/**
 * P268 — pressing 恢复 in the 回收站 used to only put the row back into
 * 最近对话: the main pane stayed on the welcome page and both overlays
 * kept floating. Restoring must switch straight to that conversation —
 * bubbles visible, trash sheet closed — because the intent was 「接着聊」.
 *
 * App mounts against the same fake DOM as confirm-dialog.test.ts; react-dom
 * loads lazily after installFakeDom() so canUseDOM resolves to true.
 */

const msg = (id: string, role: 'user' | 'assistant', content: string): ChatMessage => ({
  id,
  role,
  content,
  createdAt: 1_000,
});

describe('P268 · trash restore activates the conversation', () => {
  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) => dom.document.querySelector(sel);
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };
  const click = async (el: FakeElement | null | undefined) => {
    if (!el) throw new Error('click target missing');
    await act(async () => {
      el.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
  };

  beforeAll(() => {
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
          return jsonResponse({ status: 'ok', llmConfigured: true });
        }
        return jsonResponse({});
      }),
    );
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');
  });

  afterAll(async () => {
    if (root) {
      const r = root;
      root = null;
      await act(async () => {
        r.unmount();
      });
    }
    vi.unstubAllGlobals();
  });

  it('restore switches the main pane to the restored chat and closes the sheet', async () => {
    // No live chats — the app sits on the welcome page (the reported state);
    // the only session is the trashed one we restore.
    saveTrash([
      {
        sessionId: 's-dead',
        title: '被删的那段',
        messages: [
          msg('d1', 'user', '周六下午三点看展还是喝咖啡'),
          msg('d2', 'assistant', '看展更稳，走路多话自然多'),
        ],
        deletedAt: Date.now(),
        messageCount: 2,
      },
    ]);

    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(createElement(App));
    });
    await flush();

    // Starting state: welcome page, no bubbles, restored chat not active.
    expect(qs('.welcome')).not.toBeNull();
    expect(dom.document.querySelectorAll('.bubble')).toHaveLength(0);
    expect(loadChatState().activeSessionId).toBeNull();

    await click(qs('.recent-chat-trash') as FakeElement);
    expect(qs('.trash-overlay')).not.toBeNull();

    const restoreBtn = qs(
      '[aria-label="恢复对话：被删的那段"]',
    ) as FakeElement;
    expect(restoreBtn).not.toBeNull();
    await click(restoreBtn);

    // The sheet is gone and the restored conversation is on screen.
    expect(qs('.trash-overlay')).toBeNull();
    expect(qs('.welcome')).toBeNull();
    const bubbles = [...dom.document.querySelectorAll('.bubble')];
    expect(bubbles).toHaveLength(2);
    const texts = [...dom.document.querySelectorAll('.bubble-content')].map(
      (b) => (b as FakeElement).textContent,
    );
    expect(texts).toEqual([
      '周六下午三点看展还是喝咖啡',
      '看展更稳，走路多话自然多',
    ]);
    expect(loadChatState().activeSessionId).toBe('s-dead');
    // The row is also the highlighted one in 最近对话.
    const activeRow = qs('.recent-chat-item.active');
    expect(activeRow).not.toBeNull();
    expect(activeRow!.getAttribute('aria-current')).toBe('true');
  });
});
