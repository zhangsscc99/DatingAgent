/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import type { AgentContext } from '../../backend/src/agent/types.js';
import {
  extractMemoryFacts,
  rememberUserMessage,
  sessionMemoryFacts,
} from '../../backend/src/lib/memory-extract.js';
import {
  installFakeDom,
  type FakeDom,
} from './helpers/fakeDom';
import ChatWindow from '../src/components/ChatWindow';
import type {
  ChatMessage,
  ConversationMemory,
  MemoryFact,
} from '../src/types';

/**
 * P400 — seventh recurrence of the raw-hoisting memory defect
 * (walkthrough 1795128648, 390×844): after three emotional turns the
 * capsule listed 「记得 3 件事 / 她三天没回我消息 / 她明明看了消息就是
 * 不回 / 我可能是我自己不够好」 — the first pill a verbatim substring of
 * the session title (「她三天没回我消息，我该怎么办？」), the third a
 * malformed line whose prepended 我 collided with the body's own 我+
 * copula.
 *
 * The contract pinned here: (a) a candidate that is a verbatim
 * substring of the conversation title or of the user's own first
 * message is never stored as-is — drop it, or keep it only re-rendered
 * as a subject-led distilled statement; (b) malformed candidates —
 * duplicated copula/subject (我可能是我 / 是是我 / 我我 / 她她) or two
 * 是 inside the first six characters — are deterministically repaired
 * and re-gated, else dropped; (c) the capsule never repeats the title
 * nor shows two facts whose normalised text (punctuation, whitespace
 * and tail particles 了/的/啊/吧 stripped) contains one another.
 */

function freshContext(sessionId: string): AgentContext {
  return { sessionId, profile: {}, conversationHistory: [] };
}

describe('P400 · verbatim hoisting from the title / first message is never stored', () => {
  it('the fact clipped verbatim out of the first (title) message drops, and a verbatim restatement drops too', () => {
    const context = freshContext('s-p400-title');
    // The first user message derives the session title — a fact clipped
    // verbatim out of it renders the same sentence twice.
    rememberUserMessage(context, '她三天没回我消息，我该怎么办？', 1);
    expect(sessionMemoryFacts(context)).toEqual([]);

    context.conversationHistory.push(
      { role: 'user', content: '她三天没回我消息，我该怎么办？' },
      { role: 'assistant', content: '先别连发。' },
    );
    // A later turn that only restates the title clause verbatim is the
    // same echo — still not a fact.
    rememberUserMessage(context, '她三天没回我消息', 2);
    expect(sessionMemoryFacts(context)).toEqual([]);

    // A real statement that is not a verbatim substring of the title
    // still lands — the gate costs no recall on new information.
    rememberUserMessage(context, '她明明看了消息就是不回', 3);
    expect(sessionMemoryFacts(context).map((f) => f.text)).toEqual([
      '她明明看了消息就是不回',
    ]);
  });

  it('a subject-prepended rewrite is a distilled statement, not hoisting — it still lands', () => {
    const context = freshContext('s-p400-rewrite');
    // 「周末本来想约她去看展」 is the title source; the shaped fact
    // prepends the missing 我 — a re-rendered subject-led statement,
    // not a verbatim copy, so the gate keeps it.
    rememberUserMessage(context, '周末本来想约她去看展', 1);
    expect(sessionMemoryFacts(context).map((f) => f.text)).toEqual([
      '我周末本来想约她去看展',
    ]);
  });
});

describe('P400 · malformed candidates are repaired deterministically or dropped', () => {
  it('「算了，可能是我自己不够好」 never yields 「我可能是我自己不够好」', () => {
    const facts = extractMemoryFacts('算了，可能是我自己不够好');
    for (const fact of facts) {
      expect(fact.text).not.toMatch(/我可能是我/);
      expect(fact.text).not.toMatch(/是是我|我我|你你|她她|他他/);
    }
    // The deterministic repair drops the collided copula + repeated
    // subject: 「我可能是我…」 lands as the grammatical 「我可能自己不够
    // 好」 — same input, same output.
    expect(facts.some((f) => f.text === '我可能自己不够好')).toBe(true);
    expect(extractMemoryFacts('算了，可能是我自己不够好')).toEqual(facts);
  });

  it('「算了，可能是我，是我自己不够好」 yields no malformed line either', () => {
    for (const fact of extractMemoryFacts('算了，可能是我，是我自己不够好')) {
      expect(fact.text).not.toMatch(/我可能是我|是是我|我我|她她|他他/);
    }
    expect(
      extractMemoryFacts('算了，可能是我，是我自己不够好').some((f) =>
        /我可能是我/.test(f.text),
      ),
    ).toBe(false);
  });
});

describe('P400 · normalised-substring dedupe on the read path', () => {
  it('two stored facts whose keys contain one another collapse to the longer wording', () => {
    const context = freshContext('s-p400-dedupe');
    context.conversationHistory.push(
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '在。' },
    );
    context.memoryFacts = [
      { key: '她三天没回我消息了', text: '她三天没回我消息了', ts: 1 },
      { key: '她三天没回我消息', text: '她三天没回我消息', ts: 2 },
      { key: '我明天第一次约会', text: '我明天第一次约会', ts: 3 },
    ];
    // 了-stripping makes the first two keys identical — the first-stated
    // row wins; the unrelated fact keeps its slot.
    expect(sessionMemoryFacts(context).map((f) => f.text)).toEqual([
      '她三天没回我消息了',
      '我明天第一次约会',
    ]);
  });

  it('a pre-gate malformed shard is pruned on read', () => {
    const context = freshContext('s-p400-malformed');
    context.conversationHistory.push(
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '在。' },
    );
    context.memoryFacts = [
      { key: '我可能是我自己不够好', text: '我可能是我自己不够好', ts: 1 },
      { key: '她明明看了消息就是不回', text: '她明明看了消息就是不回', ts: 2 },
    ];
    expect(sessionMemoryFacts(context).map((f) => f.text)).toEqual([
      '她明明看了消息就是不回',
    ]);
  });
});

describe('P400 · facts pinned by earlier rounds still extract unchanged', () => {
  it('the P339/P366/P382 expectations hold', () => {
    expect(
      extractMemoryFacts('她说最近有点累，我是不是不该约了？').some(
        (f) => f.text === '她最近有点累',
      ),
    ).toBe(true);
    expect(extractMemoryFacts('我明天第一次约会')).toEqual([
      { key: '我明天第一次约会', text: '我明天第一次约会' },
    ]);
    expect(extractMemoryFacts('她三天没回我消息了')).toEqual([
      { key: '她三天没回我消息了', text: '她三天没回我消息了' },
    ]);
    const intents = extractMemoryFacts('我打算周末表白，我还喜欢她做的饭');
    expect(intents.some((f) => f.text.includes('我打算'))).toBe(true);
    expect(intents.some((f) => f.text.includes('喜欢'))).toBe(true);
    expect(
      extractMemoryFacts('明天第一次约会我该安排在哪儿').some(
        (f) => f.text === '我明天第一次约会',
      ),
    ).toBe(true);
  });
});

describe('P400 · the capsule never repeats the title nor renders a substring pair', () => {
  const noop = () => {};
  const TITLE = '她三天没回我消息，我该怎么办？';
  const turns: ChatMessage[] = [
    { id: 'u1', role: 'user', content: TITLE },
    { id: 'a1', role: 'assistant', content: '先别连发，给她一点空间。' },
  ];

  /**
   * A pre-gate shard: the first label is a verbatim substring of the
   * title, and the last two are a normalised substring pair.
   */
  const LABELS = [
    '她三天没回我消息',
    '她明明看了消息就是不回',
    '明天第一次约会',
    '我明天第一次约会',
  ];

  let dom: FakeDom;
  let root: Root | null = null;

  const qsa = (sel: string) => dom.document.querySelectorAll(sel);
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  beforeAll(async () => {
    dom = installFakeDom();
    const memory: ConversationMemory = {
      count: LABELS.length,
      items: LABELS.map((label, i) => ({
        key: `${label}#${i}`,
        text: label,
        ts: i + 1,
      })) as MemoryFact[],
    };
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const { createRoot } = await import('react-dom/client');
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root!.render(
        createElement(ChatWindow, {
          messages: turns,
          loading: false,
          onSend: noop,
          profile: null,
          sessionId: 's-p400',
          memory,
          onForgetMemory: noop,
          sessionTitle: TITLE,
        }),
      );
    });
    await flush();
  });

  afterAll(async () => {
    if (root) {
      const current = root;
      root = null;
      await act(async () => {
        current.unmount();
      });
    }
    vi.unstubAllGlobals();
  });

  it('the title echo drops, the shorter half of the pair drops, real facts stay', () => {
    const texts = qsa('span[data-fact]').map((el) => el.textContent ?? '');
    expect(texts).toEqual(['她明明看了消息就是不回', '我明天第一次约会']);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts).not.toContain('她三天没回我消息');
    expect(texts).not.toContain('明天第一次约会');
    // No pill is a normalised substring of the title or of another pill.
    const key = (s: string) =>
      s
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, '')
        .replace(/[了的啊吧]+$/u, '');
    const titleKey = key(TITLE);
    for (const text of texts) {
      expect(titleKey.includes(key(text))).toBe(false);
    }
    for (let i = 0; i < texts.length; i++) {
      for (let j = 0; j < texts.length; j++) {
        if (i === j) continue;
        expect(key(texts[j]).includes(key(texts[i])) && key(texts[i]) !== key(texts[j])).toBe(false);
      }
    }
  });
});
