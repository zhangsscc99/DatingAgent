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
 * P387 — the Round-105 walkthrough (1795109419, 390×844) showed the
 * memory capsule listing 「记得 2 件事 / 她三天没回我消息了 / 我明天直接
 * 当面质问她行不行」: the second pill is a truncated user QUESTION
 * (「她就是个绿茶，我明天直接当面质问她行不行？」) stored as an
 * accomplished fact — the fourth recurrence of the pattern, so the
 * extraction layer now applies a hard interrogative rejection. A
 * candidate that ends with ?/？ or carries a question/deliberation
 * marker (吗/呢/行不行/要不要/该不该/怎么/哪儿/哪里/什么/是不是/能不能/
 * 可不可以) is dropped completely — never paraphrased into a fact,
 * prefer missing over wrong.
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

const QUESTION_INPUTS = [
  '她就是个绿茶，我明天直接当面质问她行不行？',
  '我明天穿什么去见面比较不尴尬？',
  '我该不该主动找她',
];

describe('P387 · interrogative candidates are dropped, never stored', () => {
  for (const input of QUESTION_INPUTS) {
    it(`「${input}」 yields zero facts`, () => {
      expect(extractMemoryFacts(input)).toEqual([]);
    });
  }

  it('a marker-less clause uttered as a question still yields nothing', () => {
    // No interrogative word at all — the trailing ？ on the clause marks it.
    expect(extractMemoryFacts('我们明天几点见面？')).toEqual([]);
  });

  it('「她三天没回我消息了」 yields exactly one subject-led declarative', () => {
    const facts = extractMemoryFacts('她三天没回我消息了');
    expect(facts).toHaveLength(1);
    expect(facts[0].text).toMatch(/^(她|他|我|我们|对方)/);
    expect(facts[0].text).not.toMatch(/行不行|吗|呢|？/);
  });

  it('a statement clause inside a question-y message still yields its fact', () => {
    // The declarative clause survives; the deliberation clause dies.
    const facts = extractMemoryFacts('她说最近有点累，我是不是不该约了？');
    expect(facts.some((f) => f.text === '她最近有点累')).toBe(true);
    for (const fact of facts) {
      expect(fact.text).not.toMatch(/[?？]/);
      expect(fact.text).not.toMatch(/该不该|行不行|要不要/);
    }
  });
});

describe('P387 · /api/chat stores nothing for a question turn', () => {
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

  it('the Round-105 message stores nothing, then the declarative lands alone', async () => {
    const first = await postChat('她就是个绿茶，我明天直接当面质问她行不行？');
    expect(first.memory?.count ?? 0).toBe(0);

    const second = await postChat('她三天没回我消息了', first.sessionId);
    const items = second.memory?.items ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatch(/^(她|他|我|我们|对方)/);
    expect(items[0]).not.toMatch(/行不行|吗|呢|？/);
  });
});

describe('P387 · capsule pills never carry a question mark; empty memory says so', () => {
  const noop = () => {};
  const turns: ChatMessage[] = [
    { id: 'u1', role: 'user', content: '她三天没回我消息了' },
    { id: 'a1', role: 'assistant', content: '先别连发，给她一点空间。' },
  ];

  let dom: FakeDom;
  let root: Root | null = null;

  const qs = (sel: string) => dom.document.querySelector(sel);
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
          sessionId: 's-p387',
          memory,
          onForgetMemory: noop,
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

  it('[data-fact] texts are pairwise distinct and contain no question mark', async () => {
    // A pre-P387 shard may still hand the capsule a question-shaped label;
    // it can never reach a pill.
    await renderWithMemory([
      '我明天直接当面质问她行不行？',
      '她三天没回我消息了',
      '我明天第一次约会',
    ]);
    const texts = qsa('span[data-fact]').map((el) => el.textContent ?? '');
    expect(texts).toEqual(['她三天没回我消息了', '我明天第一次约会']);
    expect(new Set(texts).size).toBe(texts.length);
    for (const text of texts) {
      expect(text).not.toMatch(/[?？]/);
    }
    await act(async () => {
      root!.unmount();
    });
    root = null;
  });

  it('when no non-question candidates remain the capsule shows 暂无可记住的信息', async () => {
    await renderWithMemory(['我明天直接当面质问她行不行？']);
    const receipt = qs('.memory-receipt');
    expect(receipt).toBeTruthy();
    expect(receipt!.textContent).toContain('暂无可记住的信息');
    expect(qsa('span[data-fact]')).toHaveLength(0);
    await act(async () => {
      root!.unmount();
    });
    root = null;
  });
});
