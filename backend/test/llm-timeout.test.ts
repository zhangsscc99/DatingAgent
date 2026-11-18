import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMClient, LLMTimeoutError } from '../src/llm/client.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A stub OpenAI-compatible upstream. Requests whose body contains "hang"
// never get a response — simulating a stalled/half-open provider connection.
// Anything else gets a normal chat-completion payload.
const stubSockets = new Set<Socket>();
const stub = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    if (body.includes('hang')) return; // never respond
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          { message: { content: 'stub回复', tool_calls: [] }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    );
  });
});
stub.on('connection', (socket) => {
  stubSockets.add(socket);
  socket.on('close', () => stubSockets.delete(socket));
});
await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
const stubPort = (stub.address() as AddressInfo).port;

// Env must be set before the app module loads: its harness constructs the
// real LLMClient at import time and captures these values.
process.env.OPENAI_API_KEY = 'test-key';
process.env.LLM_BASE_URL = `http://127.0.0.1:${stubPort}/v1`;
process.env.LLM_MODEL = 'test-model';
// 200ms gives the real local HTTP round-trip in "a normal request is
// unaffected" enough margin to not flake under CPU contention, while the
// stalled-upstream cases still hit the deadline well under their 1s
// assertions (deadline + handler overhead must stay < 1000ms).
process.env.LLM_TIMEOUT_MS = '200';

const { createApp } = await import('../src/routes/app.js');

function chatFetch(baseUrl: string, path: string, message: string) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

describe('LLM upstream timeout (P166)', () => {
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
    for (const socket of stubSockets) socket.destroy();
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_TIMEOUT_MS;
  });

  it('/api/chat returns 504 JSON with requestId within ~1s when upstream stalls', async () => {
    const startedAt = Date.now();
    const res = await chatFetch(baseUrl, '/api/chat', 'hang please');
    const elapsed = Date.now() - startedAt;

    expect(res.status).toBe(504);
    const body = (await res.json()) as { error?: string; requestId?: string };
    expect(typeof body.error).toBe('string');
    expect(body.error).toContain('timed out');
    expect(typeof body.requestId).toBe('string');
    // Wide margin on purpose: the production default upstream timeout (30s)
    // is far above this bound, so anything under ~1.5s still proves the
    // client fast-fails on a stalled upstream instead of waiting out the
    // default. A hard 1000ms wall-clock bound flaked under full parallel
    // load (observed 1021ms with all functional assertions green).
    expect(elapsed).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1500);
  });

  it('/api/chat/stream emits an error event then closes when upstream stalls', async () => {
    const startedAt = Date.now();
    const res = await chatFetch(baseUrl, '/api/chat/stream', 'hang please');
    // SSE headers flush before the upstream call, so the status is already 200.
    expect(res.status).toBe(200);

    // text() only resolves once the server calls res.end() — a closed stream.
    const text = await res.text();
    expect(Date.now() - startedAt).toBeLessThan(1000);

    const events = [...text.matchAll(/data: (.*)\n/g)].map((m) => JSON.parse(m[1]));
    const error = events.find((e) => e.type === 'error');
    expect(error).toBeDefined();
    expect(error.data.message).toContain('timed out');
    expect(typeof error.data.requestId).toBe('string');
    // No `done` event may follow the error.
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });

  it('a normal request is unaffected and still lands reply + meta', async () => {
    const res = await chatFetch(baseUrl, '/api/chat', '你好');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      reply: string;
      meta?: { tokens?: number; latencyMs?: number };
    };
    expect(body.reply).toBe('stub回复');
    expect(body.meta).toMatchObject({ tokens: 7 });
    expect(typeof body.meta?.latencyMs).toBe('number');
  });
});

describe('LLMClient timeout semantics (P166)', () => {
  beforeEach(() => {
    // The endpoint describe's afterAll clears env; the client needs a key
    // again so it takes the real fetch path instead of the mock response.
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.LLM_TIMEOUT_MS = '50';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function hangingFetch() {
    return vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const fail = () =>
            reject(init?.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
          // Like real fetch: an already-aborted signal rejects immediately.
          if (init?.signal?.aborted) return fail();
          init?.signal?.addEventListener('abort', fail);
        }),
    );
  }

  it('throws LLMTimeoutError when the deadline fires', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const client = new LLMClient();
    await expect(
      client.chat([{ role: 'user', content: 'hi' }], [], undefined, 50),
    ).rejects.toBeInstanceOf(LLMTimeoutError);
  });

  it('a caller abort is rethrown as AbortError, never misreported as timeout', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const client = new LLMClient();
    const controller = new AbortController();
    const pending = client.chat([{ role: 'user', content: 'hi' }], [], controller.signal, 50);
    const settled = pending.then(
      () => 'resolved',
      (err: unknown) => (err instanceof LLMTimeoutError ? 'LLMTimeoutError' : 'AbortError'),
    );

    controller.abort();
    // External abort wins even though the 50ms deadline is still armed.
    await expect(settled).resolves.toBe('AbortError');
  });

  it('ignores invalid timeout values and falls back to the default', async () => {
    process.env.LLM_TIMEOUT_MS = 'not-a-number';
    // Upstream answers normally after 120ms: only a wrongly-short fallback
    // would abort this call.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, _init?: RequestInit) => {
        await sleep(120);
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: 'ok', tool_calls: [] }, finish_reason: 'stop' },
            ],
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const client = new LLMClient();
    const res = await client.chat(
      [{ role: 'user', content: 'hi' }],
      [],
      undefined,
      -1, // invalid per-call value: also falls back
    );
    expect(res.finishReason).toBe('stop');
    expect(res.content).toBe('ok');
  });
});
