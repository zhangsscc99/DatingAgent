import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMResponse } from '../src/agent/types.js';
import type { RequestLogLine } from '../src/lib/request-log.js';

/** Replace the LLM client so chat turns run deterministically and offline. */
const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock('../src/llm/client.js', () => ({
  LLMClient: class {
    chat = chatMock;
    // The turn loop streams through chatStream; yield each content
    // character as a delta so firstTokenMs is exercised by real events.
    async *chatStream(...args: unknown[]) {
      const result = (await chatMock(...args)) as LLMResponse;
      if (typeof result.content === 'string') {
        for (const ch of result.content) yield ch;
      }
      return result;
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

function response(partial: Partial<LLMResponse>): LLMResponse {
  return { content: null, toolCalls: [], finishReason: 'stop', ...partial };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseLogLines(lines: string[]): RequestLogLine[] {
  return lines.map((l) => JSON.parse(l) as RequestLogLine);
}

async function postChat(baseUrl: string, path: string, message: string) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  await res.text();
  return res;
}

describe('P300 · chat latency instrumentation', () => {
  const lines: string[] = [];
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    const app = createApp({ requestLogWriter: (line) => lines.push(line) });
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const addr = server.address();
    if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  beforeEach(() => {
    chatMock.mockReset();
    lines.length = 0;
  });

  it('/api/chat/stream logs first-event, first-token and total ms', async () => {
    chatMock.mockResolvedValue(response({ content: '你好，慢慢来。' }));

    const res = await postChat(baseUrl, '/api/chat/stream', '测试首字延迟');
    expect(res.status).toBe(200);
    await sleep(10);

    const line = parseLogLines(lines).find((l) => l.path === '/api/chat/stream');
    expect(line).toBeDefined();
    expect(line!.ms).toBeGreaterThan(0);
    expect(typeof line!.firstEventMs).toBe('number');
    expect(typeof line!.firstTokenMs).toBe('number');
    // First content cannot precede the first SSE event nor postdate the end.
    expect(line!.firstTokenMs!).toBeGreaterThanOrEqual(line!.firstEventMs!);
    expect(line!.firstTokenMs!).toBeLessThanOrEqual(line!.ms);
    // A clean turn executes no tools — the field stays absent, not 0.
    expect(line!.toolCalls).toBeUndefined();
  });

  it('a tool turn records the extra upstream round trip in toolCalls', async () => {
    chatMock
      .mockResolvedValueOnce(
        response({
          toolCalls: [
            { id: 'call-1', name: 'analyze_profile', arguments: { bio: '喜欢徒步' } },
          ],
          finishReason: 'tool_calls',
        }),
      )
      .mockResolvedValueOnce(response({ content: '这是你的资料分析。' }));

    const res = await postChat(baseUrl, '/api/chat/stream', '帮我看看资料');
    expect(res.status).toBe(200);
    await sleep(10);

    const line = parseLogLines(lines).find((l) => l.path === '/api/chat/stream');
    expect(line).toBeDefined();
    expect(line!.toolCalls).toBe(1);
    expect(typeof line!.firstTokenMs).toBe('number');
    expect(line!.firstTokenMs!).toBeLessThanOrEqual(line!.ms);
  });

  it('/api/chat logs first-token and total ms on the buffered path', async () => {
    chatMock.mockResolvedValue(response({ content: '缓冲回复也计时。' }));

    const res = await postChat(baseUrl, '/api/chat', '测试非流式计时');
    expect(res.status).toBe(200);
    await sleep(10);

    const line = parseLogLines(lines).find(
      (l) => l.path === '/api/chat' && l.method === 'POST',
    );
    expect(line).toBeDefined();
    expect(line!.ms).toBeGreaterThan(0);
    expect(typeof line!.firstTokenMs).toBe('number');
    expect(line!.firstTokenMs!).toBeLessThanOrEqual(line!.ms);
  });
});
