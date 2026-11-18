/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatWindow from '../src/components/ChatWindow';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONVERSATION_FACT_LEXICON,
  MEMORY_RECEIPT_MAX_ITEMS,
  MEMORY_RECEIPT_PREFIX,
  conversationFactItems,
  memoryReceiptItems,
  memoryReceiptLine,
  rememberedItems,
} from '../src/lib/memoryReceipt';
import { loadProfile, saveProfile } from '../src/lib/profileStorage';
import type { ChatMessage } from '../src/types';

/**
 * P293 — after three turns nothing on screen acknowledged what the agent
 * had remembered, and the profile card showed no receipt either. A quiet
 * 「记得你提到：…」 line now sits at the head of the conversation, derived only
 * from data the client already holds (the stored profile plus the
 * reply-length preference); it renders nothing when there is nothing
 * remembered. Same node-side harness as welcome-primary-cta.test.ts:
 * markup via renderToStaticMarkup, localStorage stubbed per case.
 */

const noop = () => {};

const threeTurns: ChatMessage[] = [
  { id: 'u1', role: 'user', content: '最近在聊一个同事' },
  { id: 'a1', role: 'assistant', content: '先说说你们现在的节奏。' },
  { id: 'u2', role: 'user', content: '她回复有点慢' },
  { id: 'a2', role: 'assistant', content: '慢一点不一定是坏事。' },
  { id: 'u3', role: 'user', content: '周末要不要约出来' },
  { id: 'a3', role: 'assistant', content: '可以，给一个轻量的提议。' },
];

/** P296: three real turns, no stored profile, concrete life facts stated. */
const factTurns: ChatMessage[] = [
  { id: 'u1', role: 'user', content: '我昨晚没睡好，一直在想怎么回她' },
  { id: 'a1', role: 'assistant', content: '先接住自己，再来想措辞。' },
  { id: 'u2', role: 'user', content: '周末本来想约她去看展' },
  { id: 'a2', role: 'assistant', content: '这个安排很轻，适合开口。' },
  { id: 'u3', role: 'user', content: '就是不知道她有没有空' },
  { id: 'a3', role: 'assistant', content: '可以先轻轻问一句时间。' },
];

function stubStorage(entries: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(entries));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

function renderChat(extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(ChatWindow, {
      messages: threeTurns,
      loading: false,
      onSend: noop,
      ...extra,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('P293 · memory receipt line derivation', () => {
  it('names up to two remembered items, prefixed with 记得你提到：', () => {
    const line = memoryReceiptLine({
      name: '阿宇',
      goals: '想认真谈恋爱',
      interests: ['徒步', '摄影'],
      personality: '慢热',
    });
    expect(line).not.toBeNull();
    expect(line!.startsWith(MEMORY_RECEIPT_PREFIX)).toBe(true);
    expect(line).toContain('想认真谈恋爱');
    expect(line).toContain('徒步');
  });

  it('caps the receipt at MEMORY_RECEIPT_MAX_ITEMS items when more fields exist', () => {
    const items = rememberedItems(
      {
        goals: '想认真谈恋爱',
        interests: ['徒步'],
        personality: '慢热',
      },
      'detailed',
    );
    expect(items).toHaveLength(MEMORY_RECEIPT_MAX_ITEMS);
    // The fourth candidate — the reply-length preference — is cut.
    expect(items.join('')).not.toContain('回答详细一些');
  });

  it('returns null when there is nothing remembered', () => {
    expect(memoryReceiptLine(null)).toBeNull();
    expect(memoryReceiptLine(undefined)).toBeNull();
    expect(memoryReceiptLine({})).toBeNull();
    expect(memoryReceiptLine({ name: '阿宇', interests: [] })).toBeNull();
    expect(
      memoryReceiptLine({ goals: '   ', personality: '\n' }),
    ).toBeNull();
  });

  it('a non-default reply-length preference counts as remembered', () => {
    expect(memoryReceiptLine(null, 'concise')).toContain('回答简短一些');
    expect(memoryReceiptLine(null, 'detailed')).toContain('回答详细一些');
  });

  it('clips an over-long field value to keep the line quiet', () => {
    const line = memoryReceiptLine({
      goals: '这是一个非常非常非常长而且详细的交友目标描述句子',
    });
    expect(line).toContain('…');
    expect(line!.length).toBeLessThan(40);
  });
});

describe('P293 · rendered receipt at the head of the conversation', () => {
  it('three turns plus stored profile fields renders the line with a field value', () => {
    stubStorage();
    saveProfile({
      name: '阿宇',
      goals: '想认真谈恋爱',
      interests: ['徒步', '摄影'],
    });
    const profile = loadProfile();
    expect(profile).not.toBeNull();

    const markup = renderChat({ profile });
    expect(markup).toContain('memory-receipt');
    expect(markup).toContain('记得你提到');
    // The line carries an actual stored field value.
    expect(markup).toContain('想认真谈恋爱');
    expect(markup).toContain('徒步');
  });

  it('renders nothing when the stored profile is empty', () => {
    stubStorage();
    expect(loadProfile()).toBeNull();
    const markup = renderChat({ profile: loadProfile() });
    expect(markup).not.toContain('memory-receipt');
    expect(markup).not.toContain('记得你提到');
  });

  it('renders nothing on the empty welcome screen even with a profile', () => {
    const markup = renderToStaticMarkup(
      createElement(ChatWindow, {
        messages: [] as ChatMessage[],
        loading: false,
        onSend: noop,
        profile: { name: '阿宇', goals: '想认真谈恋爱' },
      }),
    );
    expect(markup).not.toContain('memory-receipt');
  });

  it('renders nothing while the session is still restoring', () => {
    const markup = renderChat({
      restoring: true,
      profile: { name: '阿宇', goals: '想认真谈恋爱' },
    });
    expect(markup).not.toContain('memory-receipt');
  });

  it('a session-only preference still produces the receipt line', () => {
    const markup = renderChat({ replyLength: 'concise' });
    expect(markup).toContain('memory-receipt');
    expect(markup).toContain('记得你提到');
    expect(markup).toContain('回答简短一些');
  });
});

describe('P296 · durable facts mined from user messages', () => {
  it('names 没睡好 and 看展 from an empty-profile three-turn conversation', () => {
    const line = memoryReceiptLine(null, 'default', factTurns);
    expect(line).not.toBeNull();
    expect(line!.startsWith(MEMORY_RECEIPT_PREFIX)).toBe(true);
    expect(line).toContain('没睡好');
    expect(line).toContain('看展');
  });

  it('extracts facts only from user messages, in mention order, deduped', () => {
    const items = conversationFactItems([
      { role: 'assistant', content: '要不要一起去爬山' },
      { role: 'user', content: '最近加班有点多' },
      { role: 'user', content: '周末想去看展，之前说过加班' },
      { role: 'user', content: '还想去徒步' },
    ]);
    // 加班 first (mentioned first), 看展 second, 徒步 third; repeats deduped.
    expect(items).toEqual(['加班', '看展', '徒步']);
    expect(items.length).toBeLessThanOrEqual(MEMORY_RECEIPT_MAX_ITEMS);
    // Every emitted fact is a lexicon entry.
    for (const item of items) {
      expect(CONVERSATION_FACT_LEXICON).toContain(item);
    }
  });

  it('skips noise: tiny messages, fenced code blocks and URLs never count', () => {
    const items = conversationFactItems([
      { role: 'user', content: '哦' },
      { role: 'user', content: '看这段\n```\nconsole.log("没睡好")\n```' },
      { role: 'user', content: '链接在这 https://example.com/看展' },
    ]);
    expect(items).toEqual([]);
    expect(
      memoryReceiptLine(null, 'default', [
        { id: 'u1', role: 'user', content: '```\n加班\n```' },
      ]),
    ).toBeNull();
  });

  it('returns null for an empty message list, even with a profile', () => {
    expect(memoryReceiptLine(null, 'default', [])).toBeNull();
    expect(
      memoryReceiptLine({ goals: '想认真谈恋爱' }, 'default', []),
    ).toBeNull();
    // …and for a conversation with no user message at all.
    expect(
      memoryReceiptLine({ goals: '想认真谈恋爱' }, 'default', [
        { id: 'a1', role: 'assistant', content: '你好' },
      ]),
    ).toBeNull();
  });

  it('keeps the two-argument profile-only call byte-identical', () => {
    expect(
      memoryReceiptLine({
        goals: '想认真谈恋爱',
        interests: ['徒步', '摄影'],
        personality: '慢热',
      }),
    ).toBe('记得你提到：目标「想认真谈恋爱」；喜欢「徒步、摄影」；性格「慢热」');
    expect(memoryReceiptLine(null)).toBeNull();
    expect(memoryReceiptLine(null, 'concise')).toBe('记得你提到：偏好回答简短一些');
  });

  it('dedupes profile items against facts and never exceeds the cap', () => {
    const line = memoryReceiptLine(
      { interests: ['徒步'] },
      'default',
      [{ id: 'u1', role: 'user', content: '周末想去徒步再看展' }],
    );
    expect(line).toBe('记得你提到：喜欢「徒步」；看展');
    expect(line!.match(/徒步/g)).toHaveLength(1);
    expect(line!.split('；').length).toBeLessThanOrEqual(
      MEMORY_RECEIPT_MAX_ITEMS,
    );
  });
});

describe('P313 · three turns each carrying a distinct fact', () => {
  /** 看展 / 三小时没回消息 / 带闺蜜 — only 看展 matched the lexicon before. */
  const p313Turns: ChatMessage[] = [
    { id: 'u1', role: 'user', content: '周末本来想约她去看展' },
    { id: 'a1', role: 'assistant', content: '很轻的安排，适合开口。' },
    { id: 'u2', role: 'user', content: '她已经三个小时没回我消息了' },
    { id: 'a2', role: 'assistant', content: '先别连发，给她一点空间。' },
    { id: 'u3', role: 'user', content: '下次见面我想带闺蜜一起去' },
    { id: 'a3', role: 'assistant', content: '带个朋友反而自然，可以提。' },
  ];

  it('the receipt names at least two distinct fact keywords', () => {
    const line = memoryReceiptLine(null, 'default', p313Turns);
    expect(line).not.toBeNull();
    const hits = ['看展', '没回', '闺蜜'].filter((k) => line!.includes(k));
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('every turn contributes its own fact, in mention order', () => {
    const items = conversationFactItems(p313Turns, 10);
    expect(items).toEqual(['看展', '三个小时没回', '带闺蜜']);
  });

  it('a fact mentioned twice across turns is stored once', () => {
    const items = conversationFactItems(
      [
        { role: 'user', content: '她三个小时没回消息了' },
        { role: 'user', content: '对，已经三个小时没回' },
      ],
      10,
    );
    expect(items.filter((i) => i.includes('没回'))).toHaveLength(1);
  });

  it('one phrase yields one fact — no 没回消息 on top of 三个小时没回', () => {
    const items = conversationFactItems(
      [{ role: 'user', content: '她三个小时没回我消息了' }],
      10,
    );
    expect(items).toEqual(['三个小时没回']);
  });

  it('renders the capsule with two facts for an empty-profile user', () => {
    stubStorage();
    expect(loadProfile()).toBeNull();
    const markup = renderChat({ messages: p313Turns, profile: null });
    expect(markup).toContain('memory-receipt');
    const hits = ['看展', '没回', '闺蜜'].filter((k) => markup.includes(k));
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});

describe('P317 · the Round-87 reagent — three turns, three distinct facts', () => {
  /**
   * The live walkthrough sent 三小时没回消息 / 想问她在干嘛 / 周末看展 and
   * the receipt surfaced only 「看展」. The wait already matched after
   * P313; the stated intent 「想问她在干嘛」 matched nothing and was
   * dropped. Fixture phrasing mirrors the round-87 probe.
   */
  const p317Turns: ChatMessage[] = [
    { id: 'u1', role: 'user', content: '今天约她，她三小时没回消息，我有点慌。' },
    { id: 'a1', role: 'assistant', content: '先别急着补发，给她一点空间。' },
    { id: 'u2', role: 'user', content: '要不要再发一条？想问她在干嘛' },
    { id: 'a2', role: 'assistant', content: '不建议现在追问，先稳住。' },
    { id: 'u3', role: 'user', content: '周末本来约她去看展' },
    { id: 'a3', role: 'assistant', content: '轻轻确认一句就好。' },
  ];

  it('the receipt names at least two different fact keywords', () => {
    const line = memoryReceiptLine(null, 'default', p317Turns);
    expect(line).not.toBeNull();
    const hits = ['没回', '要不要', '想问', '看展'].filter((k) =>
      line!.includes(k),
    );
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('every turn admits a fact — the intent 想问她在干嘛 no longer drops', () => {
    const items = conversationFactItems(p317Turns, 10);
    expect(items).toContain('三小时没回');
    expect(items).toContain('看展');
    expect(items.some((i) => i.includes('想问'))).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(3);
  });

  it('stated intents are facts, but lexicon hits keep their cleaner labels', () => {
    // 「想约她去看展」 still surfaces as 看展, not a re-labelled intent.
    expect(
      conversationFactItems(
        [{ role: 'user', content: '周末本来想约她去看展' }],
        10,
      ),
    ).toEqual(['看展']);
    expect(
      conversationFactItems(
        [{ role: 'user', content: '下次见面我想带闺蜜一起去' }],
        10,
      ),
    ).toEqual(['带闺蜜']);
    // …and a bare 「要不要约出来」 is not a fact on its own.
    expect(
      conversationFactItems(
        [{ role: 'user', content: '周末要不要约出来' }],
        10,
      ),
    ).toEqual([]);
  });

  it('renders the capsule with a clickable 记忆 management entry and >= 2 facts', () => {
    stubStorage();
    expect(loadProfile()).toBeNull();
    const markup = renderChat({ messages: p317Turns, profile: null });
    expect(markup).toContain('<button type="button" class="memory-capsule"');
    expect(markup).toContain('aria-label="管理记忆"');
    const hits = ['没回', '要不要', '想问', '看展'].filter((k) =>
      markup.includes(k),
    );
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});

describe('P296 · rendered receipt without a stored profile', () => {
  it('three turns of concrete facts renders the line for an empty-profile user', () => {
    stubStorage();
    expect(loadProfile()).toBeNull();
    const markup = renderChat({ messages: factTurns, profile: null });
    expect(markup).toContain('memory-receipt');
    expect(markup).toContain('记得你提到');
    expect(markup).toContain('没睡好');
    expect(markup).toContain('看展');
  });

  it('renders nothing for an empty conversation without a profile', () => {
    const markup = renderChat({ messages: [] as ChatMessage[], profile: null });
    expect(markup).not.toContain('memory-receipt');
    expect(markup).not.toContain('记得你提到');
  });
});

describe('P323 · the Round-88 reagent — four turns, three remembered facts', () => {
  /**
   * The live walkthrough sent 三天没回 / 一直是我主动 / 明天第一次约会，
   * 穿什么 / 要不要提前到 and the receipt froze at 「三天没回」 — the
   * other three turns matched neither the lexicon nor a pattern. The
   * clause fallback now admits one anchored fact per turn and the cap
   * rises to three so the accumulation is visible.
   */
  const p323Turns: ChatMessage[] = [
    { id: 'u1', role: 'user', content: '她三天没回我' },
    { id: 'a1', role: 'assistant', content: '先别再发，给她一点空间。' },
    { id: 'u2', role: 'user', content: '一直是我主动' },
    { id: 'a2', role: 'assistant', content: '节奏失衡可以先点破。' },
    { id: 'u3', role: 'user', content: '明天第一次约会，穿什么' },
    { id: 'a3', role: 'assistant', content: '干净利落就好，别太用力。' },
    { id: 'u4', role: 'user', content: '要不要提前到' },
    { id: 'a4', role: 'assistant', content: '提前五到十分钟刚好。' },
  ];

  it('the receipt accumulates at least three distinct facts across four turns', () => {
    const items = memoryReceiptItems(null, 'default', p323Turns);
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(new Set(items).size).toBe(items.length);
    expect(items).toContain('三天没回');
    expect(items).toContain('一直是我主动');
    expect(items).toContain('明天第一次约会');
  });

  it('the rendered line names >= 3 fragments joined by ；', () => {
    const line = memoryReceiptLine(null, 'default', p323Turns);
    expect(line).not.toBeNull();
    expect(line!.startsWith(MEMORY_RECEIPT_PREFIX)).toBe(true);
    const fragments = ['三天没回', '一直是我主动', '明天第一次约会', '要不要提前到'];
    const hits = fragments.filter((f) => line!.includes(f));
    expect(hits.length).toBeGreaterThanOrEqual(3);
    // Full-width semicolons separate the named facts, one per boundary.
    expect(line!.split('；').length).toBeGreaterThanOrEqual(3);
  });

  it('every unmatched turn still contributes exactly one clause fact', () => {
    const items = conversationFactItems(p323Turns, 10);
    expect(items).toEqual([
      '三天没回',
      '一直是我主动',
      '明天第一次约会',
      '要不要提前到',
    ]);
  });

  it('390-wide: still a single capsule whose text can never wrap past one line', () => {
    stubStorage();
    const markup = renderChat({ messages: p323Turns, profile: null });
    expect(markup.match(/class="memory-capsule"/g)).toHaveLength(1);
    // The pill text ellipsises inside its capsule, so a three-fact line
    // stays one quiet line at 390×844 — never a second wrapped line.
    const css = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        'src',
        'components',
        'ChatWindow.css',
      ),
      'utf8',
    );
    const textRule = /\.memory-capsule-text\s*\{([^}]*)\}/.exec(css)![1];
    expect(textRule).toContain('white-space: nowrap');
    expect(textRule).toContain('overflow: hidden');
    expect(textRule).toContain('text-overflow: ellipsis');
    const capsuleRule = /\.memory-capsule\s*\{([^}]*)\}/.exec(css)![1];
    expect(capsuleRule).toContain('max-width: 100%');
  });
});
