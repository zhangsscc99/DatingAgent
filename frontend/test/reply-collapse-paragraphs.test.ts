/// <reference types="node" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MessageBubble from '../src/components/MessageBubble';
import {
  REPLY_COLLAPSE_CHARS,
  REPLY_COLLAPSE_PARAGRAPHS,
  collapseByParagraphs,
  collapseReplyPreview,
  paragraphCount,
  replyCollapseReason,
  shouldCollapseReply,
  visibleReplyContent,
} from '../src/lib/replyCollapse';
import type { ChatMessage } from '../src/types';

/**
 * P301 — a settled assistant reply with more than 3 non-empty paragraphs
 * previews only its first three behind the collapse toggle. P341 moved
 * both rules behind one shared ~400-character floor — a 175-char reply
 * no longer folds at all — and the toggle now reads 「展开剩余 N 字」.
 * Vitest runs in node, so the collapsed default is asserted on
 * renderToStaticMarkup output and the expanded path goes through the
 * same pure helper the component renders.
 */

// 100-char paragraphs: 4 of them clear the P341 floor (~406 chars) while
// the first three still fit inside the preview (~304 chars).
const pad = (s: string) => (s + '再多说一点细节。'.repeat(30)).slice(0, 100);
const P1 = pad('先回一句积极的，比如「好呀，我也正想看看那个展」。');
const P2 = pad('不用刻意显得不急，她的主动说明节奏是对的。');
const P3 = pad('定完时间后就别再追加解释，自然收尾就好。');
const P4 = pad('想让我帮你拟一句可以直接发出去的回复吗？');
const FOUR_PARA = [P1, P2, P3, P4].join('\n\n');
const TWO_PARA = [P1, P2].join('\n\n');

// A single-paragraph reply past the character limit — the P217 path.
const TAIL = 'TAIL-最后一节的标记文字';
const LONG_REPLY = '细节展开段落，凑足长度。'.repeat(90) + '\n' + TAIL;

const msg = (partial: Partial<ChatMessage>): ChatMessage => ({
  id: 'm1',
  role: 'assistant',
  content: '',
  ...partial,
});

const render = (m: ChatMessage) =>
  renderToStaticMarkup(createElement(MessageBubble, { message: m }));

describe('P301 · paragraph-level reply collapse', () => {
  it('fixtures isolate the two rules', () => {
    expect(REPLY_COLLAPSE_PARAGRAPHS).toBe(3);
    expect(paragraphCount(FOUR_PARA)).toBe(4);
    // P341: the paragraph rule only fires past the shared char floor —
    // the fixture must clear it, and its first 3 paragraphs stay inside it.
    expect(FOUR_PARA.length).toBeGreaterThan(REPLY_COLLAPSE_CHARS);
    expect([P1, P2, P3].join('\n\n').length).toBeLessThanOrEqual(
      REPLY_COLLAPSE_CHARS,
    );
    expect(paragraphCount(LONG_REPLY)).toBe(1);
    expect(LONG_REPLY.length).toBeGreaterThan(REPLY_COLLAPSE_CHARS);
  });

  it('P341: a multi-paragraph reply at or under the floor never collapses', () => {
    const short = [P1.slice(0, 42), P2.slice(0, 42), P3.slice(0, 42), P4.slice(0, 42)].join(
      '\n\n',
    );
    expect(short.length).toBeLessThanOrEqual(REPLY_COLLAPSE_CHARS);
    expect(paragraphCount(short)).toBe(4);
    expect(replyCollapseReason(short)).toBeNull();
    expect(shouldCollapseReply(short)).toBe(false);
    const html = render(msg({ content: short }));
    expect(html).not.toContain('collapse-toggle');
  });

  it('a 4-paragraph reply collapses to exactly the first 3 paragraphs', () => {
    expect(replyCollapseReason(FOUR_PARA)).toBe('paragraphs');
    expect(collapseByParagraphs(FOUR_PARA)).toBe([P1, P2, P3].join('\n\n'));
    expect(collapseByParagraphs(FOUR_PARA, 2)).toBe([P1, P2].join('\n\n'));
    const preview = visibleReplyContent(FOUR_PARA, false);
    expect(preview).toContain(P1);
    expect(preview).toContain(P3);
    expect(preview).not.toContain(P4);
  });

  it('expanding restores the full text', () => {
    expect(visibleReplyContent(FOUR_PARA, true)).toBe(FOUR_PARA);
  });

  it('the collapsed bubble renders 3 paragraphs plus a counted toggle', () => {
    const html = render(msg({ content: FOUR_PARA }));
    expect(html).toContain('collapse-toggle');
    // P341: the toggle now states the hidden count for every collapse.
    expect(html).toMatch(/展开剩余 \d+ 字/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(P1.slice(0, 8));
    expect(html).toContain(P3.slice(0, 8));
    expect(html).not.toContain(P4);
    // The faded-preview hook rides on the collapsed body (P341).
    expect(html).toContain('reply-preview-collapsed');
  });

  it('a 2-paragraph reply is untouched — no collapse, no toggle', () => {
    expect(shouldCollapseReply(TWO_PARA)).toBe(false);
    expect(replyCollapseReason(TWO_PARA)).toBeNull();
    expect(collapseByParagraphs(TWO_PARA)).toBe(TWO_PARA);
    expect(visibleReplyContent(TWO_PARA, false)).toBe(TWO_PARA);
    const html = render(msg({ content: TWO_PARA }));
    expect(html).not.toContain('collapse-toggle');
    expect(html).not.toContain('展开剩余');
    expect(html).toContain(P2.slice(0, 8));
  });

  it('the >400-char single-paragraph path still collapses exactly as before', () => {
    expect(replyCollapseReason(LONG_REPLY)).toBe('chars');
    // Recompute the P217 algorithm here — the char path must match it
    // byte for byte: slice, back off to a line boundary, drop a dangling
    // fence, strip trailing markdown markers, append the ellipsis.
    let expected = LONG_REPLY.slice(0, REPLY_COLLAPSE_CHARS);
    const lastBreak = expected.lastIndexOf('\n');
    if (lastBreak > REPLY_COLLAPSE_CHARS - Math.floor(REPLY_COLLAPSE_CHARS / 6)) {
      expected = expected.slice(0, lastBreak);
    }
    const fenceRun = expected.match(/```/g);
    if (fenceRun && fenceRun.length % 2 === 1) {
      expected = expected.slice(0, expected.lastIndexOf('```'));
    }
    expected = expected.replace(/[\s>*#`|-]+$/, '') + '…';
    expect(collapseReplyPreview(LONG_REPLY)).toBe(expected);
    expect(visibleReplyContent(LONG_REPLY, false)).toBe(expected);
    // …and the char-mode bubble carries the same counted toggle (P341).
    const html = render(msg({ content: LONG_REPLY }));
    expect(html).toMatch(/展开剩余 \d+ 字/);
    expect(html).not.toContain(TAIL);
  });

  it('a fenced block with blank lines counts as one paragraph — no dangling ```', () => {
    const fenced =
      '示例代码：\n```\n第一段\n\n第二段\n```\n\n' +
      [P2, P3, P4, P1].join('\n\n');
    // P341: past the shared floor the paragraph preview still applies.
    expect(fenced.length).toBeGreaterThan(REPLY_COLLAPSE_CHARS);
    expect(paragraphCount(fenced)).toBe(5);
    const preview = collapseByParagraphs(fenced);
    // The fence block is kept whole inside the first three paragraphs.
    expect((preview.match(/```/g) ?? []).length % 2).toBe(0);
    expect(preview).toContain('第二段');
    expect(preview).not.toContain(P4);
    const rendered = collapseReplyPreview(fenced);
    expect((rendered.match(/```/g) ?? []).length % 2).toBe(0);
  });

  it('user and streaming bubbles never collapse, even with 4+ paragraphs', () => {
    expect(render(msg({ role: 'user', content: FOUR_PARA }))).not.toContain(
      'collapse-toggle',
    );
    expect(
      render(
        msg({ content: FOUR_PARA, streaming: true, streamPhase: 'generating' }),
      ),
    ).not.toContain('collapse-toggle');
  });
});
