import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMResponse } from '../src/agent/types.js';

/**
 * P339 — two live probes proved the old keyword-lexicon memory unstable:
 * in one session 「她说最近有点累，我是不是不该约了？」 was dropped whole
 * while 「我明天第一次约会」 was kept — same input class, different
 * outcome. Extraction is now a deterministic rule pass (no LLM) covering
 * 人物+状态 / 我+时间+事件 / 我想·打算·计划 / 喜欢·讨厌·怕, written into a
 * stored, deletable session memory every user turn.
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

interface MemoryFactBody {
  key: string;
  text: string;
  ts: number;
}

interface ChatBody {
  sessionId: string;
  reply: string;
  memory?: { count: number; items: string[]; facts?: MemoryFactBody[] };
}

describe('P339 · deterministic per-turn fact extraction', () => {
  it('extracts 她+状态 from the clause that used to drop whole', () => {
    const facts = extractMemoryFacts('她说最近有点累，我是不是不该约了？');
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts.some((f) => f.text === '她最近有点累')).toBe(true);
    // The deliberation clause is a question, not a fact.
    expect(facts.some((f) => f.text.includes('不该'))).toBe(false);
  });

  it('extracts 我+时间+事件', () => {
    const facts = extractMemoryFacts('我明天第一次约会');
    expect(facts.some((f) => f.text === '我明天第一次约会')).toBe(true);
  });

  it('extracts 我想/打算/计划 + X and 喜欢/讨厌 + X', () => {
    const intents = extractMemoryFacts('我打算周末表白，我还喜欢她做的饭');
    expect(intents.some((f) => f.text.includes('我打算'))).toBe(true);
    expect(intents.some((f) => f.text.includes('喜欢'))).toBe(true);
  });

  it('one message can yield several facts', () => {
    const facts = extractMemoryFacts('她最近有点累，我明天还要加班');
    expect(facts.length).toBeGreaterThanOrEqual(2);
  });

  it('the same input three times yields identical facts (no flaky misses)', () => {
    const a = extractMemoryFacts('她说最近有点累，我是不是不该约了？');
    const b = extractMemoryFacts('她说最近有点累，我是不是不该约了？');
    const c = extractMemoryFacts('她说最近有点累，我是不是不该约了？');
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
});

describe('P339 · memory API across two turns', () => {
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

  async function runTwoTurns(): Promise<ChatBody> {
    const first = await postChat('她说最近有点累，我是不是不该约了？');
    return postChat('我明天第一次约会', first.sessionId);
  }

  it('two turns keep facts from both — length >= 2, none dropped', async () => {
    const second = await runTwoTurns();
    expect(second.memory).toBeDefined();
    expect(second.memory!.count).toBeGreaterThanOrEqual(2);
    const joined = second.memory!.items.join('；');
    expect(joined).toContain('她最近有点累');
    expect(joined).toContain('我明天第一次约会');
    // Facts carry the {key, text, ts} shape the management API needs.
    const facts = second.memory!.facts ?? [];
    expect(facts.length).toBe(second.memory!.count);
    for (const fact of facts) {
      expect(typeof fact.key).toBe('string');
      expect(typeof fact.text).toBe('string');
      expect(typeof fact.ts).toBe('number');
    }
  });

  it('the same two-turn input on three fresh sessions is identical', async () => {
    const [a, b, c] = await Promise.all([runTwoTurns(), runTwoTurns(), runTwoTurns()]);
    const strip = (body: ChatBody) =>
      (body.memory?.facts ?? []).map(({ key, text }) => ({ key, text }));
    expect(strip(b)).toEqual(strip(a));
    expect(strip(c)).toEqual(strip(a));
  });

  it('GET /api/conversations/:id/memory lists the keyed facts', async () => {
    const second = await runTwoTurns();
    const res = await fetch(`${baseUrl}/api/conversations/${second.sessionId}/memory`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; items: MemoryFactBody[] };
    expect(body.count).toBeGreaterThanOrEqual(2);
    expect(body.items.map((f) => f.text)).toEqual(second.memory!.items);
  });

  it('GET memory for an unknown conversation is a JSON 404', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/nope/memory`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(typeof body.error).toBe('string');
  });

  it('DELETE forgets a fact — and it stays forgotten through restore', async () => {
    const second = await runTwoTurns();
    const fact = (second.memory!.facts ?? []).find((f) =>
      f.text.includes('她最近有点累'),
    )!;
    const del = await fetch(
      `${baseUrl}/api/conversations/${second.sessionId}/memory/${encodeURIComponent(fact.key)}`,
      { method: 'DELETE' },
    );
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ deleted: true });

    const after = await fetch(`${baseUrl}/api/conversations/${second.sessionId}/memory`);
    const afterBody = (await after.json()) as { count: number; items: MemoryFactBody[] };
    expect(afterBody.items.some((f) => f.key === fact.key)).toBe(false);

    // A history restore must not resurrect the forgotten fact.
    const restore = await fetch(`${baseUrl}/api/session/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: second.sessionId,
        messages: [
          { role: 'user', content: '她说最近有点累，我是不是不该约了？' },
          { role: 'assistant', content: '嗯' },
          { role: 'user', content: '我明天第一次约会' },
        ],
      }),
    });
    expect(restore.status).toBe(200);
    const reGet = await fetch(`${baseUrl}/api/conversations/${second.sessionId}/memory`);
    const reBody = (await reGet.json()) as { items: MemoryFactBody[] };
    expect(reBody.items.some((f) => f.key === fact.key)).toBe(false);
    expect(reBody.items.some((f) => f.text.includes('我明天第一次约会'))).toBe(true);
  });

  it('DELETE on an unknown key or conversation is a JSON 404', async () => {
    const second = await runTwoTurns();
    const missing = await fetch(
      `${baseUrl}/api/conversations/${second.sessionId}/memory/${encodeURIComponent('没有这条')}`,
      { method: 'DELETE' },
    );
    expect(missing.status).toBe(404);
    const missingBody = (await missing.json()) as { deleted?: boolean; error?: string };
    expect(missingBody.deleted).toBe(false);

    const noConv = await fetch(
      `${baseUrl}/api/conversations/nope/memory/${encodeURIComponent('没有这条')}`,
      { method: 'DELETE' },
    );
    expect(noConv.status).toBe(404);
    const noConvBody = (await noConv.json()) as { error?: string };
    expect(typeof noConvBody.error).toBe('string');
  });
});
