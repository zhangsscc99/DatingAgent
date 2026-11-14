import { describe, expect, it } from 'vitest';
import { getTool, toolRegistry } from '../src/tools/registry.js';
import type { AgentContext } from '../src/agent/types.js';

const ctx: AgentContext = {
  sessionId: 'test-session',
  profile: {},
  conversationHistory: [],
  language: 'auto',
};

describe('tool registry', () => {
  it('looks tools up by name', () => {
    const tool = getTool('analyze_profile');
    expect(tool).toBeDefined();
    expect(tool?.name).toBe('analyze_profile');
  });

  it('returns undefined for an unknown tool instead of throwing', () => {
    expect(getTool('definitely_not_a_tool')).toBeUndefined();
    expect(getTool('')).toBeUndefined();
  });

  it('registers unique tool names with callable executors', () => {
    const names = toolRegistry.map((t) => t.name);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of toolRegistry) {
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('executes tools with minimal args and returns parseable JSON', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['analyze_profile', { bio: '喜欢徒步和手冲咖啡' }],
      ['coach_conversation', { scenario: '对方说周末去爬山了' }],
      ['plan_date', { interests: ['咖啡'] }],
      ['check_compatibility', { traits: '一个外向一个内向' }],
      ['get_relationship_advice', { question: '怎么开口约第二次见面？' }],
    ];

    for (const [name, args] of cases) {
      const tool = getTool(name);
      const raw = await tool!.execute(args, ctx);
      expect(() => JSON.parse(raw) as unknown).not.toThrow();
    }
  });
});
