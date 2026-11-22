import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/routes/app.js';

/**
 * P430 — after a deploy the hashed asset names change, so a tab holding an
 * old chunk name used to get the SPA shell (200 text/html) back, which a
 * `nosniff` browser refuses to execute — a mystery white screen instead of
 * a diagnosable miss. Paths that look like static files (last segment has a
 * `.` with a 1–8 alphanumeric extension) now answer 404 text/plain;
 * extensionless SPA routes keep the shell, /favicon.ico keeps its 204, and
 * /api/* keeps its JSON 404.
 */

const SHELL =
  '<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>';

type App = ReturnType<typeof createApp>;

async function listen(app: App): Promise<{
  server: ReturnType<App['listen']>;
  base: string;
}> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, base: `http://127.0.0.1:${port}` };
}

function close(server: ReturnType<App['listen']>): Promise<void> {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('P430 · missing static-looking paths answer 404 text/plain', () => {
  let distDir = '';
  let server: ReturnType<App['listen']> | undefined;
  let base = '';

  beforeAll(async () => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-miss-'));
    fs.mkdirSync(path.join(distDir, 'assets'));
    fs.writeFileSync(path.join(distDir, 'assets', 'index-live.js'), '/* live bundle */');
    fs.writeFileSync(path.join(distDir, 'index.html'), SHELL);
    ({ server, base } = await listen(createApp({ frontendDist: distDir, llmConfigured: true })));
  });

  afterAll(async () => {
    await close(server!);
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it('missing .js/.css/.txt paths answer 404 text/plain, never the SPA shell', async () => {
    for (const route of ['/assets/index-deadbeef.js', '/assets/nope.css', '/robots.txt']) {
      const res = await fetch(`${base}${route}`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('text/plain');
      expect(await res.text()).toBe('Not found');
    }
  });

  it('an existing hashed asset still serves 200', async () => {
    const res = await fetch(`${base}/assets/index-live.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('/* live bundle */');
  });

  it('extensionless SPA routes still get the shell', async () => {
    for (const route of ['/', '/settings', '/chat/123']) {
      const res = await fetch(`${base}${route}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('id="root"');
    }
  });

  it('/favicon.ico keeps its 204', async () => {
    const res = await fetch(`${base}/favicon.ico`);
    expect(res.status).toBe(204);
  });

  it('/api/health answers 200 JSON and /api/nope keeps the JSON 404', async () => {
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get('content-type')).toContain('application/json');
    const healthBody = (await health.json()) as { status?: string };
    expect(healthBody.status).toBe('ok');

    const miss = await fetch(`${base}/api/nope`);
    expect(miss.status).toBe(404);
    expect(miss.headers.get('content-type')).toContain('application/json');
    const missBody = (await miss.json()) as { requestId?: string };
    expect(typeof missBody.requestId).toBe('string');
  });
});
