/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
  queueHintText,
  restoreQueuedDraft,
  STREAMING_QUEUE_HINT,
} from '../src/lib/sendQueue';

/**
 * P244 — pressing Enter while a reply was still streaming used to be a
 * silent no-op: no queue, no explanation of where the draft would go.
 * Submissions during a stream now join an in-app FIFO — the composer shows
 * 「回复生成中，完成后将自动发送」 plus 「还有 N 条待发」, and the queue
 * drains in order as each turn ends. 「取消排队」 drops the queue and
 * hands the text back to the composer. The P224 invariant still holds: a
 * second send must never abort or overlap the in-flight stream.
 *
 * Vitest runs in node with no DOM, so the app mounts against a minimal fake
 * DOM (see ./helpers/fakeDom.ts) plus a controllable slow SSE fetch mock.
 * IMPORTANT: react-dom is imported lazily inside the test — its `canUseDOM`
 * feature flag is captured at module evaluation time, so it must load only
 * after installFakeDom() has populated window/document.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const M1 = '她说明天要加班，我该说什么？';
const M2 = '周末想约她看电影合适吗？';
const M3 = '她说最近想吃火锅，怎么接？';
const M4 = '第四轮：她问我在干嘛';
const M5 = '这条会进队列又被取消';
const M6 = '第二条被取消的草稿';

describe('P244 · send while a reply is still streaming', () => {
  let dom: FakeDom;
  let streams: ControlledSseStream[];
  let streamCalls: Array<{ signal: AbortSignal | undefined; abortNotices: string[] }>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let root: Root;
  let container: FakeElement;

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
  const hint = () => qs('.busy-enter-hint')?.textContent ?? '';
  const cancelButton = () => qs('.queue-cancel-btn') as FakeElement | null;

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

  const finishStream = async (
    stream: ControlledSseStream,
    reply: string,
  ) => {
    await act(async () => {
      stream.push(
        sse('delta', { content: reply }),
        sse('message', { content: reply, role: 'assistant' }),
        sse('done', { sessionId: 's-p244-test', tokens: 42, latencyMs: 1200 }),
      );
      stream.close();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
  };

  beforeAll(async () => {
    dom = installFakeDom();
    streams = [];
    streamCalls = [];
    fetchMock = vi.fn(async (input: unknown, init?: { signal?: AbortSignal }) => {
      const url = typeof input === 'string' ? input : String((input as { url?: string })?.url);
      if (url === '/api/chat/stream') {
        const abortNotices: string[] = [];
        const signal = init?.signal;
        signal?.addEventListener('abort', () => abortNotices.push('abort fired'));
        streamCalls.push({ signal, abortNotices });
        // Every turn gets its own controllable stream — the queue test
        // drives several sequential replies.
        const stream = new ControlledSseStream();
        streams.push(stream);
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

    // react-dom must evaluate AFTER the fake DOM exists (canUseDOM).
    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(App));
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('queues mid-stream submissions and drains them FIFO after each turn', async () => {
    const { loadChatState } = await import('../src/lib/chatStorage');

    // --- send message 1 ------------------------------------------------
    await type(M1);
    await click(sendButton());
    await flush();

    expect(streams).toHaveLength(1);
    expect(bubbles()).toHaveLength(2); // user + streaming assistant placeholder

    // The reply is streaming: a thinking frame plus a partial delta.
    await act(async () => {
      streams[0].push(
        sse('thinking', { message: '正在思考…' }),
        sse('delta', { content: '她说明天要加班时' }),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(bubbles()).toHaveLength(2);

    // (a) the composer copy now promises the queue, not a shrug.
    expect(hint()).toContain(STREAMING_QUEUE_HINT);
    expect(cancelButton()).toBeNull(); // nothing queued yet

    // --- Enter mid-stream queues the draft ------------------------------
    await type(M2);
    await pressEnter();
    await flush();

    // (b) the queued outcome: draft leaves the box, the hint counts it,
    //     no second turn starts and the in-flight stream is untouched.
    expect((qs('textarea') as FakeElement).value).toBe('');
    expect(hint()).toContain('还有 1 条待发');
    expect(cancelButton()?.textContent).toBe('取消排队');
    expect(streams).toHaveLength(1);
    expect(bubbles()).toHaveLength(2);
    expect(streamCalls[0].abortNotices).toEqual([]);
    expect(streamCalls[0].signal?.aborted).toBe(false);

    // The send button also queues while streaming (it stays enabled).
    await type(M3);
    const sendDuringStream = sendButton() as FakeElement;
    expect(sendDuringStream.disabled).toBe(false);
    await click(sendDuringStream);
    await flush();
    expect((qs('textarea') as FakeElement).value).toBe('');
    expect(hint()).toContain('还有 2 条待发');
    expect(streams).toHaveLength(1);
    expect(bubbles()).toHaveLength(2);

    // --- the first stream finishes: queue head auto-sends --------------
    await finishStream(streams[0], '她说明天要加班时，先接住她的辛苦。');
    expect(streams).toHaveLength(2);
    expect(bubbles()).toHaveLength(4); // u1 + a1 + u2 + streaming a2
    expect(bubbles()[2].textContent).toContain(M2);
    expect(hint()).toContain('还有 1 条待发');

    // --- second turn finishes: the last queued draft goes out ----------
    await finishStream(streams[1], '周末约电影可以，先问她想看哪部。');
    expect(streams).toHaveLength(3);
    expect(bubbles()).toHaveLength(6);
    expect(bubbles()[4].textContent).toContain(M3);

    // --- queue empty: hint reverts, no extra fetch, no loop ------------
    await finishStream(streams[2], '火锅这个话头很好接。');
    expect(streams).toHaveLength(3);
    expect(bubbles()).toHaveLength(6);
    expect(hint()).toBe('');
    expect(cancelButton()).toBeNull();
    expect(qs('.input-stop')).toBeNull();

    // Back to a normal composer: typing re-enables send (it's disabled
    // only while the box is empty, the usual idle rule).
    await type('再打一句');
    expect((sendButton() as FakeElement).disabled).toBe(false);
    await type('');

    // All three user messages landed in order, like normally sent ones.
    const texts = bubbles().map((b) => b.textContent);
    expect(texts[0]).toContain(M1);
    expect(texts[2]).toContain(M2);
    expect(texts[4]).toContain(M3);

    // (c) the queued turns persisted through the normal chat-storage path.
    const stored = loadChatState().sessions.find((s) => s.id === 's-p244-test');
    expect(stored?.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);

    // A reload restores the full conversation — the in-memory queue was
    // already drained, nothing half-sent survives.
    await act(async () => {
      root.unmount();
    });
    const container2 = dom.document.createElement('div');
    dom.document.body.appendChild(container2);
    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    root = createRoot(container2 as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(App));
    });
    await flush();
    expect(bubbles()).toHaveLength(6);
  });

  it('「取消排队」 drops the queue and hands the text back to the composer', async () => {
    // Start a fresh turn so the composer is streaming again.
    await type(M4);
    await click(sendButton());
    await flush();
    expect(streams).toHaveLength(4);
    const bubblesBefore = bubbles().length;

    await act(async () => {
      streams[3].push(sse('thinking', { message: '正在思考…' }));
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Queue two drafts.
    await type(M5);
    await pressEnter();
    await flush();
    await type(M6);
    await pressEnter();
    await flush();
    expect(hint()).toContain('还有 2 条待发');

    // 取消排队 → queue dropped, both drafts restored oldest-first, and
    // the hint falls back to the bare streaming copy.
    await click(cancelButton());
    await flush();
    expect((qs('textarea') as FakeElement).value).toBe(`${M5}\n${M6}`);
    expect(hint()).toContain(STREAMING_QUEUE_HINT);
    expect(hint()).not.toContain('条待发');
    expect(cancelButton()).toBeNull();

    // The stream ends: nothing auto-sends, the restored draft stays put.
    await finishStream(streams[3], '第四轮的回复。');
    expect(streams).toHaveLength(4);
    expect(bubbles()).toHaveLength(bubblesBefore); // only u4's reply landed
    expect(bubbles().map((b) => b.textContent).join('')).not.toContain(M5);
    expect((qs('textarea') as FakeElement).value).toBe(`${M5}\n${M6}`);

    // The restored draft is real — sending it works like any draft.
    await pressEnter();
    await flush();
    expect(streams).toHaveLength(5);
    const texts = bubbles().map((b) => b.textContent);
    expect(texts[texts.length - 2]).toContain(M5);
    await finishStream(streams[4], '最后一条回复。');
  });

  describe('queue helpers', () => {
    it('queueHintText counts the waiting drafts', () => {
      expect(STREAMING_QUEUE_HINT).toBe('回复生成中，完成后将自动发送');
      expect(queueHintText(0)).toBe('回复生成中，完成后将自动发送');
      expect(queueHintText(1)).toBe('回复生成中，完成后将自动发送 · 还有 1 条待发');
      expect(queueHintText(2)).toBe('回复生成中，完成后将自动发送 · 还有 2 条待发');
    });

    it('restoreQueuedDraft rejoins cancelled drafts ahead of the current text', () => {
      expect(restoreQueuedDraft(['a', 'b'], '')).toBe('a\nb');
      expect(restoreQueuedDraft(['a'], 'new')).toBe('a\nnew');
      expect(restoreQueuedDraft([], 'keep')).toBe('keep');
      expect(restoreQueuedDraft([], '')).toBe('');
    });
  });

  describe('source guards', () => {
    it('the send button queues while streaming — only a non-streaming disable blocks it', () => {
      const bar = read('components/InputBar.tsx');
      const sendIdx = bar.indexOf('className="input-send"');
      const stopIdx = bar.indexOf('className="input-send input-stop"');
      expect(sendIdx).toBeGreaterThan(-1);
      expect(stopIdx).toBeGreaterThan(sendIdx);
      expect(bar).toContain('disabled={sendBlocked || !text.trim()}');
      expect(bar).toContain('const sendBlocked = Boolean(disabled) && !streaming');
      expect(bar).toContain('!text.trim() || (disabled && !streaming)');
    });

    it('a turn in flight is still mutexed synchronously', () => {
      const app = read('App.tsx');
      expect(app).toContain('loading || replyInFlightRef.current');
      // The ref is still acquired/released on every streamReply entry
      // point — the queue drains through the same single-turn path.
      expect(app.match(/replyInFlightRef\.current = true/g)?.length).toBeGreaterThanOrEqual(4);
      expect(app.match(/replyInFlightRef\.current = false/g)?.length).toBeGreaterThanOrEqual(4);
      expect(app).toContain('pendingQueueRef.current');
    });
  });
});
