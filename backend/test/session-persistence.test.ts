import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LLMResponse } from '../src/agent/types.js';

/**
 * P359 — sessions and memories lived only in process memory, so a single
 * pm2 restart wiped every conversation mid-chat (P0 data loss, confirmed
 * live twice). Each session is now also a JSON shard on disk; a fresh app
 * instance — an empty cache over the same shards — is exactly a restart.
 * These tests run the real routes end to end: write → new instance → read.
 */

const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock('../src/llm/client.js', () => ({
  LLMClient: class {
    chat = chatMock;
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
const { SessionStore, sessionsDir } = await import('../src/lib/session-store.js');

function response(partial: Partial<LLMResponse>): LLMResponse {
  return { content: null, toolCalls: [], finishReason: 'stop', ...partial };
}

interface SessionBody {
  sessionId: string;
  history: Array<{ role: string; content: string }>;
  memory: { count: number; items: string[] };
}

interface ChatBody {
  sessionId: string;
  reply: string;
  memory?: { count: number };
}

type Server = ReturnType<ReturnType<typeof createApp>['listen']>;

async function listen(app: ReturnType<typeof createApp>): Promise<{ server: Server; baseUrl: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  const baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
  return { server, baseUrl };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function postChat(baseUrl: string, message: string, sessionId?: string): Promise<ChatBody> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, sessionId }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ChatBody;
}

async function getSession(baseUrl: string, sessionId: string): Promise<{ status: number; body?: SessionBody }> {
  const res = await fetch(`${baseUrl}/api/session/${encodeURIComponent(sessionId)}`);
  if (res.status !== 200) return { status: res.status };
  return { status: 200, body: (await res.json()) as SessionBody };
}

/** One write→restart→read cycle at a fresh temp dir; returns the shard dir used. */
describe('P359 · sessions and memories survive a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dating-sessions-p359-'));
  const servers: Server[] = [];

  beforeAll(() => {
    process.env.DATING_SESSIONS_DIR = dir;
  });

  afterAll(async () => {
    await Promise.all(servers.map(close));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    chatMock.mockReset();
    chatMock.mockResolvedValue(response({ content: '嗯，我记下了。' }));
  });

  async function startApp() {
    const { server, baseUrl } = await listen(createApp({ llmConfigured: true }));
    servers.push(server);
    return { server, baseUrl };
  }

  /** Two chat turns → 4 history rows (2 user + 2 assistant) and ≥2 memory facts. */
  async function writeSession(baseUrl: string, sessionId: string) {
    await postChat(baseUrl, '她说最近有点累', sessionId);
    const second = await postChat(baseUrl, '我明天第一次约会', sessionId);
    return { memoryCount: second.memory?.count ?? 0 };
  }

  it('a fresh app instance still serves the session — messages and memory intact', async () => {
    const first = await startApp();
    const { memoryCount } = await writeSession(first.baseUrl, 'persist-main');
    expect(memoryCount).toBeGreaterThanOrEqual(2);
    await close(first.server);

    const second = await startApp();
    const got = await getSession(second.baseUrl, 'persist-main');
    expect(got.status).toBe(200);
    const contents = got.body!.history.map((m) => `${m.role}:${m.content}`);
    expect(contents).toContain('user:她说最近有点累');
    expect(contents).toContain('user:我明天第一次约会');
    expect(got.body!.history).toHaveLength(4);
    expect(got.body!.memory.count).toBe(memoryCount);
  });

  it('three write → restart → read cycles stay stable', async () => {
    const ids = ['cycle-a', 'cycle-b', 'cycle-c'];
    const expected = new Map<string, number>();
    for (const id of ids) {
      const writer = await startApp();
      const { memoryCount } = await writeSession(writer.baseUrl, id);
      expected.set(id, memoryCount);
      expect(memoryCount).toBeGreaterThanOrEqual(2);
      await close(writer.server);

      const reader = await startApp();
      const got = await getSession(reader.baseUrl, id);
      expect(got.status).toBe(200);
      const contents = got.body!.history.map((m) => m.content);
      expect(contents).toContain('她说最近有点累');
      expect(contents).toContain('我明天第一次约会');
      expect(got.body!.memory.count).toBe(expected.get(id));
      // Earlier cycles' sessions survive on this same instance too.
      for (const earlier of ids.slice(0, ids.indexOf(id))) {
        const again = await getSession(reader.baseUrl, earlier);
        expect(again.status).toBe(200);
        expect(again.body!.memory.count).toBe(expected.get(earlier));
      }
      await close(reader.server);
    }
  });

  it('a non-conforming session id cannot escape the data dir', async () => {
    const { baseUrl } = await startApp();
    const hostile = '../../etc/passwd';
    await postChat(baseUrl, '她想周末见面', hostile);

    // The shard filename is a hash — never a path segment.
    const store = new SessionStore(dir);
    const file = store.fileFor(hostile);
    expect(path.dirname(file)).toBe(path.resolve(dir));
    expect(path.basename(file)).toMatch(/^[A-Za-z0-9_-]+\.json$/);
    for (const name of fs.readdirSync(dir)) {
      expect(name).toMatch(/^[A-Za-z0-9_-]+\.json$/);
    }

    // …yet the same id round-trips fine through the API itself.
    const got = await getSession(baseUrl, hostile);
    expect(got.status).toBe(200);
    expect(got.body!.sessionId).toBe(hostile);
    expect(got.body!.history.some((m) => m.content === '她想周末见面')).toBe(true);
  });

  it('a corrupt shard never throws — treated as missing, file left in place', async () => {
    const { baseUrl } = await startApp();
    fs.writeFileSync(path.join(dir, 'corrupt-garbage.json'), '{not json at all', 'utf8');
    fs.writeFileSync(
      path.join(dir, 'corrupt-shape.json'),
      JSON.stringify({ v: 1, lastActiveAt: Date.now(), context: { nope: true } }),
      'utf8',
    );

    const a = await getSession(baseUrl, 'corrupt-garbage');
    expect(a.status).toBe(404);
    const b = await getSession(baseUrl, 'corrupt-shape');
    expect(b.status).toBe(404);

    // The server is unaffected and the files were not deleted.
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
    expect(fs.existsSync(path.join(dir, 'corrupt-garbage.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'corrupt-shape.json'))).toBe(true);
  });

  it('deleting a session drops the shard too', async () => {
    const { baseUrl } = await startApp();
    await writeSession(baseUrl, 'delete-me');
    expect(fs.existsSync(path.join(dir, 'delete-me.json'))).toBe(true);
    const res = await fetch(`${baseUrl}/api/session/delete-me`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(fs.existsSync(path.join(dir, 'delete-me.json'))).toBe(false);
  });

  it('sessionsDir honors DATING_SESSIONS_DIR', () => {
    expect(sessionsDir()).toBe(path.resolve(dir));
  });
});
