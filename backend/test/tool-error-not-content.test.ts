import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, LLMResponse, Message } from '../src/agent/types.js';

/**
 * P397 — measured live at walk-1795122630: a hallucinated `get_date` call
 * surfaced as `出错了：Unknown tool: get_date` written into the bubble body,
 * twice (top card + bubble), while the tool record still claimed
 * 「已使用 1 个工具 · 完成」. These tests pin the contract:
 *
 *  ① the reply content (`reply.content` / the `message` event) never
 *    carries internal failure text — no raw exception, no tool name;
 *  ② every tool failure surfaces as a structured `error` event with the
 *    stable machine code `tool_unavailable`;
 *  ③ nothing about the failure is appended to the persisted history.
 */
const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock('../src/llm/client.js', () => ({
  LLMClient: class {
    chat = chatMock;
    // P189: the turn loop streams through chatStream; delegate to the same
    // mock so a mocked LLMResponse comes back with no delta increments.
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

const { AgentHarness, createSession } = await import('../src/agent/harness.js');
const { getTool } = await import('../src/tools/registry.js');

function response(partial: Partial<LLMResponse>): LLMResponse {
  return { content: null, toolCalls: [], finishReason: 'stop', ...partial };
}

/** The exact leak measured live — raw name or raw exception must never surface. */
const LEAK = /Unknown tool|get_date/;

async function collect(message: string) {
  const context = createSession({}, 'auto');
  const events: AgentEvent[] = [];
  for await (const event of new AgentHarness().run(message, context)) events.push(event);
  return { events, context };
}

beforeEach(() => {
  chatMock.mockReset();
});

describe('P397 · tool errors surface as coded events, never as reply text', () => {
  it('a hallucinated tool name yields error.code tool_unavailable and a clean reply', async () => {
    chatMock
      .mockResolvedValueOnce(
        response({
          toolCalls: [{ id: 'call-1', name: 'get_date', arguments: {} }],
          finishReason: 'tool_calls',
        }),
      )
      .mockResolvedValueOnce(response({ content: '降级后的正常回答。' }));

    const { events, context } = await collect('我和她最近聊天越来越短');

    // ① the reply the client renders carries none of the internal text.
    const reply = events.filter((e) => e.type === 'message').at(-1);
    expect(reply).toBeDefined();
    const replyContent = (reply!.data as { content: string }).content;
    expect(replyContent).toBe('降级后的正常回答。');
    expect(replyContent).not.toMatch(LEAK);

    // ② the failure surfaced exactly once, as a structured error with a
    //    stable machine code and a localized message.
    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    const errorData = errors[0].data as { message: string; code: string };
    expect(errorData.code).toBe('tool_unavailable');
    expect(errorData.message).toContain('不可用');
    expect(errorData.message).not.toMatch(LEAK);

    // The tool record settled the call as failed — never 「· 完成」.
    const toolEnds = events.filter((e) => e.type === 'tool_end');
    expect(toolEnds).toHaveLength(1);
    expect((toolEnds[0].data as { status?: string }).status).toBe('failed');
    expect(events.some((e) => e.type === 'tool_start')).toBe(false);

    // The hallucinated name does not leak into the reply-meta channel either.
    const done = events.at(-1);
    expect(done?.type).toBe('done');
    expect((done!.data as { tool?: string }).tool).toBeUndefined();

    // ③ persisted history holds only the clean exchange — no error text,
    //    no tool name in any appended message.
    expect(context.conversationHistory).toEqual([
      { role: 'user', content: '我和她最近聊天越来越短' },
      { role: 'assistant', content: '降级后的正常回答。' },
    ]);
    for (const m of context.conversationHistory) {
      expect(m.content).not.toMatch(LEAK);
    }
  });

  it('tells the model the call failed through a sanitized tool message', async () => {
    chatMock
      .mockResolvedValueOnce(
        response({
          toolCalls: [{ id: 'call-1', name: 'get_date', arguments: {} }],
          finishReason: 'tool_calls',
        }),
      )
      .mockResolvedValueOnce(response({ content: '好的。' }));

    await collect('触发未知工具');

    // The transcript handed back to the model records the call as failed —
    // a machine marker, not prose it could echo back to the user.
    const secondMessages = chatMock.mock.calls[1][0] as Message[];
    const toolMsg = secondMessages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.toolCallId).toBe('call-1');
    expect(JSON.parse(toolMsg!.content)).toEqual({ error: 'tool_unavailable' });
  });

  it('chatWithMeta returns the recovered reply, never the error text', async () => {
    chatMock
      .mockResolvedValueOnce(
        response({
          toolCalls: [{ id: 'call-1', name: 'get_date', arguments: {} }],
          finishReason: 'tool_calls',
        }),
      )
      .mockResolvedValueOnce(response({ content: '正常回复在此。' }));

    const context = createSession({}, 'auto');
    const events: AgentEvent[] = [];
    const { content } = await new AgentHarness().chatWithMeta(
      '你好',
      context,
      undefined,
      undefined,
      (e) => events.push(e),
    );

    expect(content).toBe('正常回复在此。');
    expect(content).not.toMatch(LEAK);
    expect(
      events.some(
        (e) =>
          e.type === 'error' &&
          (e.data as { code?: string }).code === 'tool_unavailable',
      ),
    ).toBe(true);
  });

  it('a thrown tool handler surfaces the same coded error, never the exception', async () => {
    const tool = getTool('plan_date')!;
    const original = tool.execute;
    tool.execute = () => Promise.reject(new Error('secret internal failure'));
    try {
      chatMock
        .mockResolvedValueOnce(
          response({
            toolCalls: [
              { id: 'call-2', name: 'plan_date', arguments: { interests: ['咖啡'] } },
            ],
            finishReason: 'tool_calls',
          }),
        )
        .mockResolvedValueOnce(response({ content: '换个方式回答。' }));

      const { events, context } = await collect('帮我安排一次约会');

      const error = events.find((e) => e.type === 'error');
      expect(error).toBeDefined();
      const errorData = error!.data as { message: string; code: string };
      expect(errorData.code).toBe('tool_unavailable');
      expect(errorData.message).not.toContain('secret internal failure');

      const toolEnd = events.find((e) => e.type === 'tool_end');
      expect((toolEnd!.data as { status?: string }).status).toBe('failed');

      const reply = events.filter((e) => e.type === 'message').at(-1);
      expect((reply!.data as { content: string }).content).toBe('换个方式回答。');
      for (const m of context.conversationHistory) {
        expect(m.content).not.toContain('secret internal failure');
      }
    } finally {
      tool.execute = original;
    }
  });

  it('an unrecovered tool loop never names the failed call in the fallback reply', async () => {
    // Every turn asks for the same unavailable tool; the run ends on the
    // deterministic fallback, which must not claim it 「调用了 get_date」.
    chatMock.mockResolvedValue(
      response({
        toolCalls: [{ id: 'call-x', name: 'get_date', arguments: {} }],
        finishReason: 'tool_calls',
      }),
    );

    const { events } = await collect('又触发未知工具');

    const reply = events.filter((e) => e.type === 'message').at(-1);
    expect(reply).toBeDefined();
    expect((reply!.data as { content: string }).content).not.toMatch(LEAK);
  });
});
