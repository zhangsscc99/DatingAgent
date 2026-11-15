import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock('../src/llm/client.js', () => ({
  LLMClient: class {
    chat = chatMock;
  },
}));

const { createApp } = await import('../src/routes/app.js');

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const readSrc = (file: string) => readFileSync(join(SRC, file), 'utf8');

const post = (baseUrl: string, path: string, body: string) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

describe('P04 · request id in error responses', () => {
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

  it('400 empty message carries the header request id', async () => {
    const res = await post(baseUrl, '/api/chat', '{}');
    const body = await res.json();
    const headerId = res.headers.get('x-request-id');
    expect(res.status).toBe(400);
    expect(headerId).toMatch(/^[0-9a-f]{12}$/);
    expect(body).toMatchObject({ error: 'Message is required', requestId: headerId });
  });

  it('400 invalid JSON body carries the request id', async () => {
    const res = await post(baseUrl, '/api/chat', '{not json');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      error: 'Invalid JSON body',
      requestId: res.headers.get('x-request-id'),
    });
  });

  it('400 missing sessionId on restore carries the request id', async () => {
    const res = await post(baseUrl, '/api/session/restore', '{}');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.requestId).toBe(res.headers.get('x-request-id'));
  });

  it('404 unknown session carries the request id', async () => {
    const res = await fetch(`${baseUrl}/api/session/does-not-exist`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({
      error: 'Session not found',
      requestId: res.headers.get('x-request-id'),
    });
  });

  it('413 oversized message carries the request id', async () => {
    const res = await post(baseUrl, '/api/chat', JSON.stringify({ message: 'x'.repeat(4001) }));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.requestId).toBe(res.headers.get('x-request-id'));
    expect(body.maxChars).toBe(4000);
  });

  it('413 body-parser too-large carries the request id', async () => {
    const res = await post(
      baseUrl,
      '/api/chat',
      JSON.stringify({ message: 'x'.repeat(200 * 1024) }),
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body).toMatchObject({
      error: 'Request body too large',
      requestId: res.headers.get('x-request-id'),
    });
  });

  it('500 on chat failure carries the request id', async () => {
    chatMock.mockRejectedValueOnce(new Error('llm exploded'));
    const res = await post(baseUrl, '/api/chat', JSON.stringify({ message: 'boom' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({
      error: 'llm exploded',
      requestId: res.headers.get('x-request-id'),
    });
  });

  it('SSE error event carries the request id inside data', async () => {
    chatMock.mockRejectedValueOnce(new Error('stream blew up'));
    const res = await post(baseUrl, '/api/chat/stream', JSON.stringify({ message: 'please' }));
    expect(res.status).toBe(200);
    const headerId = res.headers.get('x-request-id');
    const events = [...(await res.text()).matchAll(/data: (.*)\n/g)].map((m) =>
      JSON.parse(m[1]) as { type: string; data?: Record<string, unknown> },
    );
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.data).toMatchObject({ requestId: headerId });
  });

  it('successful responses keep their shape without a requestId field', async () => {
    const res = await post(baseUrl, '/api/session', '{}');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBeTruthy();
    expect(body.requestId).toBeUndefined();
  });

  it('429 rate limit carries the request id', async () => {
    // Earlier tests spend part of the 30/min budget; 35 more always crosses it.
    let last: Response | undefined;
    for (let i = 0; i < 35; i++) {
      last = await post(baseUrl, '/api/chat', '{}');
    }
    expect(last!.status).toBe(429);
    const body = await last!.json();
    expect(body.requestId).toBe(last!.headers.get('x-request-id'));
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it('no /api error path bypasses the shared errorBody helper', () => {
    const app = readSrc('routes/app.ts');
    const guardrails = readSrc('lib/guardrails.ts');
    expect(app).not.toMatch(/json\(\{\s*error/);
    expect(guardrails).not.toMatch(/json\(\{\s*error/);
    // The localhost-only 403 is not reachable from a loopback test request.
    expect(app).toContain("errorBody(res, 'forbidden: localhost only')");
    // SSE error payloads carry the id inside `data`, not as an event field.
    expect(app).toMatch(/type: 'error', data: \{ message: msg, requestId: requestId\(res\) \}/);
  });
});
