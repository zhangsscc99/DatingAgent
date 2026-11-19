/// <reference types="node" />
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentContext, LLMResponse } from '../src/agent/types.js';

/**
 * P392 — fifth recurrence of the memory-echo defect (walkthrough
 * 1795115528, 390×844, refresh-continue): the capsule listed
 * 「记得 3 件事 / 她三天没回我消息了 / 我明天直接当面质问她行不行 /
 * 我明天第一次约会」. The second pill is the user's question
 * (「她就是个绿茶，我明天直接当面质问她行不行？」), the third is a
 * half-sentence clipped out of 「明天第一次约会，穿卫衣去会不会太随
 * 便？」 — a topic fragment with no predicate that P387's
 * clause-boundary check let through because the clause ends in 「，」
 * — and the first is byte-identical to the session title.
 *
 * The contract pinned here: extraction drops (a) every interrogative /
 * consultative sentence, including a non-standalone clause inside a
 * question sentence, and (b) incomplete fragments (a short candidate
 * with no verb/state word). Output stays a 「主语 + 状态/计划」 line
 * capped at 20 chars and deduped against the session title — and the
 * stored list is re-validated on every read so a pre-gate shard can no
 * longer serve an echo on refresh. Prefer missing over wrong.
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
const { extractMemoryFacts, sessionMemoryFacts } = await import(
  '../src/lib/memory-extract.js'
);

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

const QUESTION_INPUTS = [
  // The user's own consultative question — never a fact.
  '她就是个绿茶，我明天直接当面质问她行不行？',
  // A question whose topic clause used to survive as a fragment.
  '明天第一次约会，穿卫衣去会不会太随便？',
  // Marker-less deliberation.
  '我该不该主动找她',
];

describe('P392 · question sentences and fragments yield no facts', () => {
  for (const input of QUESTION_INPUTS) {
    it(`「${input}」 yields facts.length === 0`, () => {
      expect(extractMemoryFacts(input)).toEqual([]);
    });
  }

  it('a topic fragment inside a question sentence dies; a standalone clause lives', () => {
    // Same 「明天第一次约会」 headline: inside a question it is the
    // question's topic fragment, as a statement it is a real fact.
    expect(extractMemoryFacts('明天第一次约会，穿卫衣去会不会太随便？')).toEqual([]);
    expect(
      extractMemoryFacts('我明天第一次约会').some(
        (f) => f.text === '我明天第一次约会',
      ),
    ).toBe(true);
    // The declarative clause inside a mixed message still lands.
    expect(
      extractMemoryFacts('她说最近有点累，我是不是不该约了？').some(
        (f) => f.text === '她最近有点累',
      ),
    ).toBe(true);
  });

  it('a short fragment with no predicate is dropped', () => {
    for (const fact of extractMemoryFacts('明天的安排')) {
      expect(fact.text.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('「她三天没回我消息了」 yields one subject-led declarative ≥ 8 chars', () => {
    const facts = extractMemoryFacts('她三天没回我消息了');
    expect(facts).toHaveLength(1);
    expect(facts[0].text).toMatch(/^(她|他|我|我们|对方)/);
    expect(facts[0].text.length).toBeGreaterThanOrEqual(8);
    expect(facts[0].text).not.toMatch(/行不行|吗|呢|？/);
  });
});

describe('P392 · stored memory is re-validated on read — no pre-gate echo survives', () => {
  it('the Round-106 shard: title echo + question + fragment are all pruned', () => {
    const context: AgentContext = {
      sessionId: 's-p392',
      profile: {},
      conversationHistory: [
        { role: 'user', content: '她三天没回我消息了' },
        { role: 'assistant', content: '先别连发。' },
        { role: 'user', content: '她就是个绿茶，我明天直接当面质问她行不行？' },
        { role: 'assistant', content: '先缓一缓。' },
        { role: 'user', content: '明天第一次约会，穿卫衣去会不会太随便？' },
        { role: 'assistant', content: '干净利落就好。' },
      ],
      memoryFacts: [
        { key: '她三天没回我消息了', text: '她三天没回我消息了', ts: 1 },
        { key: '我明天直接当面质问她行不行', text: '我明天直接当面质问她行不行', ts: 2 },
        { key: '我明天第一次约会', text: '我明天第一次约会', ts: 3 },
      ],
    };
    // All three stale rows die: the first restates the title, the
    // second is the user's question, the third only ever appeared
    // inside a question sentence.
    expect(sessionMemoryFacts(context)).toEqual([]);
  });

  it('a fact also stated declaratively survives its question echo', () => {
    const context: AgentContext = {
      sessionId: 's-p392b',
      profile: {},
      conversationHistory: [
        { role: 'user', content: '在吗' },
        { role: 'assistant', content: '在。' },
        { role: 'user', content: '我明天第一次约会' },
        { role: 'assistant', content: '记下。' },
        { role: 'user', content: '我明天第一次约会穿什么好？' },
        { role: 'assistant', content: '干净利落就好。' },
      ],
      memoryFacts: [
        { key: '我明天第一次约会', text: '我明天第一次约会', ts: 1 },
      ],
    };
    expect(sessionMemoryFacts(context).map((f) => f.text)).toEqual([
      '我明天第一次约会',
    ]);
  });
});

describe('P392 · /api/chat stores nothing for the repro turns; items stay distinct and never echo the title', () => {
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

  it('the Round-106 conversation: question turns store nothing, items pairwise distinct, none === session.title', async () => {
    const firstMessage = '她三天没回我消息了';
    const sessionTitle = titleOf(firstMessage);
    const first = await postChat(firstMessage);
    // The declarative first message is already the title — storing it as
    // a fact would render the same sentence twice.
    expect(first.memory?.count ?? 0).toBe(0);

    const second = await postChat(
      '她就是个绿茶，我明天直接当面质问她行不行？',
      first.sessionId,
    );
    expect(second.memory?.count ?? 0).toBe(0);

    const third = await postChat(
      '明天第一次约会，穿卫衣去会不会太随便？',
      first.sessionId,
    );
    expect(third.memory?.count ?? 0).toBe(0);

    const fourth = await postChat('她最近有点累，我有点担心', first.sessionId);
    const items = fourth.memory?.items ?? [];
    for (let i = 0; i < items.length; i++) {
      expect(items[i]).not.toBe(sessionTitle);
      expect(items[i]).not.toMatch(/[?？]/);
      for (let j = i + 1; j < items.length; j++) {
        expect(items[i], `${items[i]} vs ${items[j]}`).not.toBe(items[j]);
      }
    }
    // And the fact that did land is a real statement, not a fragment.
    expect(items.some((i) => i === '她最近有点累')).toBe(true);
  });
});

describe('P392 · capsule facts are plain-text entries, not input boxes', () => {
  const css = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../frontend/src/components/ChatWindow.css',
    ),
    'utf8',
  );

  function ruleBody(selector: string): string {
    const re = new RegExp(
      `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
      'g',
    );
    return [...css.matchAll(re)].map((m) => m[1]).join('\n');
  }

  it('[data-fact] carries no input-box styling — border: none or transparent background', () => {
    const rule = ruleBody('.memory-capsule-fact');
    expect(rule).not.toBe('');
    expect(
      /border(-style)?\s*:\s*none/.test(rule) ||
        /background\s*:\s*transparent/.test(rule),
    ).toBe(true);
    // No input-box chrome at all: neither a border shorthand nor a fill.
    expect(rule).not.toMatch(/border\s*:\s*1px/);
  });

  it('the capsule container itself has no input-box outline', () => {
    // `.memory-capsule {` — the ruleBody regex matches the base rule only.
    const base = ruleBody('.memory-capsule');
    expect(base).not.toBe('');
    expect(base).not.toContain('border: 1px');
    // It stays a quiet status row: a bookmark icon is still rendered
    // alongside the plain-text entries (asserted on the markup side).
  });
});
