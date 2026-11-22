/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import {
  installFakeDom,
  jsonResponse,
  type FakeDom,
  type FakeElement,
} from './helpers/fakeDom';
import type { ChatMessage } from '../src/types';

/**
 * P438 — 实测 1795366246: of three assistant replies only the newest carried
 * 「换一个」 — ChatWindow handed onRegenerate to a single bubble id, so the
 * action row differed between same-kind bubbles and the user could not
 * predict which reply could be re-rolled. Every settled assistant bubble now
 * gets the handler (each re-rolls its own turn in place), so all three
 * .bubble-col.assistant rows carry both 「复制」 and 「换一个」. Mounted on
 * the repo fake DOM like message-actions.test.ts.
 */

const noop = () => {};

const user = (id: string, content: string): ChatMessage => ({
  id,
  role: 'user',
  content,
  createdAt: 1,
});
const assistant = (id: string, content: string): ChatMessage => ({
  id,
  role: 'assistant',
  content,
  createdAt: 2,
});

const MESSAGES: ChatMessage[] = [
  user('u1', '她今天回得很慢'),
  assistant('a1', '先接住她的情绪，别急着追问。'),
  user('u2', '我现在有点焦虑，怕聊死'),
  // The measured defect hit the long anxious reply — keep a long body here.
  assistant(
    'a2',
    '焦虑的时候最容易连发追问，反而把节奏弄乱。'.repeat(40),
  ),
  user('u3', '那我下一句发什么'),
  assistant('a3', '发一句轻的：「刚看到个展，想到你上次说想看」。'),
];

describe('P438 · every assistant bubble carries 复制 + 换一个', () => {
  let dom: FakeDom;
  let cols: FakeElement[];

  beforeAll(async () => {
    dom = installFakeDom();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ tools: [] })));
    const { createRoot } = await import('react-dom/client');
    const { default: ChatWindow } = await import('../src/components/ChatWindow');

    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(
        createElement(ChatWindow, {
          messages: MESSAGES,
          loading: false,
          onSend: noop,
          onRegenerate: noop,
          onToggleReplyVersion: noop,
        }),
      );
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
    cols = dom.document.querySelectorAll('.bubble-col.assistant');
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('all three assistant turns rendered', () => {
    expect(cols).toHaveLength(3);
  });

  it.each([0, 1, 2])('assistant bubble #%i offers both 复制 and 换一个', (i) => {
    const col = cols[i];
    const actions = col.querySelector('.bubble-actions');
    expect(actions, `bubble ${i}: .bubble-actions`).not.toBeNull();
    const copy = actions!.querySelector('.copy-btn');
    expect(copy, `bubble ${i}: .copy-btn`).not.toBeNull();
    expect(copy!.textContent).toContain('复制');
    const regen = actions!
      .querySelectorAll('.regen-btn')
      .find((b) => b.getAttribute('aria-label') === '重新生成回复');
    expect(regen, `bubble ${i}: 换一个 button`).toBeTruthy();
    expect(regen!.textContent).toContain('换一个');
  });

  it('the older bubbles are regenerable, not only the newest', async () => {
    const { regenerableMessageIds } = await import('../src/lib/chatSearchState');
    expect(regenerableMessageIds(MESSAGES)).toEqual(new Set(['a1', 'a2', 'a3']));
    const { regeneratePromptFor } = await import('../src/lib/regenerate');
    expect(regeneratePromptFor(MESSAGES, 'a1')).toBe('她今天回得很慢');
    expect(regeneratePromptFor(MESSAGES, 'a2')).toBe('我现在有点焦虑，怕聊死');
    expect(regeneratePromptFor(MESSAGES, 'a3')).toBe('那我下一句发什么');
  });
});
