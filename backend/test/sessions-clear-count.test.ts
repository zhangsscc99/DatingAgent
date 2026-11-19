import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/routes/app.js';

/**
 * P369 — the machine-readable half of 清空全部对话. The sidebar button opens
 * the in-app ConfirmDialog; on confirm the frontend fires
 * DELETE /api/session/:id once per stored chat (chatStorage
 * deleteBackendSessions). These tests boot the real app on an ephemeral
 * port and prove GET /api/sessions count drops by exactly 1 per DELETE —
 * the walkthrough assertion that previously had no executable form.
 */

interface SessionsBody {
  count: number;
  oldestAgeSec: number;
}

describe('P369 · clear-all decrements GET /api/sessions', () => {
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    const app = createApp();
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const addr = server.address();
    if (typeof addr === 'object' && addr) {
      baseUrl = `http://127.0.0.1:${addr.port}`;
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  async function sessionsCount(): Promise<number> {
    const res = await fetch(`${baseUrl}/api/sessions`);
    expect(res.status).toBe(200);
    return ((await res.json()) as SessionsBody).count;
  }

  async function createSession(): Promise<string> {
    const res = await fetch(`${baseUrl}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: {} }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { sessionId: string }).sessionId;
  }

  it('DELETE /api/session/:id drops the count by exactly 1', async () => {
    const before = await sessionsCount();
    const id = await createSession();
    expect(await sessionsCount()).toBe(before + 1);

    // The exact request the UI issues on confirm (deleteBackendSessions):
    // DELETE /api/session/<encodeURIComponent(id)>, fire-and-forget.
    const del = await fetch(
      `${baseUrl}/api/session/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ deleted: true });
    expect(await sessionsCount()).toBe(before);
  });

  it('clearing one of several sessions removes only that one', async () => {
    const before = await sessionsCount();
    const a = await createSession();
    const b = await createSession();
    expect(await sessionsCount()).toBe(before + 2);

    await fetch(`${baseUrl}/api/session/${encodeURIComponent(a)}`, {
      method: 'DELETE',
    });
    expect(await sessionsCount()).toBe(before + 1);

    await fetch(`${baseUrl}/api/session/${encodeURIComponent(b)}`, {
      method: 'DELETE',
    });
    expect(await sessionsCount()).toBe(before);
  });
});
