/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import {
  installFakeDom,
  FakeElement,
  FakeEvent,
  type FakeDom,
} from './helpers/fakeDom';
import type { ChatMessage } from '../src/types';

/**
 * P219 — the copy action under a user's own bubble was announced as
 * 「复制回复」 ("copy reply"), so a three-turn conversation read six
 * identical "copy reply" controls to a screen reader, half of them lying.
 * The label is now role-aware: user bubbles expose 「复制我的消息」, assistant
 * bubbles keep 「复制回复」; the icon, the clipboard payload and the
 * 1.5 s copied feedback are unchanged. Vitest runs in node, so the two
 * bubbles mount on the fake DOM (see ./helpers/fakeDom.ts) and the
 * clipboard write is observed through a navigator.clipboard spy.
 */

const USER: ChatMessage = {
  id: 'u-1',
  role: 'user',
  content: '她今天答应周末出来了',
  createdAt: 1,
};

const ASSISTANT: ChatMessage = {
  id: 'a-1',
  role: 'assistant',
  content: '可以回得开心但不过度激动。',
  createdAt: 1,
};

describe('P219 · role-aware copy label on bubbles', () => {
  let dom: FakeDom;
  let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
  };

  const click = async (el: FakeElement) => {
    await act(async () => {
      el.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
    });
  };

  const copyBtnIn = (row: FakeElement) => {
    const btn = row.querySelector('.copy-btn');
    expect(btn, '.copy-btn').not.toBeNull();
    return btn!;
  };

  beforeAll(async () => {
    dom = installFakeDom();
    writeText = vi.fn(async (_text: string) => {});
    const nav = navigator as unknown as Record<string, unknown>;
    nav.clipboard = { writeText };

    // react-dom must evaluate AFTER the fake DOM exists (canUseDOM).
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
          createElement(MessageBubble, { message: USER }),
          createElement(MessageBubble, { message: ASSISTANT }),
        ),
      );
    });
    await flush();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  const userRow = () => {
    const row = dom.document.querySelector('.bubble-row.user');
    expect(row, 'user row').not.toBeNull();
    return row!;
  };
  const assistantRow = () => {
    const row = dom.document.querySelector('.bubble-row.assistant');
    expect(row, 'assistant row').not.toBeNull();
    return row!;
  };

  it('the user bubble copy button is named 复制我的消息, never 回复', () => {
    const btn = copyBtnIn(userRow());
    const label = btn.getAttribute('aria-label') ?? '';
    expect(label).toBe('复制我的消息');
    expect(label).not.toContain('回复');
    expect(btn.getAttribute('title')).toBe('复制我的消息');
  });

  it('the assistant bubble copy button keeps 复制回复', () => {
    const btn = copyBtnIn(assistantRow());
    expect(btn.getAttribute('aria-label')).toBe('复制回复');
    expect(btn.getAttribute('title')).toBe('复制回复');
  });

  it('both copy controls are real <button type="button"> with the inline SVG', () => {
    for (const btn of [copyBtnIn(userRow()), copyBtnIn(assistantRow())]) {
      expect(btn.tagName).toBe('BUTTON');
      expect(btn.getAttribute('type')).toBe('button');
      const icon = btn.querySelector('svg');
      expect(icon, 'inline svg icon').not.toBeNull();
      expect(icon!.getAttribute('aria-hidden')).toBe('true');
      expect(btn.textContent).toContain('复制');
    }
  });

  it('clicking each button writes that bubble\'s own text to the clipboard', async () => {
    writeText.mockClear();
    await click(copyBtnIn(userRow()));
    await flush();
    expect(writeText).toHaveBeenLastCalledWith(USER.content);

    await click(copyBtnIn(assistantRow()));
    await flush();
    expect(writeText).toHaveBeenLastCalledWith(ASSISTANT.content);
    expect(writeText).toHaveBeenCalledTimes(2);
  });
});
