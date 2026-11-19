import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMResponse } from '../src/agent/types.js';

/**
 * P366 — the Round-97 walkthrough (1795072237, 390×844) showed the
 * sidebar and first-screen capsule listing 「记得 2 件事：她三天没回我
 * 消息了；她先不回我的」. The second entry is a clause clipped on a
 * dangling 的 — no reader can tell what was remembered. Extraction now
 * gates every candidate on `isStandaloneFact`: a stored fact must be a
 * standalone sentence — explicit subject + action/state, ≥6 normalised
 * chars, never ending in 的/地/得.
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

describe('P366 · fragment inputs produce no memory fact', () => {
  it('「她先不回我的」 — a clause clipped on a dangling 的 — yields nothing', () => {
    expect(extractMemoryFacts('她先不回我的')).toEqual([]);
  });

  it('「是她先不回我的！」inside a longer outburst still yields no 的-fragment', () => {
    const facts = extractMemoryFacts('你有病吧？凭什么让我低头？是她先不回我的！');
    expect(facts.some((f) => f.text.includes('她先不回我的'))).toBe(false);
    for (const fact of facts) {
      expect(fact.text).not.toMatch(/[的地得]$/);
    }
  });

  it('「就是烦」 — no subject, three chars — yields nothing', () => {
    expect(extractMemoryFacts('就是烦')).toEqual([]);
  });

  it('every produced fact is standalone: 6–20 chars, subject or headline lead, no dangling ending', () => {
    const samples = [
      '她说最近有点累，我是不是不该约了？',
      '我明天第一次约会',
      '我打算周末表白，我还喜欢她做的饭',
      '她最近有点累，我明天还要加班',
      '一直是我主动',
      '明天第一次约会，穿什么',
      '是她先不回我的！',
      '就是烦',
    ];
    for (const sample of samples) {
      for (const fact of extractMemoryFacts(sample)) {
        expect(fact.text.length, `${sample} → ${fact.text}`).toBeGreaterThanOrEqual(6);
        expect(fact.text.length, `${sample} → ${fact.text}`).toBeLessThanOrEqual(21); // 20 + ellipsis
        expect(fact.text, `${sample} → ${fact.text}`).not.toMatch(/[的地得]$/);
        expect(
          /我|你|她|他|它|ta/i.test(fact.text) ||
            /^(?:今天|明天|后天|昨天|昨晚|周末|下周|这周|今晚|明晚)/.test(fact.text),
          `${sample} → ${fact.text}`,
        ).toBe(true);
      }
    }
  });
});

describe('P366 · a real statement still produces a readable fact', () => {
  it('「她三天没回我消息了」 — subject 她 + state 没回消息, 6–20 chars', () => {
    const facts = extractMemoryFacts('她三天没回我消息了');
    expect(facts.length).toBeGreaterThanOrEqual(1);
    const fact = facts[0];
    expect(fact.text).toBe('她三天没回我消息了');
    expect(fact.text.length).toBeGreaterThanOrEqual(6);
    expect(fact.text.length).toBeLessThanOrEqual(20);
    expect(fact.text).toContain('她');
    expect(fact.text).toContain('没回');
  });
});

describe('P366 · /api/chat never stores a fragment', () => {
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

  it('the Round-97 message keeps 她三天没回我消息了 and drops 她先不回我的', async () => {
    const first = await postChat('她三天没回我消息了');
    const second = await postChat('你有病吧？凭什么让我低头？是她先不回我的！', first.sessionId);
    const items = second.memory?.items ?? [];
    expect(items.some((i) => i.includes('她三天没回我消息了'))).toBe(true);
    expect(items.some((i) => i.includes('她先不回我的'))).toBe(false);
    for (const item of items) {
      expect(item).not.toMatch(/[的地得]$/);
      expect(item.length).toBeGreaterThanOrEqual(6);
    }
  });
});
