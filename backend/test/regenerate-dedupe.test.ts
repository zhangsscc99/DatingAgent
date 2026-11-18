import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, LLMResponse, Message } from '../src/agent/types.js';
import {
  matchesAnyReply,
  normalizeReplyText,
  parsePreviousReplies,
} from '../src/lib/reply-dedupe.js';
import { buildAvoidRepeatDirective } from '../src/agent/harness.js';

/**
 * P284 — 「换一个」 dedupe on the backend: the regenerate request carries the
 * last shown reply versions, the system prompt forbids repeating them, and a
 * reply that still echoes one gets exactly one server-side retry before the
 * result falls through to the frontend's honest retry line.
 */

const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock('../src/llm/client.js', () => ({
  LLMClient: class {
    chat = chatMock;
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

function response(partial: Partial<LLMResponse>): LLMResponse {
  return { content: null, toolCalls: [], finishReason: 'stop', ...partial };
}

const PREV = '明天见面跟着展厅走就行，不用背话题。';
const FRESH = '顺着她昨天提到的展览聊，问她最想看哪个展厅，再顺势约时间。';

async function collect(
  harness: InstanceType<typeof AgentHarness>,
  message: string,
  previousReplies?: string[],
) {
  const context = createSession({}, 'auto');
  const events: AgentEvent[] = [];
  for await (const event of harness.run(message, context, undefined, undefined, previousReplies)) {
    events.push(event);
  }
  return { events, context };
}

beforeEach(() => {
  chatMock.mockReset();
});

describe('P284 · reply dedupe helpers', () => {
  it('normalizeReplyText strips whitespace so re-wrapped repeats match', () => {
    expect(normalizeReplyText('  甲。\n乙。 ')).toBe('甲。乙。');
    expect(matchesAnyReply(`  ${PREV} `, [PREV])).toBe(true);
    expect(matchesAnyReply(FRESH, [PREV])).toBe(false);
  });

  it('parsePreviousReplies accepts string arrays, caps at three, trims blanks', () => {
    expect(parsePreviousReplies(undefined)).toBeUndefined();
    expect(parsePreviousReplies([])).toBeUndefined();
    expect(parsePreviousReplies(['  ', ''])).toBeUndefined();
    expect(parsePreviousReplies([' a ', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
    expect(parsePreviousReplies('not-an-array')).toBeNull();
    expect(parsePreviousReplies([1, 'a'])).toBeNull();
  });

  it('a reply that parrots the shown versions back verbatim counts as a repeat', () => {
    const parrot = `版本1：${PREV}\n\n版本2：${FRESH}`;
    expect(matchesAnyReply(parrot, [PREV, FRESH])).toBe(true);
    // A fresh reply that only shares a few opening words is not a repeat.
    expect(matchesAnyReply(`新写法：${PREV.slice(0, 6)}，换个角度接着说。`, [PREV])).toBe(false);
  });

  it('buildAvoidRepeatDirective lists the shown versions and forbids repeating them', () => {
    expect(buildAvoidRepeatDirective([])).toBe('');
    const directive = buildAvoidRepeatDirective([PREV, '另一版。']);
    expect(directive).toContain(PREV);
    expect(directive).toContain('版本1');
    expect(directive).toContain('版本2');
    expect(directive).toContain('不得与以上任何一版有相同句子');
    expect(directive).toContain('不少于两句话');
  });
});

describe('P284 · harness dedupe retry', () => {
  it('retries once when the regenerated reply echoes a shown version', async () => {
    chatMock
      .mockResolvedValueOnce(response({ content: PREV }))
      .mockResolvedValueOnce(response({ content: FRESH }));

    const { events, context } = await collect(new AgentHarness(), '嗯。明天见面聊啥。', [PREV]);

    expect(chatMock).toHaveBeenCalledTimes(2);
    // A fresh thinking beat separates the echoed draft from the retry stream.
    expect(events.filter((e) => e.type === 'thinking')).toHaveLength(2);
    const finalMessage = [...events].reverse().find((e) => e.type === 'message');
    expect((finalMessage!.data as { content: string }).content).toBe(FRESH);
    // History records the replacement, never the rejected duplicate.
    expect(context.conversationHistory.at(-1)).toEqual({
      role: 'assistant',
      content: FRESH,
    });
    // The retry turn carries a sharpened no-repeat directive.
    const retryMessages = chatMock.mock.calls[1][0] as Message[];
    expect(
      retryMessages.some(
        (m) => m.role === 'system' && m.content.includes('完全相同'),
      ),
    ).toBe(true);
  });

  it('stops after one retry — a stubborn repeat falls through to the client', async () => {
    chatMock
      .mockResolvedValueOnce(response({ content: PREV }))
      .mockResolvedValueOnce(response({ content: PREV }));

    const { events } = await collect(new AgentHarness(), '嗯。明天见面聊啥。', [PREV]);

    expect(chatMock).toHaveBeenCalledTimes(2);
    const finalMessage = [...events].reverse().find((e) => e.type === 'message');
    expect((finalMessage!.data as { content: string }).content).toBe(PREV);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('whitespace-only differences count as the same reply', async () => {
    chatMock
      .mockResolvedValueOnce(response({ content: ` ${PREV}\n` }))
      .mockResolvedValueOnce(response({ content: FRESH }));

    const { events } = await collect(new AgentHarness(), '嗯。明天见面聊啥。', [PREV]);

    expect(chatMock).toHaveBeenCalledTimes(2);
    const finalMessage = [...events].reverse().find((e) => e.type === 'message');
    expect((finalMessage!.data as { content: string }).content).toBe(FRESH);
  });

  it('a reply that parrots the version list back is retried once too', async () => {
    chatMock
      .mockResolvedValueOnce(response({ content: `版本1：${PREV}\n\n版本2：别的旧版。` }))
      .mockResolvedValueOnce(response({ content: FRESH }));

    const { events } = await collect(new AgentHarness(), '嗯。明天见面聊啥。', [PREV]);

    expect(chatMock).toHaveBeenCalledTimes(2);
    const finalMessage = [...events].reverse().find((e) => e.type === 'message');
    expect((finalMessage!.data as { content: string }).content).toBe(FRESH);
  });

  it('a normal turn sends no avoid-repeat directive and never retries', async () => {
    chatMock.mockResolvedValueOnce(response({ content: FRESH }));

    const { events } = await collect(new AgentHarness(), '聊聊怎么开场', undefined);

    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.type === 'thinking')).toHaveLength(1);
    const systemPrompt = (chatMock.mock.calls[0][0] as Message[])[0].content;
    expect(systemPrompt).not.toContain('已经展示给用户看过的回复版本');
  });
});
