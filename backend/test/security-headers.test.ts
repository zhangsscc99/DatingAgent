import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/routes/app.js';

describe('P147 · X-Frame-Options DENY on all responses', () => {
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

  it('GET / (SPA entry) carries x-frame-options: DENY', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('a static asset carries x-frame-options: DENY', async () => {
    const res = await fetch(`${baseUrl}/favicon.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('GET /api/health carries all three security headers', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('the header is a single DENY value, not a duplicated array', async () => {
    for (const path of ['/', '/api/health']) {
      const res = await fetch(`${baseUrl}${path}`, { method: 'HEAD' });
      // undici joins duplicate headers with ", " — exact match proves one home.
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    }
  });

  it('deep SPA fallback route also carries x-frame-options: DENY', async () => {
    const res = await fetch(`${baseUrl}/chat/anything`);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});
