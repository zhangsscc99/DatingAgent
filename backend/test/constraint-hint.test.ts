import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/agent/harness.js';

/**
 * P407 — the composer's 本轮约束 chips ride inside the user message
 * (「本轮约束：A、B」 appended to the typed text). The backend must leave
 * the existing hint order untouched: the language directive and the
 * reply-length directive keep their positions in the system message, and
 * the constraint sentence stays inside the user turn it arrived on —
 * never bleeding into the system prompt's own hint slots.
 */

describe('P407 · /api/chat/stream constraint hint ordering', () => {
  const capturedBodies: Record<string, unknown>[] = [];
  const stubSockets = new Set<Socket>();
  let stub: Server;
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    stub = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          capturedBodies.push(JSON.parse(body) as Record<string, unknown>);
        } catch {
          /* malformed body — ignore */
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(
          'data: {"choices":[{"delta":{"content":"好的"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        );
      });
    });
    stub.on('connection', (socket) => {
      stubSockets.add(socket);
      socket.on('close', () => stubSockets.delete(socket));
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const stubPort = (stub.address() as AddressInfo).port;

    process.env.OPENAI_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = `http://127.0.0.1:${stubPort}/v1`;
    process.env.LLM_MODEL = 'test-model';
    process.env.LLM_TIMEOUT_MS = '10000';

    const { createApp } = await import('../src/routes/app.js');
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    stubSockets.forEach((s) => s.destroy());
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_TIMEOUT_MS;
  });

  const postChat = (body: Record<string, unknown>) =>
    fetch(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const lastMessages = () =>
    (capturedBodies.at(-1)?.messages ?? []) as Array<{
      role?: string;
      content?: string;
    }>;

  it('the constraint sentence stays inside the user message; system hints keep their order', async () => {
    const res = await postChat({
      message: '她昨天没回我\n\n本轮约束：我不想主动、只能发短信',
      language: 'zh',
      replyLength: 'concise',
    });
    expect(res.status).toBe(200);
    await res.text();

    const messages = lastMessages();
    const system = messages[0]?.content ?? '';
    const user = messages.at(-1);

    // The constraint rode in on the user turn — verbatim, after the typed text.
    expect(user?.role).toBe('user');
    expect(user?.content).toBe(
      '她昨天没回我\n\n本轮约束：我不想主动、只能发短信',
    );

    // Existing hint order is undisturbed: language directive first, then
    // the length directive, exactly where buildSystemPrompt places them.
    const langAt = system.indexOf('回复语言：始终用简体中文回答');
    const lenAt = system.indexOf('请把回复写得更精简，控制在三点以内。');
    expect(langAt).toBeGreaterThan(-1);
    expect(lenAt).toBeGreaterThan(-1);
    expect(langAt).toBeLessThan(lenAt);

    // The constraint never leaks into the system prompt's own hint area.
    expect(system).not.toContain('我不想主动');
    expect(system).not.toContain('只能发短信');
  });

  it('a constraint-laden user message yields the same system prompt as a plain one', async () => {
    const shared = { language: 'zh', replyLength: 'detailed' } as const;
    const plain = await postChat({ message: '她昨天没回我', ...shared });
    expect(plain.status).toBe(200);
    await plain.text();
    const plainSystem = lastMessages()[0]?.content ?? '';

    const constrained = await postChat({
      message: '她昨天没回我\n\n本轮约束：预算有限',
      ...shared,
    });
    expect(constrained.status).toBe(200);
    await constrained.text();
    const withConstraint = lastMessages();

    // Same language/length hints in the same positions — the constraint
    // only changed the user message, never the system prompt.
    expect(withConstraint[0]?.content).toBe(plainSystem);
    expect(withConstraint.at(-1)?.content).toContain('本轮约束：预算有限');
  });

  it('buildSystemPrompt ordering pins the hint slots the route relies on', () => {
    const prompt = buildSystemPrompt({}, 'zh', 'concise');
    expect(prompt.indexOf('回复语言：始终用简体中文回答')).toBeLessThan(
      prompt.indexOf('请把回复写得更精简，控制在三点以内。'),
    );
  });
});
