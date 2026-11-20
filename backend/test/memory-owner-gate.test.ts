/// <reference types="node" />
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import type { LLMResponse } from '../src/agent/types.js';
import {
  installFakeDom,
  type FakeDom,
} from '../../frontend/test/helpers/fakeDom';
import ChatWindow from '../../frontend/src/components/ChatWindow';
import type {
  ChatMessage,
  ConversationMemory,
  MemoryFact,
} from '../../frontend/src/types';

/**
 * P411 — eighth recurrence of the memory-echo defect (walkthrough
 * 1795138181, 390×844): three emotional messages in a row, and after a
 * refresh the capsule listed 「她明明看了消息就是不回」 — a verbatim
 * hoist whose subject is the OTHER person, not the user — and
 * 「我可能自己不够好」, a raw in-the-moment emotion.
 *
 * The contract pinned here: a candidate whose subject is not the user
 * (她/他/对方/人家) carrying an accusation is never stored as-is — a
 * silence rant lands as the user-attributed label 「我对已读不回特别
 * 敏感」, an unmappable accusation is dropped; a bare emotion maps to a
 * category label like 「我最近在自我怀疑」; no stored fact is a verbatim
 * substring of a recent user message or of the session title; and every
 * capsule pill is user-attributed (我/我们-led).
 */

/** Replace the LLM client so chat turns run deterministically and offline. */
const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock('../src/llm/client.js', () => ({
  LLMClient: class {
    chat = chatMock;
    async *chatStream(...args: unknown[]) {
      return await chatMock(...args);
    }
  },
  LLMTimeoutError: class LLMTimeoutError extends Error {
    constructor() {
      super('mock timeout');
      this.name = 'LLMTimeoutError';
    }
  },
}));

const { createApp } = await import('../src/routes/app.js');
const { extractMemoryFacts } = await import('../src/lib/memory-extract.js');

function response(partial: Partial<LLMResponse>): LLMResponse {
  return { content: null, toolCalls: [], finishReason: 'stop', ...partial };
}

interface ChatBody {
  sessionId: string;
  reply: string;
  memory?: { count: number; items: string[]; facts?: Array<{ key: string; text: string }> };
}

/** The title the sidebar derives from the first user message. */
function titleOf(message: string): string {
  const text = message.trim();
  if (text.length <= 20) return text;
  const sliced = text.slice(0, 20).trimEnd();
  return sliced ? `${sliced}…` : '新会话';
}

describe('P411 · owner gate — an accusation about the other person is never a verbatim fact', () => {
  it('「她明明看了消息就是不回，这不是耍人吗？」 yields no 她|他|对方-led fact', () => {
    const facts = extractMemoryFacts('她明明看了消息就是不回，这不是耍人吗？');
    expect(
      facts.every((f) => !/^(她|他|对方)/.test(f.text)),
    ).toBe(true);
    // The verbatim rant is gone; what the user is really carrying —
    // the hurt of being left on read — lands as a user-attributed label.
    expect(facts.some((f) => f.text === '她明明看了消息就是不回')).toBe(false);
    expect(facts.some((f) => f.text === '我对已读不回特别敏感')).toBe(true);
  });

  it('an unmappable accusation is dropped outright — prefer missing over wrong', () => {
    const facts = extractMemoryFacts('他就是个绿茶，根本不在乎我');
    expect(facts.every((f) => !/^(她|他|对方)/.test(f.text))).toBe(true);
    expect(facts.some((f) => f.text === '他就是个绿茶')).toBe(false);
  });

  it('a plain observation about the other side is still a fact (P339–P400 contract)', () => {
    // Non-accusatory 她-facts named by earlier rounds keep landing.
    expect(
      extractMemoryFacts('她说最近有点累，我是不是不该约了？').some(
        (f) => f.text === '她最近有点累',
      ),
    ).toBe(true);
    expect(
      extractMemoryFacts('她三天没回我消息了').some(
        (f) => f.text === '她三天没回我消息了',
      ),
    ).toBe(true);
  });
});

describe('P411 · a bare emotion maps to a category label, never the raw sentence', () => {
  it('「可能是我自己不够好」 lands as 「…自我怀疑」, not the verbatim line', () => {
    const facts = extractMemoryFacts('可能是我自己不够好');
    expect(facts.some((f) => f.text === '我最近在自我怀疑')).toBe(true);
    expect(facts.some((f) => f.text.includes('不够好'))).toBe(false);
    expect(facts.every((f) => /^(我|我们)/.test(f.text))).toBe(true);
  });

  it('the Round-108 phrasing 「算了，可能是我自己不够好」 maps the same way', () => {
    const facts = extractMemoryFacts('算了，可能是我自己不够好');
    expect(facts.some((f) => f.text === '我最近在自我怀疑')).toBe(true);
    expect(facts.some((f) => f.text === '我可能自己不够好')).toBe(false);
  });

  it('「我最近真的很难受」 lands as the low-mood label', () => {
    const facts = extractMemoryFacts('我最近真的很难受');
    expect(facts.some((f) => f.text === '我最近情绪有点低落')).toBe(true);
    expect(facts.some((f) => f.text === '我最近真的很难受')).toBe(false);
  });
});

describe('P411 · /api/chat — no fact is a verbatim hoist of recent messages or the title', () => {
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    const app = createApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const addr = server.address();
    if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  beforeEach(() => {
    chatMock.mockReset();
    chatMock.mockResolvedValue(response({ content: '嗯，我记下了。' }));
  });

  async function postChat(message: string, sessionId?: string): Promise<ChatBody> {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, sessionId }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as ChatBody;
  }

  it('the Round-108 three emotional turns store only user-attributed labels', async () => {
    const userMessages = [
      '她明明看了消息就是不回，这不是耍人吗？',
      '可能是我自己不够好',
      '我现在特别焦虑，根本静不下来',
    ];
    const sessionTitle = titleOf(userMessages[0]);

    const first = await postChat(userMessages[0]);
    await postChat(userMessages[1], first.sessionId);
    const third = await postChat(userMessages[2], first.sessionId);

    const facts = third.memory?.facts ?? [];
    expect(facts.length).toBeGreaterThanOrEqual(2);
    // The two signature labels landed.
    const texts = facts.map((f) => f.text);
    expect(texts).toContain('我对已读不回特别敏感');
    expect(texts).toContain('我最近在自我怀疑');
    // No fact leads with the other person.
    expect(facts.every((f) => /^(我|我们)/.test(f.text))).toBe(true);
    // No fact is a verbatim substring of a recent user message…
    expect(
      facts.every((f) => !userMessages.some((m) => m.includes(f.text))),
    ).toBe(true);
    // …nor of the session title.
    expect(facts.every((f) => !sessionTitle.includes(f.text))).toBe(true);
  });
});

describe('P411 · every capsule pill is user-attributed', () => {
  const noop = () => {};
  const userMessages = [
    '她明明看了消息就是不回，这不是耍人吗？',
    '可能是我自己不够好',
    '我现在特别焦虑，根本静不下来',
  ];
  const turns: ChatMessage[] = [
    { id: 'u1', role: 'user', content: userMessages[0] },
    { id: 'a1', role: 'assistant', content: '先稳住。' },
    { id: 'u2', role: 'user', content: userMessages[1] },
    { id: 'a2', role: 'assistant', content: '先接住自己。' },
    { id: 'u3', role: 'user', content: userMessages[2] },
  ];

  let dom: FakeDom;
  let root: Root | null = null;

  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  function fact(label: string, i: number): MemoryFact {
    return { key: `${label}#${i}`, text: label, ts: i + 1 };
  }

  async function renderWithMemory(labels: string[]) {
    const memory: ConversationMemory = {
      count: labels.length,
      items: labels.map(fact),
    };
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const { createRoot } = await import('react-dom/client');
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(ChatWindow, {
          messages: turns,
          loading: false,
          onSend: noop,
          profile: null,
          sessionId: 's-p411',
          memory,
          onForgetMemory: noop,
          sessionTitle: titleOf(userMessages[0]),
        }),
      );
    });
    await flush();
  }

  beforeAll(() => {
    dom = installFakeDom();
  });

  afterAll(async () => {
    if (root) {
      const current = root;
      root = null;
      await act(async () => {
        current.unmount();
      });
    }
    vi.unstubAllGlobals();
  });

  it('the pipeline labels render as 我/我们-led pills', async () => {
    await renderWithMemory([
      '我对已读不回特别敏感',
      '我最近在自我怀疑',
      '我最近有点焦虑',
    ]);
    const texts = qsa('span[data-fact]').map((el) => el.textContent ?? '');
    expect(texts.length).toBeGreaterThanOrEqual(2);
    for (const text of texts) {
      expect(text).toMatch(/^[我们]/);
    }
    await act(async () => {
      root!.unmount();
    });
    root = null;
  });

  it('a pre-owner-gate shard never renders a verbatim rant or raw emotion', async () => {
    await renderWithMemory([
      '她明明看了消息就是不回',
      '我可能自己不够好',
      '我明天第一次约会',
    ]);
    const texts = qsa('span[data-fact]').map((el) => el.textContent ?? '');
    expect(texts).toEqual([
      '我对已读不回特别敏感',
      '我最近在自我怀疑',
      '我明天第一次约会',
    ]);
    for (const text of texts) {
      expect(text).toMatch(/^[我们]/);
      expect(text).not.toBe('她明明看了消息就是不回');
      expect(text).not.toBe('我可能自己不够好');
    }
    await act(async () => {
      root!.unmount();
    });
    root = null;
  });
});
