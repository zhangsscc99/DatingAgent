import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMClient } from '../src/llm/client.js';
import type { Message } from '../src/agent/types.js';

/**
 * P257 — requestBody() must send `enable_thinking: false` plus a positive
 * integer `max_tokens` (default 1600) so a tool turn stops paying the
 * thinking tax twice. Env restores/overrides both via the config layer.
 */
const capturedBodies: Record<string, unknown>[] = [];

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      capturedBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: 'ok', tool_calls: [] }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }),
  );
}

const messages: Message[] = [{ role: 'user', content: '你好' }];

afterEach(() => {
  vi.unstubAllGlobals();
  capturedBodies.length = 0;
  delete process.env.OPENAI_API_KEY;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_ENABLE_THINKING;
  delete process.env.LLM_MAX_TOKENS;
});

describe('LLM request body thinking/max_tokens (P257)', () => {
  it('sends enable_thinking=false and a positive integer max_tokens by default', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    stubFetch();

    const client = new LLMClient();
    await client.chat(messages, []);

    const body = capturedBodies.at(-1);
    expect(body?.enable_thinking).toBe(false);
    expect(Number.isInteger(body?.max_tokens)).toBe(true);
    expect(body?.max_tokens).toBe(1600);
  });

  it('chatStream() carries the same fields on the streamed request', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    stubFetch();

    const client = new LLMClient();
    const stream = client.chatStream(messages, []);
    while (!(await stream.next()).done) {
      /* drain */
    }

    const body = capturedBodies.at(-1);
    expect(body?.stream).toBe(true);
    expect(body?.enable_thinking).toBe(false);
    expect(body?.max_tokens).toBe(1600);
  });

  it('LLM_ENABLE_THINKING=1 or true restores thinking; anything else keeps it off', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    stubFetch();

    for (const raw of ['1', 'true']) {
      process.env.LLM_ENABLE_THINKING = raw;
      await new LLMClient().chat(messages, []);
      expect(capturedBodies.at(-1)?.enable_thinking).toBe(true);
    }

    for (const raw of ['0', 'yes', 'off']) {
      process.env.LLM_ENABLE_THINKING = raw;
      await new LLMClient().chat(messages, []);
      expect(capturedBodies.at(-1)?.enable_thinking).toBe(false);
    }
  });

  it('LLM_MAX_TOKENS override is honoured; invalid values fall back to 1600', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    stubFetch();

    process.env.LLM_MAX_TOKENS = '3200';
    await new LLMClient().chat(messages, []);
    expect(capturedBodies.at(-1)?.max_tokens).toBe(3200);

    for (const raw of ['abc', '0', '-5']) {
      process.env.LLM_MAX_TOKENS = raw;
      await new LLMClient().chat(messages, []);
      expect(capturedBodies.at(-1)?.max_tokens).toBe(1600);
    }
  });
});
