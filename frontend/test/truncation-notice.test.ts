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
import {
  isReplyIncomplete,
  mergeReplyContinuation,
  REPLY_CONTINUATION_PROMPT,
} from '../src/lib/replyComplete';

/**
 * P398 — replies that settled mid-thought (dangling ：/、/， or a list that
 * announced more items than it delivered) used to stay on screen with no
 * state, no error and no recovery — a feedback vacuum. Now: one terminal
 * completeness check after the stream ends triggers exactly one automatic
 * continuation; a reply still incomplete afterwards wears a 「回答中断 ·
 * 重试」 footer; and a send landing mid-stream still queues instead of
 * cutting the earlier turn off.
 *
 * Same fake-DOM + controllable-SSE harness as send-while-streaming.test.ts —
 * react-dom is imported lazily after installFakeDom() so canUseDOM resolves
 * against the fake window.
 */

const M1 = '我很生气，她明明看了消息却不回我';
const M2 = '我们上周还聊得挺好的，怎么突然冷了';
const M3 = '周末想约她看电影合适吗';
const M4 = '她说最近想吃火锅，怎么接';

const truncatedFooters = (dom: FakeDom) =>
  dom.document.querySelectorAll('.truncated-retry-btn');

describe('P398 · reply completeness detector', () => {
  it('flags a reply ending on a dangling colon/enumeration mark', () => {
    expect(isReplyIncomplete('在给你建议之前，我想先了解一些情况：')).toBe(true);
    expect(isReplyIncomplete('可以试试这几种方式、')).toBe(true);
    expect(isReplyIncomplete('第一点，先别急着追问，')).toBe(true);
    expect(isReplyIncomplete('我想说两点：')).toBe(true);
  });

  it('flags an under-counted or unterminated markdown list', () => {
    // Declared 三 items, shipped 2 → incomplete.
    expect(
      isReplyIncomplete('给你三个建议：\n- 先别追问\n- 隔一天再聊'),
    ).toBe(true);
    // All 3 arrived → complete.
    expect(
      isReplyIncomplete('给你三个建议：\n- 先别追问\n- 隔一天再聊\n- 换个话题'),
    ).toBe(false);
    // Numbered list delivering the declared count → complete.
    expect(isReplyIncomplete('两点原因：\n1. 她在忙\n2. 话题冷了')).toBe(false);
    // 几/数 promise at least two — a lone bullet is short.
    expect(isReplyIncomplete('可能有几个原因：\n- 她最近忙')).toBe(true);
    // A bare trailing marker — the announced item never arrived.
    expect(isReplyIncomplete('建议如下：\n- 先冷静\n-')).toBe(true);
  });

  it('passes complete replies — punctuation, prose counts, inline enumerations', () => {
    expect(isReplyIncomplete('她可能遇到了自己的事情，暂时没精力回复。')).toBe(false);
    expect(isReplyIncomplete('先听她说完，再决定怎么回！')).toBe(false);
    expect(isReplyIncomplete('要不要再发一条？')).toBe(false);
    // A count mentioned in prose with no list markers is not a promise.
    expect(isReplyIncomplete('我们已经聊了三个小时，早点休息。')).toBe(false);
    // Inline enumeration without markdown rows stays complete.
    expect(isReplyIncomplete('两点：一是别催，二是换话题。')).toBe(false);
    expect(isReplyIncomplete('')).toBe(false);
  });

  it('merges a continuation tail onto the kept partial', () => {
    // Tail-only continuation → plain concat.
    expect(mergeReplyContinuation('我想说两点：', '第一，别急。')).toBe(
      '我想说两点：第一，别急。',
    );
    // The model echoes the cut fragment — overlap once, not twice.
    expect(mergeReplyContinuation('我想说两点：', '两点：第一，别急。')).toBe(
      '我想说两点：第一，别急。',
    );
    // The model restates the whole reply — its version wins.
    expect(
      mergeReplyContinuation('我想说', '我想说两点：第一，别急。'),
    ).toBe('我想说两点：第一，别急。');
    expect(mergeReplyContinuation('partial', '   ')).toBe('partial');
    expect(mergeReplyContinuation('  ', 'tail')).toBe('tail');
  });
});

describe('P398 · truncation notice and auto-continuation', () => {
  let dom: FakeDom;
  let streams: ControlledSseStream[];
  let bodies: Array<Record<string, unknown>>;
  let streamSignals: AbortSignal[];
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
  const bubbles = () => qsa('.bubble');
  const footers = () => truncatedFooters(dom);
  const sendButton = () =>
    qsa('.input-send').find((b) => !(b as FakeElement).classList.contains('input-stop'));
  const hint = () => qs('.busy-enter-hint')?.textContent ?? '';

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

  const send = async (text: string) => {
    await type(text);
    await click(sendButton());
    await flush();
  };

  const finishStream = async (stream: ControlledSseStream, reply: string) => {
    await act(async () => {
      stream.push(
        sse('delta', { content: reply }),
        sse('message', { content: reply, role: 'assistant' }),
        sse('done', { sessionId: 's-p398-test', tokens: 40, latencyMs: 900 }),
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
    bodies = [];
    streamSignals = [];
    fetchMock = vi.fn(async (input: unknown, init?: { signal?: AbortSignal; body?: string }) => {
      const url = typeof input === 'string' ? input : String((input as { url?: string })?.url);
      if (url === '/api/chat/stream') {
        if (init?.signal) streamSignals.push(init.signal);
        bodies.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
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
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');

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

  it('auto-continues exactly once, then shows 回答中断 · 重试 — never loops', async () => {
    await send(M1);
    expect(streams).toHaveLength(1);

    // Attempt 1 settles mid-list: promised 三 items, shipped one.
    const partial = '我建议从三个方面入手：\n- 先别追问她';
    await finishStream(streams[0], partial);
    await flush();

    // Exactly one continuation fired — same turn, no new user bubble.
    expect(streams).toHaveLength(2);
    expect(bodies[1].message).toBe(REPLY_CONTINUATION_PROMPT);
    expect(bodies[1].previousReplies).toBeUndefined();
    expect(bubbles()).toHaveLength(2);

    // Attempt 2 still under-counts (2 < 3) → 回答中断 · 重试, exactly once.
    await finishStream(streams[1], '\n- 冷静两天再说');
    await flush();

    expect(streams).toHaveLength(2); // no third fetch — single retry only
    expect(footers()).toHaveLength(1);
    expect(footers()[0].textContent).toBe('回答中断 · 重试');
    // The merged partial stays on screen — both bullets visible.
    const bubbleText = bubbles()[1].textContent ?? '';
    expect(bubbleText).toContain('先别追问她');
    expect(bubbleText).toContain('冷静两天再说');
  });

  it('footer 重试 re-runs the turn in place and clears when the reply lands', async () => {
    await click(footers()[0] as FakeElement);
    await flush();

    // The same user prompt went back out — no duplicate user bubble.
    expect(streams).toHaveLength(3);
    expect(bodies[2].message).toBe(M1);
    expect(bubbles()).toHaveLength(2);
    expect(footers()).toHaveLength(0); // streaming now — footer hidden

    await finishStream(
      streams[2],
      '三方面：\n- 先别追问\n- 隔一天再聊\n- 换个轻松话题。',
    );
    await flush();

    expect(streams).toHaveLength(3); // complete — no continuation needed
    expect(footers()).toHaveLength(0);
    expect(bubbles()[1].textContent).toContain('换个轻松话题');
  });

  it('a continuation that lands complete skips the footer entirely', async () => {
    await send(M2);
    expect(streams).toHaveLength(4);

    // Dangling colon → one auto-continuation …
    await finishStream(streams[3], '先说两点：');
    await flush();
    expect(streams).toHaveLength(5);
    expect(bodies[4].message).toBe(REPLY_CONTINUATION_PROMPT);

    // … whose tail completes the reply → no footer, no third fetch.
    await finishStream(streams[4], '一是别急着问原因，二是给她一点空间。');
    await flush();
    expect(streams).toHaveLength(5);
    expect(footers()).toHaveLength(0);
    expect(bubbles()[3].textContent).toContain('给她一点空间');
  });

  it('a complete first reply never shows the footer and never re-fetches', async () => {
    await send(M3);
    expect(streams).toHaveLength(6);
    await finishStream(streams[5], '可以，先问她想看哪一部。');
    await flush();
    expect(streams).toHaveLength(6);
    expect(footers()).toHaveLength(0);
    expect(dom.document.querySelectorAll('.truncated-note')).toHaveLength(0);
  });

  it('a send mid-stream queues instead of cutting the earlier turn off', async () => {
    await send(M4);
    expect(streams).toHaveLength(7);

    // Push a partial delta but keep the stream OPEN — the detector must not
    // fire while the turn is still running.
    await act(async () => {
      streams[6].push(sse('delta', { content: '她想吃火锅这个话头，' }));
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // A second send while streaming is queued — not a truncation signal.
    await type('再补一条排队消息');
    await pressEnter();
    await flush();
    expect(hint()).toContain('已排队 1 条');
    expect(streams).toHaveLength(7);
    expect(streamSignals[6]?.aborted).toBe(false);
    expect(bubbles()).toHaveLength(8); // u4 + streaming a4 … nothing appended

    // The earlier turn finishes whole — its text is preserved, then the
    // queued draft drains as the next turn.
    await finishStream(streams[6], '她想吃火锅这个话头，顺着约就行。');
    await flush();
    expect(bubbles()[7].textContent).toContain('顺着约就行');
    expect(footers()).toHaveLength(0);

    expect(streams).toHaveLength(8);
    expect(bodies[7].message).toBe('再补一条排队消息');
    await finishStream(streams[7], '收到，慢慢聊。');
    await flush();
    expect(bubbles()[7].textContent).toContain('顺着约就行'); // still intact
    expect(bubbles()[9].textContent).toContain('慢慢聊');
  });
});
