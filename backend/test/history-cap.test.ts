import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LLMResponse, Message } from '../src/agent/types.js';
import {
  capHistory,
  HISTORY_DEFAULT_MAX_CHARS,
  HISTORY_DEFAULT_MAX_MESSAGES,
  historyLimitsFromEnv,
} from '../src/lib/history.js';
import { MAX_MESSAGE_CHARS } from '../src/lib/guardrails.js';

/** Replace the LLM client so the harness path runs deterministically offline. */
const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock('../src/llm/client.js', () => ({
  LLMClient: class {
    chat = chatMock;
    // P189: the turn loop streams through chatStream; delegate to the same
    // mock so sent-message assertions still land in chatMock's calls.
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

const { AgentHarness, createSession } = await import('../src/agent/harness.js');
const { createApp } = await import('../src/routes/app.js');

function turns(count: number, pad = ''): Message[] {
  const history: Message[] = [];
  for (let i = 0; i < count; i++) {
    history.push(
      { role: 'user', content: `${pad}u${i}` },
      { role: 'assistant', content: `${pad}a${i}` },
    );
  }
  return history;
}

const totalChars = (history: Message[]) =>
  history.reduce((sum, m) => sum + m.content.length, 0);

const okResponse = (content: string): LLMResponse => ({
  content,
  toolCalls: [],
  finishReason: 'stop',
});

describe('capHistory', () => {
  it('trims an over-budget history to the message cap, newest turns survive', () => {
    const history = turns(30); // 60 messages > 40
    const snapshot = JSON.parse(JSON.stringify(history)) as Message[];

    const capped = capHistory(history);

    expect(capped.length).toBe(HISTORY_DEFAULT_MAX_MESSAGES);
    expect(capped[0].role).toBe('user');
    expect(capped.at(-1)).toEqual({ role: 'assistant', content: 'a29' });
    // Input is never mutated.
    expect(history).toEqual(snapshot);
    expect(capped).not.toBe(history);
  });

  it('trims by the character budget after the count cap', () => {
    // 5 turns, each message ~102 chars -> 1020 total; budget keeps ~4.
    const capped = capHistory(turns(5, 'x'.repeat(100)), { maxChars: 500 });

    expect(totalChars(capped)).toBeLessThanOrEqual(500);
    expect(capped[0].role).toBe('user');
    expect(capped.at(-1)?.content).toBe(`${'x'.repeat(100)}a4`);
  });

  it('never leaves an orphan assistant at the head of the kept slice', () => {
    // Count cap lands mid-turn: last 3 of u0..a4 = [a3, u4, a4]; a3 must go.
    const capped = capHistory(turns(5), { maxMessages: 3 });
    expect(capped).toEqual([
      { role: 'user', content: 'u4' },
      { role: 'assistant', content: 'a4' },
    ]);

    // Char cap lands mid-turn too: dropping u0 leaves a0 at the head.
    const history = turns(2, 'y'.repeat(80));
    const byChars = capHistory(history, { maxChars: 170 });
    expect(byChars).toEqual([
      { role: 'user', content: `${'y'.repeat(80)}u1` },
      { role: 'assistant', content: `${'y'.repeat(80)}a1` },
    ]);
  });

  it('returns [] for empty or malformed input', () => {
    expect(capHistory([])).toEqual([]);
    expect(capHistory(undefined)).toEqual([]);
    expect(capHistory('not an array')).toEqual([]);
    expect(capHistory([{ role: 'system', content: 'x' }, null, { role: 'user' }])).toEqual(
      [],
    );
  });

  it('keeps a 10,000-message history inside the budget', () => {
    const capped = capHistory(turns(5000));
    expect(capped.length).toBeLessThanOrEqual(HISTORY_DEFAULT_MAX_MESSAGES);
    expect(totalChars(capped)).toBeLessThanOrEqual(HISTORY_DEFAULT_MAX_CHARS);
    expect(capped[0].role).toBe('user');
    expect(capped.at(-1)?.content).toBe('a4999');
  });

  it('reads HISTORY_MAX_MESSAGES / HISTORY_MAX_CHARS overrides via the env helper', () => {
    process.env.HISTORY_MAX_MESSAGES = '4';
    process.env.HISTORY_MAX_CHARS = '10';
    try {
      expect(historyLimitsFromEnv()).toEqual({ maxMessages: 4, maxChars: 10 });
    } finally {
      delete process.env.HISTORY_MAX_MESSAGES;
      delete process.env.HISTORY_MAX_CHARS;
    }
    expect(historyLimitsFromEnv()).toEqual({
      maxMessages: HISTORY_DEFAULT_MAX_MESSAGES,
      maxChars: HISTORY_DEFAULT_MAX_CHARS,
    });
  });
});

describe('harness prompt history (P177)', () => {
  it('sends a short conversation to the LLM byte-identical to before', async () => {
    chatMock.mockReset().mockResolvedValueOnce(okResponse('好的。'));

    const context = createSession({}, 'auto');
    const history: Message[] = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！有什么可以帮你？' },
      { role: 'user', content: '帮我优化资料' },
      { role: 'assistant', content: '当然可以，先说说你的情况。' },
    ];
    context.conversationHistory.push(...history);

    for await (const _event of new AgentHarness().run('继续', context)) {
      // drain
    }

    // The harness reuses `messages` for the whole turn and pushes the
    // assistant reply onto it afterwards — compare the pre-call prefix.
    const sent = chatMock.mock.calls[0][0] as Message[];
    expect(sent[0].role).toBe('system');
    expect(JSON.stringify(sent.slice(1, 1 + history.length + 1))).toBe(
      JSON.stringify([...history, { role: 'user', content: '继续' }]),
    );
  });

  it('applies HISTORY_MAX_MESSAGES to the prompt at call time', async () => {
    process.env.HISTORY_MAX_MESSAGES = '2';
    chatMock.mockReset().mockResolvedValueOnce(okResponse('嗯。'));
    try {
      const context = createSession({}, 'auto');
      context.conversationHistory.push(...turns(4));
      for await (const _event of new AgentHarness().run('再来', context)) {
        // drain
      }
      const sent = chatMock.mock.calls[0][0] as Message[];
      // system + capped 2 history entries + new user (+ the reply the
      // harness pushed onto the shared array after the call returned)
      expect(sent.slice(0, 4)).toEqual([
        expect.objectContaining({ role: 'system' }),
        { role: 'user', content: 'u3' },
        { role: 'assistant', content: 'a3' },
        { role: 'user', content: '再来' },
      ]);
    } finally {
      delete process.env.HISTORY_MAX_MESSAGES;
    }
  });
});

describe('POST /api/session/restore history cap (P177)', () => {
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

  const postRestore = (body: unknown) =>
    fetch(`${baseUrl}/api/session/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('stores only the budgeted tail of a large restored history', async () => {
    // 200 turns > the 40-message cap but small enough for the JSON body limit;
    // capHistory itself is covered at 10k entries above.
    const res = await postRestore({ sessionId: 'restore-cap', messages: turns(200) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { restored: boolean; messageCount: number };
    expect(body.restored).toBe(true);
    expect(body.messageCount).toBe(HISTORY_DEFAULT_MAX_MESSAGES);

    const get = await fetch(`${baseUrl}/api/session/restore-cap`);
    const session = (await get.json()) as { history: Message[] };
    expect(session.history.length).toBe(HISTORY_DEFAULT_MAX_MESSAGES);
    expect(totalChars(session.history)).toBeLessThanOrEqual(HISTORY_DEFAULT_MAX_CHARS);
    expect(session.history[0].role).toBe('user');
    expect(session.history.at(-1)?.content).toBe('a199');
  });

  it('truncates a single restored message to MAX_MESSAGE_CHARS', async () => {
    const res = await postRestore({
      sessionId: 'restore-long',
      messages: [
        { role: 'user', content: 'z'.repeat(MAX_MESSAGE_CHARS + 500) },
        { role: 'assistant', content: 'ok' },
      ],
    });
    expect(res.status).toBe(200);

    const get = await fetch(`${baseUrl}/api/session/restore-long`);
    const session = (await get.json()) as { history: Message[] };
    expect(session.history[0].content.length).toBe(MAX_MESSAGE_CHARS);
    expect(session.history[1].content).toBe('ok');
  });

  it('keeps the response shape unchanged for a normal restore', async () => {
    const res = await postRestore({
      sessionId: 'restore-ok',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['messageCount', 'restored', 'sessionId']);
    expect(body).toMatchObject({ sessionId: 'restore-ok', restored: true, messageCount: 2 });
  });
});
