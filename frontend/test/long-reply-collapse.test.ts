/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import MessageBubble from '../src/components/MessageBubble';
import {
  REPLY_COLLAPSE_CHARS,
  collapseReplyPreview,
  shouldCollapseReply,
  visibleReplyContent,
} from '../src/lib/replyCollapse';
import type { ChatMessage } from '../src/types';

/**
 * P217 — replies past ~800 characters collapse to a preview with a
 * 「展开全文 / 收起」 toggle at the bottom of the bubble; shorter replies
 * render exactly as before. Vitest runs in node, so the collapsed default
 * is asserted on renderToStaticMarkup output (useState initial value is
 * the collapsed state), the expanded path goes through the same pure
 * helper the component renders, and the click wiring is pinned at source
 * level — the same pattern as the other component tests in this repo.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const bubbleTsx = readFileSync(join(SRC, 'components', 'MessageBubble.tsx'), 'utf8');
const bubbleCss = readFileSync(join(SRC, 'components', 'MessageBubble.css'), 'utf8');

const TAIL = 'TAIL-最后一节的标记文字';

const LONG_REPLY =
  '先深呼吸，紧张说明你在乎。\n' +
  '穿什么：干净的纯色衬衫配深色长裤，利落最重要。\n' +
  '带什么：一盒茶叶或一袋水果，轻礼即可。\n' +
  '怎么开口：叔叔阿姨好，一直听她说你们做的菜很好吃。\n' +
  '细节展开段落，凑足长度。'.repeat(60) +
  '\n' +
  TAIL;

const SHORT_REPLY = '先深呼吸。穿干净的衬衫，带一盒茶叶，进门先问好。想细聊哪一块？';

const msg = (partial: Partial<ChatMessage>): ChatMessage => ({
  id: 'm1',
  role: 'assistant',
  content: '',
  ...partial,
});

const render = (m: ChatMessage) =>
  renderToStaticMarkup(createElement(MessageBubble, { message: m }));

describe('P217 · long assistant replies collapse behind 展开全文', () => {
  it('fixture really is over the limit', () => {
    expect(LONG_REPLY.length).toBeGreaterThan(REPLY_COLLAPSE_CHARS);
    expect(REPLY_COLLAPSE_CHARS).toBe(800);
  });

  it('a >800-char reply is collapsed by default with a 展开全文 control', () => {
    const html = render(msg({ content: LONG_REPLY }));
    expect(html).toContain('collapse-toggle');
    expect(html).toContain('展开全文');
    expect(html).toContain('aria-expanded="false"');
    // The tail past the cut point is not in the rendered bubble.
    expect(html).not.toContain(TAIL);
    // The head of the reply is still visible.
    expect(html).toContain('先深呼吸');
  });

  it('the expanded path renders the full text and flips the control to 收起', () => {
    // Same pure helper the component renders once replyExpanded is true.
    expect(visibleReplyContent(LONG_REPLY, true)).toBe(LONG_REPLY);
    expect(visibleReplyContent(LONG_REPLY, false)).not.toBe(LONG_REPLY);
    // Click wiring pinned at source level: toggle flips state, label and
    // aria-expanded follow it.
    expect(bubbleTsx).toContain('onClick={() => setReplyExpanded((v) => !v)}');
    expect(bubbleTsx).toContain("aria-expanded={replyExpanded}");
    expect(bubbleTsx).toContain("{replyExpanded ? '收起' : '展开全文'}");
  });

  it('a short reply renders no collapse control', () => {
    expect(SHORT_REPLY.length).toBeLessThanOrEqual(REPLY_COLLAPSE_CHARS);
    const html = render(msg({ content: SHORT_REPLY }));
    expect(html).not.toContain('collapse-toggle');
    expect(html).not.toContain('展开全文');
    expect(html).not.toContain('收起');
    expect(html).toContain(SHORT_REPLY.slice(0, 6));
  });

  it('user bubbles, streaming bubbles and error bubbles never collapse', () => {
    const userHtml = render(msg({ role: 'user', content: LONG_REPLY }));
    expect(userHtml).not.toContain('collapse-toggle');
    const streamingHtml = render(
      msg({ content: LONG_REPLY, streaming: true, streamPhase: 'generating' }),
    );
    expect(streamingHtml).not.toContain('collapse-toggle');
    const errorHtml = render(msg({ content: LONG_REPLY, error: true }));
    expect(errorHtml).not.toContain('collapse-toggle');
    // And the source gate spells out all three exclusions.
    const gate = bubbleTsx.slice(
      bubbleTsx.indexOf('const collapsible'),
      bubbleTsx.indexOf(';', bubbleTsx.indexOf('const collapsible')),
    );
    expect(gate).toContain('!isUser');
    expect(gate).toContain('!message.streaming');
    expect(gate).toContain('!message.error');
    expect(gate).toContain('shouldCollapseReply(bodyText)');
  });

  it('helper: threshold boundary and preview shape', () => {
    expect(shouldCollapseReply('x'.repeat(800))).toBe(false);
    expect(shouldCollapseReply('x'.repeat(801))).toBe(true);
    const preview = collapseReplyPreview(LONG_REPLY);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(REPLY_COLLAPSE_CHARS + 1);
    expect(preview).not.toContain(TAIL);
    // At/under-limit content passes through untouched.
    expect(collapseReplyPreview(SHORT_REPLY)).toBe(SHORT_REPLY);
  });

  it('the toggle sits at the bottom of the bubble, styled from existing tokens', () => {
    const contentEnd = bubbleTsx.indexOf('{collapsible && (');
    const stoppedNote = bubbleTsx.indexOf('{message.stopped && (');
    expect(contentEnd).toBeGreaterThan(-1);
    // The toggle renders right after .bubble-content, before stopped/regen
    // notes and the actions row — i.e. the bottom of the bubble body.
    expect(stoppedNote).toBeGreaterThan(contentEnd);
    expect(bubbleCss).toContain('.collapse-toggle');
    expect(bubbleCss).toContain('var(--border)');
    expect(bubbleCss).toContain('var(--text-muted)');
    expect(bubbleCss).toContain('var(--accent-soft)');
  });
});
