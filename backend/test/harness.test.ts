import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, LLMResponse, Message } from '../src/agent/types.js';

/** Replace the LLM client so the loop runs deterministically and offline. */
const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock('../src/llm/client.js', () => ({
  LLMClient: class {
    chat = chatMock;
  },
  LLMTimeoutError: class LLMTimeoutError extends Error {
    constructor() {
      super('mock timeout');
      this.name = 'LLMTimeoutError';
    }
  },
}));

const { AgentHarness, createSession } = await import('../src/agent/harness.js');

function response(partial: Partial<LLMResponse>): LLMResponse {
  return { content: null, toolCalls: [], finishReason: 'stop', ...partial };
}

async function collect(harness: InstanceType<typeof AgentHarness>, message: string) {
  const context = createSession({}, 'auto');
  const events: AgentEvent[] = [];
  for await (const event of harness.run(message, context)) events.push(event);
  return { events, context };
}

beforeEach(() => {
  chatMock.mockReset();
});

describe('agent harness tool loop', () => {
  it('dispatches a tool call and feeds the result back to the model', async () => {
    chatMock
      .mockResolvedValueOnce(
        response({
          toolCalls: [
            {
              id: 'call-1',
              name: 'analyze_profile',
              arguments: { bio: '喜欢徒步和手冲咖啡，最近在学摄影。' },
            },
          ],
          finishReason: 'tool_calls',
        }),
      )
      .mockResolvedValueOnce(response({ content: '这是你的资料分析。' }));

    const { events } = await collect(new AgentHarness(), '帮我看看资料');

    expect(events.map((e) => e.type)).toEqual([
      'thinking',
      'tool_start',
      'tool_end',
      'message',
      'done',
    ]);

    const start = events[1].data as { name: string };
    expect(start.name).toBe('analyze_profile');

    const end = events[2].data as { name: string; result: { score: number } };
    expect(end.name).toBe('analyze_profile');
    expect(typeof end.result.score).toBe('number');

    expect(chatMock).toHaveBeenCalledTimes(2);

    // Second turn must carry the tool result with its matching tool_call id.
    const secondMessages = chatMock.mock.calls[1][0] as Message[];
    const toolMessage = secondMessages.find((m) => m.role === 'tool');
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.toolCallId).toBe('call-1');
    expect(toolMessage?.toolName).toBe('analyze_profile');
    expect(() => JSON.parse(toolMessage!.content) as unknown).not.toThrow();

    const final = events[3].data as { content: string; role: string };
    expect(final.content).toBe('这是你的资料分析。');
  });

  it('emits an error for an unknown tool and keeps the loop alive', async () => {
    chatMock
      .mockResolvedValueOnce(
        response({
          toolCalls: [{ id: 'call-x', name: 'not_a_tool', arguments: {} }],
          finishReason: 'tool_calls',
        }),
      )
      .mockResolvedValueOnce(response({ content: '降级后的回答。' }));

    const { events } = await collect(new AgentHarness(), '触发未知工具');

    const error = events.find((e) => e.type === 'error');
    expect(error).toBeDefined();
    expect((error!.data as { message: string }).message).toBe('Unknown tool: not_a_tool');
    expect(events.some((e) => e.type === 'tool_start')).toBe(false);
    expect(events.at(-1)?.type).toBe('done');
    expect(events.some((e) => e.type === 'message')).toBe(true);
  });

  it('persists the exchange into conversation history exactly once', async () => {
    chatMock.mockResolvedValueOnce(response({ content: '你好呀。' }));

    const { context } = await collect(new AgentHarness(), '你好');

    expect(context.conversationHistory).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好呀。' },
    ]);
  });
});
