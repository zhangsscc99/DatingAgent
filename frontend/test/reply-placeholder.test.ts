/// <reference types="node" />
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import { installFakeDom, type FakeDom, type FakeElement } from './helpers/fakeDom';
import MessageBubble from '../src/components/MessageBubble';
import { fillBracketSlots } from '../src/lib/replyPlaceholders';
import type { ChatMessage } from '../src/types';

/**
 * P334 — live replies carried the template slot verbatim: 「一直想去看那个
 * [某部电影/展]」 and 「最近发现一家很棒的[咖啡馆/展览]」. The backend now
 * rewrites slots before the reply ships, and the bubble applies the same
 * fillBracketSlots guard at render time so a placeholder can never reach
 * the DOM. Asserted on a mounted bubble: innerText never matches
 * /\[[^\]]{1,20}\]/ and the fallback phrase reads in place.
 */

const SLOT = /\[[^\]]{1,20}\]/;
const SLOT_FW = /【[^【】]{1,20}】/;

const assistant = (content: string): ChatMessage => ({
  id: 'a-1',
  role: 'assistant',
  content,
  createdAt: 2,
});

const user = (content: string): ChatMessage => ({ id: 'u-1', role: 'user', content });

describe('P334 · rendered AI bubble never shows a bracket slot', () => {
  let dom: FakeDom;
  let unmount: () => Promise<void>;

  const mount = async (message: ChatMessage): Promise<FakeElement> => {
    dom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    unmount = async () => {
      await act(async () => {
        root.unmount();
      });
      dom.document.body.textContent = '';
    };
    await act(async () => {
      root.render(createElement(MessageBubble, { message }));
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return dom.document.querySelector('.bubble') as FakeElement;
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('the two live-observed replies render their fallback phrases instead', async () => {
    let bubble = await mount(
      assistant('一直想去看那个[某部电影/展]，正愁没人陪，周六下午有空一起吗？'),
    );
    expect(bubble.textContent).not.toMatch(SLOT);
    expect(bubble.textContent).toContain('一直想去看一部电影');
    await unmount();

    bubble = await mount(assistant('最近发现一家很棒的[咖啡馆/展览]，感觉你会喜欢'));
    expect(bubble.textContent).not.toMatch(SLOT);
    expect(bubble.textContent).toContain('一家挺有氛围的小店');
    await unmount();
  });

  it('full-width 【】 slots and mid-stream text get the same guard', async () => {
    const bubble = await mount(assistant('约在了【某家餐厅/火锅店】等你'));
    expect(bubble.textContent).not.toMatch(SLOT);
    expect(bubble.textContent).not.toMatch(SLOT_FW);
    expect(bubble.textContent).toContain('一家挺有氛围的小店');
    await unmount();

    const streaming = await mount({ ...assistant('先看这个[某个展/电影]再去'), streaming: true });
    expect(streaming.textContent).not.toMatch(SLOT);
    expect(streaming.textContent).toContain('先看一个新开的展再去');
    await unmount();
  });

  it('a markdown link and inline code are not treated as slots', async () => {
    const bubble = await mount(assistant('看这个[攻略](https://example.com/a)吧，`arr[0]` 别动'));
    expect(bubble.textContent).toContain('攻略');
    expect(bubble.textContent).toContain('arr[0]');
    // The link text survives — only the slot shape is guarded.
    const anchor = bubble.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com/a');
    await unmount();
  });

  it('the user bubble is left untouched', async () => {
    const bubble = await mount(user('我喜欢[电影]这个表达'));
    expect(bubble.textContent).toContain('[电影]');
    await unmount();
  });
});

describe('P334 · fillBracketSlots fallback shapes', () => {
  it('rewrites the observed slots into natural phrases', () => {
    expect(fillBracketSlots('一直想去看那个[某部电影/展]，正愁没人陪')).toBe(
      '一直想去看一部电影，正愁没人陪',
    );
    expect(fillBracketSlots('最近发现一家很棒的[咖啡馆/展览]，感觉你会喜欢')).toBe(
      '最近发现一家挺有氛围的小店，感觉你会喜欢',
    );
  });

  it('keeps a describing adjective when the fill is a bare noun', () => {
    expect(fillBracketSlots('介绍他很棒的[朋友/哥们儿]给我')).toBe('介绍他很棒的朋友给我');
  });

  it('is idempotent and leaves clean text byte-identical', () => {
    const clean = '今晚先别想太多，好好睡一觉。';
    expect(fillBracketSlots(clean)).toBe(clean);
    const once = fillBracketSlots('约在了【某家餐厅/火锅店】等你');
    expect(fillBracketSlots(once)).toBe(once);
  });
});
