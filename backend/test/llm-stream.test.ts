import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { LLMClient } from '../src/llm/client.js';
import type { LLMResponse, Message } from '../src/agent/types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sseLine = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

/**
 * P189 — a stub OpenAI-compatible upstream that speaks SSE for
 * `stream: true` requests and plain JSON otherwise. Scenario is chosen by
 * the last user message: "stream-tool" emits fragmented tool_calls,
 * "stream-length" a truncated finish, "stream-hang" one delta then silence;
 * anything else streams 你好/，/世界 (with one line split across TCP writes).
 */
const capturedBodies: Record<string, unknown>[] = [];
const stubSockets = new Set<Socket>();
let hangSocketClosed = false;

function writeDefaultStream(res: import('node:http').ServerResponse): void {
  // The first JSON line is deliberately split mid-token across two writes.
  const parts = [
    'data: {"choices":[{"delta":{"content":"你',
    '好"}}]}\n\ndata: {"choices":[{"delta":{"content":"，"}}]}\n',
    `\ndata: ${JSON.stringify({
      choices: [{ delta: { content: '世界' } }],
      usage: { prompt_tokens: 5, completion_tokens: 7 },
    })}\n\n`,
    'data: [DONE]\n\n',
  ];
  let i = 0;
  const tick = () => {
    if (i >= parts.length) {
      res.end();
      return;
    }
    res.write(parts[i++]);
    setTimeout(tick, 5);
  };
  tick();
}

function writeToolCallStream(res: import('node:http').ServerResponse): void {
  res.write(
    sseLine({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call-1',
                function: {
                  name: 'plan_date',
                  arguments: '{"interests":["咖啡","散步"],"budg',
                },
              },
            ],
          },
        },
      ],
    }),
  );
  res.write(
    sseLine({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, function: { arguments: 'et":"low"}' } }],
          },
        },
      ],
    }),
  );
  res.write(sseLine({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
  res.end('data: [DONE]\n\n');
}

function writeLengthStream(res: import('node:http').ServerResponse): void {
  res.write(sseLine({ choices: [{ delta: { content: '半截回复' } }] }));
  res.write(sseLine({ choices: [{ delta: {}, finish_reason: 'length' }] }));
  res.end('data: [DONE]\n\n');
}

function writeHangStream(res: import('node:http').ServerResponse): void {
  res.write(sseLine({ choices: [{ delta: { content: 'partial' } }] }));
  res.on('close', () => {
    hangSocketClosed = true;
  });
  // Never ends: simulates a stalled provider mid-stream.
}

const stub = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      /* malformed body keeps {} */
    }
    capturedBodies.push(parsed);

    if (parsed.stream === true) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      const messages = parsed.messages as Array<{ content?: string }> | undefined;
      const text = String(messages?.at(-1)?.content ?? '');
      if (text.includes('stream-tool')) return writeToolCallStream(res);
      if (text.includes('stream-length')) return writeLengthStream(res);
      if (text.includes('stream-hang')) return writeHangStream(res);
      return writeDefaultStream(res);
    }

    // Non-streamed request: the pre-P189 one-shot JSON completion.
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        choices: [
          { message: { content: '你好，世界', tool_calls: [] }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 7 },
      }),
    );
  });
});
stub.on('connection', (socket) => {
  stubSockets.add(socket);
  socket.on('close', () => stubSockets.delete(socket));
});
await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
const stubPort = (stub.address() as AddressInfo).port;

// Env must be set before the app module loads: its harness constructs the
// real LLMClient at import time and captures these values. A generous
// deadline keeps timeouts out of every case — the abort test relies on the
// caller signal winning, not the clock.
process.env.OPENAI_API_KEY = 'test-key';
process.env.LLM_BASE_URL = `http://127.0.0.1:${stubPort}/v1`;
process.env.LLM_MODEL = 'test-model';
process.env.LLM_TIMEOUT_MS = '10000';

const { createApp } = await import('../src/routes/app.js');

const userMessage = (content: string): Message[] => [{ role: 'user', content }];

async function drain(stream: AsyncGenerator<string, LLMResponse, unknown>) {
  const deltas: string[] = [];
  let step = await stream.next();
  while (!step.done) {
    deltas.push(step.value);
    step = await stream.next();
  }
  return { deltas, response: step.value };
}

// File-scope cleanup: env stays set for every describe below — the app-level
// test also constructs LLMClient instances that must reach the stub.
afterAll(async () => {
  for (const socket of stubSockets) socket.destroy();
  await new Promise<void>((resolve) => stub.close(() => resolve()));
  delete process.env.OPENAI_API_KEY;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_TIMEOUT_MS;
});

describe('LLMClient.chatStream (P189)', () => {
  it('yields 你好/，/世界 as three independent increments, then returns the assembled response', async () => {
    const client = new LLMClient();
    const { deltas, response } = await drain(
      client.chatStream(userMessage('打个招呼'), []),
    );

    expect(deltas).toEqual(['你好', '，', '世界']);
    expect(response.content).toBe('你好，世界');
    expect(response.finishReason).toBe('stop');
    expect(response.toolCalls).toEqual([]);
    expect(response.usage).toEqual({ promptTokens: 5, completionTokens: 7 });
    expect(capturedBodies.at(-1)?.stream).toBe(true);
  });

  it('reassembles fragmented tool_calls by index into one complete call', async () => {
    const client = new LLMClient();
    const { deltas, response } = await drain(
      client.chatStream(userMessage('stream-tool'), []),
    );

    expect(deltas).toEqual([]);
    expect(response.finishReason).toBe('tool_calls');
    expect(response.content).toBeNull();
    expect(response.toolCalls).toEqual([
      {
        id: 'call-1',
        name: 'plan_date',
        arguments: { interests: ['咖啡', '散步'], budget: 'low' },
      },
    ]);
  });

  it("reports finish_reason 'length' faithfully instead of collapsing to 'stop'", async () => {
    const client = new LLMClient();
    const { deltas, response } = await drain(
      client.chatStream(userMessage('stream-length'), []),
    );

    expect(deltas).toEqual(['半截回复']);
    expect(response.content).toBe('半截回复');
    expect(response.finishReason).toBe('length');
  });

  it('stops reading immediately when the caller aborts mid-stream', async () => {
    hangSocketClosed = false;
    const client = new LLMClient();
    const controller = new AbortController();
    const stream = client.chatStream(userMessage('stream-hang'), [], controller.signal);

    const first = await stream.next();
    expect(first.done).toBe(false);
    expect(first.value).toBe('partial');

    const pending = stream.next();
    const startedAt = Date.now();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    // Well under the armed 10s deadline — the abort, not the clock, ended it.
    expect(Date.now() - startedAt).toBeLessThan(2000);

    // The aborted fetch tears the upstream socket down.
    for (let i = 0; i < 100 && !hangSocketClosed; i++) await sleep(10);
    expect(hangSocketClosed).toBe(true);
  });
});

describe('/api/chat non-streaming result (P189)', () => {
  it('is byte-identical to what the pre-stream path produced', async () => {
    const app = createApp();
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const addr = server.address() as AddressInfo;

      // Baseline: the unchanged chat() one-shot path on the same stub.
      const client = new LLMClient();
      const baseline = await client.chat(userMessage('打个招呼'), []);
      const lastBody = capturedBodies.at(-1);
      expect(lastBody).toBeDefined();
      expect(lastBody && 'stream' in lastBody).toBe(false);
      expect(baseline.content).toBe('你好，世界');

      const res = await fetch(`http://127.0.0.1:${addr.port}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: '打个招呼' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        reply: string;
        language: string;
        meta?: { tokens?: number; latencyMs?: number };
      };

      // Same upstream scenario on both paths → the reply bytes are identical.
      expect(body.reply).toBe(baseline.content);
      expect(body.reply).toBe('你好，世界');
      expect(body.language).toBe('auto');
      expect(body.meta).toMatchObject({ tokens: 12 });
      // The harness reached the same reply through the streamed request.
      expect(capturedBodies.at(-1)?.stream).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
