import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LLMResponse } from '../src/agent/types.js';

const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock('../src/llm/client.js', () => ({
  LLMClient: class {
    chat = chatMock;
    // P189: the turn loop streams through chatStream; delegate to the same
    // mock so a mocked LLMResponse comes back with no delta increments.
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

function response(partial: Partial<LLMResponse>): LLMResponse {
  return { content: null, toolCalls: [], finishReason: 'stop', ...partial };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('SSE keepalive (F19)', () => {
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    process.env.SSE_KEEPALIVE_MS = '20';
    // Slow "tool/LLM" call: the stream stays idle well past one keepalive tick.
    chatMock.mockImplementation(async () => {
      await sleep(120);
      return response({ content: '慢速回复完成' });
    });
    const app = createApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const addr = server.address();
    if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    delete process.env.SSE_KEEPALIVE_MS;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('emits `: ping` comments while the model is thinking', async () => {
    const res = await fetch(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '测试慢速流' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    expect(text).toContain(': ping');
    expect(text).toContain('"type":"message"');
    expect(text).toContain('"type":"done"');
  });

  it('still completes a slow stream end to end', async () => {
    const res = await fetch(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '测试慢速流完成' }),
    });
    const text = await res.text();
    const lastData = [...text.matchAll(/data: (.*)\n/g)].pop();
    expect(JSON.parse(lastData![1])).toMatchObject({ type: 'done' });
    expect(text).toContain('慢速回复完成');
  });
});
