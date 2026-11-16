/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
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

/**
 * P224 — pressing send while a reply is still streaming destroyed the turn:
 * the streamed bubble and the just-sent user message vanished together and
 * no reply ever arrived. The fix (option A) forbids a second turn while one
 * is in flight: `.input-send` renders disabled, Enter does not submit, a
 * persistent inline hint explains it, the draft survives, and no path may
 * abort() the in-flight SSE — only the explicit 停止 control may.
 *
 * Vitest runs in node with no DOM, so the app mounts against a minimal fake
 * DOM (see ./helpers/fakeDom.ts) plus a controllable slow SSE fetch mock.
 * IMPORTANT: react-dom is imported lazily inside the test — its `canUseDOM`
 * feature flag is captured at module evaluation time, so it must load only
 * after installFakeDom() has populated window/document.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

describe('P224 · send while a reply is still streaming', () => {
  let dom: FakeDom;
  let stream: ControlledSseStream;
  let streamCalls: Array<{ signal: AbortSignal | undefined; abortNotices: string[] }>;
  let fetchMock: ReturnType<typeof vi.fn>;

  const flush = async () => {
    // Let the fetch/read-loop promise chain settle, then let React commit.
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const qs = (sel: string) => dom.document.querySelector(sel);
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const bubbles = () => qsa('.bubble');
  const sendButton = () =>
    qsa('.input-send').find((b) => !(b as FakeElement).classList.contains('input-stop'));
  const stopButton = () => qs('.input-stop');

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
      el.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
  };

  const pressEnter = async () => {
    const ta = qs('textarea') as FakeElement;
    await act(async () => {
      ta.dispatchEvent(
        new FakeEvent('keydown', { bubbles: true, cancelable: true, props: { key: 'Enter' } }),
      );
    });
  };

  beforeAll(() => {
    dom = installFakeDom();
    stream = new ControlledSseStream();
    streamCalls = [];
    fetchMock = vi.fn(async (input: unknown, init?: { signal?: AbortSignal }) => {
      const url = typeof input === 'string' ? input : String((input as { url?: string })?.url);
      if (url === '/api/chat/stream') {
        const abortNotices: string[] = [];
        const signal = init?.signal;
        signal?.addEventListener('abort', () => abortNotices.push('abort fired'));
        streamCalls.push({ signal, abortNotices });
        return sseResponse(stream);
      }
      if (url === '/api/tools') return jsonResponse({ tools: [] });
      if (url === '/api/health') {
        return jsonResponse({ status: 'ok', llmConfigured: true, llmModel: 'qwen3.8-flash' });
      }
      if (url.startsWith('/api/session/restore')) return jsonResponse({ ok: true });
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);
    // Skip the onboarding modal: the composer must be the first surface.
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('a second send attempt can never start or abort the in-flight turn', async () => {
    const { activeChatFromState, loadChatState } = await import('../src/lib/chatStorage');
    // react-dom must evaluate AFTER the fake DOM exists (canUseDOM).
    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');

    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(App));
    });

    // --- send message 1 ------------------------------------------------
    await type('她说明天要加班，我该说什么？');
    await click(sendButton());
    await flush();

    expect(streamCalls).toHaveLength(1);
    expect(bubbles()).toHaveLength(2); // user + streaming assistant placeholder

    // The reply is streaming: a thinking frame plus a partial delta.
    await act(async () => {
      stream.push(
        sse('thinking', { message: '正在思考…' }),
        sse('delta', { content: '她说明天要加班时' }),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(bubbles()).toHaveLength(2);
    const firstUserBubble = bubbles()[0];
    expect(firstUserBubble.textContent).toContain('她说明天要加班，我该说什么？');

    // (a) while streaming, `.input-send` is disabled and 停止 sits beside it.
    const sendDuringStream = qs('.input-send') as FakeElement;
    expect(sendDuringStream.disabled).toBe(true);
    expect(sendDuringStream.hasAttribute('disabled')).toBe(true);
    expect(stopButton()).not.toBeNull();
    expect((stopButton() as FakeElement).disabled).toBe(false);

    // The composer keeps an inline hint explaining why send is blocked.
    expect(qs('.busy-enter-hint')?.textContent).toContain('回复生成中，完成后可发送');

    // --- attempt a second send mid-stream ------------------------------
    await type('周末想约她看电影合适吗？');
    const bubbleCountBefore = bubbles().length;

    // Click the (disabled) send button — the dispatch still reaches the
    // handler, so the submit-level guard must reject it too.
    await click(sendButton());
    await flush();
    // Enter path as well.
    await pressEnter();
    await flush();

    // (b) the first user bubble's text is untouched.
    expect(bubbles()[0].textContent).toContain('她说明天要加班，我该说什么？');
    // (c) the bubble count never decreased and no second turn was created.
    expect(bubbles().length).toBe(bubbleCountBefore);
    expect(bubbles().length).toBe(2);
    // Still exactly one stream request — no second fetch, no abort signal.
    expect(streamCalls).toHaveLength(1);
    // The draft is preserved, never silently cleared.
    expect((qs('textarea') as FakeElement).value).toBe('周末想约她看电影合适吗？');

    // --- the first stream finishes normally ----------------------------
    await act(async () => {
      stream.push(
        sse('delta', { content: '，先接住她的辛苦，再给一个轻量的关心。' }),
        sse('message', {
          content: '她说明天要加班时，先接住她的辛苦，再给一个轻量的关心。',
          role: 'assistant',
        }),
        sse('done', { sessionId: 's-p224-test', tokens: 42, latencyMs: 1200 }),
      );
      stream.close();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();

    // (d) exactly 2 messages — user + the complete reply.
    expect(bubbles()).toHaveLength(2);
    expect(bubbles()[0].textContent).toContain('她说明天要加班，我该说什么？');
    expect(bubbles()[1].textContent).toContain(
      '她说明天要加班时，先接住她的辛苦，再给一个轻量的关心。',
    );
    // The streaming controls released: no stop button, send usable again
    // (the preserved draft is still in the composer, ready to send).
    expect(stopButton()).toBeNull();
    expect((qs('.input-send') as FakeElement).disabled).toBe(false);
    expect((qs('textarea') as FakeElement).value).toBe('周末想约她看电影合适吗？');

    // (e) the in-flight request's signal was never aborted — no abort
    // event fired and the signal never flipped.
    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0].abortNotices).toEqual([]);
    expect(streamCalls[0].signal?.aborted).toBe(false);

    // (f) the completed turn persisted; a reload restores both messages.
    const stored = loadChatState().sessions.find((s) => s.id === 's-p224-test');
    expect(stored?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    const restored = activeChatFromState(loadChatState());
    expect(restored.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(restored.messages[1].content).toContain('先接住她的辛苦');

    // Simulate the reload for real: a fresh root over the same storage
    // must show both bubbles again.
    await act(async () => {
      root.unmount();
    });
    const container2 = dom.document.createElement('div');
    dom.document.body.appendChild(container2);
    const root2 = createRoot(container2 as unknown as HTMLElement);
    await act(async () => {
      root2.render(createElement(App));
    });
    await flush();
    const restoredBubbles = container2.querySelectorAll('.bubble');
    expect(restoredBubbles).toHaveLength(2);
    expect(restoredBubbles[0].textContent).toContain('她说明天要加班，我该说什么？');
    expect(restoredBubbles[1].textContent).toContain('先接住她的辛苦');
    await act(async () => {
      root2.unmount();
    });
  });

  describe('source guards', () => {
    it('the send button precedes the stop button and is disabled while streaming', () => {
      const bar = read('components/InputBar.tsx');
      const sendIdx = bar.indexOf('className="input-send"');
      const stopIdx = bar.indexOf('className="input-send input-stop"');
      expect(sendIdx).toBeGreaterThan(-1);
      expect(stopIdx).toBeGreaterThan(sendIdx);
      expect(bar).toContain('disabled={sendBlocked || !text.trim()}');
      expect(bar).toContain('const sendBlocked = Boolean(disabled) || streaming');
      expect(bar).toContain('|| disabled || streaming');
    });

    it('a turn in flight is mutexed synchronously, not only by the loading flag', () => {
      const app = read('App.tsx');
      expect(app).toContain('loading || replyInFlightRef.current');
      // The ref is acquired before setLoading and released in finally on
      // every streamReply entry point.
      expect(app.match(/replyInFlightRef\.current = true/g)?.length).toBeGreaterThanOrEqual(4);
      expect(app.match(/replyInFlightRef\.current = false/g)?.length).toBeGreaterThanOrEqual(4);
    });
  });
});
