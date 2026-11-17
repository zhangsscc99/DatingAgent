import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, LLMResponse, ToolDefinition } from '../src/agent/types.js';
import { toolRegistry } from '../src/tools/registry.js';

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

const { AgentHarness, createSession, toolProgressHeartbeatMs, TOOL_PROGRESS_HEARTBEAT_MS_DEFAULT } =
  await import('../src/agent/harness.js');

function response(partial: Partial<LLMResponse>): LLMResponse {
  return { content: null, toolCalls: [], finishReason: 'stop', ...partial };
}

async function collect(harness: InstanceType<typeof AgentHarness>, message: string) {
  const context = createSession({}, 'auto');
  const events: AgentEvent[] = [];
  for await (const event of harness.run(message, context)) events.push(event);
  return { events, context };
}

const progressEvents = (events: AgentEvent[]) =>
  events.filter((e) => e.type === 'tool_progress');

const adviceCall = () =>
  response({
    toolCalls: [
      {
        id: 'call-1',
        name: 'get_relationship_advice',
        arguments: { question: '如何沟通' },
      },
    ],
    finishReason: 'tool_calls',
  });

beforeEach(() => {
  chatMock.mockReset();
});

afterEach(() => {
  delete process.env.TOOL_PROGRESS_HEARTBEAT_MS;
});

describe('P231 · tool-phase progress events', () => {
  it('emits a progress event naming the tool while it executes, and a summarizing one after', async () => {
    chatMock
      .mockResolvedValueOnce(adviceCall())
      .mockResolvedValueOnce(response({ content: '这是建议。' }));

    const { events } = await collect(new AgentHarness(), '给我点建议');
    const types = events.map((e) => e.type);
    const startIdx = types.indexOf('tool_start');
    const endIdx = types.indexOf('tool_end');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThan(startIdx);

    // During tool execution at least one progress event carries the tool name.
    const during = progressEvents(events.slice(startIdx, endIdx));
    expect(during.length).toBeGreaterThanOrEqual(1);
    const first = during[0].data as { name: string; phase: string; elapsedMs: number };
    expect(first.name).toBe('get_relationship_advice');
    expect(first.phase).toBe('calling');
    expect(first.elapsedMs).toBe(0);

    // The post-tool wait is covered too: a 'summarizing' event naming the
    // tool lands between tool_end and the final message.
    const afterEnd = events.slice(endIdx + 1);
    const summarizing = afterEnd.find(
      (e) => e.type === 'tool_progress' && (e.data as { phase?: string }).phase === 'summarizing',
    );
    expect(summarizing).toBeDefined();
    expect((summarizing!.data as { name: string }).name).toBe('get_relationship_advice');
    const messageIdx = types.indexOf('message');
    expect(types.lastIndexOf('tool_progress')).toBeLessThan(messageIdx);
  });

  it('heartbeats with a growing elapsedMs while a slow tool handler runs', async () => {
    process.env.TOOL_PROGRESS_HEARTBEAT_MS = '15';
    const slowTool: ToolDefinition = {
      name: 'slow_probe_tool',
      description: 'test-only slow tool',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        await new Promise((r) => setTimeout(r, 120));
        return JSON.stringify({ ok: true });
      },
    };
    toolRegistry.push(slowTool);
    try {
      chatMock
        .mockResolvedValueOnce(
          response({
            toolCalls: [{ id: 'c1', name: 'slow_probe_tool', arguments: {} }],
            finishReason: 'tool_calls',
          }),
        )
        .mockResolvedValueOnce(response({ content: '完成。' }));

      const { events } = await collect(new AgentHarness(), '触发慢工具');
      const calling = progressEvents(events).filter(
        (e) =>
          (e.data as { name?: string }).name === 'slow_probe_tool' &&
          (e.data as { phase?: string }).phase === 'calling',
      );
      // Immediate event + at least one heartbeat across the ~120 ms handler.
      expect(calling.length).toBeGreaterThanOrEqual(2);
      const elapsed = calling.map((e) => (e.data as { elapsedMs: number }).elapsedMs);
      expect(elapsed[0]).toBe(0);
      expect(elapsed.at(-1)!).toBeGreaterThan(0);
      for (let i = 1; i < elapsed.length; i++) {
        expect(elapsed[i]).toBeGreaterThanOrEqual(elapsed[i - 1]);
      }
    } finally {
      toolRegistry.splice(toolRegistry.indexOf(slowTool), 1);
    }
  });

  it('emits no tool_progress on a plain no-tool turn', async () => {
    chatMock.mockResolvedValueOnce(response({ content: '你好呀。' }));
    const { events } = await collect(new AgentHarness(), '你好');
    expect(progressEvents(events).length).toBe(0);
  });

  it('heartbeat interval is env-tunable and defaults to 5 s', () => {
    expect(toolProgressHeartbeatMs({})).toBe(TOOL_PROGRESS_HEARTBEAT_MS_DEFAULT);
    expect(TOOL_PROGRESS_HEARTBEAT_MS_DEFAULT).toBe(5_000);
    expect(toolProgressHeartbeatMs({ TOOL_PROGRESS_HEARTBEAT_MS: 'abc' })).toBe(5_000);
    expect(toolProgressHeartbeatMs({ TOOL_PROGRESS_HEARTBEAT_MS: '0' })).toBe(5_000);
    expect(toolProgressHeartbeatMs({ TOOL_PROGRESS_HEARTBEAT_MS: '250' })).toBe(250);
  });
});
