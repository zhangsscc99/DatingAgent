import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { LLMResponse } from '../src/agent/types.js';
import { createCompressionMiddleware } from '../src/lib/compression.js';

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

/**
 * P426 — gzip for text responses >= 1 KB via node:zlib. Compressed requests
 * are fetched with raw http.request (not fetch, which would transparently
 * decompress and hide the wire bytes) so `zlib.gunzipSync` can verify the
 * payload. Tests run against a temp dist dir via the `frontendDist`
 * AppOption, like static-cache.test.ts.
 */

const SHELL =
  '<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>';
const JS_CONTENT = `// bundle\n${'console.log("x");\n'.repeat(150)}`;
const JSON_CONTENT = JSON.stringify({
  items: Array.from({ length: 200 }, (_, i) => `row-${i}`),
});
const SMALL_TEXT = 'a'.repeat(500);

type App = ReturnType<typeof createApp>;

async function listen(app: App): Promise<{
  server: ReturnType<App['listen']>;
  port: number;
}> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, port };
}

function close(server: ReturnType<App['listen']>): Promise<void> {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

/** Raw request — no implicit Accept-Encoding, no transparent decompression. */
function rawRequest(options: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      (res) => {
        const bufs: Buffer[] = [];
        res.on('data', (chunk: Buffer) => bufs.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(bufs) }),
        );
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe('P426 · gzip text responses', () => {
  let distDir = '';
  let server: ReturnType<App['listen']> | undefined;
  let port = 0;

  beforeAll(async () => {
    chatMock.mockResolvedValue({ content: '回复', toolCalls: [], finishReason: 'stop' } satisfies Partial<LLMResponse>);
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compression-'));
    fs.mkdirSync(path.join(distDir, 'assets'));
    fs.writeFileSync(path.join(distDir, 'assets', 'index-abc.js'), JS_CONTENT);
    fs.writeFileSync(path.join(distDir, 'data.json'), JSON_CONTENT);
    fs.writeFileSync(path.join(distDir, 'small.txt'), SMALL_TEXT);
    fs.writeFileSync(path.join(distDir, 'index.html'), SHELL);
    ({ server, port } = await listen(createApp({ frontendDist: distDir, llmConfigured: true })));
  });

  afterAll(async () => {
    await close(server!);
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it('GET a >=1 KB JS asset with Accept-Encoding: gzip returns gzip bytes', async () => {
    const res = await rawRequest({
      port,
      path: '/assets/index-abc.js',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['vary']).toContain('Accept-Encoding');
    expect(Number(res.headers['content-length'])).toBe(res.body.length);
    expect(zlib.gunzipSync(res.body).equals(Buffer.from(JS_CONTENT))).toBe(true);
    // The P424 immutable cache policy survives verbatim.
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('GET a >=1 KB JSON file with Accept-Encoding: gzip returns gzip bytes', async () => {
    const res = await rawRequest({
      port,
      path: '/data.json',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['vary']).toContain('Accept-Encoding');
    expect(zlib.gunzipSync(res.body).equals(Buffer.from(JSON_CONTENT))).toBe(true);
  });

  it('the same responses without Accept-Encoding are byte-identical, unencoded', async () => {
    for (const [route, original] of [
      ['/assets/index-abc.js', JS_CONTENT],
      ['/data.json', JSON_CONTENT],
    ] as const) {
      const res = await rawRequest({ port, path: route });
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.body.equals(Buffer.from(original))).toBe(true);
    }
  });

  it('HEAD on a compressible asset advertises gzip like the GET would', async () => {
    const res = await rawRequest({
      port,
      path: '/assets/index-abc.js',
      method: 'HEAD',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['vary']).toContain('Accept-Encoding');
    expect(res.body.length).toBe(0);
  });

  it('GET with Range returns the raw partial bytes — no gzip on 206', async () => {
    const res = await rawRequest({
      port,
      path: '/assets/index-abc.js',
      headers: { 'accept-encoding': 'gzip', range: 'bytes=0-1999' },
    });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-1999/${JS_CONTENT.length}`);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(Number(res.headers['content-length'])).toBe(2000);
    expect(res.body.length).toBe(2000);
    expect(res.body.equals(Buffer.from(JS_CONTENT).subarray(0, 2000))).toBe(true);
    // Not a gzip stream mislabelled as an identity byte range.
    expect(res.body[0]).not.toBe(0x1f);
  });

  it('GET a suffix Range also passes through uncompressed', async () => {
    const res = await rawRequest({
      port,
      path: '/assets/index-abc.js',
      headers: { 'accept-encoding': 'gzip', range: 'bytes=-2000' },
    });
    expect(res.status).toBe(206);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.equals(Buffer.from(JS_CONTENT).subarray(-2000))).toBe(true);
  });

  it('HEAD with Range does not advertise Content-Encoding: gzip', async () => {
    const res = await rawRequest({
      port,
      path: '/assets/index-abc.js',
      method: 'HEAD',
      headers: { 'accept-encoding': 'gzip', range: 'bytes=0-1999' },
    });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-1999/${JS_CONTENT.length}`);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(Number(res.headers['content-length'])).toBe(2000);
    expect(res.body.length).toBe(0);
  });

  // P428 — RFC 9110 q=0 means "not acceptable"; gzip;q=0 must not get a gzip body.
  for (const value of ['gzip;q=0', 'gzip;q=0.000', '*;q=0']) {
    it(`Accept-Encoding "${value}" receives the identity body, no Content-Encoding`, async () => {
      const res = await rawRequest({
        port,
        path: '/assets/index-abc.js',
        headers: { 'accept-encoding': value },
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBeUndefined();
      expect(Number(res.headers['content-length'])).toBe(JS_CONTENT.length);
      expect(res.body.equals(Buffer.from(JS_CONTENT))).toBe(true);
    });
  }

  for (const value of ['gzip;q=0.8', 'gzip, deflate', 'GZIP']) {
    it(`Accept-Encoding "${value}" still gets gzip`, async () => {
      const res = await rawRequest({
        port,
        path: '/assets/index-abc.js',
        headers: { 'accept-encoding': value },
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBe('gzip');
      expect(zlib.gunzipSync(res.body).equals(Buffer.from(JS_CONTENT))).toBe(true);
    });
  }

  it('Accept-Encoding "xgzip" still does not match the gzip token', async () => {
    const res = await rawRequest({
      port,
      path: '/assets/index-abc.js',
      headers: { 'accept-encoding': 'xgzip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.equals(Buffer.from(JS_CONTENT))).toBe(true);
  });

  it('a 500-byte text response is not compressed', async () => {
    const res = await rawRequest({
      port,
      path: '/small.txt',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.equals(Buffer.from(SMALL_TEXT))).toBe(true);
  });

  it('POST /api/chat/stream stays text/event-stream with no Content-Encoding', async () => {
    const res = await rawRequest({
      port,
      path: '/api/chat/stream',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept-encoding': 'gzip',
      },
      body: JSON.stringify({ message: '你好' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.toString()).toContain('data:');
  });

  it('GET /api/health keeps no-store and the F26/P147 security headers', async () => {
    const res = await rawRequest({
      port,
      path: '/api/health',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('GET / SPA shell keeps Cache-Control: no-cache', async () => {
    const res = await rawRequest({
      port,
      path: '/',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
  });
});

describe('P431 · 304 revalidation carries Vary: Accept-Encoding', () => {
  let distDir = '';
  let server: ReturnType<App['listen']> | undefined;
  let port = 0;
  let etag = '';

  beforeAll(async () => {
    chatMock.mockResolvedValue({ content: '回复', toolCalls: [], finishReason: 'stop' } satisfies Partial<LLMResponse>);
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compression-304-'));
    fs.mkdirSync(path.join(distDir, 'assets'));
    fs.writeFileSync(path.join(distDir, 'assets', 'index-abc.js'), JS_CONTENT);
    fs.writeFileSync(path.join(distDir, 'index.html'), SHELL);
    ({ server, port } = await listen(createApp({ frontendDist: distDir, llmConfigured: true })));
    const first = await rawRequest({ port, path: '/assets/index-abc.js' });
    etag = String(first.headers.etag);
    expect(etag.length).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await close(server!);
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it('304 with Accept-Encoding: gzip carries Vary and no Content-Encoding/body', async () => {
    const res = await rawRequest({
      port,
      path: '/assets/index-abc.js',
      headers: { 'accept-encoding': 'gzip', 'if-none-match': etag },
    });
    expect(res.status).toBe(304);
    expect(res.headers.vary).toContain('Accept-Encoding');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['content-length']).toBeUndefined();
    expect(res.body.length).toBe(0);
  });

  it('304 from an identity-only client also carries Vary', async () => {
    const res = await rawRequest({
      port,
      path: '/assets/index-abc.js',
      headers: { 'if-none-match': etag },
    });
    expect(res.status).toBe(304);
    expect(res.headers.vary).toContain('Accept-Encoding');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.length).toBe(0);
  });

  it('HEAD 304 revalidation carries Vary too', async () => {
    const res = await rawRequest({
      port,
      path: '/assets/index-abc.js',
      method: 'HEAD',
      headers: { 'accept-encoding': 'gzip', 'if-none-match': etag },
    });
    expect(res.status).toBe(304);
    expect(res.headers.vary).toContain('Accept-Encoding');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.length).toBe(0);
  });
});

describe('P426 · middleware pass-through', () => {
  it('a text/event-stream route behind the middleware streams unbuffered', async () => {
    let finishSse: (() => void) | undefined;
    const app = express();
    app.use(createCompressionMiddleware());
    app.get('/sse', (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.flushHeaders();
      res.write('data: first\n\n');
      // The response only ends once the client has seen the first frame —
      // a buffering middleware would deadlock this test into a timeout.
      finishSse = () => res.end('data: last\n\n');
    });
    app.get('/finish', (_req, res) => {
      finishSse?.();
      res.json({ ok: true });
    });

    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      let gotFirst: (chunk: Buffer) => void = () => {};
      const firstChunk = new Promise<Buffer>((resolve) => {
        gotFirst = resolve;
      });
      const full = new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }>(
        (resolve, reject) => {
          const bufs: Buffer[] = [];
          const req = http.request(
            { host: '127.0.0.1', port, path: '/sse', headers: { 'accept-encoding': 'gzip' } },
            (res) => {
              res.on('data', (chunk: Buffer) => {
                if (bufs.length === 0) gotFirst(chunk);
                bufs.push(chunk);
              });
              res.on('end', () =>
                resolve({ headers: res.headers, body: Buffer.concat(bufs) }),
              );
            },
          );
          req.on('error', reject);
          req.end();
        },
      );

      const first = await firstChunk;
      expect(first.toString()).toContain('data: first');
      await rawRequest({ port, path: '/finish' });
      const { headers, body } = await full;
      expect(headers['content-encoding']).toBeUndefined();
      expect(body.toString()).toContain('data: last');
    } finally {
      await close(server as ReturnType<App['listen']>);
    }
  });
});
