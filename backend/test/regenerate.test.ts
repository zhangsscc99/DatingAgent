import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentContext, AgentEvent, LLMResponse, Message } from '../src/agent/types.js';
import {
  FACT_GROUNDING_RULE,
  buildAvoidRepeatDirective,
  buildSystemPrompt,
} from '../src/agent/harness.js';
import {
  REPLY_STRATEGIES,
  REPLY_STRATEGY_LABELS,
  extractReplyStrategy,
} from '../src/lib/reply-strategy.js';

/**
 * P370 — a Round 98 「换一个」 (third click, 6.4 s) produced a bubble whose
 * innerText began with the sidebar quick-entry label 「排约会 ✓」 followed
 * by a reply asserting preferences the user never stated (「刚好贴合你们
 * 爱美食、爱散步的节奏」 — the user had only asked where to arrange a first
 * date). Two contracts are pinned here:
 *
 *  - the regenerate turn never feeds UI chip labels to the model and never
 *    emits them in reply.content — no `label\n✓` line, no ✓ on the first
 *    non-empty line;
 *  - every turn's system prompt carries FACT_GROUNDING_RULE, so a reply
 *    cannot assert preferences the user never stated.
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

/** Sidebar quick-entry / tool labels that must never appear inside reply text. */
const CHIP_LABELS = [
  '排约会',
  '接话术',
  '改资料',
  '看匹配',
  '关系建议',
  '我们合不合适',
] as const;

/** The exact leak measured live: a chip label followed by its ✓ status glyph. */
const CHIP_LINE = /(排约会|接话术|改资料|看匹配|关系建议|我们合不合适)\s*\n?\s*✓/;

function firstNonEmptyLine(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? '';
}

/** Run one turn the way 「换一个」 issues it and return the final reply text. */
async function runTurn(message: string, previousReplies?: string[]): Promise<string> {
  const context = createSession({}, 'auto');
  const events: AgentEvent[] = [];
  for await (const event of new AgentHarness().run(
    message,
    context,
    undefined,
    undefined,
    previousReplies,
  )) {
    events.push(event);
  }
  const final = [...events].reverse().find((e) => e.type === 'message');
  return (final!.data as { content: string }).content;
}

beforeEach(() => {
  chatMock.mockReset();
});

/**
 * Three different openings × three consecutive 「换一个」 clicks each —
 * mirrors the walkthrough's third-click leak. `replies[0]` is the original
 * answer, the rest are the versions each regen returns.
 */
const STARTERS: { message: string; replies: string[] }[] = [
  {
    message: '明天第一次约会，我该安排在哪儿？',
    replies: [
      '第一次约会选人不太多的公共场所最稳：下午时段、两三个小时能自然收尾的地方，比如安静的咖啡馆或小型展览。',
      '换个思路：把第一次约会压到「一杯咖啡的时长」——约在工作日下午的咖啡店，聊得好再顺延，聊不动也好收场。',
      '再换一个角度：别安排太满，选你们交通都方便的商圈里一家安静小店，留退路也留余地。要问她一句平时偏好吗？',
      '还有一个方案：约周末下午的小型展览或市集，并肩看东西比面对面干坐更容易开启话题，预算也低。',
    ],
  },
  {
    message: '她昨天一整天没回我消息，我该怎么办？',
    replies: [
      '先别急着追问。一整天不回可能只是忙，今晚发一条不带压力的问候，比如「今天是不是特别忙？」',
      '换个做法：把追问换成一个轻量的话题钩子，发一件你今天的趣事，让她有台阶自然地接回来。',
      '再稳一点：今晚什么都别发，明天中午再丢一句日常关心。连着追问只会把她的忙变成压力。',
      '也可以先复盘时间线：她上一次回复是什么语气？如果只是忙，你的下一条就要轻；如果是冷下来，就换种问法。',
    ],
  },
  {
    message: '帮我看看交友资料怎么写更有吸引力',
    replies: [
      '示例：「你的职业，周末喜欢你的爱好一，最近在学你的爱好二。比起条件，更想聊生活里的小事。」这是示例，把里面的换成你自己的。你在哪个平台用这份资料？',
      '改写思路：把形容词换成场景——不写「热爱生活」，写你上周末真的做了什么。示例：「你的职业，上周刚跟朋友去了你的爱好一」。这是示例，占位槽换成你自己的经历。',
      '再换一版：「你的职业，平时你的爱好一，最近在琢磨你的爱好二——有同好的话直接来聊。」这是示例模板，槽位自己填。资料主打哪个平台？',
      '这一版走简洁路线：「你的职业，爱好一和爱好二轮流续命。想找个能一起逛展的。」占位符换成你的真实经历就能发。眼下资料最弱的是哪一块？',
    ],
  },
];

describe('P370 · regen replies never carry sidebar chip labels', () => {
  for (const starter of STARTERS) {
    it(`「换一个」×3 on 「${starter.message.slice(0, 14)}…」 — content stays chip-free`, async () => {
      const shown: string[] = [];
      for (const canned of starter.replies) {
        chatMock.mockImplementationOnce(async () => response({ content: canned }));
        const content = await runTurn(starter.message, shown.length ? [...shown] : undefined);

        expect(content).toBe(canned);
        expect(content).not.toMatch(CHIP_LINE);
        const head = firstNonEmptyLine(content);
        expect(head).not.toContain('✓');
        for (const label of CHIP_LABELS) expect(head).not.toContain(label);
        shown.push(content);
      }
      expect(chatMock).toHaveBeenCalledTimes(4);
    });
  }

  it('the model is never shown a chip label or ✓ line — the leak cannot be parroted', async () => {
    const starter = STARTERS[0];
    const shown: string[] = [];
    for (const canned of starter.replies) {
      chatMock.mockImplementationOnce(async () => response({ content: canned }));
      shown.push(
        await runTurn(starter.message, shown.length ? [...shown] : undefined),
      );
    }

    expect(chatMock).toHaveBeenCalledTimes(4);
    for (const call of chatMock.mock.calls) {
      for (const m of call[0] as Message[]) {
        expect(m.content).not.toMatch(CHIP_LINE);
        expect(m.content).not.toContain('✓');
        // No standalone UI-label line anywhere in the prompt either — the
        // labels may only ever appear inside a directive sentence.
        for (const line of m.content.split('\n')) {
          expect(line.trim()).not.toMatch(
            /^(排约会|接话术|改资料|看匹配|关系建议|我们合不合适)\s*✓?$/,
          );
        }
      }
    }
  });

  it('the regen directive itself forbids tool labels and invented preferences', () => {
    const directive = buildAvoidRepeatDirective(['旧回复一。', '旧回复二。']);
    expect(directive).toContain('工具标签');
    expect(directive).toContain('不要断言用户没提过的偏好');
    expect(directive).not.toMatch(CHIP_LINE);
  });
});

/**
 * P390 — three consecutive 「换一个」 clicks used to return the same advice
 * in new words (「晾着 + 找事做 + 别老看手机」 ×3): the dedupe rule only
 * forbade repeated sentences, so every version was a dead option. A regen
 * now must switch strategy dimension — one of 等待/轻量试探/明确收尾/
 * 转移注意力/自我调节 the chain has not used yet — and report its pick on a
 * trailing `strategy: <id>` marker the server strips before display.
 */
describe('P390 · 「换一个」 switches strategy each version', () => {
  const QUESTION = '她三天没回我消息了，我该怎么办？';
  const ORIGINAL = '先晾一晾别急着追问，把这几天的空档拿去干点自己的事。';

  /** Reply payloads the mocked model hands back, each ending in its marker. */
  interface CannedVersion {
    body: string;
    strategy: (typeof REPLY_STRATEGIES)[number];
  }
  const canned = (v: CannedVersion) => `${v.body}\nstrategy: ${v.strategy}`;

  /**
   * Run one 「换一个」 turn on a shared chain — same harness, same session,
   * same re-issued question — and return the reply object (content + the
   * strategy the model reported).
   */
  async function regen(
    harness: InstanceType<typeof AgentHarness>,
    context: AgentContext,
    shown: string[],
  ): Promise<{ content: string; strategy?: string }> {
    const events: AgentEvent[] = [];
    for await (const event of harness.run(
      QUESTION,
      context,
      undefined,
      undefined,
      [...shown],
    )) {
      events.push(event);
    }
    const final = [...events].reverse().find((e) => e.type === 'message');
    return final!.data as { content: string; strategy?: string };
  }

  it('mock LLM ×3: the 3 reply.strategy values are pairwise distinct and in the enum', async () => {
    const harness = new AgentHarness();
    const context = createSession({}, 'auto');
    const versions: CannedVersion[] = [
      {
        body: '给自己定一个 48 小时的期限，这期间一条消息都别发，期限到了再决定下一步。',
        strategy: 'wait',
      },
      {
        body: '今晚发一条不带压力的轻量消息，只分享一件你今天的趣事，不追问她为什么没回。',
        strategy: 'light_probe',
      },
      {
        body: '如果到周末还是没动静，就发一条收尾消息把话说开，体面地结束这个话题。',
        strategy: 'clear_close',
      },
    ];

    const shown = [ORIGINAL];
    const strategies: string[] = [];
    for (const version of versions) {
      chatMock.mockImplementationOnce(async () => response({ content: canned(version) }));
      const reply = await regen(harness, context, shown);

      // The marker line names the pick and never reaches the bubble.
      expect(reply.strategy).toBe(version.strategy);
      expect(reply.content).toBe(version.body);
      expect(reply.content).not.toMatch(/strategy|策略/i);
      strategies.push(reply.strategy!);
      shown.push(reply.content);
    }

    expect(chatMock).toHaveBeenCalledTimes(3);
    expect(new Set(strategies).size).toBe(3);
    for (const s of strategies) expect(REPLY_STRATEGIES).toContain(s);
  });

  it('version 2+ prompts exclude the strategies earlier versions reported', async () => {
    const harness = new AgentHarness();
    const context = createSession({}, 'auto');
    const shown = [ORIGINAL];

    chatMock.mockImplementationOnce(async () =>
      response({ content: '先等 48 小时再说。\nstrategy: wait' }),
    );
    const first = await regen(harness, context, shown);
    shown.push(first.content);

    chatMock.mockImplementationOnce(async () =>
      response({ content: '把注意力转到朋友聚会上去。\nstrategy: distraction' }),
    );
    const second = await regen(harness, context, shown);
    shown.push(second.content);

    const call2Prompt = String((chatMock.mock.calls[1][0] as Message[])[0].content);
    expect(call2Prompt).toContain('已经用过的策略');
    expect(call2Prompt).toContain('等待（wait）');
    expect(call2Prompt).toContain('不得使用已经用过的策略');
    expect(call2Prompt).toContain('strategy:');
    // The still-fresh routes stay on the menu.
    expect(call2Prompt).toContain('轻量试探（light_probe）');

    chatMock.mockImplementationOnce(async () =>
      response({ content: '先把自己的状态调整好。\nstrategy: self_regulation' }),
    );
    await regen(harness, context, shown);

    const call3Prompt = String((chatMock.mock.calls[2][0] as Message[])[0].content);
    expect(call3Prompt).toContain('等待（wait）');
    expect(call3Prompt).toContain('转移注意力（distraction）');
  });

  it('a regen reporting an already-used strategy is retried once', async () => {
    const harness = new AgentHarness();
    const context = createSession({}, 'auto');
    const shown = [ORIGINAL];

    chatMock.mockImplementationOnce(async () =>
      response({ content: '先等一等，别发。\nstrategy: wait' }),
    );
    const first = await regen(harness, context, shown);
    shown.push(first.content);

    chatMock
      .mockImplementationOnce(async () =>
        response({ content: '换个说法还是让你继续等。\nstrategy: wait' }),
      )
      .mockImplementationOnce(async () =>
        response({ content: '发一条轻量的问候试探一下她的状态。\nstrategy: light_probe' }),
      );

    const reply = await regen(harness, context, shown);

    expect(chatMock).toHaveBeenCalledTimes(3);
    expect(reply.strategy).toBe('light_probe');
    expect(reply.content).toBe('发一条轻量的问候试探一下她的状态。');
    // The retry turn carries a sharpened strategy-exclusion directive.
    const retryMessages = chatMock.mock.calls[2][0] as Message[];
    expect(
      retryMessages.some((m) => m.role === 'system' && m.content.includes('已经用过')),
    ).toBe(true);
  });

  it('the directive enumerates all five strategies and the marker contract', () => {
    const directive = buildAvoidRepeatDirective([ORIGINAL], ['wait' as const]);
    for (const s of REPLY_STRATEGIES) {
      expect(directive).toContain(`${REPLY_STRATEGY_LABELS[s]}（${s}）`);
    }
    expect(directive).toContain('已经用过的策略：等待（wait）');
    expect(directive).toContain('不得使用已经用过的策略');
    expect(directive).toContain('strategy:');
  });

  it('extractReplyStrategy strips the marker and resolves ids and labels', () => {
    expect(extractReplyStrategy('正文。\nstrategy: wait')).toEqual({
      text: '正文。',
      strategy: 'wait',
    });
    expect(extractReplyStrategy('正文。\n策略：明确收尾')).toEqual({
      text: '正文。',
      strategy: 'clear_close',
    });
    // A marker-shaped line with an unresolvable id is still stripped — a
    // malformed marker must never reach the bubble — and yields no strategy.
    expect(extractReplyStrategy('正文。\nstrategy: banana')).toEqual({
      text: '正文。',
    });
    // No marker at all → byte-identical content.
    expect(extractReplyStrategy('普通回复，没有任何标记。')).toEqual({
      text: '普通回复，没有任何标记。',
    });
  });
});

describe('P370 · unstated preferences are never asserted', () => {
  it('the fact-grounding rule is pinned in every turn’s system prompt', () => {
    expect(buildSystemPrompt({}, 'auto')).toContain(FACT_GROUNDING_RULE);
  });

  it('「明天第一次约会安排在哪」 earns no invented 美食/散步 preference', async () => {
    chatMock.mockImplementation(async (messages: Message[]) => {
      const system = String(messages[0]?.content ?? '');
      // Mirrors the live failure: the model asserts shared preferences only
      // when nothing in the prompt forbids it.
      return response({
        content: system.includes(FACT_GROUNDING_RULE)
          ? '第一次约会选你们交通都方便的安静公共场所，下午两三个小时的轻量安排最稳妥。她有提过想去的地方或想试的东西吗？'
          : '刚好贴合你们爱美食、爱散步的节奏，明天约菜市场小吃街准没错。',
      });
    });

    const content = await runTurn('明天第一次约会安排在哪');
    expect(content).not.toContain('美食');
    expect(content).not.toContain('散步');
  });
});
