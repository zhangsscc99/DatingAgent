import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, LLMResponse, Message } from '../src/agent/types.js';

/** Replace the LLM client so the tool loop runs deterministically and offline. */
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

const { AgentHarness, createSession, toolCallBudgetFromEnv, TOOL_CALL_BUDGET_DEFAULT } =
  await import('../src/agent/harness.js');

function response(partial: Partial<LLMResponse>): LLMResponse {
  return { content: null, toolCalls: [], finishReason: 'stop', ...partial };
}

/** A model that keeps demanding the same tool on every turn. */
const alwaysCallsTool = () =>
  response({
    toolCalls: [
      {
        id: 'call-always',
        name: 'get_relationship_advice',
        arguments: { question: '继续' },
      },
    ],
    finishReason: 'tool_calls',
  });

async function collect(harness: InstanceType<typeof AgentHarness>, message: string) {
  const context = createSession({}, 'auto');
  const events: AgentEvent[] = [];
  for await (const event of harness.run(message, context)) events.push(event);
  return { events, context };
}

const toolStarts = (events: AgentEvent[]) => events.filter((e) => e.type === 'tool_start');

beforeEach(() => {
  chatMock.mockReset();
});

afterEach(() => {
  delete process.env.TOOL_CALL_BUDGET;
});

describe('P210 · per-run tool-call budget', () => {
  it('never executes more tool calls than the default budget of 2', async () => {
    chatMock.mockImplementation(async () => alwaysCallsTool());

    const { events } = await collect(new AgentHarness(), '她一直不回我消息');

    expect(toolStarts(events).length).toBeLessThanOrEqual(TOOL_CALL_BUDGET_DEFAULT);
    expect(toolStarts(events).length).toBe(2);

    // The turn after the budget ran out must offer no tools at all.
    const lastCall = chatMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual([]);
    // …and carry the directive telling the model to answer from what it has.
    const lastMessages = lastCall?.[0] as Message[];
    expect(
      lastMessages.some(
        (m) => m.role === 'system' && m.content.includes('不要再调用工具'),
      ),
    ).toBe(true);
  });

  it('still yields a non-empty assistant message when the model never stops asking for tools', async () => {
    chatMock.mockImplementation(async () => alwaysCallsTool());

    const { events } = await collect(new AgentHarness(), '她一直不回我消息');

    const message = events.find((e) => e.type === 'message');
    expect(message).toBeDefined();
    const { content, role } = message!.data as { content: string; role: string };
    expect(role).toBe('assistant');
    expect(content.trim().length).toBeGreaterThan(0);
    expect(events.at(-1)?.type).toBe('done');
    // The deterministic fallback names the tool that actually ran.
    expect(content).toContain('get_relationship_advice');
  });

  it('budget 1 runs one tool, budget 2 runs two', async () => {
    chatMock.mockImplementation(async () => alwaysCallsTool());

    process.env.TOOL_CALL_BUDGET = '1';
    const tight = await collect(new AgentHarness(), '需要建议');
    expect(toolStarts(tight.events).length).toBe(1);

    chatMock.mockClear();

    process.env.TOOL_CALL_BUDGET = '2';
    const loose = await collect(new AgentHarness(), '需要建议');
    expect(toolStarts(loose.events).length).toBe(2);
  });

  it('a multi-call response spends the budget without exceeding it', async () => {
    process.env.TOOL_CALL_BUDGET = '2';
    chatMock
      .mockResolvedValueOnce(
        response({
          toolCalls: [
            { id: 'c1', name: 'get_relationship_advice', arguments: { question: '一' } },
            { id: 'c2', name: 'coach_conversation', arguments: { scenario: '二' } },
            { id: 'c3', name: 'plan_date', arguments: {} },
          ],
          finishReason: 'tool_calls',
        }),
      )
      .mockResolvedValue(response({ content: '综合建议如下。' }));

    const { events } = await collect(new AgentHarness(), '帮我全分析一下');

    expect(toolStarts(events).length).toBe(2);
    const message = events.find((e) => e.type === 'message');
    expect((message!.data as { content: string }).content).toBe('综合建议如下。');
  });

  it('env override clamps to 1..4 and defaults to 2', () => {
    expect(toolCallBudgetFromEnv({})).toBe(2);
    expect(toolCallBudgetFromEnv({ TOOL_CALL_BUDGET: 'abc' })).toBe(2);
    expect(toolCallBudgetFromEnv({ TOOL_CALL_BUDGET: '  ' })).toBe(2);
    expect(toolCallBudgetFromEnv({ TOOL_CALL_BUDGET: '0' })).toBe(1);
    expect(toolCallBudgetFromEnv({ TOOL_CALL_BUDGET: '1' })).toBe(1);
    expect(toolCallBudgetFromEnv({ TOOL_CALL_BUDGET: '3' })).toBe(3);
    expect(toolCallBudgetFromEnv({ TOOL_CALL_BUDGET: '99' })).toBe(4);
    expect(toolCallBudgetFromEnv({ TOOL_CALL_BUDGET: '2.7' })).toBe(2);
  });

  it('an unrestricted run is untouched: one tool + answer still works', async () => {
    chatMock
      .mockResolvedValueOnce(
        response({
          toolCalls: [
            { id: 'call-1', name: 'get_relationship_advice', arguments: { question: 'q' } },
          ],
          finishReason: 'tool_calls',
        }),
      )
      .mockResolvedValueOnce(response({ content: '这是建议。' }));

    const { events } = await collect(new AgentHarness(), '给我点建议');

    expect(toolStarts(events).length).toBe(1);
    // Second turn still gets the full registry — budget was not spent.
    expect(chatMock.mock.calls[1][1]).not.toEqual([]);
    expect((events.at(-2)!.data as { content: string }).content).toBe('这是建议。');
  });
});
