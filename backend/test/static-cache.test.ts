import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/routes/app.js';

/**
 * P424 — Vite emits content-hashed bundles under `assets/`, but express.static
 * answered them with `max-age=0`, so every page load revalidated ~450 KB of JS.
 * The `setHeaders` callback now answers `/assets/*` with a year-long immutable
 * cache policy while non-hashed files (favicon.svg, ...) keep a short window.
 * The SPA shell, the /assets 404 fallthrough and /api/* are untouched. Tests
 * run against a temp dist dir via the `frontendDist` AppOption.
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

function maxAge(cacheControl: string | null): number {
  const match = /max-age=(\d+)/.exec(cacheControl ?? '');
  return match ? Number(match[1]) : -1;
}

describe('P424 · Cache-Control on static files', () => {
  let distDir = '';
  let server: ReturnType<App['listen']> | undefined;
  let base = '';

  beforeAll(async () => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-cache-'));
    fs.mkdirSync(path.join(distDir, 'assets'));
    fs.writeFileSync(path.join(distDir, 'assets', 'index-abc.js'), '/* hashed bundle */');
    fs.writeFileSync(path.join(distDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(path.join(distDir, 'index.html'), SHELL);
    ({ server, base } = await listen(createApp({ frontendDist: distDir, llmConfigured: true })));
  });

  afterAll(async () => {
    await close(server!);
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it('GET /assets/index-abc.js is public + immutable for a full year', async () => {
    const res = await fetch(`${base}/assets/index-abc.js`);
    expect(res.status).toBe(200);
    const cc = res.headers.get('cache-control');
    expect(cc).toContain('immutable');
    expect(cc).toContain('public');
    expect(maxAge(cc)).toBeGreaterThanOrEqual(31_536_000);
  });

  it('GET /favicon.svg gets a short cache window and no immutable', async () => {
    const res = await fetch(`${base}/favicon.svg`);
    expect(res.status).toBe(200);
    const cc = res.headers.get('cache-control');
    expect(cc).not.toContain('immutable');
    expect(maxAge(cc)).toBeGreaterThan(-1);
    expect(maxAge(cc)).toBeLessThanOrEqual(3600);
  });

  it('GET / and a deep SPA route still answer 200 + HTML', async () => {
    for (const route of ['/', '/some/deep/route']) {
      const res = await fetch(`${base}${route}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
    }
  });

  it('a missing /assets file still falls through to the SPA shell, not a static 404', async () => {
    const res = await fetch(`${base}/assets/gone.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('GET /api/health keeps Cache-Control: no-store', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
