/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import type { Root } from 'react-dom/client';
import {
  installFakeDom,
  FakeEvent,
  type FakeDom,
  type FakeElement,
} from './helpers/fakeDom';
import MessageBubble from '../src/components/MessageBubble';
import {
  REPLY_COLLAPSE_CHARS,
  collapseReplyPreview,
  hiddenReplyChars,
  replyCollapseReason,
  shouldCollapseReply,
} from '../src/lib/replyCollapse';
import type { ChatMessage } from '../src/types';

/**
 * P341 (and the P346 second observation) — a 175-char reply used to
 * collapse behind a silent 「展开更多」 whose hidden tail was usually the
 * most specific 「可以这样说」 line. Both collapse rules now share one
 * ~400-character floor, the toggle states what it hides (「展开剩余 N 字」),
 * and the preview fades out at its bottom edge. Asserted on a mounted
 * bubble: 180 chars renders whole, 600 chars collapses with the count,
 * and expanding restores innerText within ±5 chars of the promised N.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const bubbleCss = readFileSync(join(SRC, 'components', 'MessageBubble.css'), 'utf8');

const SENTENCE = '她在加班，先别急着追问。'; // 12 chars
// Exactly 180 chars, one paragraph — comfortably under the floor.
const SHORT_180 = SENTENCE.repeat(15);
// Exactly 600 chars, one paragraph — over the floor, char-cut preview.
const LONG_600 = SENTENCE.repeat(50);
// P346's actual shape: four short paragraphs (~186 chars total) that used
// to collapse purely on paragraph count.
const PARA = '先别急着追问，'.repeat(6); // 42 chars
const FOUR_SHORT_PARAS = [PARA, PARA, PARA, PARA].join('\n\n');
// A >400-char reply whose tail carries the line the defect hid.
const TAIL = '可以这样说：今晚别发了，明早再约她喝咖啡。';
const FOUR_LONG_PARAS = [
  SENTENCE.repeat(13), // 156
  SENTENCE.repeat(13), // 156
  SENTENCE.repeat(13), // 156
  TAIL + SENTENCE.repeat(10),
].join('\n\n');

const LABEL = /展开剩余 \d+ 字/;

const assistant = (content: string): ChatMessage => ({
  id: 'a-1',
  role: 'assistant',
  content,
  createdAt: 2,
});

describe('P341 · collapse floor and 「展开剩余 N 字」 toggle', () => {
  let dom: FakeDom;
  let root: Root;

  const mount = async (message: ChatMessage) => {
    dom = installFakeDom();
    const { createRoot } = await import('react-dom/client');
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    root = createRoot(container as unknown as HTMLElement);
    await act(async () => {
      root.render(createElement(MessageBubble, { message }));
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return {
      bubble: dom.document.querySelector('.bubble') as FakeElement,
      content: dom.document.querySelector('.bubble-content') as FakeElement,
      toggle: dom.document.querySelector('.collapse-toggle') as FakeElement | null,
    };
  };

  const unmount = async () => {
    await act(async () => {
      root.unmount();
    });
    dom.document.body.textContent = '';
  };

  const click = async (el: FakeElement) => {
    await act(async () => {
      el.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('fixtures pin the spec sizes and the shared 400-char floor', () => {
    expect(SHORT_180.length).toBe(180);
    expect(LONG_600.length).toBe(600);
    expect(REPLY_COLLAPSE_CHARS).toBe(400);
    expect(shouldCollapseReply(SHORT_180)).toBe(false);
    expect(shouldCollapseReply(LONG_600)).toBe(true);
  });

  it('a 180-char reply renders whole — no collapse toggle at all', async () => {
    const { bubble, toggle } = await mount(assistant(SHORT_180));
    expect(toggle).toBeNull();
    expect(bubble.textContent).not.toContain('展开更多');
    expect(bubble.textContent).not.toContain('展开剩余');
    expect(bubble.innerText).toContain(SHORT_180.slice(0, 12));
    await unmount();
  });

  it('P346 shape: a 4-paragraph reply under 400 chars no longer collapses', async () => {
    expect(FOUR_SHORT_PARAS.length).toBeLessThanOrEqual(REPLY_COLLAPSE_CHARS);
    expect(replyCollapseReason(FOUR_SHORT_PARAS)).toBeNull();
    const { toggle, content } = await mount(assistant(FOUR_SHORT_PARAS));
    expect(toggle).toBeNull();
    expect(content.innerText).toContain(PARA.slice(0, 7));
    await unmount();
  });

  it('a 600-char reply collapses with 「展开剩余 N 字」 and expands to N more chars', async () => {
    const { content, toggle } = await mount(assistant(LONG_600));
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent).toMatch(LABEL);
    expect(toggle!.getAttribute('aria-expanded')).toBe('false');
    // The promised count comes from the same helper the label renders.
    const n = Number(toggle!.textContent.match(/(\d+)/)![1]);
    expect(n).toBe(hiddenReplyChars(LONG_600));
    expect(n).toBe(LONG_600.length - (collapseReplyPreview(LONG_600).length - 1));

    // The preview fades at its bottom edge, then loses the fade on expand.
    const preview = content.querySelector('.reply-preview-collapsed');
    expect(preview, 'collapsed preview carries the fade class').not.toBeNull();

    const before = content.innerText.length;
    await click(toggle!);
    const after = content.innerText.length;
    const gained = after - before;
    expect(gained).toBeGreaterThan(0);
    expect(Math.abs(gained - n)).toBeLessThanOrEqual(5);

    const expanded = dom.document.querySelector('.collapse-toggle') as FakeElement;
    expect(expanded.textContent).toBe('收起');
    expect(expanded.getAttribute('aria-expanded')).toBe('true');
    expect(content.querySelector('.reply-preview-collapsed')).toBeNull();
    await unmount();
  });

  it('a >400-char multi-paragraph reply hides its tail and the label counts it', async () => {
    const { content, toggle } = await mount(assistant(FOUR_LONG_PARAS));
    expect(replyCollapseReason(FOUR_LONG_PARAS)).toBe('paragraphs');
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent).toMatch(LABEL);
    // The most specific line is the part that is folded away.
    expect(content.innerText).not.toContain('可以这样说');

    const before = content.innerText.length;
    const n = Number(toggle!.textContent.match(/(\d+)/)![1]);
    await click(toggle!);
    const gained = content.innerText.length - before;
    expect(content.innerText).toContain('可以这样说');
    expect(Math.abs(gained - n)).toBeLessThanOrEqual(5);
    await unmount();
  });

  it('the fade is a mask on the collapsed region, not an opaque overlay', () => {
    expect(bubbleCss).toContain('.reply-preview-collapsed');
    const rule = bubbleCss.slice(bubbleCss.indexOf('.reply-preview-collapsed'));
    expect(rule).toContain('mask-image');
    expect(rule).toContain('linear-gradient');
  });
});
