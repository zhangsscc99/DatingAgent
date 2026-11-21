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
import { loadChatState } from '../src/lib/chatStorage';

/**
 * P397 — the live bug measured at walk-1795122630: one failed tool call
 * (`Unknown tool: get_date`) rendered THREE self-contradicting surfaces at
 * once — a top error card, the same text as the bubble body, and a tool
 * record claiming 「已使用 1 个工具 · 完成」. These tests pin the contract:
 *
 *  - one failure = exactly one error surface (the bubble), one 重试;
 *  - the error text lives on the bubble's failure detail, never in the
 *    message content — nothing internal is persisted as the reply;
 *  - a mid-turn error the model recovers from shows the reply normally,
 *    with the record honestly reporting 「N 个工具调用失败」.
 */

const USER_MSG = '我和她认识三个月，最近聊天越来越短，还要不要继续主动？';
const TOOL_ERR = '工具暂时不可用，已跳过这一步';
const REPLY = '聊天变短不一定代表她不在意，先看她回复的认真程度。';

describe('P397 · one failure, one error surface', () => {
  let dom: FakeDom;
  let streams: ControlledSseStream[];
  let root: Root | null = null;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const qs = (sel: string) => dom.document.querySelector(sel);
  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const allElements = () => (dom.document.documentElement as FakeElement)._walk();
  // The fake DOM has no [class*=] attribute matcher — same predicate by hand.
  const errorEls = () => allElements().filter((e) => e.className.includes('error'));
  const retryButtons = () => qsa('button').filter((b) => b.innerText.includes('重试'));

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

  const type = async (text: string) => {
    const ta = qs('textarea') as FakeElement;
    ta.value = text;
    await act(async () => {
      ta.dispatchEvent(new FakeEvent('input', { bubbles: true }));
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

  const pushAndClose = async (stream: ControlledSseStream, ...frames: string[]) => {
    await act(async () => {
      stream.push(...frames);
      stream.close();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
  };

  const send = async (text: string) => {
    await type(text);
    await pressEnter();
    await flush();
  };

  const toolFailureFrames = () => [
    sse('thinking', { message: '正在思考…' }),
    // What the backend now emits for a hallucinated tool call: a failed
    // record entry plus a structured error with a stable machine code.
    sse('tool_end', { name: 'get_date', status: 'failed' }),
    sse('error', { message: TOOL_ERR, code: 'tool_unavailable' }),
  ];

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
          return jsonResponse({ status: 'ok', llmConfigured: true, llmModel: 'test-model' });
        }
        if (url.startsWith('/api/conversations/')) {
          return jsonResponse({ count: 0, facts: [] });
        }
        return jsonResponse({});
      }),
    );
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');
  });

  afterAll(async () => {
    await unmountApp();
    vi.unstubAllGlobals();
  });

  it('a terminal tool error shows one bubble error, one 重试, no internal text', async () => {
    await mountApp();
    await send(USER_MSG);
    expect(streams).toHaveLength(1);

    await pushAndClose(streams[0], ...toolFailureFrames());

    // Exactly one error surface in the whole document — the bubble.
    expect(errorEls()).toHaveLength(1);
    expect(qs('.error-toast')).toBeNull();
    expect(qsa('.bubble.error')).toHaveLength(1);

    // Exactly one recovery affordance — the in-bubble 重试.
    expect(retryButtons()).toHaveLength(1);
    // (the fake DOM has no descendant selector — scope the query by hand)
    expect(qs('.bubble.error')?.querySelector('.retry-btn')).not.toBeNull();

    // The failure detail carries the localized line; nothing internal and
    // no self-contradicting 「完成」 claim anywhere on screen. P87: the copy
    // is keyed on `code` — the backend's raw sentence stays out of the UI.
    expect(qs('.bubble-failure-detail')?.innerText).toBe(
      '出错了：这个功能暂时用不了，换个问法再试',
    );
    expect(qs('.bubble-failure-detail')?.innerText).not.toContain(TOOL_ERR);
    const pageText = dom.document.body.innerText;
    expect(pageText).not.toContain('Unknown tool');
    expect(pageText).not.toContain('get_date');
    expect(pageText).not.toContain('已完成');
    expect(pageText).not.toContain('· 完成');

    // The collapsed record reports the failure, not 「已使用 1 个工具 · 完成」.
    expect(qs('.tool-record-summary')?.innerText).toBe('1 个工具调用失败');

    // The error text never entered the persisted conversation — the failed
    // turn leaves only the user's own message in storage.
    const stored = loadChatState().sessions.at(-1);
    expect(
      stored?.messages.every(
        (m) => !/Unknown tool|get_date|工具暂时不可用|出错了/.test(m.content),
      ),
    ).toBe(true);

    await unmountApp();
  });

  it('a recovered turn shows the reply and keeps the failure only in the record', async () => {
    dom.localStorage.clear();
    dom.localStorage.setItem('datingAgent.onboardingDone', 'true');
    streams.length = 0;
    await mountApp();
    await send('那我现在该主动发点什么？');
    expect(streams).toHaveLength(1);

    // Same mid-turn failure, but the model then produces a real reply —
    // the error must not rewrite the bubble.
    await pushAndClose(
      streams[0],
      ...toolFailureFrames(),
      sse('delta', { content: REPLY }),
      sse('message', { content: REPLY, role: 'assistant' }),
      sse('done', { sessionId: 's-p397', tokens: 20, latencyMs: 500 }),
    );

    // The reply rendered normally — zero error surfaces, no retry needed.
    expect(errorEls()).toHaveLength(0);
    expect(retryButtons()).toHaveLength(0);
    expect(qs('.error-toast')).toBeNull();

    const last = qsa('.bubble').at(-1)!;
    expect(last.innerText).toContain(REPLY);
    expect(last.innerText).not.toContain('Unknown tool');
    expect(last.innerText).not.toContain('get_date');

    // The record still tells the truth about the failed attempt.
    expect(qs('.tool-record-summary')?.innerText).toBe('1 个工具调用失败');
    const pageText = dom.document.body.innerText;
    expect(pageText).not.toContain('· 完成');
    // And the raw name never leaked into the expanded record either.
    expect(pageText).not.toContain('get_date');

    await unmountApp();
  });
});
