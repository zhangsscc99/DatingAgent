import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isCorsAllowed, isSameOrigin, requestHost } from '../src/lib/cors.js';
import { createApp } from '../src/routes/app.js';

describe('P170 · cors lib', () => {
  it('matches origin host against the request host, port included', () => {
    expect(isSameOrigin('http://127.0.0.1:3012', '127.0.0.1:3012')).toBe(true);
    expect(isSameOrigin('https://example.com', 'example.com')).toBe(true);
    expect(isSameOrigin('http://localhost:3012', 'localhost:3012')).toBe(true);
  });

  it('normalises default ports and case on both sides', () => {
    expect(isSameOrigin('https://example.com', 'example.com:443')).toBe(true);
    expect(isSameOrigin('https://EXAMPLE.com', 'example.COM')).toBe(true);
    expect(isSameOrigin('http://example.com', 'example.com:443')).toBe(false);
    expect(isSameOrigin('https://example.com', 'example.com:8080')).toBe(false);
  });

  it('rejects foreign, malformed and tricky origins', () => {
    expect(isSameOrigin('https://evil.example', '127.0.0.1:3012')).toBe(false);
    expect(isSameOrigin('http://127.0.0.1:3012.evil.example', '127.0.0.1:3012')).toBe(false);
    expect(isSameOrigin('null', '127.0.0.1:3012')).toBe(false);
    expect(isSameOrigin('not a url', '127.0.0.1:3012')).toBe(false);
    expect(isSameOrigin(undefined, '127.0.0.1:3012')).toBe(false);
    expect(isSameOrigin('https://example.com', undefined)).toBe(false);
  });

  it('treats a missing Origin header as allowed', () => {
    expect(isCorsAllowed(undefined, '127.0.0.1:3012')).toBe(true);
    expect(isCorsAllowed('https://evil.example', '127.0.0.1:3012')).toBe(false);
    expect(isCorsAllowed('http://127.0.0.1:3012', '127.0.0.1:3012')).toBe(true);
  });

  it('prefers the first X-Forwarded-Host entry over Host', () => {
    expect(
      requestHost({ 'x-forwarded-host': 'a.example, b.example', host: 'c.example' }),
    ).toBe('a.example');
    expect(requestHost({ host: 'c.example' })).toBe('c.example');
    expect(requestHost({})).toBeUndefined();
  });
});

describe('P170 · same-origin cors middleware', () => {
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    const app = createApp({ llmConfigured: true });
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const addr = server.address();
    if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('emits no Access-Control-Allow-Origin for a foreign origin', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('reflects the Origin when it matches the request host', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: baseUrl },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(baseUrl);
  });

  it('reflects the Origin when it matches X-Forwarded-Host', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://coach.example.com', 'X-Forwarded-Host': 'coach.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://coach.example.com');
  });

  it('does not trust a foreign Origin even when X-Forwarded-Host is present', async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://evil.example', 'X-Forwarded-Host': 'coach.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('emits no CORS headers at all when there is no Origin header', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    for (const [name] of res.headers) {
      expect(name.startsWith('access-control-')).toBe(false);
    }
  });

  it('answers a same-origin preflight with reflected CORS headers', async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'OPTIONS',
      headers: { Origin: baseUrl, 'Access-Control-Request-Headers': 'content-type' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(baseUrl);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type');
  });

  it('answers a foreign-origin preflight with no Access-Control-* headers', async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    for (const [name] of res.headers) {
      expect(name.startsWith('access-control-')).toBe(false);
    }
  });

  it('still reaches /api/chat without an Origin header', async () => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    // 400 proves the request passed the CORS layer and hit the handler.
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Message is required');
  });
});
