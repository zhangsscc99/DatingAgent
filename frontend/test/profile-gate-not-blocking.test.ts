/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
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
import type { ChatMessage } from '../src/types';

/**
 * P255 — the first-visit full-screen 「完善你的资料」 dialog used to open
 * automatically and sit over the composer (the #chat-input centre
 * hit-tested to .profile-overlay at both 390×844 and 1440×900). The dialog
 * is opt-in now: the first render lands on a usable chat surface, the
 * welcome CTA / sidebar 「完善资料」 entries open the same dialog on
 * demand, and a single inline nudge — never a modal, never over the
 * input — offers it once per session after the first reply.
 */

const ONBOARDING_KEY = 'datingAgent.onboardingDone';
const PROFILE_KEY = 'datingAgent.userProfile';
const STORAGE_KEY = 'datingAgent.chatHistory';

const assistantMsg = (id: string, content: string): ChatMessage => ({
  id,
  role: 'assistant',
  content,
  createdAt: 1_001,
});

function seedSession(messages: ChatMessage[], id = 's-seed') {
  return {
    activeSessionId: id,
    sessions: [
      { id, title: messages[0]?.content ?? '会话', updatedAt: 10, messages },
    ],
  };
}

describe('P255 · the profile gate no longer blocks the composer', () => {
  let dom: FakeDom;
  let root: Root | null = null;
  let streams: ControlledSseStream[];

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const qs = (sel: string) => dom.document.querySelector(sel);
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const click = (el: FakeElement) =>
    el.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));

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
    if (!root) return;
    const r = root;
    root = null;
    await act(async () => {
      r.unmount();
    });
  };

  /** Drive one full composer send through the parked SSE stream. */
  const sendAndAnswer = async (text: string, reply: string) => {
    const ta = qs('#chat-input') as FakeElement;
    ta.value = text;
    await act(async () => {
      ta.dispatchEvent(new FakeEvent('input', { bubbles: true }));
    });
    const send = qsa('.input-send').find(
      (b) => !(b as FakeElement).classList.contains('input-stop'),
    ) as FakeElement;
    await act(async () => {
      click(send);
    });
    await flush();
    const stream = streams.at(-1)!;
    await act(async () => {
      stream.push(
        sse('delta', { content: reply }),
        sse('message', { content: reply, role: 'assistant' }),
        sse('done', { sessionId: 's-live', tokens: 20, latencyMs: 700 }),
      );
      stream.close();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
  };

  beforeAll(() => {
    dom = installFakeDom();
    streams = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url =
          typeof input === 'string' ? input : String((input as { url?: string })?.url);
        if (url === '/api/chat/stream') {
          const stream = new ControlledSseStream();
          streams.push(stream);
          return sseResponse(stream);
        }
        if (url === '/api/tools') return jsonResponse({ tools: [] });
        if (url === '/api/health') {
          return jsonResponse({ status: 'ok', llmConfigured: true });
        }
        if (url === '/api/session/restore') {
          return jsonResponse({ sessionId: 's-seed', restored: true });
        }
        return jsonResponse({});
      }),
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('first render: no dialog, no overlay — the composer is present and focusable', async () => {
    dom.localStorage.clear();
    await mountApp();

    expect(qs('[role="dialog"]')).toBeNull();
    expect(qsa('.profile-overlay')).toHaveLength(0);
    expect(qs('[aria-modal="true"]')).toBeNull();

    const input = qs('#chat-input') as FakeElement;
    expect(input).toBeTruthy();
    expect(input.disabled).toBe(false);
    input.focus();
    expect(dom.document.activeElement).toBe(input);

    // The welcome CTA keeps a clearly labelled 「完善资料」 entry on the
    // first screen; the sidebar keeps a second one.
    const cta = qs('.welcome-cta') as FakeElement;
    expect(cta).toBeTruthy();
    expect(cta.textContent).toContain('完善资料');
    expect(qs('.profile-setup-btn')?.textContent).toContain('完善资料');

    await unmountApp();
  });

  it('activating the 「完善资料」 entry opens the same dialog, and Escape closes it', async () => {
    dom.localStorage.clear();
    await mountApp();

    const cta = qs('.welcome-cta') as FakeElement;
    await act(async () => {
      click(cta);
    });
    await flush();

    const dialog = qs('[role="dialog"]') as FakeElement;
    expect(dialog).toBeTruthy();
    expect(dialog.classList.contains('profile-overlay')).toBe(true);
    expect(dialog.textContent).toContain('完善你的资料');

    await act(async () => {
      dom.document.dispatchEvent(
        new FakeEvent('keydown', { bubbles: true, props: { key: 'Escape' } }),
      );
    });
    await flush();

    expect(qs('[role="dialog"]')).toBeNull();
    expect(qsa('.profile-overlay')).toHaveLength(0);
    expect(qs('#chat-input')).toBeTruthy();

    await unmountApp();
  });

  it('after the first assistant answer a dismissible inline nudge appears — never covering the input', async () => {
    dom.localStorage.clear();
    await mountApp();

    // Before any reply there is no nudge at all.
    expect(qs('.profile-nudge')).toBeNull();

    await sendAndAnswer('她只回了一个嗯', '先别追问，给她一点空间。');

    const nudge = qs('.profile-nudge') as FakeElement;
    expect(nudge).toBeTruthy();
    expect(nudge.textContent).toContain('想让我更懂你的处境');
    expect(nudge.getAttribute('role')).not.toBe('dialog');
    expect(nudge.getAttribute('aria-modal')).toBeNull();
    // The composer stays reachable — the nudge is a sibling line, not a cover.
    const input = qs('#chat-input') as FakeElement;
    expect(input).toBeTruthy();
    expect(input.disabled).toBe(false);

    // The nudge's button opens the same dialog…
    const open = qs('.profile-nudge-btn') as FakeElement;
    expect(open.textContent).toContain('完善资料');
    await act(async () => {
      click(open);
    });
    await flush();
    expect(qs('[role="dialog"]')).toBeTruthy();

    // …and engaging with it puts the nudge down for the rest of the session.
    const skip = qsa('button').find((b) =>
      (b as FakeElement).textContent.includes('稍后再说'),
    ) as FakeElement;
    await act(async () => {
      click(skip);
    });
    await flush();
    expect(qs('[role="dialog"]')).toBeNull();
    expect(qs('.profile-nudge')).toBeNull();

    await unmountApp();
  });

  it('the dismiss button puts the nudge down without opening the dialog', async () => {
    dom.localStorage.clear();
    dom.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        seedSession([
          { id: 'u1', role: 'user', content: '聊什么开场好', createdAt: 1_000 },
          assistantMsg('a1', '从对方资料里挑一个具体的点问。'),
        ]),
      ),
    );
    await mountApp();

    const nudge = qs('.profile-nudge') as FakeElement;
    expect(nudge).toBeTruthy();
    const dismiss = qs('.profile-nudge-dismiss') as FakeElement;
    await act(async () => {
      click(dismiss);
    });
    await flush();

    expect(qs('.profile-nudge')).toBeNull();
    expect(qs('[role="dialog"]')).toBeNull();
    expect(qs('#chat-input')).toBeTruthy();

    await unmountApp();
  });

  it('a saved profile means no nudge, and the edit path still opens the dialog', async () => {
    dom.localStorage.clear();
    dom.localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: '阿澄' }));
    dom.localStorage.setItem(ONBOARDING_KEY, 'true');
    dom.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        seedSession([
          { id: 'u1', role: 'user', content: '周末约会去哪', createdAt: 1_000 },
          assistantMsg('a1', '先定室内还是户外。'),
        ]),
      ),
    );
    await mountApp();

    expect(qs('.profile-nudge')).toBeNull();
    expect(qs('.welcome-cta')).toBeNull();

    // The sidebar 编辑 entry opens the same dialog in edit mode (× close).
    const edit = qs('.profile-edit-btn') as FakeElement;
    expect(edit).toBeTruthy();
    await act(async () => {
      click(edit);
    });
    await flush();
    const dialog = qs('[role="dialog"]') as FakeElement;
    expect(dialog).toBeTruthy();
    expect(qs('.profile-close')).toBeTruthy();
    await act(async () => {
      click(qs('.profile-close') as FakeElement);
    });
    await flush();
    expect(qs('[role="dialog"]')).toBeNull();

    await unmountApp();
  });
});
