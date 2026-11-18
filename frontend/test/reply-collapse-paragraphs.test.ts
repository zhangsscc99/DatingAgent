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
 * previews only its first three behind a 「展开更多」 toggle, even when it
 * is under the 800-character limit. The >800-char path and its 「展开全文」
 * wording are unchanged (P217). Vitest runs in node, so the collapsed
 * default is asserted on renderToStaticMarkup output and the expanded path
 * goes through the same pure helper the component renders.
 */

const P1 = '先回一句积极的，比如「好呀，我也正想看看那个展」。';
const P2 = '不用刻意显得不急，她的主动说明节奏是对的。';
const P3 = '定完时间后就别再追加解释，自然收尾就好。';
const P4 = '想让我帮你拟一句可以直接发出去的回复吗？';
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
    expect(FOUR_PARA.length).toBeLessThanOrEqual(REPLY_COLLAPSE_CHARS);
    expect(paragraphCount(LONG_REPLY)).toBe(1);
    expect(LONG_REPLY.length).toBeGreaterThan(REPLY_COLLAPSE_CHARS);
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

  it('the collapsed bubble renders 3 paragraphs plus a 展开更多 toggle', () => {
    const html = render(msg({ content: FOUR_PARA }));
    expect(html).toContain('collapse-toggle');
    expect(html).toContain('展开更多');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(P1.slice(0, 8));
    expect(html).toContain(P3.slice(0, 8));
    expect(html).not.toContain(P4);
    // The char-path label must not leak into a paragraph collapse.
    expect(html).not.toContain('展开全文');
  });

  it('a 2-paragraph reply is untouched — no collapse, no toggle', () => {
    expect(shouldCollapseReply(TWO_PARA)).toBe(false);
    expect(replyCollapseReason(TWO_PARA)).toBeNull();
    expect(collapseByParagraphs(TWO_PARA)).toBe(TWO_PARA);
    expect(visibleReplyContent(TWO_PARA, false)).toBe(TWO_PARA);
    const html = render(msg({ content: TWO_PARA }));
    expect(html).not.toContain('collapse-toggle');
    expect(html).not.toContain('展开更多');
    expect(html).toContain(P2.slice(0, 8));
  });

  it('the >800-char path still collapses exactly as before', () => {
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
    // …and the char-mode bubble keeps its original toggle wording.
    const html = render(msg({ content: LONG_REPLY }));
    expect(html).toContain('展开全文');
    expect(html).not.toContain('展开更多');
    expect(html).not.toContain(TAIL);
  });

  it('a fenced block with blank lines counts as one paragraph — no dangling ```', () => {
    const fenced =
      '示例代码：\n```\n第一段\n\n第二段\n```\n\n' +
      [P2, P3, P4].join('\n\n');
    expect(paragraphCount(fenced)).toBe(4);
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
