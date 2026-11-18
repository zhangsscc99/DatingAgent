/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChatWindow from '../src/components/ChatWindow';
import {
  MEMORY_RECEIPT_MAX_ITEMS,
  MEMORY_RECEIPT_PREFIX,
  memoryReceiptLine,
  rememberedItems,
} from '../src/lib/memoryReceipt';
import { loadProfile, saveProfile } from '../src/lib/profileStorage';
import type { ChatMessage } from '../src/types';

/**
 * P293 — after three turns nothing on screen acknowledged what the agent
 * had remembered, and the profile card showed no receipt either. A quiet
 * 「已记住：…」 line now sits at the head of the conversation, derived only
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
  it('names up to two remembered items, prefixed with 已记住：', () => {
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

  it('caps the receipt at two items when more fields exist', () => {
    const items = rememberedItems({
      goals: '想认真谈恋爱',
      interests: ['徒步'],
      personality: '慢热',
    });
    expect(items).toHaveLength(MEMORY_RECEIPT_MAX_ITEMS);
    expect(items.join('')).not.toContain('慢热');
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
    expect(markup).toContain('已记住');
    // The line carries an actual stored field value.
    expect(markup).toContain('想认真谈恋爱');
    expect(markup).toContain('徒步');
  });

  it('renders nothing when the stored profile is empty', () => {
    stubStorage();
    expect(loadProfile()).toBeNull();
    const markup = renderChat({ profile: loadProfile() });
    expect(markup).not.toContain('memory-receipt');
    expect(markup).not.toContain('已记住');
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
    expect(markup).toContain('已记住');
    expect(markup).toContain('回答简短一些');
  });
});
