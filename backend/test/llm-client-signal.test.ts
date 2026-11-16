import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMClient } from '../src/llm/client.js';

describe('LLMClient abort signal (P165)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
  });

  it('forwards the caller signal to fetch and rejects when it aborts', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.LLM_BASE_URL = 'http://llm.invalid/v1';
    process.env.LLM_MODEL = 'test-model';

    // Upstream fetch that hangs like a stalled provider until aborted.
    const fetchMock = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted', 'AbortError')),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new LLMClient();
    const controller = new AbortController();
    const pending = client.chat([{ role: 'user', content: 'hi' }], [], controller.signal);
    const settled = pending.then(
      () => 'resolved',
      (err: unknown) => (err instanceof Error ? err.name : String(err)),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(controller.signal);

    controller.abort();
    await expect(settled).resolves.toBe('AbortError');
  });

  it('still works without a signal (unchanged call signature)', async () => {
    delete process.env.OPENAI_API_KEY;
    const client = new LLMClient();
    // Unconfigured client takes the mock-response path — no fetch needed.
    const res = await client.chat([{ role: 'user', content: 'hi' }], []);
    expect(res.finishReason).toBe('stop');
  });
});
