import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, LLMResponse, Message } from '../src/agent/types.js';
import {
  CHAT_INTENTS,
  STARTER_INTENT_MARKER,
  STARTER_INTENT_SKELETONS,
  buildStarterIntentDirective,
  parseChatIntent,
} from '../src/agent/harness.js';

/**
 * P345 — the three starter capsules are structural branches: each sends a
 * different `intent` on /api/chat and the first-turn reply must follow a
 * genuinely different skeleton (different opening line AND different
 * section plan), not the shared 归因 + 可照抄 + 解释 template.
 *
 * The LLM is mocked: it echoes back the per-intent skeleton the harness
 * put at the tail of the system message, so the returned `reply` text IS
 * the reply skeleton that turn was told to produce. A hand-typed message
 * (no intent) gets a plain canned reply. Pairwise similarity must stay
 * under 0.8 — the same test the walkthrough used to prove the three
 * entries were dead options.
 */

const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock('../src/llm/client.js', () => ({
  LLMClient: class {
    chat = chatMock;
    // The turn loop streams through chatStream; delegate to the same mock.
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
const { AgentHarness, createSession } = await import('../src/agent/harness.js');

const GENERIC_REPLY = '先接住你说的这件事，再给一句可以直接用的话。';

/** The mock returns the intent skeleton as the reply when one is pinned. */
function echoIntentSkeleton() {
  chatMock.mockImplementation(async (messages: Message[]) => {
    const system = messages[0]?.content ?? '';
    const idx = system.indexOf(STARTER_INTENT_MARKER);
    const content =
      idx >= 0 ? system.slice(idx + STARTER_INTENT_MARKER.length) : GENERIC_REPLY;
    return {
      content,
      toolCalls: [],
      finishReason: 'stop',
    } satisfies LLMResponse;
  });
}

/** Character-bigram Jaccard over Han/latin/digit characters — small,
 *  dependency-free similarity measure for the < 0.8 contract. */
function jaccardSimilarity(a: string, b: string): number {
  const grams = (text: string): Set<string> => {
    const chars = (text.match(/[\p{Script=Han}\p{L}\p{N}]/gu) ?? []).join('');
    const set = new Set<string>();
    for (let i = 0; i + 1 < chars.length; i += 1) set.add(chars.slice(i, i + 2));
    if (chars) set.add(chars.slice(-1));
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  let intersection = 0;
  for (const g of A) if (B.has(g)) intersection += 1;
  return intersection / (A.size + B.size - intersection);
}

/** First sentence of a reply (splits on CJK sentence punctuation). */
function firstSentence(text: string): string {
  return (text.split(/[。！？!?\n]/)[0] ?? '').trim();
}

const post = (baseUrl: string, path: string, body: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('P345 · parseChatIntent', () => {
  it('accepts exactly the three starter intents', () => {
    expect(CHAT_INTENTS).toEqual(['profile', 'chat-coach', 'date-plan']);
    for (const v of CHAT_INTENTS) expect(parseChatIntent(v)).toBe(v);
  });

  it('rejects anything else', () => {
    for (const v of ['PROFILE', 'chat', '', 'date', 'coach', 1, true, null]) {
      expect(parseChatIntent(v)).toBeUndefined();
    }
    expect(parseChatIntent(undefined)).toBeUndefined();
    expect(parseChatIntent({})).toBeUndefined();
  });
});

describe('P345 · buildStarterIntentDirective gating', () => {
  it('fires only when an intent is present AND history is empty', () => {
    expect(buildStarterIntentDirective(undefined, 0)).toBe('');
    expect(buildStarterIntentDirective('profile', 2)).toBe('');
    for (const intent of CHAT_INTENTS) {
      const directive = buildStarterIntentDirective(intent, 0);
      expect(directive).toContain(STARTER_INTENT_MARKER);
      expect(directive).toContain(STARTER_INTENT_SKELETONS[intent]);
      expect(directive).toContain('不要在回复中提及或复述这些要求');
    }
  });

  it('the three skeletons are genuinely different texts', () => {
    const texts = CHAT_INTENTS.map((i) => STARTER_INTENT_SKELETONS[i]);
    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        expect(
          jaccardSimilarity(texts[i], texts[j]),
          `${CHAT_INTENTS[i]} vs ${CHAT_INTENTS[j]}`,
        ).toBeLessThan(0.8);
      }
    }
  });
});

describe('P345 · /api/chat intent → different first-turn replies', () => {
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
    echoIntentSkeleton();
  });

  it('the same user input yields three replies with different first sentences and skeletons', async () => {
    const replies: Record<string, string> = {};
    for (const intent of CHAT_INTENTS) {
      const res = await post(baseUrl, '/api/chat', { message: '帮我看看', intent });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reply: string };
      replies[intent] = body.reply;
      // The turn's system message carried this intent's skeleton at the tail.
      const calls = chatMock.mock.calls;
      const system = (calls.at(-1)![0] as Message[])[0].content;
      expect(system).toContain(STARTER_INTENT_MARKER + STARTER_INTENT_SKELETONS[intent]);
    }

    for (let i = 0; i < CHAT_INTENTS.length; i += 1) {
      for (let j = i + 1; j < CHAT_INTENTS.length; j += 1) {
        const a = replies[CHAT_INTENTS[i]];
        const b = replies[CHAT_INTENTS[j]];
        expect(
          jaccardSimilarity(a, b),
          `similarity ${CHAT_INTENTS[i]} vs ${CHAT_INTENTS[j]}`,
        ).toBeLessThan(0.8);
        expect(
          firstSentence(a),
          `first sentence ${CHAT_INTENTS[i]} vs ${CHAT_INTENTS[j]}`,
        ).not.toBe(firstSentence(b));
      }
    }
  });

  it('a hand-typed first message sends no skeleton and keeps today\'s shape', async () => {
    const res = await post(baseUrl, '/api/chat', { message: '帮我看看' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string };
    expect(body.reply).toBe(GENERIC_REPLY);
    const system = (chatMock.mock.calls.at(-1)![0] as Message[])[0].content;
    expect(system).not.toContain(STARTER_INTENT_MARKER);
  });

  it('an unknown intent value is a 400 like the other enum hints', async () => {
    const res = await post(baseUrl, '/api/chat', { message: '你好', intent: 'bogus' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('intent');
    for (const bad of ['PROFILE', 'chat', 'date-plan-plan', '资料优化']) {
      const r = await post(baseUrl, '/api/chat', { message: '你好', intent: bad });
      expect(r.status, bad).toBe(400);
    }
  });

  it('/api/chat/stream accepts the same intents', async () => {
    const res = await post(baseUrl, '/api/chat/stream', {
      message: '帮我看看',
      intent: 'date-plan',
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const events = [...text.matchAll(/data: (.*)\n/g)].map((m) =>
      JSON.parse(m[1]) as { type: string; data?: Record<string, unknown> },
    );
    expect(events.at(-1)?.type).toBe('done');
    const system = (chatMock.mock.calls.at(-1)![0] as Message[])[0].content;
    expect(system).toContain(STARTER_INTENT_SKELETONS['date-plan']);
  });

  it('the stream endpoint rejects a malformed intent too', async () => {
    const res = await post(baseUrl, '/api/chat/stream', {
      message: '你好',
      intent: 'nope',
    });
    expect(res.status).toBe(400);
  });
});

describe('P345 · the intent only shapes the first turn', () => {
  beforeEach(() => {
    chatMock.mockReset();
    echoIntentSkeleton();
  });

  async function runTurn(
    message: string,
    historyLen: number,
    intent?: (typeof CHAT_INTENTS)[number],
  ) {
    const context = createSession({}, 'auto');
    for (let i = 0; i < historyLen; i += 2) {
      context.conversationHistory.push(
        { role: 'user', content: `第${i / 2 + 1}轮问题` },
        { role: 'assistant', content: `第${i / 2 + 1}轮回答` },
      );
    }
    const events: AgentEvent[] = [];
    for await (const ev of new AgentHarness().run(
      message,
      context,
      undefined,
      undefined,
      undefined,
      intent,
    )) {
      events.push(ev);
    }
    return { context, events };
  }

  it('a later turn carrying an intent keeps the shared prompt shape', async () => {
    const { events } = await runTurn('接着说', 2, 'profile');
    expect(events.at(-1)?.type).toBe('done');
    const system = (chatMock.mock.calls.at(-1)![0] as Message[])[0].content;
    expect(system).not.toContain(STARTER_INTENT_MARKER);
  });

  it('a first turn carrying an intent pins the skeleton', async () => {
    const { context } = await runTurn('帮我看看', 0, 'chat-coach');
    const system = (chatMock.mock.calls.at(-1)![0] as Message[])[0].content;
    expect(system).toContain(STARTER_INTENT_SKELETONS['chat-coach']);
    // …and history records the real exchange, not the directive.
    expect(context.conversationHistory[0]).toEqual({
      role: 'user',
      content: '帮我看看',
    });
  });
});
