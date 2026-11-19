/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import {
  installFakeDom,
  type FakeDom,
} from './helpers/fakeDom';
import ChatWindow from '../src/components/ChatWindow';
import type { ChatMessage, ConversationMemory, MemoryFact } from '../src/types';

/**
 * P376 — sessions written before the same-event merge can hold two
 * keyed facts with one display text (「第一次约会安排在哪儿比较好」
 * stored verbatim next to 「明天第一次约会」), and the capsule used to
 * render every row as its own pill — the same sentence twice. The
 * capsule now drops the session-title echo and dedupes pill rows by
 * display text; the 管理记忆 panel still lists every stored key so a
 * duplicate can be forgotten.
 */

const noop = () => {};

const TITLE = '第一次约会安排在哪儿比较好？';

const turns: ChatMessage[] = [
  { id: 'u1', role: 'user', content: TITLE },
  { id: 'a1', role: 'assistant', content: '安静一点的地方最好聊。' },
];

/**
 * Five stored keys but only three distinct display texts: the session
 * title itself and a duplicate pair written by two turns that named the
 * same event differently.
 */
const FACT_LABELS = [
  TITLE,
  '她三天没回我消息了',
  '明天第一次约会',
  '明天第一次约会',
  '我昨晚没睡好',
];

describe('P376 · the capsule never renders the same fact text twice', () => {
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
      count: FACT_LABELS.length,
      items: FACT_LABELS.map((label, i) => ({
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
          sessionId: 's-p376',
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

  it('every [data-fact] text is unique — title echo and same-text dupes are gone', () => {
    const texts = qsa('span[data-fact]').map((el) => el.textContent ?? '');
    expect(texts).toEqual(['她三天没回我消息了', '明天第一次约会', '我昨晚没睡好']);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts).not.toContain(TITLE);
  });
});
