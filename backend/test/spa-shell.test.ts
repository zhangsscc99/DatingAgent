import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/routes/app.js';

/**
 * P314 — during a frontend rebuild `frontend/dist/index.html` is briefly
 * missing or half-written, and the old `sendFile` catch-all answered the SPA
 * fallback with `200 {"error":"Frontend not built"}`. The shell is now read
 * whole, cached after the first good read, and answered as either full HTML
 * or `503 + Retry-After` — never 200 with an error body. These tests replay
 * the rebuild window against a temp dist dir via the `frontendDist`
 * AppOption, so the real dist is never touched.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_INDEX = path.resolve(__dirname, '../../frontend/dist/index.html');

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

describe('P314 · SPA shell during a frontend rebuild', () => {
  let distDir = '';
  let shellFile = '';
  let missingFile = '';

  beforeAll(() => {
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-shell-'));
    shellFile = path.join(distDir, 'index.html');
    missingFile = `${shellFile}.missing`;
    fs.writeFileSync(shellFile, SHELL);
  });

  afterAll(() => {
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  it('GET / and deep routes return 200 + full HTML containing id="root"', async () => {
    const { server, base } = await listen(createApp({ frontendDist: distDir }));
    try {
      for (const route of ['/', '/index.html', '/chat/deep-route']) {
        const res = await fetch(`${base}${route}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        expect(await res.text()).toContain('id="root"');
      }
    } finally {
      await close(server);
    }
  });

  it('20 hits while index.html is gone: cached HTML or 503, never 200 + error JSON', async () => {
    const { server, base } = await listen(createApp({ frontendDist: distDir }));
    try {
      // Prime the last-good cache with one healthy read, then pull the file
      // out from under the server — the vite rebuild window.
      const warm = await fetch(`${base}/`);
      expect(warm.status).toBe(200);
      fs.renameSync(shellFile, missingFile);
      try {
        for (let i = 0; i < 20; i += 1) {
          const res = await fetch(`${base}/`);
          const body = await res.text();
          if (res.status === 200) {
            expect(res.headers.get('content-type')).toContain('text/html');
            expect(body).toContain('id="root"');
          } else {
            expect(res.status).toBe(503);
            expect(res.headers.get('retry-after')).toBeTruthy();
          }
          expect(res.status === 200 && body.includes('"error"')).toBe(false);
        }
        // /api/* behaviour is unchanged during the same window: JSON either way.
        const health = await fetch(`${base}/api/health`);
        expect(health.headers.get('content-type')).toContain('application/json');
        expect(((await health.json()) as Record<string, unknown>).status).toBeDefined();
        const api404 = await fetch(`${base}/api/nope`);
        expect(api404.status).toBe(404);
        expect(((await api404.json()) as Record<string, unknown>).error).toBe('Not found');
      } finally {
        fs.renameSync(missingFile, shellFile);
      }
    } finally {
      await close(server);
    }
  });

  it('a half-written shell (no #root yet) also falls back to the last good copy', async () => {
    const { server, base } = await listen(createApp({ frontendDist: distDir }));
    try {
      expect((await fetch(`${base}/`)).status).toBe(200);
      fs.writeFileSync(shellFile, '<!doctype html><html><head>');
      const res = await fetch(`${base}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('id="root"');
    } finally {
      fs.writeFileSync(shellFile, SHELL);
      await close(server);
    }
  });

  it('cold start with no shell at all: 503 + Retry-After, never 200 + error JSON', async () => {
    fs.renameSync(shellFile, missingFile);
    const { server, base } = await listen(createApp({ frontendDist: distDir }));
    try {
      for (const route of ['/', '/index.html', '/chat/deep-route']) {
        const res = await fetch(`${base}${route}`);
        expect(res.status).toBe(503);
        expect(res.headers.get('retry-after')).toBeTruthy();
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.error).toBe('Frontend not built');
        expect(body.requestId).toBeTruthy();
      }
    } finally {
      fs.renameSync(missingFile, shellFile);
      await close(server);
    }
  });

  it('the default wiring still serves the real dist shell end-to-end', async () => {
    const { server, base } = await listen(createApp());
    try {
      const res = await fetch(`${base}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('id="root"');
      expect(fs.existsSync(REAL_INDEX)).toBe(true);
    } finally {
      await close(server);
    }
  });
});
