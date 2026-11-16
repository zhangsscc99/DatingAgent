import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LLMResponse } from '../src/agent/types.js';
import { usageMetrics } from '../src/lib/metrics.js';

const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock('../src/llm/client.js', () => ({
  LLMClient: class {
    chat = chatMock;
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

describe('stream client disconnect (P165)', () => {
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

  it('aborts the upstream LLM call and stops the loop when the client disconnects', async () => {
    let seenSignal: AbortSignal | undefined;
    chatMock.mockReset();
    chatMock.mockImplementationOnce(
      (_messages: unknown, _tools: unknown, signal?: AbortSignal) => {
        seenSignal = signal;
        // Hang like a real fetch would, until the signal kills it.
        return new Promise<LLMResponse>((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
          );
        });
      },
    );

    const chatCountBefore = usageMetrics.snapshot().requests.chat;
    const clientAbort = new AbortController();
    const req = fetch(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '生成一封很长的信' }),
      signal: clientAbort.signal,
    });
    // Swallow the client-side abort rejection as soon as it exists so it
    // cannot surface as an unhandled rejection.
    const reqDone = req.then(() => 'completed').catch(() => 'aborted');

    // Wait until the fake LLM call is in flight, then kill the client socket.
    while (!seenSignal) await sleep(5);
    clientAbort.abort();
    expect(await reqDone).toBe('aborted');

    // The server-side signal must have fired (res 'close' -> controller.abort).
    while (!seenSignal!.aborted) await sleep(5);
    // Give the handler a moment to unwind; the process must stay alive and
    // no error event may be written to the dead socket.
    await sleep(30);

    // Aborted turns are not counted as successful (or failed) chat samples.
    expect(usageMetrics.snapshot().requests.chat).toBe(chatCountBefore);
    expect(server?.listening).toBe(true);
  });

  it('still completes a normal /api/chat turn with meta', async () => {
    chatMock.mockReset();
    chatMock.mockResolvedValueOnce(
      response({ content: '普通回复', usage: { promptTokens: 5, completionTokens: 7 } }),
    );

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '你好' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      reply: string;
      meta?: { tokens?: number; latencyMs?: number };
    };
    expect(body.reply).toBe('普通回复');
    expect(body.meta).toMatchObject({ tokens: 12 });
    expect(typeof body.meta?.latencyMs).toBe('number');
  });

  it('still completes a normal /api/chat/stream turn with done meta', async () => {
    chatMock.mockReset();
    chatMock.mockResolvedValueOnce(
      response({ content: '流式回复', usage: { promptTokens: 3, completionTokens: 4 } }),
    );

    const res = await fetch(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '你好' }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();

    const events = [...text.matchAll(/data: (.*)\n/g)].map((m) => JSON.parse(m[1]));
    expect(events.some((e) => e.type === 'message' && e.data?.content === '流式回复')).toBe(true);
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done.data.tokens).toBe(7);
    expect(typeof done.data.latencyMs).toBe('number');
  });
});
