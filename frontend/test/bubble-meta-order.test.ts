/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createElement, act } from 'react';
import {
  installFakeDom,
  type FakeDom,
  type FakeElement,
  type FakeNode,
} from './helpers/fakeDom';
import type { ChatMessage } from '../src/types';

/**
 * P331 — the assistant bubble's age label used to render AFTER the
 * 「复制 / 换一个」 pill row, so the bubble bottom read body → buttons →
 * time like a footnote to the buttons. The fix pulls `.reply-meta` into
 * `.bubble-actions` as the row's first item (「刚刚 · 复制 · 换一个」 on
 * one line), and keeps it directly under the body when no action row
 * renders. Asserted: meta and actions share a visual row (rect tops within
 * 4 px) OR meta precedes actions in DOM order.
 *
 * Mounted on the fake DOM, same approach as bubble-tool-meta-label.test.ts.
 */

const NOW = Date.now();

const WITH_ACTIONS: ChatMessage = {
  id: 'a-actions',
  role: 'assistant',
  content: '可以先接住她的表情包，再顺着约咖啡。',
  createdAt: NOW,
  meta: { tokens: 120, latencyMs: 8800 },
};

/** Streaming bubble: no actions row, no meta — nothing to order. */
const STREAMING: ChatMessage = {
  id: 'a-streaming',
  role: 'assistant',
  content: '正在输入…',
  createdAt: NOW,
  streaming: true,
};

/** Depth-first document order: negative when `a` comes before `b`. */
const precedes = (a: FakeNode, b: FakeNode, root: FakeNode): boolean => {
  const order: FakeNode[] = [];
  const walk = (n: FakeNode) => {
    order.push(n);
    for (const c of n.childNodes) walk(c);
  };
  walk(root);
  return order.indexOf(a) > -1 && order.indexOf(a) < order.indexOf(b);
};

describe('P331 · bubble meta rides the action row, not below it', () => {
  let dom: FakeDom;

  const metaRows = () =>
    Array.from(dom.document.querySelectorAll('.reply-meta')) as FakeElement[];
  const actionRows = () =>
    Array.from(dom.document.querySelectorAll('.bubble-actions')) as FakeElement[];

  beforeAll(async () => {
    dom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const { default: MessageBubble } = await import('../src/components/MessageBubble');

    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(
        createElement(
          'div',
          null,
          createElement(MessageBubble, { message: WITH_ACTIONS }),
          createElement(MessageBubble, { message: STREAMING }),
        ),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  afterAll(() => {
    // fake DOM is process-global; nothing persistent to tear down
  });

  it('.reply-meta and .bubble-actions share one visual row or meta precedes actions', () => {
    const meta = metaRows()[0];
    const actions = actionRows()[0];
    expect(meta, 'meta row').toBeTruthy();
    expect(actions, 'actions row').toBeTruthy();

    const sameRow =
      Math.abs(
        meta.getBoundingClientRect().top - actions.getBoundingClientRect().top,
      ) <= 4;
    const metaFirst = precedes(meta, actions, dom.document.documentElement);
    // meta living inside the action row counts as the same visual row
    const nested = actions.contains(meta);
    expect(sameRow || metaFirst || nested).toBe(true);
  });

  it('the age label is the first item inside the action row', () => {
    const actions = actionRows()[0];
    const meta = metaRows()[0];
    expect(actions.contains(meta), 'meta inside .bubble-actions').toBe(true);
    const firstElementChild = actions.childNodes.find(
      (n): n is FakeElement => (n as FakeElement).classList !== undefined,
    );
    expect(firstElementChild).toBe(meta);
    // the single bottom row still reads 「刚刚 · 复制 · 换一个」
    expect(actions.textContent).toContain('刚刚');
    expect(actions.textContent).toContain('复制');
  });

  it('nothing renders after the action row inside the bubble', () => {
    const bubble = dom.document.querySelector('.bubble.assistant') as FakeElement;
    const last = bubble.childNodes[bubble.childNodes.length - 1] as FakeElement;
    expect(last.classList?.contains('bubble-actions')).toBe(true);
  });

  it('a streaming bubble still renders neither meta nor actions', () => {
    expect(metaRows()).toHaveLength(1);
    expect(actionRows()).toHaveLength(1);
  });
});
