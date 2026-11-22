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
  jsonResponse,
  sse,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';
import { isForeignQueuedSend, retireQueue } from '../src/lib/sendQueue';
import { DEFAULT_DRAFT_ID, draftStorageKey, saveDraft } from '../src/lib/chatDrafts';

/**
 * P423 — a draft queued while a reply streamed used to be bound to
 * nothing: PendingSend carried only `prompt`/`constraints`, and none of
 * the six conversation-switch paths touched the queue. Switching sessions
 * mid-queue left the parked text behind forever — the drain effect ran
 * once while `replyInFlightRef` was still true, the aborted turn then
 * settled `loading` back onto the same `false` value (no dep change → no
 * re-run), and every later send joined the dead queue instead of going
 * out. Only a refresh recovered. Worse, a drain that did fire used the
 * NEW sessionId, sending conversation A's words into conversation B.
 *
 * The fix pins each queued draft to the session it was typed in and, on
 * every switch path, retires it into that session's own composer draft —
 * the text reappears in the textarea when the user comes back, nothing is
 * ever sent into the wrong conversation, and the queue can never stall.
 *
 * Same fake-DOM + controllable-SSE harness as send-while-streaming.test.ts,
 * with one addition: the mock body reader rejects a parked read() on
 * abort, like a real fetch body — that is what lets the in-flight turn's
 * finally settle (replyInFlightRef → false) when a switch aborts it.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

const A1 = '甲会话的第一条消息，记住了';
const B1 = '乙会话的第一条消息，另一段';
const B2 = '乙会话第二条，流挂起不回';
const QUEUED = '乙流式中排队的那句心里话';
const FRESH = '乙会话恢复后新发的消息';
const QUEUED2 = '新对话点击前又排上一句';

const abortError = () =>
  Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

describe('P423 · queued drafts are bound to their own session', () => {
  let dom: FakeDom;
  let streams: ControlledSseStream[];
  let streamBodies: string[];
  let fetchMock: ReturnType<typeof vi.fn>;
  let root: Root;
  let container: FakeElement;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const qs = (sel: string) => dom.document.querySelector(sel);
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const hint = () => qs('.busy-enter-hint')?.textContent ?? '';
  const cancelButton = () => qs('.queue-cancel-btn') as FakeElement | null;
  const textareaValue = () => (qs('textarea') as FakeElement).value;
  const sentMessages = () =>
    streamBodies.map((body) => {
      try {
        return (JSON.parse(body) as { message?: string }).message ?? '';
      } catch {
        return '';
      }
    });
  const sessionRow = (marker: string) =>
    qsa('.recent-chat-item').find((b) =>
      (b.getAttribute('title') ?? '').includes(marker),
    ) as FakeElement | undefined;

  /**
   * `.recent-chat-item` carries `disabled={busy}` — while a reply streams
   * every row is disabled, and React deliberately swallows a disabled
   * button's click before it reaches `onClick`. The switch handler is the
   * unit under test, so this fires the row's own React `onClick` prop
   * directly (the props expando react-dom stores on the DOM node) —
   * the same handler, the same live queue.
   */
  const fireRowSelect = async (row: FakeElement | undefined) => {
    if (!row) throw new Error('session row missing');
    const key = Object.keys(row).find((k) => k.startsWith('__reactProps$'));
    const props = key
      ? (row as unknown as Record<string, { onClick?: () => void }>)[key]
      : undefined;
    if (typeof props?.onClick !== 'function') throw new Error('row onClick missing');
    await act(async () => {
      props.onClick!();
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
      el.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
  };

  const sendButton = () =>
    qsa('.input-send').find((b) => !b.classList.contains('input-stop'));

  const pressEnter = async () => {
    const ta = qs('textarea') as FakeElement;
    await act(async () => {
      ta.dispatchEvent(
        new FakeEvent('keydown', { bubbles: true, cancelable: true, props: { key: 'Enter' } }),
      );
    });
  };

  const finishStream = async (stream: ControlledSseStream, reply: string, sid: string) => {
    await act(async () => {
      stream.push(
        sse('delta', { content: reply }),
        sse('message', { content: reply, role: 'assistant' }),
        sse('done', { sessionId: sid, tokens: 42, latencyMs: 1200 }),
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
    streamBodies = [];
    fetchMock = vi.fn(async (input: unknown, init?: { signal?: AbortSignal; body?: string }) => {
      const url = typeof input === 'string' ? input : String((input as { url?: string })?.url);
      if (url === '/api/chat/stream') {
        const signal = init?.signal;
        const stream = new ControlledSseStream();
        streams.push(stream);
        streamBodies.push(typeof init?.body === 'string' ? init.body : '');
        const reader = stream.reader;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          body: {
            getReader: () => ({
              // A real fetch body rejects a parked read on abort; mirroring
              // that lets the turn's AbortError branch + finally settle.
              read: () => {
                if (signal?.aborted) return Promise.reject(abortError());
                return Promise.race([
                  reader.read(),
                  new Promise<never>((_res, reject) => {
                    signal?.addEventListener('abort', () => reject(abortError()));
                  }),
                ]);
              },
              cancel: reader.cancel,
              releaseLock: reader.releaseLock,
            }),
          },
        };
      }
      if (url === '/api/tools') return jsonResponse({ tools: [] });
      if (url === '/api/health') {
        return jsonResponse({ status: 'ok', llmConfigured: true, llmModel: 'qwen3.8-flash' });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');

    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../src/App');
    container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(App));
    });
    await flush();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('a session switch retires the queued draft into ITS OWN composer draft', async () => {
    // --- two stored conversations: 甲会话 (A) then 乙会话 (B) ------------
    await type(A1);
    await click(sendButton());
    await flush();
    expect(streams).toHaveLength(1);
    await finishStream(streams[0], '甲会话的第一条回复。', 'sess-a');

    await click(qs('.new-chat-btn') as FakeElement);
    await flush();
    await type(B1);
    await click(sendButton());
    await flush();
    expect(streams).toHaveLength(2);
    await finishStream(streams[1], '乙会话的第一条回复。', 'sess-b');
    expect(sessionRow('甲会话')).toBeDefined();
    expect(sessionRow('乙会话')).toBeDefined();

    // --- a turn in B stays in flight; a second draft is queued ----------
    await type(B2);
    await click(sendButton());
    await flush();
    expect(streams).toHaveLength(3);

    await type(QUEUED);
    await pressEnter();
    await flush();
    expect(textareaValue()).toBe('');
    expect(hint()).toContain('已排队 1 条');
    expect(cancelButton()).not.toBeNull();

    // --- switch to A mid-queue ------------------------------------------
    await fireRowSelect(sessionRow('甲会话'));
    await flush();
    await flush();

    // The hint is gone and no 「取消排队」 row survives — the queue was
    // retired, not parked on a dead conversation.
    expect(hint()).toBe('');
    expect(qsa('.queue-cancel-btn')).toHaveLength(0);

    // The queued text was never sent — least of all into conversation A.
    expect(sentMessages()).not.toContain(QUEUED);
    expect(streams).toHaveLength(3);

    // It lives under ITS OWN session's draft key instead …
    expect(dom.localStorage.getItem(draftStorageKey('sess-b'))).toBe(QUEUED);
    // … and the switch really did land on A.
    expect(qsa('.bubble').map((b) => b.textContent).join('')).toContain(A1);

    // --- coming back to B restores the words into the composer ---------
    await click(sessionRow('乙会话'));
    await flush();
    await flush();
    expect(textareaValue()).toBe(QUEUED);

    // --- a fresh send in B fires immediately: the dead-end is broken ---
    await type(FRESH);
    await pressEnter();
    await flush();
    expect(streams).toHaveLength(4);
    expect(sentMessages()[3]).toBe(FRESH);
    expect(hint()).toBe('');
  });

  it('+ 新对话 mid-queue retires the draft the same way', async () => {
    // stream[3] (the fresh send in B) is still in flight — queue again.
    await type(QUEUED2);
    await pressEnter();
    await flush();
    expect(hint()).toContain('已排队 1 条');

    await click(qs('.new-chat-btn') as FakeElement);
    await flush();
    await flush();

    expect(hint()).toBe('');
    expect(qsa('.queue-cancel-btn')).toHaveLength(0);
    expect(sentMessages()).not.toContain(QUEUED2);
    expect(streams).toHaveLength(4);
    expect(dom.localStorage.getItem(draftStorageKey('sess-b'))).toBe(QUEUED2);

    // Re-selecting B hands the words back to the composer …
    await click(sessionRow('乙会话'));
    await flush();
    await flush();
    expect(textareaValue()).toBe(QUEUED2);

    // … and sending them now lands them in their own conversation.
    await pressEnter();
    await flush();
    expect(streams).toHaveLength(5);
    expect(sentMessages()[4]).toBe(QUEUED2);
    await finishStream(streams[4], '乙会话的收尾回复。', 'sess-b');
  });

  describe('retireQueue', () => {
    it('writes each parked prompt back to its own session, FIFO joined', () => {
      const writes: Array<[string, string]> = [];
      const remainder = retireQueue(
        [
          { sessionId: 'a', prompt: 'p1' },
          { sessionId: 'b', prompt: 'p2' },
          { sessionId: 'a', prompt: 'p3' },
        ],
        (sid, text) => writes.push([sid, text]),
      );
      // One write per session, first-appearance order, submit order kept.
      expect(writes).toEqual([
        ['a', 'p1\np3'],
        ['b', 'p2'],
      ]);
      expect(remainder).toEqual([]);
    });

    it('consumes empty prompts without a write', () => {
      const writes: Array<[string, string]> = [];
      const remainder = retireQueue(
        [
          { sessionId: 'a', prompt: '' },
          { sessionId: 'a', prompt: 'kept' },
        ],
        (sid, text) => writes.push([sid, text]),
      );
      expect(writes).toEqual([['a', 'kept']]);
      expect(remainder).toEqual([]);
    });

    it('returns a failed session’s items untouched and still retires the rest', () => {
      const items = [
        { sessionId: 'a', prompt: 'p1', constraints: ['x'] },
        { sessionId: 'a', prompt: 'p2' },
        { sessionId: 'b', prompt: 'p3' },
      ];
      const writes: Array<[string, string]> = [];
      const remainder = retireQueue(items, (sid, text) => {
        if (sid === 'a') throw new Error('quota');
        writes.push([sid, text]);
      });
      expect(writes).toEqual([['b', 'p3']]);
      expect(remainder).toEqual([items[0], items[1]]);
    });

    it('targets the default draft for a parked no-session draft', () => {
      const writes: Array<[string, string]> = [];
      retireQueue([{ sessionId: null, prompt: 'hi' }], (sid, text) =>
        writes.push([sid, text]),
      );
      expect(writes).toEqual([[DEFAULT_DRAFT_ID, 'hi']]);
    });
  });

  describe('isForeignQueuedSend', () => {
    it('flags any parked draft that does not belong to the active session', () => {
      expect(isForeignQueuedSend('a', 'a')).toBe(false);
      expect(isForeignQueuedSend('a', 'b')).toBe(true);
      // `null` is a real identity — fresh-chat → named-session crosses too.
      expect(isForeignQueuedSend(null, 'x')).toBe(true);
      expect(isForeignQueuedSend('x', null)).toBe(true);
      expect(isForeignQueuedSend(null, null)).toBe(false);
    });
  });

  describe('saveDraft', () => {
    it('writes under the draft key, clips at 4 KB, removes on empty, never throws', () => {
      saveDraft('s1', 'hello');
      expect(dom.localStorage.getItem(draftStorageKey('s1'))).toBe('hello');

      saveDraft('s1', 'x'.repeat(5000));
      expect(dom.localStorage.getItem(draftStorageKey('s1'))).toHaveLength(4096);

      saveDraft('s1', '');
      expect(dom.localStorage.getItem(draftStorageKey('s1'))).toBeNull();

      const setSpy = vi
        .spyOn(dom.localStorage, 'setItem')
        .mockImplementation(() => {
          throw new Error('blocked');
        });
      expect(() => saveDraft('s2', 'y')).not.toThrow();
      setSpy.mockRestore();

      const removeSpy = vi
        .spyOn(dom.localStorage, 'removeItem')
        .mockImplementation(() => {
          throw new Error('blocked');
        });
      expect(() => saveDraft('s2', '')).not.toThrow();
      removeSpy.mockRestore();
    });
  });

  describe('source guards', () => {
    const app = read('App.tsx');
    const handlerBody = (name: string) => {
      const start = app.indexOf(`const ${name}`);
      expect(start).toBeGreaterThan(-1);
      const next = app.indexOf('\n  const ', start + 1);
      return app.slice(start, next < 0 ? undefined : next);
    };

    it('every conversation-switch path retires the queue', () => {
      for (const name of [
        'handleNewChat',
        'handleSelectChat',
        'performDeleteChat',
        'restoreDeletedChat',
        'handleRestoreTrash',
        'handleClearAllChats',
      ]) {
        expect(handlerBody(name)).toContain('retirePendingDrafts()');
      }
    });

    it('a parked draft records the session it was typed in', () => {
      const pending = app.slice(app.indexOf('interface PendingSend'));
      expect(pending.slice(0, 300)).toContain('sessionId: string | null');
      expect(app).toContain('inFlightSessionIdRef');
    });

    it('the drain effect guards against a foreign head instead of sending it', () => {
      expect(app).toContain('isForeignQueuedSend(head.sessionId');
      expect(app).toContain('retireQueue(pendingQueueRef.current');
    });
  });
});
