import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSystemPrompt, parseReplyLength } from '../src/agent/harness.js';

/**
 * P196 — reply-length hint plumbing. 默认 sends no field and builds the
 * unmodified system prompt; 详细/精简 append exactly one sentence. The route
 * block proves the optional field end-to-end against a stub upstream that
 * captures the system message the harness sends.
 */

describe('P196 · buildSystemPrompt length directive', () => {
  const profile = { name: '小林', age: 28 };

  it('默认 omits the hint — prompt identical to the two-argument call', () => {
    const base = buildSystemPrompt(profile, 'auto');
    expect(buildSystemPrompt(profile, 'auto', undefined)).toBe(base);
    expect(base).not.toContain('更精简');
    expect(base).not.toContain('更详细');
    expect(base).not.toContain('三点以内');
  });

  it('详细 appends the detailed-hint sentence', () => {
    const prompt = buildSystemPrompt(profile, 'auto', 'detailed');
    expect(prompt).toContain('请把回复写得更详细一些，给出更完整的步骤和例子。');
    expect(prompt.endsWith('请把回复写得更详细一些，给出更完整的步骤和例子。')).toBe(true);
  });

  it('精简 appends the concise-hint sentence', () => {
    const prompt = buildSystemPrompt(profile, 'auto', 'concise');
    expect(prompt).toContain('请把回复写得更精简，控制在三点以内。');
  });

  it('parseReplyLength accepts only the two hint values', () => {
    expect(parseReplyLength('concise')).toBe('concise');
    expect(parseReplyLength('detailed')).toBe('detailed');
    expect(parseReplyLength('default')).toBeUndefined();
    expect(parseReplyLength('bogus')).toBeUndefined();
    expect(parseReplyLength('')).toBeUndefined();
    expect(parseReplyLength(undefined)).toBeUndefined();
    expect(parseReplyLength(3)).toBeUndefined();
  });
});

describe('P196 · /api/chat replyLength end-to-end', () => {
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
        // The harness always streams upstream (P189): answer a minimal SSE turn.
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

  const lastSystemPrompt = (): string => {
    const messages = capturedBodies.at(-1)?.messages as
      | Array<{ role?: string; content?: string }>
      | undefined;
    return messages?.[0]?.content ?? '';
  };

  it('omits the hint on the default path (no field sent)', async () => {
    const res = await postChat({ message: '默认长度' });
    expect(res.status).toBe(200);
    await res.text();
    expect(lastSystemPrompt()).not.toContain('更精简');
    expect(lastSystemPrompt()).not.toContain('更详细');
  });

  it('appends the detailed sentence when replyLength=detailed', async () => {
    const res = await postChat({ message: '详细一点', replyLength: 'detailed' });
    expect(res.status).toBe(200);
    await res.text();
    expect(lastSystemPrompt()).toContain('请把回复写得更详细一些，给出更完整的步骤和例子。');
  });

  it('appends the concise sentence when replyLength=concise', async () => {
    const res = await postChat({ message: '精简一点', replyLength: 'concise' });
    expect(res.status).toBe(200);
    await res.text();
    expect(lastSystemPrompt()).toContain('请把回复写得更精简，控制在三点以内。');
  });

  it('rejects an invalid replyLength on both chat endpoints', async () => {
    const streamRes = await postChat({ message: 'x', replyLength: 'bogus' });
    expect(streamRes.status).toBe(400);
    const body = (await streamRes.json()) as { error?: string };
    expect(body.error).toContain('replyLength');

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'x', replyLength: 'verbose' }),
    });
    expect(res.status).toBe(400);
  });
});
