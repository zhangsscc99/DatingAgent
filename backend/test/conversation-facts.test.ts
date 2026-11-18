import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMResponse } from '../src/agent/types.js';

/**
 * P313 — three turns each carrying a distinct fact (看展 / 三小时没回 /
 * 带闺蜜) used to surface only the lexicon hit; the other two were
 * silently dropped, and the backend kept no memory at all so the receipt
 * copy was all the "memory" there was. Facts are now extracted from every
 * retained user message — lexicon plus curated patterns — and the chat
 * payloads report how many memories the session holds.
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
const { conversationFactItems } = await import('../src/lib/conversationFacts.js');

function response(partial: Partial<LLMResponse>): LLMResponse {
  return { content: null, toolCalls: [], finishReason: 'stop', ...partial };
}

interface ChatBody {
  sessionId: string;
  reply: string;
  memory?: { count: number; items: string[] };
}

describe('P313 · conversation fact extraction', () => {
  const threeTurns = [
    { role: 'user' as const, content: '周末本来想约她去看展' },
    { role: 'assistant' as const, content: '很轻的安排，适合开口。' },
    { role: 'user' as const, content: '她已经三个小时没回我消息了' },
    { role: 'assistant' as const, content: '先别连发，给她一点空间。' },
    { role: 'user' as const, content: '下次见面我想带闺蜜一起去' },
  ];

  it('keeps one fact per turn across three distinct facts', () => {
    const items = conversationFactItems(threeTurns);
    expect(items).toEqual(['看展', '三个小时没回', '带闺蜜']);
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it('dedupes a fact repeated in a later turn', () => {
    const items = conversationFactItems([
      { role: 'user', content: '她三个小时没回消息了' },
      { role: 'user', content: '对，已经三个小时没回' },
    ]);
    expect(items.filter((i) => i.includes('没回'))).toHaveLength(1);
  });

  it('one phrase yields one fact — overlapping spans collapse', () => {
    const items = conversationFactItems([
      { role: 'user', content: '她三个小时没回我消息了' },
    ]);
    expect(items).toEqual(['三个小时没回']);
  });

  it('assistant messages and code blocks never contribute', () => {
    const items = conversationFactItems([
      { role: 'assistant', content: '要不要带闺蜜一起去' },
      { role: 'user', content: '看这段\n```\n看展\n```' },
    ]);
    expect(items).toEqual([]);
  });
});

describe('P313 · /api/chat memory payload across three turns', () => {
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

  it('the third turn reports at least two retained memories', async () => {
    const first = await postChat('周末本来想约她去看展');
    expect(first.memory?.count).toBe(1);

    const second = await postChat('她已经三个小时没回我消息了', first.sessionId);
    expect(second.memory?.count).toBeGreaterThanOrEqual(2);

    const third = await postChat('下次见面我想带闺蜜一起去', first.sessionId);
    expect(third.memory).toBeDefined();
    expect(third.memory!.count).toBeGreaterThanOrEqual(2);
    const joined = third.memory!.items.join('、');
    const hits = ['看展', '没回', '闺蜜'].filter((k) => joined.includes(k));
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('repeating the same fact does not inflate the count', async () => {
    const first = await postChat('她三个小时没回消息了');
    const second = await postChat('对，三个小时没回', first.sessionId);
    expect(second.memory!.count).toBe(first.memory!.count);
  });
});
