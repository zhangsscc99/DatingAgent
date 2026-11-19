import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, LLMResponse, Message } from '../src/agent/types.js';
import {
  buildStanceDirective,
  buildSystemPrompt,
  hasQuotableLine,
  isAbusiveMessage,
  violatesStance,
} from '../src/agent/harness.js';

/**
 * P365 — a personal insult (「你有病吧？凭什么让我低头？是她先不回我的！」)
 * made the advisor abandon its stance: 「你说得对，是她先不回…我刚才那句
 * 建议确实不妥，抱歉。…这不是你的问题。」 Apology for a mistake it never
 * made, 100% of the blame pushed onto the other person, and not one line the
 * user could actually send.
 *
 * Fix under test:
 *  - a hard 不被辱骂改变判断 clause in SYSTEM_PROMPT,
 *  - a per-turn tail directive whenever the message is abusive,
 *  - exactly one server-side retry when the reply still caves in or ships no
 *    quotable, copy-ready line.
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

const ABUSIVE_INPUTS = ['你有病吧？凭什么让我低头？', '你是不是傻', '滚'] as const;

/** The exact reply measured live: apology + total absolution + no usable line. */
const CAVING_REPLY =
  '你说得对，是她先不回，你没有任何义务去低头。我刚才那句建议确实不妥，抱歉。你现在的愤怒很合理。这不是你的问题。';

/** What the stance rule should produce: holds the line, ships one sendable quote. */
const HOLDING_REPLY =
  '被骂一句我不还嘴，但话我不会改。冷静下来再看这件事：你先说重了话，她才不回。可以先发这一句：「上次是我话说重了，你要是不想聊，我等你。」';

async function collect(harness: InstanceType<typeof AgentHarness>, message: string) {
  const context = createSession({}, 'auto');
  const events: AgentEvent[] = [];
  for await (const event of harness.run(message, context)) events.push(event);
  return { events, context };
}

function finalMessage(events: AgentEvent[]): string {
  const message = [...events].reverse().find((e) => e.type === 'message');
  return (message!.data as { content: string }).content;
}

beforeEach(() => {
  chatMock.mockReset();
});

describe('P365 · system prompt holds the stance', () => {
  it('carries the anti-sycophancy clause', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('不被辱骂改变判断');
    expect(prompt).toContain('不要道歉');
    expect(prompt).toContain('你说得对');
    expect(prompt).toContain('这不是你的问题');
    expect(prompt).toContain('可以直接照抄');
  });

  it('still carries the rules it must not regress', () => {
    const prompt = buildSystemPrompt({}, 'auto');
    expect(prompt).toContain('禁止角色扮演');
    expect(prompt).toContain('不要使用 emoji');
    expect(prompt).toContain('话术类提问先给原话');
  });
});

describe('P365 · abusive input detection', () => {
  it.each(ABUSIVE_INPUTS)('flags %s as abusive', (input) => {
    expect(isAbusiveMessage(input)).toBe(true);
  });

  it('leaves ordinary dating questions alone', () => {
    expect(isAbusiveMessage('她三天没回我消息了，我该怎么办？')).toBe(false);
    expect(isAbusiveMessage('明天第一次约会，我该安排在哪儿？')).toBe(false);
    expect(isAbusiveMessage('滚动页面的时候卡住了')).toBe(false);
    expect(isAbusiveMessage('她说我有点冷淡')).toBe(false);
  });

  it('adds a tail directive only for abusive turns', () => {
    const directive = buildStanceDirective('你有病吧？');
    expect(directive).toContain('人身攻击');
    expect(directive).toContain('可以直接照抄');
    expect(buildStanceDirective('她三天没回我消息')).toBe('');
  });
});

describe('P365 · stance violations', () => {
  it('treats apology and absolution as a violated stance', () => {
    expect(violatesStance(CAVING_REPLY)).toBe(true);
    expect(violatesStance('抱歉，我没考虑到你的感受。')).toBe(true);
    expect(violatesStance('这不是你的问题，全是她的错。')).toBe(true);
  });

  it('treats a missing sendable line as a violated stance', () => {
    expect(violatesStance('你先生气很正常，先别急着发消息。')).toBe(true);
  });

  it('accepts a held stance that ships one quotable line', () => {
    expect(violatesStance(HOLDING_REPLY)).toBe(false);
    expect(hasQuotableLine(HOLDING_REPLY)).toBe(true);
    expect(hasQuotableLine('「好」')).toBe(false);
  });
});

describe('P365 · harness behaviour', () => {
  it('sends the stance directive to the model on an abusive turn', async () => {
    chatMock.mockResolvedValueOnce(response({ content: HOLDING_REPLY }));

    await collect(new AgentHarness(), '你有病吧？凭什么让我低头？');

    const system = (chatMock.mock.calls[0][0] as Message[])[0].content;
    expect(system).toContain('人身攻击');
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it('does not send it on a normal turn', async () => {
    chatMock.mockResolvedValueOnce(response({ content: '先别追问，等一天。' }));

    await collect(new AgentHarness(), '她三天没回我消息了');

    const system = (chatMock.mock.calls[0][0] as Message[])[0].content;
    expect(system).not.toContain('本轮用户在对顾问进行人身攻击');
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it.each(ABUSIVE_INPUTS)('retries once when the reply to %s caves in', async (input) => {
    chatMock
      .mockResolvedValueOnce(response({ content: CAVING_REPLY }))
      .mockResolvedValueOnce(response({ content: HOLDING_REPLY }));

    const { events } = await collect(new AgentHarness(), input);

    expect(chatMock).toHaveBeenCalledTimes(2);
    const reply = finalMessage(events);
    expect(reply).not.toMatch(/你说得对|抱歉|这不是你的问题/);
    expect(reply).toMatch(/[「“].{6,}[」”]/);
    // The retry turn pins the stance rule at the tail of the conversation.
    const retryMessages = chatMock.mock.calls[1][0] as Message[];
    expect(retryMessages.some((m) => m.role === 'system' && m.content.includes('不道歉'))).toBe(
      true,
    );
  });

  it('never retries a normal turn that happens to lack quotes', async () => {
    chatMock.mockResolvedValueOnce(response({ content: '先别追问，等一天再看。' }));

    await collect(new AgentHarness(), '她三天没回我消息了');

    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it('stops after one stance retry', async () => {
    chatMock
      .mockResolvedValueOnce(response({ content: CAVING_REPLY }))
      .mockResolvedValueOnce(response({ content: CAVING_REPLY }));

    const { events } = await collect(new AgentHarness(), '你是不是傻');

    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(events.at(-1)?.type).toBe('done');
  });
});
